import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { StructPayload } from '../src/types.ts';
import { StructRegistry } from '../src/struct-registry.ts';

describe('calculate byte size', () => {
	test('bool value', ({ expect }) => {
		const registry = new StructRegistry();
		registry.register('MyStruct', 'bool value');

		expect(registry.getByteLength('MyStruct')).toBe(1);
	});

	test('double arr[4]', ({ expect }) => {
		const registry = new StructRegistry();
		registry.register('MyStruct', 'double arr[4]');

		expect(registry.getByteLength('MyStruct')).toBe(4 * 8);
	});

	test('enum {a=1, b=2} int8 val', ({ expect }) => {
		const registry = new StructRegistry();
		registry.register('MyStruct', 'enum {a=1, b=2} int8 val');

		expect(registry.getByteLength('MyStruct')).toBe(1);
	});

	test('nested structs', ({ expect }) => {
		const registry = new StructRegistry();
		registry.register('Inner', 'int16 i;int8 x');
		registry.register('Outer', 'char c; Inner s; bool b');

		expect(registry.getByteLength('Inner')).toBe(3);
		expect(registry.getByteLength('Outer')).toBe(1 + 3 + 1);
	});

	test('packed bit fields', ({ expect }) => {
		const registry = new StructRegistry();
		registry.register(
			'ControlWord',
			'uint64 opModeHash:56;uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1',
		);

		expect(registry.getByteLength('ControlWord')).toBe(8);
	});
});

for (const mode of ['generated', 'CSP'] as const) {
	describe(`decode structs (${mode})`, { concurrent: mode === 'generated' }, () => {
		// CSP cases replace the global Function constructor and must run sequentially.
		if (mode === 'CSP') {
			beforeEach(() => {
				vi.spyOn(globalThis, 'Function').mockImplementation(function () {
					throw new EvalError('Code generation disallowed by CSP');
				});
			});
			afterEach(() => vi.restoreAllMocks());
		}
		test.for([
			{ name: 'scalar', definition: 'uint8 __proto__', bytes: [1], expected: 1 },
			{ name: 'nested struct', definition: 'Inner __proto__', bytes: [1], expected: { ['__proto__']: 1 } },
			{
				name: 'struct array',
				definition: 'Inner __proto__[2]',
				bytes: [1, 2],
				expected: [{ ['__proto__']: 1 }, { ['__proto__']: 2 }],
			},
		])('preserves arbitrary field names for $name values', (fixture, { expect }) => {
			const registry = new StructRegistry();
			registry.register('Inner', 'uint8 __proto__');
			registry.register(
				'Names',
				`uint8 prefix;${fixture.definition};uint8 constructor;uint8 hasOwnProperty;uint8 get;uint8 set;uint8 size;uint8 tail`,
			);
			const bytes = new Uint8Array([42, ...fixture.bytes, 2, 3, 4, 5, 6, 7]);
			const decoded = registry.decode('Names', bytes);
			const expected = {
				prefix: 42,
				['__proto__']: fixture.expected,
				constructor: 2,
				hasOwnProperty: 3,
				get: 4,
				set: 5,
				size: 6,
				tail: 7,
			};
			expect(decoded).toStrictEqual(expected);
			expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
			expect(Object.keys(decoded)).toEqual(Object.keys(expected));
			expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')).toEqual({
				value: fixture.expected,
				enumerable: true,
				writable: true,
				configurable: true,
			});
			expect(JSON.parse(JSON.stringify(decoded))).toStrictEqual(expected);
		});

		test.for([
			{ name: 'NaN', value: NaN },
			{ name: 'positive infinity', value: Infinity },
			{ name: 'negative infinity', value: -Infinity },
			{ name: 'negative zero', value: -0 },
		])('preserves $name in object fields', ({ value }, { expect }) => {
			const registry = new StructRegistry();
			registry.register('Value', 'double value');
			const bytes = new Uint8Array(8);
			new DataView(bytes.buffer).setFloat64(0, value, true);
			expect(registry.decode('Value', bytes)).toStrictEqual({ value });
		});

		test('char array (string)', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('MyStruct', 'char string[4]');

			const buffer = new Uint8Array([0b01100001, 0b01100010, 0b01100011, 0b01100100]);
			expect(registry.decode('MyStruct', buffer)).toStrictEqual({ string: 'abcd' });
		});

		test('nested structs', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('Inner', 'int16 i;\nint8 x;');
			registry.register('Outer', 'char c;\nInner s;\nbool b;');

			const buffer = new Uint8Array(5);
			const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

			view.setUint8(0, 'a'.charCodeAt(0));
			view.setInt16(1, 581, true);
			view.setUint8(3, 1);
			view.setUint8(4, 2);

			const inner: StructPayload = { i: 581, x: 1 };

			const outer: StructPayload = { c: 'a', s: inner, b: true };

			expect(registry.decode('Outer', buffer)).toStrictEqual(outer);
		});

		test('control word bit fields', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register(
				'ControlWord',
				'uint64 opModeHash:56;uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1',
			);

			const buffer = new Uint8Array(8);
			const value = 0x0123_4567_89ab_cdn | (2n << 56n) | (1n << 58n) | (1n << 60n) | (1n << 61n);
			new DataView(buffer.buffer).setBigUint64(0, value, true);

			expect(registry.decode('ControlWord', buffer)).toStrictEqual({
				opModeHash: 0x0123_4567_89ab_cdn,
				robotMode: 2n,
				enabled: true,
				eStop: false,
				fmsAttached: true,
				dsAttached: true,
			});
		});

		test('starts new storage when the type changes or a field does not fit', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('MyStruct', 'uint8 low:4;uint8 high:4;uint16 wide:9;bool flag:1;uint8 next');

			const buffer = new Uint8Array([0xba, 0x01, 0x03, 0x7f]);

			expect(registry.getByteLength('MyStruct')).toBe(4);
			expect(registry.decode('MyStruct', buffer)).toStrictEqual({
				low: 10,
				high: 11,
				wide: 0x101,
				flag: true,
				next: 0x7f,
			});
		});

		test('sign extends signed bit fields', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('MyStruct', 'int8 value:4');

			expect(registry.decode('MyStruct', new Uint8Array([0b1101]))).toStrictEqual({ value: -3 });
		});

		test('waits for missing dependencies without consuming bytes', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('Outer', 'uint8 prefix;Inner value');
			expect(registry.decode('Outer', new Uint8Array([42, 7]), 0)).toBe('Inner');
			expect(registry.decodeArray('Outer', new Uint8Array([42, 7]))).toBe('Inner');
			expect(registry.decodeArray('Missing', new Uint8Array())).toBe('Missing');
			registry.register('Inner', 'uint8 value');
			expect(registry.decode('Outer', new Uint8Array([42, 7]))).toStrictEqual({ prefix: 42, value: { value: 7 } });
		});

		test('invalidates enclosing decoders and array strides when a schema changes', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('Inner', 'uint8 value');
			registry.register('Outer', 'Inner inner;uint8 tail');
			expect(registry.decodeArray('Outer', new Uint8Array([1, 2]))).toStrictEqual([{ inner: { value: 1 }, tail: 2 }]);
			registry.register('Inner', 'uint16 value');
			expect(registry.getByteLength('Outer')).toBe(3);
			expect(registry.decodeArray('Outer', new Uint8Array([0x01, 0x02, 3, 0x04, 0x05, 6]))).toStrictEqual([
				{ inner: { value: 513 }, tail: 3 },
				{ inner: { value: 1284 }, tail: 6 },
			]);
			registry.register('Inner', 'NewInner value');
			expect(registry.decode('Outer', new Uint8Array([7, 8]))).toBe('NewInner');
			registry.register('NewInner', 'uint8 count');
			expect(registry.decode('Outer', new Uint8Array([7, 8]))).toStrictEqual({
				inner: { value: { count: 7 } },
				tail: 8,
			});
		});

		test('preserves subarray boundaries and accepts a byte offset', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('Inner', 'int8 value:4');
			registry.register('Outer', 'Inner inner;uint16 tail');
			const bytes = new Uint8Array([99, 42, 0x0d, 0x01, 0x02, 99]).subarray(1, 5);
			expect(registry.decode('Outer', bytes, 1)).toStrictEqual({ inner: { value: -3 }, tail: 513 });
			expect(() => registry.decode('Outer', bytes.subarray(0, 3), 1)).toThrow(RangeError);
		});

		test('handles full-width and plain declarations after packed fields', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('Bits', 'uint8 packed:4;uint8 full:8;int16 plain');
			expect(registry.getByteLength('Bits')).toBe(4);
			expect(registry.decode('Bits', new Uint8Array([3, 255, 0xfe, 0xff]))).toStrictEqual({
				packed: 3,
				full: 255,
				plain: -2,
			});
		});

		test('handles empty structs and rejects nonempty arrays with a zero stride', ({ expect }) => {
			const registry = new StructRegistry();
			registry.register('Empty', '');
			expect(registry.decode('Empty', new Uint8Array())).toStrictEqual({});
			expect(registry.decodeArray('Empty', new Uint8Array())).toStrictEqual([]);
			expect(() => registry.decodeArray('Empty', new Uint8Array([1]))).toThrow(RangeError);
		});
	});
}

describe('runtime compilation', { concurrent: false }, () => {
	// These cases spy on or replace the global Function constructor.
	afterEach(() => vi.restoreAllMocks());

	test('compiles lazily and reuses decoders across records and unchanged registrations', () => {
		const constructor = vi.spyOn(globalThis, 'Function');
		const registry = new StructRegistry();
		registry.register('Value', 'uint8 value');
		expect(constructor).not.toHaveBeenCalled();
		expect(registry.decode('Value', new Uint8Array([1]))).toStrictEqual({ value: 1 });
		const compilationCalls = constructor.mock.calls.length;
		expect(compilationCalls).toBeGreaterThan(0);
		registry.register('Value', 'uint8 value');
		registry.register('Unrelated', 'uint8 other');
		expect(registry.decode('Value', new Uint8Array([2]))).toStrictEqual({ value: 2 });
		expect(registry.decodeArray('Value', new Uint8Array([3, 4]))).toStrictEqual([{ value: 3 }, { value: 4 }]);
		expect(constructor).toHaveBeenCalledTimes(compilationCalls);
	});

	test('probes a CSP restriction once and keeps decoding other schemas', () => {
		const constructor = vi.spyOn(globalThis, 'Function').mockImplementation(function () {
			throw new EvalError('Code generation disallowed by CSP');
		});
		const registry = new StructRegistry();
		registry.register('Value', 'uint8 value');
		registry.register('Other', 'uint16 value');
		expect(registry.decode('Value', new Uint8Array([1]))).toStrictEqual({ value: 1 });
		expect(registry.decode('Other', new Uint8Array([2, 3]))).toStrictEqual({ value: 770 });
		expect(registry.decodeArray('Value', new Uint8Array([3, 4]))).toStrictEqual([{ value: 3 }, { value: 4 }]);
		expect(constructor).toHaveBeenCalledTimes(1);
	});

	test('uses the interpreter if compilation is denied after the capability probe', () => {
		const nativeFunction = globalThis.Function;
		const constructor = vi.spyOn(globalThis, 'Function').mockImplementation(function (...args) {
			if (args.length === 1 && args[0] === '') return nativeFunction(...args);
			throw new EvalError('Code generation disallowed by CSP');
		});
		const registry = new StructRegistry();
		registry.register('Value', 'uint8 value');
		expect(registry.decode('Value', new Uint8Array([1]))).toStrictEqual({ value: 1 });
		expect(registry.decode('Value', new Uint8Array([2]))).toStrictEqual({ value: 2 });
		expect(constructor).toHaveBeenCalledTimes(2);
	});

	test('does not hide errors in generated code', () => {
		const nativeFunction = globalThis.Function;
		const error = new SyntaxError('Invalid generated source');
		vi.spyOn(globalThis, 'Function').mockImplementation(function (...args) {
			if (args.length === 1 && args[0] === '') return nativeFunction(...args);
			throw error;
		});
		const registry = new StructRegistry();
		registry.register('Value', 'uint8 value');
		expect(() => registry.decode('Value', new Uint8Array([1]))).toThrow(error);
	});
});
