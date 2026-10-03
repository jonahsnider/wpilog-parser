import type { StructPayload } from '../../src/types.ts';
import { describe, expect, test, vi } from 'vite-plus/test';
import { structPayloadToJson } from '../../src/struct-payload-to-json.ts';
import { StructDecodeQueue } from '../../src/struct/struct-decode-queue.ts';
import { StructRegistry } from '../../src/struct/struct-registry.ts';
import { compileStruct } from '../../src/struct/compile-struct.ts';
import { createStructFixture, STRUCT_FIXTURES } from '../helpers/struct-fixtures.ts';

function compileAndSnapshot(registry: StructRegistry, name: string) {
	// Capture the full factory source, including nested decoder functions that
	// would be absent from the returned decoder's toString().
	const constructor = vi.spyOn(globalThis, 'Function');
	try {
		const decoder = compileStruct(registry, name);
		expect(constructor.mock.calls).toMatchSnapshot(name);
		return decoder;
	} finally {
		constructor.mockRestore();
	}
}

describe('compiled struct decoder', { concurrent: false }, () => {
	// Source snapshots spy on the global Function constructor and run sequentially.
	test.for(STRUCT_FIXTURES)('$name matches the interpreter', (fixture) => {
		const { registry, payloads } = createStructFixture(fixture);
		const decoder = compileAndSnapshot(registry, fixture.name);
		for (const bytes of payloads) {
			const expected = registry.decodeInterpreted(fixture.name, bytes);
			if (typeof expected === 'string') throw new TypeError(`Missing schema: ${expected}`);
			expect(decoder(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes, 0)).toStrictEqual(expected);
		}
	});

	test('handles primitives, arrays, strings and enums', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register(
			'AllTypes',
			'bool flags[2];int8 a;uint8 b;int16 c;uint16 d;int32 e;uint32 f;int64 g;uint64 h;float i;float32 j;double k;float64 l;char text[4];char letter;enum {off=0,on=1} uint8 mode;int16 values[2];double empty[0]',
		);
		compileAndSnapshot(registry, 'AllTypes');
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
			empty: [],
		};
		expect(structPayloadToJson(registry.decode('AllTypes', bytes) as StructPayload)).toStrictEqual(expected);
	});

	test('bit fields cross storage boundaries and sign extend', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Bits', 'int8 low:4;uint8 high:4;uint16 wide:9;bool flag:1;int64 signed:5;uint8 tail');
		compileAndSnapshot(registry, 'Bits');
		const bytes = new Uint8Array(12);
		bytes.set([0xbd, 0x01, 0x03]);
		new DataView(bytes.buffer).setBigUint64(3, 0b11101n, true);
		bytes[11] = 127;
		const expected = { low: -3, high: 11, wide: 257, flag: true, signed: -3n, tail: 127 };
		expect(structPayloadToJson(registry.decode('Bits', bytes) as StructPayload)).toStrictEqual(expected);
	});

	test('treats unusual field names as Map keys', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Names', 'uint8 __proto__;uint8 constructor;uint8 default');
		compileAndSnapshot(registry, 'Names');
		const decoded = registry.decode('Names', new Uint8Array([1, 2, 3])) as StructPayload;
		expect([...decoded]).toStrictEqual([
			['__proto__', 1],
			['constructor', 2],
			['default', 3],
		]);
	});

	test('accounts for trailing bit-field storage in nested arrays', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Inner', 'int8 value:4;bool flag:1');
		registry.register('Outer', 'uint8 prefix;Inner items[2];uint8 tail');
		compileAndSnapshot(registry, 'Outer');
		const bytes = new Uint8Array([42, 0x1d, 0x07, 255]);
		const expected = {
			prefix: 42,
			items: [
				{ value: -3, flag: true },
				{ value: 7, flag: false },
			],
			tail: 255,
		};
		expect(structPayloadToJson(registry.decode('Outer', bytes) as StructPayload)).toStrictEqual(expected);
	});

	test.concurrent('rejects truncated numeric payloads', ({ expect }) => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Value', 'double value');
		expect(() => registry.decode('Value', new Uint8Array(7))).toThrow(RangeError);
	});
});
