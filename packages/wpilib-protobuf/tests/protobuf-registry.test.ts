import { describe, test } from 'vite-plus/test';
import { ProtobufRegistry } from '../src/index.ts';
import { descriptors, messages } from './helpers/fixtures.ts';

describe('ProtobufRegistry', () => {
	test('decodes WPILib messages into plain objects named like their structs', ({ expect }) => {
		const registry = new ProtobufRegistry();
		registry.register(descriptors.geometry2d);

		expect(registry.decode('wpi.proto.ProtobufPose2d', messages.pose)).toStrictEqual({
			translation: { x: 1.5, y: -2 },
			rotation: { value: 3 },
		});
	});

	test('waits for imported files registered later', ({ expect }) => {
		const registry = new ProtobufRegistry();
		registry.register(descriptors.trajectory);

		expect(registry.has('wpi.proto.ProtobufTrajectory')).toBe(false);
		expect(registry.decode('wpi.proto.ProtobufTrajectory', messages.trajectory)).toBe('wpi.proto.ProtobufTrajectory');

		registry.register(descriptors.geometry2d);

		expect(registry.has('wpi.proto.ProtobufTrajectory')).toBe(true);
		expect(registry.decode('wpi.proto.ProtobufTrajectory', messages.trajectory)).toStrictEqual({
			states: [
				{
					time: 0.5,
					velocity: 1.25,
					acceleration: 0,
					pose: { translation: { x: 1, y: 2 }, rotation: { value: 0.5 } },
					curvature: 0,
				},
				// Unset scalars have their default value, the unset pose is left out
				{ time: 1, velocity: 0, acceleration: 0, curvature: 0 },
			],
		});
	});

	test('decodes every kind of field', ({ expect }) => {
		const registry = new ProtobufRegistry();
		registry.register(descriptors.test);
		registry.register(descriptors.geometry2d);

		expect(registry.decode('test.Everything', messages.everything)).toStrictEqual({
			count: -9_007_199_254_740_993n,
			mode: 1,
			poses: [{ translation: { x: 1, y: 0 } }, {}],
			counts: { a: 1, b: 2 },
			angle: { value: 0.25 },
			data: new Uint8Array([1, 2]),
			values: [1.5, 2.5],
		});
		// Optional fields and oneof members are included when set, even to their default
		expect(registry.decode('test.Everything', messages.text)).toStrictEqual({
			count: 0n,
			maybe: 0,
			mode: 0,
			poses: [],
			counts: {},
			text: 'hi',
			data: new Uint8Array(),
			values: [],
		});
	});

	test('throws for invalid messages', ({ expect }) => {
		const registry = new ProtobufRegistry();
		registry.register(descriptors.geometry2d);

		expect(() => registry.decode('wpi.proto.ProtobufPose2d', new Uint8Array([0x0a, 0x05, 0x09]))).toThrow();
	});
});
