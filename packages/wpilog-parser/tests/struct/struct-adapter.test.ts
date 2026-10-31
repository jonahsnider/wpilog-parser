import { test } from 'vite-plus/test';
import { Diagnostic } from 'nostics';
import { parseStructSpecification } from '../../src/index.ts';
import { ByteOffset } from '../../src/byte-offset.ts';
import { StructDecodeQueue } from '../../src/struct/struct-decode-queue.ts';
import { StructRegistry } from '../../src/struct/struct-registry.ts';

test.for([
	['bool value!', 'WPILOG_R0007'],
	['int32', 'WPILOG_R0008'],
	['{} bool value', 'WPILOG_R0009'],
	['int8 value:9', 'WPILOG_R0010'],
	['double value:1', 'WPILOG_R0011'],
])('preserves the published %s diagnostic', ([schema, code], { expect }) => {
	try {
		parseStructSpecification(schema!);
	} catch (error) {
		expect(error).toBeInstanceOf(Diagnostic);
		expect(error).toMatchObject({ code });
		return;
	}
	throw new Error('Expected a WPILOG diagnostic');
});

test('the adapter preserves offsets, array suffixes, schema cycles and queue ordering', ({ expect }) => {
	const decoded: unknown[] = [];
	const queue = new StructDecodeQueue((_name, records) => {
		for (const record of records) decoded.push(registry.decode('Outer', record.payload));
	});
	const registry = new StructRegistry(queue);
	registry.register('Outer', 'Inner value');
	const offset = new ByteOffset(1);
	expect(registry.decode('Outer', new Uint8Array([99, 42]), offset)).toBe('Inner');
	expect(offset.get()).toBe(1);
	queue.queueStructRecord('Inner', { entryId: 1, timestamp: 0n, payload: new Uint8Array([7]) });
	registry.register('Inner', 'uint8 value');
	expect(decoded).toEqual([{ value: { value: 7 } }]);
	expect(registry.decode('Outer', new Uint8Array([99, 42]), offset)).toEqual({ value: { value: 42 } });
	expect(offset.get()).toBe(2);
	expect(registry.decodeArray('Outer[]', new Uint8Array([1, 2]))).toEqual([
		{ value: { value: 1 } },
		{ value: { value: 2 } },
	]);
	expect(() => registry.register('Inner', 'Outer value')).toThrowError(
		expect.objectContaining({ code: 'WPILOG_R0012' }),
	);
	expect(registry.decode('Outer', new Uint8Array([8]))).toEqual({ value: { value: 8 } });
});
