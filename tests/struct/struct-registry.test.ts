import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { ByteOffset } from '../../src/byte-offset.ts';
import type { StructPayload } from '../../src/types.ts';
import { StructDecodeQueue } from '../../src/struct/struct-decode-queue.ts';
import { StructRegistry } from '../../src/struct/struct-registry.ts';

describe('calculate byte size', () => {
	test('bool value', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('MyStruct', 'bool value');

		expect(registry.getByteLength('MyStruct')).toBe(1);
	});

	test('double arr[4]', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('MyStruct', 'double arr[4]');

		expect(registry.getByteLength('MyStruct')).toBe(4 * 8);
	});

	test('enum {a=1, b=2} int8 val', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('MyStruct', 'enum {a=1, b=2} int8 val');

		expect(registry.getByteLength('MyStruct')).toBe(1);
	});

	test('nested structs', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Inner', 'int16 i;int8 x');
		registry.register('Outer', 'char c; Inner s; bool b');

		expect(registry.getByteLength('Inner')).toBe(3);
		expect(registry.getByteLength('Outer')).toBe(1 + 3 + 1);
	});

	test('packed bit fields', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register(
			'ControlWord',
			'uint64 opModeHash:56;uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1',
		);

		expect(registry.getByteLength('ControlWord')).toBe(8);
	});
});

describe.for(['generated', 'CSP'] as const)('decode structs (%s)', (mode) => {
	beforeEach(() => {
		if (mode === 'CSP') {
			vi.spyOn(globalThis, 'Function').mockImplementation(function () {
				throw new EvalError('Code generation disallowed by CSP');
			});
		}
	});
	afterEach(() => vi.restoreAllMocks());
	test('char array (string)', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('MyStruct', 'char string[4]');

		const buffer = new Uint8Array([0b01100001, 0b01100010, 0b01100011, 0b01100100]);
		expect(registry.decode('MyStruct', buffer)).toStrictEqual(new Map([['string', 'abcd']]));
	});

	test('nested structs', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Inner', 'int16 i;\nint8 x;');
		registry.register('Outer', 'char c;\nInner s;\nbool b;');

		const buffer = new Uint8Array(5);
		const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		view.setUint8(0, 'a'.charCodeAt(0));
		view.setInt16(1, 581, true);
		view.setUint8(3, 1);
		view.setUint8(4, 2);

		const inner: StructPayload = new Map([
			['i', 581],
			['x', 1],
		]);

		const outer: StructPayload = new Map<string, unknown>([
			['c', 'a'],
			['s', inner],
			['b', true],
		]) as StructPayload;

		expect(registry.decode('Outer', buffer)).toStrictEqual(outer);
	});

	test('control word bit fields', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register(
			'ControlWord',
			'uint64 opModeHash:56;uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1',
		);

		const buffer = new Uint8Array(8);
		const value = 0x0123_4567_89ab_cdn | (2n << 56n) | (1n << 58n) | (1n << 60n) | (1n << 61n);
		new DataView(buffer.buffer).setBigUint64(0, value, true);

		expect(registry.decode('ControlWord', buffer)).toStrictEqual(
			new Map<string, bigint | boolean>([
				['opModeHash', 0x0123_4567_89ab_cdn],
				['robotMode', 2n],
				['enabled', true],
				['eStop', false],
				['fmsAttached', true],
				['dsAttached', true],
			]),
		);
	});

	test('starts new storage when the type changes or a field does not fit', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('MyStruct', 'uint8 low:4;uint8 high:4;uint16 wide:9;bool flag:1;uint8 next');

		const buffer = new Uint8Array([0xba, 0x01, 0x03, 0x7f]);

		expect(registry.getByteLength('MyStruct')).toBe(4);
		expect(registry.decode('MyStruct', buffer)).toStrictEqual(
			new Map<string, number | boolean>([
				['low', 10],
				['high', 11],
				['wide', 0x101],
				['flag', true],
				['next', 0x7f],
			]),
		);
	});

	test('sign extends signed bit fields', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('MyStruct', 'int8 value:4');

		expect(registry.decode('MyStruct', new Uint8Array([0b1101]))).toStrictEqual(new Map([['value', -3]]));
	});

	test('waits for missing dependencies without consuming bytes', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Outer', 'uint8 prefix;Inner value');
		const offset = new ByteOffset();
		expect(registry.decode('Outer', new Uint8Array([42, 7]), offset)).toBe('Inner');
		expect(offset.get()).toBe(0);
		expect(registry.decodeArray('Outer[]', new Uint8Array([42, 7]))).toBe('Inner');
		expect(registry.decodeArray('Missing[]', new Uint8Array())).toBe('Missing');
		registry.register('Inner', 'uint8 value');
		expect(registry.decode('Outer', new Uint8Array([42, 7]))).toStrictEqual(
			new Map<string, unknown>([
				['prefix', 42],
				['value', new Map([['value', 7]])],
			]),
		);
	});

	test('invalidates enclosing decoders and array strides when a schema changes', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Inner', 'uint8 value');
		registry.register('Outer', 'Inner inner;uint8 tail');
		expect(registry.decodeArray('Outer[]', new Uint8Array([1, 2]))).toStrictEqual([
			new Map<string, unknown>([
				['inner', new Map([['value', 1]])],
				['tail', 2],
			]),
		]);
		registry.register('Inner', 'uint16 value');
		expect(registry.getByteLength('Outer')).toBe(3);
		expect(registry.decodeArray('Outer[]', new Uint8Array([0x01, 0x02, 3, 0x04, 0x05, 6]))).toStrictEqual([
			new Map<string, unknown>([
				['inner', new Map([['value', 513]])],
				['tail', 3],
			]),
			new Map<string, unknown>([
				['inner', new Map([['value', 1284]])],
				['tail', 6],
			]),
		]);
		registry.register('Inner', 'NewInner value');
		expect(registry.decode('Outer', new Uint8Array([7, 8]))).toBe('NewInner');
		registry.register('NewInner', 'uint8 count');
		expect(registry.decode('Outer', new Uint8Array([7, 8]))).toStrictEqual(
			new Map<string, unknown>([
				['inner', new Map([['value', new Map([['count', 7]])]])],
				['tail', 8],
			]),
		);
	});

	test('preserves subarray boundaries and advances a supplied offset', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Inner', 'int8 value:4');
		registry.register('Outer', 'Inner inner;uint16 tail');
		const bytes = new Uint8Array([99, 42, 0x0d, 0x01, 0x02, 99]).subarray(1, 5);
		const offset = new ByteOffset(1);
		expect(registry.decode('Outer', bytes, offset)).toStrictEqual(
			new Map<string, unknown>([
				['inner', new Map([['value', -3]])],
				['tail', 513],
			]),
		);
		expect(offset.get()).toBe(4);
		expect(() => registry.decode('Outer', bytes.subarray(0, 3), new ByteOffset(1))).toThrow(RangeError);
	});

	test('handles full-width and zero-width declarations after packed fields', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Bits', 'uint8 packed:4;uint8 full:8;int16 plain:0');
		expect(registry.getByteLength('Bits')).toBe(4);
		expect(registry.decode('Bits', new Uint8Array([3, 255, 0xfe, 0xff]))).toStrictEqual(
			new Map([
				['packed', 3],
				['full', 255],
				['plain', -2],
			]),
		);
	});

	test('handles empty structs and rejects nonempty arrays with a zero stride', () => {
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Empty', '');
		expect(registry.decode('Empty', new Uint8Array())).toStrictEqual(new Map());
		expect(registry.decodeArray('Empty[]', new Uint8Array())).toStrictEqual([]);
		expect(() => registry.decodeArray('Empty[]', new Uint8Array([1]))).toThrow(RangeError);
	});
});

describe('runtime compilation', () => {
	afterEach(() => vi.restoreAllMocks());

	test('compiles lazily and reuses decoders across records and unchanged registrations', () => {
		const constructor = vi.spyOn(globalThis, 'Function');
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Value', 'uint8 value');
		expect(constructor).not.toHaveBeenCalled();
		expect(registry.decode('Value', new Uint8Array([1]))).toStrictEqual(new Map([['value', 1]]));
		const compilationCalls = constructor.mock.calls.length;
		expect(compilationCalls).toBeGreaterThan(0);
		registry.register('Value', 'uint8 value');
		registry.register('Unrelated', 'uint8 other');
		expect(registry.decode('Value', new Uint8Array([2]))).toStrictEqual(new Map([['value', 2]]));
		expect(registry.decodeArray('Value[]', new Uint8Array([3, 4]))).toStrictEqual([
			new Map([['value', 3]]),
			new Map([['value', 4]]),
		]);
		expect(constructor).toHaveBeenCalledTimes(compilationCalls);
	});

	test('probes a CSP restriction once and keeps decoding other schemas', () => {
		const constructor = vi.spyOn(globalThis, 'Function').mockImplementation(function () {
			throw new EvalError('Code generation disallowed by CSP');
		});
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Value', 'uint8 value');
		registry.register('Other', 'uint16 value');
		expect(registry.decode('Value', new Uint8Array([1]))).toStrictEqual(new Map([['value', 1]]));
		expect(registry.decode('Other', new Uint8Array([2, 3]))).toStrictEqual(new Map([['value', 770]]));
		expect(registry.decodeArray('Value[]', new Uint8Array([3, 4]))).toStrictEqual([
			new Map([['value', 3]]),
			new Map([['value', 4]]),
		]);
		expect(constructor).toHaveBeenCalledTimes(1);
	});

	test('uses the interpreter if compilation is denied after the capability probe', () => {
		const nativeFunction = globalThis.Function;
		const constructor = vi.spyOn(globalThis, 'Function').mockImplementation(function (...args) {
			if (args.length === 1 && args[0] === '') return nativeFunction(...args);
			throw new EvalError('Code generation disallowed by CSP');
		});
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Value', 'uint8 value');
		expect(registry.decode('Value', new Uint8Array([1]))).toStrictEqual(new Map([['value', 1]]));
		expect(registry.decode('Value', new Uint8Array([2]))).toStrictEqual(new Map([['value', 2]]));
		expect(constructor).toHaveBeenCalledTimes(2);
	});

	test('does not hide errors in generated code', () => {
		const nativeFunction = globalThis.Function;
		const error = new SyntaxError('Invalid generated source');
		vi.spyOn(globalThis, 'Function').mockImplementation(function (...args) {
			if (args.length === 1 && args[0] === '') return nativeFunction(...args);
			throw error;
		});
		const registry = new StructRegistry(new StructDecodeQueue(() => {}));
		registry.register('Value', 'uint8 value');
		expect(() => registry.decode('Value', new Uint8Array([1]))).toThrow(error);
	});
});
