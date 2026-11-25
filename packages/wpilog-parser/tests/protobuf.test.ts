import { describe, test } from 'vite-plus/test';
import { descriptors, messages } from './helpers/protobuf-fixtures.ts';
import {
	DataLogStreamParser,
	DataLogWriter,
	type DecodedRecord,
	decodeRecords,
	parseDataLog,
	readRecords,
} from '../src/index.ts';

async function logBytes(write: (writer: DataLogWriter) => void): Promise<Uint8Array> {
	const writer = new DataLogWriter();
	write(writer);
	writer.close();
	return new Uint8Array(await new Response(writer.readable).arrayBuffer());
}

const parsers: Record<string, (bytes: Uint8Array) => DecodedRecord[]> = {
	parseDataLog: (bytes) => Array.from(parseDataLog(bytes)),
	decodeRecords: (bytes) => Array.from(decodeRecords(readRecords(bytes))),
	DataLogStreamParser: (bytes) => Array.from(new DataLogStreamParser().push(bytes)),
};

describe('protobuf entries', () => {
	test.for(Object.keys(parsers))('decodes messages logged before their schemas (%s)', async (parser, { expect }) => {
		// WPILib logs a file's imports before it, these arrive in the worst order
		const bytes = await logBytes((writer) => {
			const trajectory = writer.start('/Trajectory', 'proto:wpi.proto.ProtobufTrajectory', '', 0);
			writer.append(trajectory, messages.trajectory, 1000);
			const trajectorySchema = writer.start('/.schema/proto:trajectory.proto', 'proto:FileDescriptorProto', '', 0);
			writer.append(trajectorySchema, descriptors.trajectory, 2000);
			const geometrySchema = writer.start('/.schema/proto:geometry2d.proto', 'proto:FileDescriptorProto', '', 0);
			writer.append(geometrySchema, descriptors.geometry2d, 3000);
			const pose = writer.start('/Pose', 'proto:wpi.proto.ProtobufPose2d', '', 0);
			writer.append(pose, messages.pose, 4000);
		});

		const records = parsers[parser]!(bytes).flatMap((record) => {
			if (record.type === 'control') return [];
			const { entry, ...rest } = record;
			return [{ name: entry.name, ...rest }];
		});

		expect(records).toStrictEqual([
			{ name: '/.schema/proto:trajectory.proto', timestamp: 2000, type: 'raw', payload: descriptors.trajectory },
			{ name: '/.schema/proto:geometry2d.proto', timestamp: 3000, type: 'raw', payload: descriptors.geometry2d },
			// Decoded once the last file it uses is logged, keeping its own timestamp
			{
				name: '/Trajectory',
				timestamp: 1000,
				type: 'protobuf',
				messageName: 'wpi.proto.ProtobufTrajectory',
				payload: {
					states: [
						{
							time: 0.5,
							velocity: 1.25,
							acceleration: 0,
							pose: { translation: { x: 1, y: 2 }, rotation: { value: 0.5 } },
							curvature: 0,
						},
						{ time: 1, velocity: 0, acceleration: 0, curvature: 0 },
					],
				},
			},
			{
				name: '/Pose',
				timestamp: 4000,
				type: 'protobuf',
				messageName: 'wpi.proto.ProtobufPose2d',
				payload: { translation: { x: 1.5, y: -2 }, rotation: { value: 3 } },
			},
		]);
	});

	const invalid = new Uint8Array([0x0a, 0x05, 0x09]);

	test('yields invalid schemas and messages as raw records with invalidValues', async ({ expect }) => {
		const bytes = await logBytes((writer) => {
			const pose = writer.start('/Pose', 'proto:wpi.proto.ProtobufPose2d', '', 0);
			// Logged before the schema, so they're decoded when it arrives
			writer.append(pose, invalid, 1000);
			writer.append(pose, messages.pose, 2000);
			const badSchema = writer.start('/.schema/proto:bad.proto', 'proto:FileDescriptorProto', '', 0);
			writer.append(badSchema, invalid, 3000);
			const schema = writer.start('/.schema/proto:geometry2d.proto', 'proto:FileDescriptorProto', '', 0);
			writer.append(schema, descriptors.geometry2d, 4000);
			writer.append(pose, invalid, 5000);
		});

		const records = Array.from(parseDataLog(bytes, { strict: true, invalidValues: 'raw' })).flatMap((record) =>
			record.type === 'control' ? [] : [{ name: record.entry.name, type: record.type, payload: record.payload }],
		);

		const pose = { translation: { x: 1.5, y: -2 }, rotation: { value: 3 } };
		expect(records).toStrictEqual([
			{ name: '/.schema/proto:bad.proto', type: 'raw', payload: invalid },
			{ name: '/.schema/proto:geometry2d.proto', type: 'raw', payload: descriptors.geometry2d },
			// The invalid message doesn't stop the valid one waiting for the same schema
			{ name: '/Pose', type: 'raw', payload: invalid },
			{ name: '/Pose', type: 'protobuf', payload: pose },
			{ name: '/Pose', type: 'raw', payload: invalid },
		]);
	});

	test('throws for invalid messages by default', async ({ expect }) => {
		const bytes = await logBytes((writer) => {
			const schema = writer.start('/.schema/proto:geometry2d.proto', 'proto:FileDescriptorProto');
			writer.append(schema, descriptors.geometry2d);
			const pose = writer.start('/Pose', 'proto:wpi.proto.ProtobufPose2d');
			writer.append(pose, invalid);
		});

		expect(() => Array.from(parseDataLog(bytes))).toThrowError(
			'Invalid wpi.proto.ProtobufPose2d protobuf message in /Pose',
		);
	});

	test('throws for invalid schemas by default', async ({ expect }) => {
		const bytes = await logBytes((writer) => {
			const schema = writer.start('/.schema/proto:geometry2d.proto', 'proto:FileDescriptorProto');
			writer.append(schema, invalid);
		});

		expect(() => Array.from(parseDataLog(bytes))).toThrowError(
			'Invalid protobuf schema in /.schema/proto:geometry2d.proto',
		);
	});
});
