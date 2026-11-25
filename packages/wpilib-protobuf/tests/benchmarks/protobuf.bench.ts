import { describe, expect, test } from 'vite-plus/test';
import { ProtobufRegistry } from '../../src/index.ts';
import { descriptors, encodePose2d, encodeTrajectory } from '../helpers/fixtures.ts';

const registry = new ProtobufRegistry();
registry.register(descriptors.geometry2d);
registry.register(descriptors.trajectory);

// Varying payloads, so the benchmark doesn't decode one constant input
const poses = Array.from({ length: 32 }, (_, index) => encodePose2d(index * 0.5, index * -0.25, index * 0.1));
const trajectory = encodeTrajectory(100);
const decodePose = (bytes: Uint8Array) => registry.decode('wpi.proto.ProtobufPose2d', bytes);

// Check the inputs decode to the values they were encoded from, outside timed decoding
expect(decodePose(poses[3]!)).toStrictEqual({
	translation: { x: 1.5, y: -0.75 },
	rotation: { value: 0.30000000000000004 },
});
const decodedTrajectory = registry.decode('wpi.proto.ProtobufTrajectory', trajectory);
expect(typeof decodedTrajectory !== 'string' && decodedTrajectory.states).toHaveLength(100);

describe('ProtobufPose2d', { concurrent: false }, () => {
	test('decode 32 payloads (schemas already registered)', async ({ bench }) => {
		// Keep the decoded values observable to prevent dead-code elimination.
		let decoded: unknown[] = [];
		await bench('decode', () => (decoded = poses.map(decodePose))).run();
		expect(decoded).toHaveLength(poses.length);
	});

	test('register schema and decode first payload', async ({ bench }) => {
		let decoded: unknown;
		await bench('registration + first decode', () => {
			const fresh = new ProtobufRegistry();
			fresh.register(descriptors.geometry2d);
			decoded = fresh.decode('wpi.proto.ProtobufPose2d', poses[0]!);
		}).run();
		expect(decoded).toStrictEqual(decodePose(poses[0]!));
	});
});

describe('ProtobufTrajectory', { concurrent: false }, () => {
	test('decode a 100 state trajectory (schemas already registered)', async ({ bench }) => {
		let decoded: unknown;
		await bench('decode', () => (decoded = registry.decode('wpi.proto.ProtobufTrajectory', trajectory))).run();
		expect(decoded).toStrictEqual(decodedTrajectory);
	});
});
