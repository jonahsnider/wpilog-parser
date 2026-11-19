import type { StructPayload } from '../src/types.ts';
import { describe, expect, test, vi } from 'vite-plus/test';
import { StructRegistry } from '../src/struct-registry.ts';
import { compileStructClosures } from '../src/compile-struct-closures.ts';
import { compileStruct } from '../src/compile-struct.ts';
import { compileStructEncoderClosures } from '../src/compile-struct-encoder-closures.ts';
import { compileStructEncoder } from '../src/compile-struct-encoder.ts';
import { createStructFixture, STRUCT_FIXTURES } from './helpers/struct-fixtures.ts';

function compileAndSnapshot<T>(
	registry: StructRegistry,
	name: string,
	compile: (registry: StructRegistry, name: string) => T,
): T {
	// Capture the full factory source, including nested functions that
	// would be absent from the returned function's toString().
	const constructor = vi.spyOn(globalThis, 'Function');
	try {
		const compiled = compile(registry, name);
		expect(constructor.mock.calls).toMatchSnapshot(name);
		return compiled;
	} finally {
		constructor.mockRestore();
	}
}

function expectDecodersMatch(registry: StructRegistry, name: string, bytes: Uint8Array, expected: StructPayload) {
	const generated = compileStruct(registry, name);
	const closures = compileStructClosures(registry, name);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	expect(generated(view, bytes, 0)).toStrictEqual(expected);
	expect(closures(view, bytes, 0)).toStrictEqual(expected);
}

describe('compiled struct decoder', { concurrent: false }, () => {
	// Source snapshots spy on the global Function constructor and run sequentially.
	test.for(STRUCT_FIXTURES)('$name matches closure compilation', (fixture) => {
		const { registry, payloads } = createStructFixture(fixture);
		const decoder = compileAndSnapshot(registry, fixture.name, compileStruct);
		const closures = compileStructClosures(registry, fixture.name);
		for (const bytes of payloads) {
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const expected = closures(view, bytes, 0);
			expect(decoder(view, bytes, 0)).toStrictEqual(expected);
		}
	});

	test('handles primitives, arrays, strings and enums', () => {
		const registry = new StructRegistry();
		registry.register(
			'AllTypes',
			'bool flags[2];int8 a;uint8 b;int16 c;uint16 d;int32 e;uint32 f;int64 g;uint64 h;float i;float32 j;double k;float64 l;char text[4];char letter;enum {off=0,on=1} uint8 mode;int16 values[2]',
		);
		compileAndSnapshot(registry, 'AllTypes', compileStruct);
		const bytes = new Uint8Array(66);
		const view = new DataView(bytes.buffer);
		bytes.set([0, 2, 0xfd, 255]);
		view.setInt16(4, -1234, true);
		view.setUint16(6, 54321, true);
		view.setInt32(8, -1234567, true);
		view.setUint32(12, 3456789012, true);
		view.setBigInt64(16, -1234567890123456789n, true);
		view.setBigUint64(24, 12345678901234567890n, true);
		view.setFloat32(32, 1.25, true);
		view.setFloat32(36, -2.5, true);
		view.setFloat64(40, 3.75, true);
		view.setFloat64(48, -4.125, true);
		bytes.set(new TextEncoder().encode('éabZ'), 56);
		view.setUint8(61, 1);
		view.setInt16(62, -2, true);
		view.setInt16(64, 3, true);
		const expected = {
			flags: [false, true],
			a: -3,
			b: 255,
			c: -1234,
			d: 54321,
			e: -1234567,
			f: 3456789012,
			g: -1234567890123456789n,
			h: 12345678901234567890n,
			i: 1.25,
			j: -2.5,
			k: 3.75,
			l: -4.125,
			text: 'éab',
			letter: 'Z',
			mode: 1,
			values: [-2, 3],
		};
		expect(registry.decode('AllTypes', bytes)).toStrictEqual(expected);
		expectDecodersMatch(registry, 'AllTypes', bytes, expected);
	});

	test('bit fields cross storage boundaries and sign extend', () => {
		const registry = new StructRegistry();
		registry.register('Bits', 'int8 low:4;uint8 high:4;uint16 wide:9;bool flag:1;int64 signed:5;uint8 tail');
		compileAndSnapshot(registry, 'Bits', compileStruct);
		const bytes = new Uint8Array(12);
		bytes.set([0xbd, 0x01, 0x03]);
		new DataView(bytes.buffer).setBigUint64(3, 0b11101n, true);
		bytes[11] = 127;
		const expected = { low: -3, high: 11, wide: 257, flag: true, signed: -3n, tail: 127 };
		expect(registry.decode('Bits', bytes)).toStrictEqual(expected);
		expectDecodersMatch(registry, 'Bits', bytes, expected);
	});

	test('treats unusual field names as own properties', () => {
		const registry = new StructRegistry();
		registry.register('Names', 'uint8 __proto__;uint8 constructor;uint8 default');
		compileAndSnapshot(registry, 'Names', compileStruct);
		const bytes = new Uint8Array([1, 2, 3]);
		const decoded = registry.decode('Names', bytes) as StructPayload;
		const expected = [
			['__proto__', 1],
			['constructor', 2],
			['default', 3],
		];
		expect(Object.entries(decoded)).toStrictEqual(expected);
		const closures = compileStructClosures(registry, 'Names');
		expect(Object.entries(closures(new DataView(bytes.buffer), bytes, 0))).toStrictEqual(expected);
	});

	test('accounts for trailing bit-field storage in nested arrays', () => {
		const registry = new StructRegistry();
		registry.register('Inner', 'int8 value:4;bool flag:1');
		registry.register('Outer', 'uint8 prefix;Inner items[2];uint8 tail');
		compileAndSnapshot(registry, 'Outer', compileStruct);
		const bytes = new Uint8Array([42, 0x1d, 0x07, 255]);
		const expected = {
			prefix: 42,
			items: [
				{ value: -3, flag: true },
				{ value: 7, flag: false },
			],
			tail: 255,
		};
		expect(registry.decode('Outer', bytes)).toStrictEqual(expected);
		expectDecodersMatch(registry, 'Outer', bytes, expected);
	});

	test.concurrent('rejects truncated numeric payloads', ({ expect }) => {
		const registry = new StructRegistry();
		registry.register('Value', 'double value');
		expect(() => registry.decode('Value', new Uint8Array(7))).toThrow(RangeError);
	});
});

describe('compiled struct encoder', { concurrent: false }, () => {
	function encodeBoth(registry: StructRegistry, name: string, value: unknown) {
		const size = registry.getByteLength(name) as number;
		return [compileStructEncoder, compileStructEncoderClosures].map((compile) => {
			const bytes = new Uint8Array(size);
			try {
				compile(registry, name)(new DataView(bytes.buffer), bytes, 0, value);
				return bytes;
			} catch (error) {
				return error;
			}
		});
	}

	test('uses the Function constructor', () => {
		const constructor = vi.spyOn(globalThis, 'Function');
		try {
			const registry = new StructRegistry();
			registry.register('Value', 'uint8 value');
			expect(registry.encode('Value', { value: 1 })).toStrictEqual(new Uint8Array([1]));
			expect(constructor).toHaveBeenCalled();
		} finally {
			constructor.mockRestore();
		}
	});

	test.for(STRUCT_FIXTURES)('$name matches closure compilation', (fixture) => {
		const { registry, payloads } = createStructFixture(fixture);
		compileAndSnapshot(registry, fixture.name, compileStructEncoder);
		for (const bytes of payloads) {
			const value = registry.decode(fixture.name, bytes);
			const [generated, closures] = encodeBoth(registry, fixture.name, value);
			expect(generated).toStrictEqual(bytes.slice());
			expect(closures).toStrictEqual(bytes.slice());
		}
	});

	test.for([
		{
			name: 'AllTypes',
			schemas: {
				AllTypes:
					'bool flags[2];int8 a;uint8 b;int16 c;uint16 d;int32 e;uint32 f;int64 g;uint64 h;float i;float32 j;double k;float64 l;char text[4];char letter;enum {off=0,on=1} uint8 mode;int16 values[2]',
			},
			value: {
				flags: [false, true],
				a: -3,
				b: 255,
				c: -1234,
				d: 54321,
				e: -1234567,
				f: 3456789012,
				g: -1234567890123456789n,
				h: 12345678901234567890n,
				i: 1.25,
				j: -2.5,
				k: 3.75,
				l: -4.125,
				text: 'éab',
				letter: 'Z',
				mode: 1,
				values: [-2, 3],
			},
		},
		{
			name: 'Bits',
			schemas: { Bits: 'int8 low:4;uint8 high:4;uint16 wide:9;bool flag:1;int64 signed:5;uint8 tail' },
			value: { low: -3, high: 11, wide: 257, flag: true, signed: -3n, tail: 127 },
			bytes: [0xbd, 0x01, 0x03, 0b11101, 0, 0, 0, 0, 0, 0, 0, 127],
		},
		{
			name: 'Names',
			schemas: { Names: 'uint8 __proto__;uint8 constructor;uint8 default' },
			value: Object.fromEntries([
				['__proto__', 1],
				['constructor', 2],
				['default', 3],
			]),
			bytes: [1, 2, 3],
		},
		{
			name: 'Outer',
			schemas: { Inner: 'int8 value:4;bool flag:1', Outer: 'uint8 prefix;Inner items[2];uint8 tail' },
			value: {
				prefix: 42,
				items: [
					{ value: -3, flag: true },
					{ value: 7, flag: false },
				],
				tail: 255,
			},
			bytes: [42, 0x1d, 0x07, 255],
		},
	])('$name encodes like closure compilation', ({ name, schemas, value, bytes }) => {
		const registry = new StructRegistry();
		for (const [schemaName, schema] of Object.entries(schemas)) registry.register(schemaName, schema);
		compileAndSnapshot(registry, name, compileStructEncoder);
		const [generated, closures] = encodeBoth(registry, name, value);
		expect(generated).toStrictEqual(closures);
		if (bytes) expect(generated).toStrictEqual(new Uint8Array(bytes));
		expect(registry.decode(name, generated as Uint8Array)).toStrictEqual(value);
	});

	test('validates the same fields in the same order with the same errors', () => {
		const registry = new StructRegistry();
		registry.register('Inner', 'int8 value:4;bool flag:1');
		registry.register(
			'Outer',
			'uint8 prefix;Inner items[2];char name[4];uint64 hash:56;bool on:1;int64 big;uint32 wide:20;float f',
		);
		const valid = {
			prefix: 255,
			items: [
				{ value: -8, flag: true },
				{ value: 7, flag: false },
			],
			name: 'éab',
			hash: 2n ** 56n - 1n,
			on: true,
			big: -(2n ** 63n),
			wide: 2 ** 20 - 1,
			f: -1.5,
		};
		const cases: unknown[] = [
			valid,
			[],
			{ ...valid, prefix: undefined },
			{ ...valid, items: [{ value: 8, flag: true }, valid.items[1]] },
			{ ...valid, items: [valid.items[0], { value: 0 }] },
			{ ...valid, items: [valid.items[0]] },
			{ ...valid, name: 'abcde' },
			{ ...valid, hash: 2n ** 56n },
			{ ...valid, hash: 2 ** 53 },
			{ ...valid, on: 1 },
			{ ...valid, big: 1.5 },
			{ ...valid, wide: 2 ** 20 },
			{ ...valid, wide: -1n },
			{ ...valid, f: '1' },
		];
		for (const value of cases) {
			const [generated, closures] = encodeBoth(registry, 'Outer', value);
			expect(generated).toStrictEqual(closures);
		}
	});
});
