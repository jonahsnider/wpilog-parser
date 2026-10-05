import { describe, test } from 'vite-plus/test';
import { structPayloadToJson } from '../src/struct-payload-to-json.ts';
import type { StructPayload } from '../src/types.ts';

type StructPayloadValue = StructPayload extends Map<unknown, infer V> ? V : never;

describe('struct payload to JSON', () => {
	test.for([
		{ name: 'scalar', value: 42, expected: 42 },
		{
			name: 'nested struct',
			value: new Map([['__proto__', new Map([['value', 7]])]]),
			expected: { ['__proto__']: { value: 7 } },
		},
		{
			name: 'struct array',
			value: [new Map([['__proto__', new Map([['value', 7]])]])],
			expected: [{ ['__proto__']: { value: 7 } }],
		},
	])('preserves arbitrary keys for $name values', ({ value, expected }, { expect }) => {
		const payload: StructPayload = new Map<string, StructPayloadValue>([
			['__proto__', value],
			['constructor', 2],
			['hasOwnProperty', 3],
		]);
		const converted = structPayloadToJson(payload);
		expect(converted).toStrictEqual({ ['__proto__']: expected, constructor: 2, hasOwnProperty: 3 });
		expect(Object.getPrototypeOf(converted)).toBe(Object.prototype);
		expect(Object.getOwnPropertyDescriptor(converted, '__proto__')).toEqual({
			value: expected,
			enumerable: true,
			writable: true,
			configurable: true,
		});
		expect(JSON.parse(JSON.stringify(converted))).toStrictEqual(converted);
	});

	test('Translation2d', ({ expect }) => {
		const payload: StructPayload = new Map([
			['x', 1.0],
			['y', 2.0],
		]);

		const json = structPayloadToJson(payload);
		expect(json).toStrictEqual({ x: 1.0, y: 2.0 });
	});

	test('Pose2d', ({ expect }) => {
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
