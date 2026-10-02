import { describe, expect, test } from 'vite-plus/test';
import { structPayloadToJson } from '../src/struct-payload-to-json.ts';
import type { StructPayload } from '../src/types.ts';

type StructPayloadValue = StructPayload extends Map<unknown, infer V> ? V : never;

describe('struct payload to JSON', () => {
	test('Translation2d', () => {
		const payload: StructPayload = new Map([
			['x', 1.0],
			['y', 2.0],
		]);

		const json = structPayloadToJson(payload);
		expect(json).toStrictEqual({ x: 1.0, y: 2.0 });
	});

	test('Pose2d', () => {
		const payload: StructPayload = new Map<string, StructPayloadValue>([
			[
				'translation',
				new Map([
					['x', 1.0],
					['y', 2.0],
				]),
			],
			['rotation', 3.0],
		]);

		const json = structPayloadToJson(payload);
		expect(json).toStrictEqual({
			translation: { x: 1.0, y: 2.0 },
			rotation: 3.0,
		});
	});
});
