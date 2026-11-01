import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { StructError, StructRegistry, parseStruct, parseStructSpecification } from '../src/index.ts';

describe('standalone registry', () => {
	test('tracks readiness without a record queue and replaces transitive dependencies', () => {
		const registry = new StructRegistry();
		registry.register('Outer', 'Inner value;Other other');
		expect(registry.getMissingDependencies('Outer')).toEqual(new Set(['Inner', 'Other']));
		expect(registry.getDecodableStructs()).toEqual([]);
		registry.register('Inner', 'uint8 value');
		registry.register('Other', 'bool enabled');
		expect(registry.getMissingDependencies('Outer')).toEqual(new Set());
		expect(registry.getDecodableStructs()).toContain('Outer');
		expect(registry.getDependencies('Outer')).toEqual(new Set(['Outer', 'Inner', 'Other', 'uint8', 'bool']));
		registry.register('Inner', 'Missing value');
		expect(registry.getMissingDependencies('Outer')).toEqual(new Set(['Missing']));
		expect(registry.getDecodableStructs()).not.toContain('Outer');
	});

	test('rejects cycles atomically, including schema replacements', () => {
		const registry = new StructRegistry();
		registry.register('Inner', 'uint8 value');
		registry.register('Outer', 'Inner value');
		expect(registry.decode('Outer', new Uint8Array([7]))).toEqual({ value: { value: 7 } });
		expect(() => registry.register('Inner', 'Outer value')).toThrowError(
			expect.objectContaining({ code: 'STRUCT_R0012' }),
		);
		expect(registry.decode('Outer', new Uint8Array([8]))).toEqual({ value: { value: 8 } });
		registry.register('A', 'B value');
		expect(() => registry.register('B', 'A value')).toThrowError(StructError);
		expect(registry.getMissingDependencies('A')).toEqual(new Set(['B']));
		registry.register('B', 'uint8 value');
		expect(registry.decode('A', new Uint8Array([9]))).toEqual({ value: { value: 9 } });
	});

	test('exposes protocol-neutral errors and preserves parser causes', () => {
		expect(() => parseStruct('int32')).toThrowError(
			expect.objectContaining({ code: 'STRUCT_R0008', cause: expect.any(AggregateError) }),
		);
		expect(() => parseStructSpecification('{} bool value')).toThrowError(StructError);
		expect(() => new StructRegistry().getDefinition('Unknown')).toThrowError(
			expect.objectContaining({ code: 'STRUCT_R0013', details: { name: 'Unknown' } }),
		);
	});
});

for (const codeGeneration of [true, false, 'function', 'closures'] as const) {
	describe(`decoding (codeGeneration: ${JSON.stringify(codeGeneration)})`, () => {
		test('preserves bigint fidelity, single-element arrays, UTF-8 and NUL bytes', () => {
			const registry = new StructRegistry({ codeGeneration });
			registry.register('Inner', 'int64 signed;uint64 unsigned;char text[4];uint8 one[1]');
			registry.register('Outer', 'Inner values[1]');
			const payload = new Uint8Array(24).subarray(3);
			const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
			view.setBigInt64(0, -9007199254740993n, true);
			view.setBigUint64(8, 18446744073709551615n, true);
			payload.set([0xc3, 0xa9, 0, 0, 42], 16);
			const expected = {
				values: [{ signed: -9007199254740993n, unsigned: 18446744073709551615n, text: 'é\0\0', one: [42] }],
			};
			expect(registry.decode('Outer', payload)).toStrictEqual(expected);
			expect(registry.decodeArray('Outer', payload)).toStrictEqual([expected]);
		});

		test('rejects partial arrays and truncated char fields consistently', () => {
			const registry = new StructRegistry({ codeGeneration });
			registry.register('Text', 'char value[4]');
			expect(() => registry.decode('Text', new Uint8Array(3))).toThrowError(RangeError);
			expect(() => registry.decodeInterpreted('Text', new Uint8Array(3))).toThrowError(RangeError);
			expect(() => registry.decodeArray('Text', new Uint8Array(5))).toThrowError(RangeError);
			expect(registry.decodeArray('Text', new Uint8Array())).toEqual([]);
			for (const offset of [-1, 0.5, NaN, Infinity, 2]) {
				expect(() => registry.decode('Text', new Uint8Array(4), offset)).toThrowError(RangeError);
			}
			expect(registry.decode('Missing', new Uint8Array())).toBe('Missing');
		});
	});
}

describe('explicit interpreter and closures policies', { concurrent: false }, () => {
	afterEach(() => vi.restoreAllMocks());

	test('never probes or invokes the Function constructor for false or closures', () => {
		const constructor = vi.spyOn(globalThis, 'Function').mockImplementation(function () {
			throw new Error('Code generation must not be attempted');
		});
		for (const codeGeneration of [false, 'closures'] as const) {
			const registry = new StructRegistry({ codeGeneration });
			registry.register('Value', 'uint8 value');
			expect(registry.decode('Value', new Uint8Array([42]))).toEqual({ value: 42 });
			expect(registry.decodeArray('Value', new Uint8Array([1, 2]))).toEqual([{ value: 1 }, { value: 2 }]);
		}
		expect(constructor).not.toHaveBeenCalled();
	});
});
