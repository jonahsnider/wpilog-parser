import { describe, expect, test } from 'vite-plus/test';
import { DataLogWriter, parseDataLog } from '../../src/index.ts';
import { descriptors, encodePose2d } from '../helpers/protobuf-fixtures.ts';

// No fixture log has protobuf entries, so these compare the same poses logged as protobuf and as structs
const POSES = Array.from({ length: 20_000 }, (_, index) => ({
	translation: { x: index * 0.001, y: index * -0.002 },
	rotation: { value: index * 0.0001 },
}));

async function writeLog(write: (writer: DataLogWriter) => void): Promise<Uint8Array> {
	const writer = new DataLogWriter();
	write(writer);
	writer.close();
	return new Uint8Array(await new Response(writer.readable).arrayBuffer());
}

const protobufLog = await writeLog((writer) => {
	const schema = writer.start('/.schema/proto:geometry2d.proto', 'proto:FileDescriptorProto', '', 0);
	writer.append(schema, descriptors.geometry2d, 0);
	const pose = writer.start('/Pose', 'proto:wpi.proto.ProtobufPose2d', '', 0);
	for (const [index, { translation, rotation }] of POSES.entries()) {
		writer.append(pose, encodePose2d(translation.x, translation.y, rotation.value), index * 20_000);
	}
});

const structLog = await writeLog((writer) => {
	writer.addStructSchema('Translation2d', 'double x;double y', 0);
	writer.addStructSchema('Rotation2d', 'double value', 0);
	writer.addStructSchema('Pose2d', 'Translation2d translation;Rotation2d rotation', 0);
	const pose = writer.start('/Pose', 'struct:Pose2d', '', 0);
	for (const [index, value] of POSES.entries()) {
		writer.append(pose, value, index * 20_000);
	}
});

// Same values from both logs, so the benchmarks do the same work
const decodedPoses = (bytes: Uint8Array) =>
	Array.from(parseDataLog(bytes)).flatMap((record) =>
		record.type === 'protobuf' || record.type === 'struct' ? [record.payload] : [],
	);
expect(decodedPoses(protobufLog)).toStrictEqual(POSES);
expect(decodedPoses(structLog)).toStrictEqual(POSES);

describe('20,000 Pose2d records', { concurrent: false }, () => {
	test('parseDataLog', async ({ bench }) => {
		const parse = (bytes: Uint8Array) => () => {
			for (const _record of parseDataLog(bytes)) {
				// discard
			}
		};
		await bench.compare(bench('struct', parse(structLog)), bench('protobuf', parse(protobufLog)));
	});
});
