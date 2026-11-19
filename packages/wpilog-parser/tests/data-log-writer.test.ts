import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { Diagnostic } from 'nostics';
import { describe, test } from 'vite-plus/test';
import {
	ControlRecordType,
	DataLogWriter,
	type DecodedRecord,
	isDataRecord,
	parseDataLog,
	readRecords,
} from '../src/index.ts';
import { LOG_FIXTURES } from './helpers/log-fixtures.ts';

function dataRecords(bytes: Uint8Array) {
	return Array.from(parseDataLog(bytes, { strict: true }))
		.filter(isDataRecord)
		.map(({ entry, timestamp, payload }) => ({ name: entry.name, timestamp, payload }));
}

/** Write each decoded record of a real log again, mapping the log's entry IDs to the writer's. */
function replay(original: Uint8Array): Uint8Array {
	const { value: header } = readRecords(original).next();
	if (header?.kind !== 'header') throw new TypeError('Expected a header');
	const writer = new DataLogWriter({ extraHeader: header.header.extraHeader });
	const entryIds = new Map<number, number>();
	for (const record of parseDataLog(original)) {
		if (isDataRecord(record)) {
			writer.append(entryIds.get(record.entry.entryId)!, record.payload, record.timestamp);
			continue;
		}
		const control = record.payload;
		switch (control.controlRecordType) {
			case ControlRecordType.Start:
				entryIds.set(
					control.entryId,
					writer.start(control.entryName, control.entryType, control.entryMetadata, record.timestamp),
				);
				break;
			case ControlRecordType.SetMetadata:
				writer.setMetadata(entryIds.get(control.entryId)!, control.entryMetadata, record.timestamp);
				break;
			case ControlRecordType.Finish:
				writer.finish(entryIds.get(control.entryId)!, record.timestamp);
				break;
		}
	}
	return writer.flush();
}

/** Decoded records without entry IDs, which the writer assigns itself. */
function withoutEntryIds(record: DecodedRecord) {
	if (isDataRecord(record)) return { ...record, entry: { ...record.entry, entryId: 0 } };
	return { ...record, payload: { ...record.payload, entryId: 0 } };
}

describe('DataLogWriter', () => {
	test.for(LOG_FIXTURES)('rewrites $name with the same decoded records', async ({ filePath }, { expect }) => {
		const original = await readFile(filePath);
		const written = replay(original);
		const expected = parseDataLog(original);
		const actual = parseDataLog(written, { strict: true });
		let count = 0;
		while (true) {
			const expectedResult = expected.next();
			const actualResult = actual.next();
			if (expectedResult.done || actualResult.done) {
				expect(actualResult.done).toBe(expectedResult.done);
				break;
			}
			const expectedRecord = withoutEntryIds(expectedResult.value);
			const actualRecord = withoutEntryIds(actualResult.value);
			// expect() is too slow to call for each of a million records, so only use it to report a difference.
			if (!isDeepStrictEqual(actualRecord, expectedRecord)) {
				expect(actualRecord, `record ${count}`).toStrictEqual(expectedRecord);
			}
			count++;
		}
		expect(count).toBeGreaterThan(1000);
	});

	test('rewrites a WPILib log byte for byte', async ({ expect }) => {
		// This log starts entries with sequential IDs and has no struct records before their schemas.
		const original = new Uint8Array(await readFile(LOG_FIXTURES.find(({ name }) => name.endsWith('Q68'))!.filePath));
		const written = replay(original);
		// Diffing two 15 MB arrays exhausts memory, so report the first differing byte instead.
		expect(written.findIndex((byte, index) => byte !== original[index])).toBe(-1);
		expect(written.byteLength).toBe(original.byteLength);
	});

	test('round-trips every value type', ({ expect }) => {
		const writer = new DataLogWriter({ extraHeader: 'héader' });
		const values: Array<[type: string, value: unknown, decoded?: unknown]> = [
			['boolean', true],
			['int64', -(2n ** 63n)],
			['int64', 2 ** 53 - 1, 2n ** 53n - 1n],
			['float', 1.5],
			['double', -0],
			['double', Number.NaN],
			['string', 'é🙂'],
			['boolean[]', [true, false]],
			['int64[]', [2n ** 63n - 1n, -5], [2n ** 63n - 1n, -5n]],
			['float[]', [0.25, -2]],
			['double[]', []],
			['string[]', ['', 'é', 'abc']],
			['raw', new Uint8Array([0, 255, 1])],
		];
		writer.addStructSchema('Inner', 'int8 value:4;bool flag:1');
		writer.addStructSchema('Outer', 'char name[3];Inner items[2];uint64 big');
		const outer = {
			name: 'ab\0',
			items: [
				{ value: -3, flag: true },
				{ value: 7, flag: false },
			],
			big: 2n ** 64n - 1n,
		};
		values.push(['struct:Outer', outer], ['struct:Outer[]', [outer, outer]], ['struct:Inner[]', []]);

		for (const [index, [type, value]] of values.entries()) {
			writer.append(writer.start(`/${index}`, type, `{"index":${index}}`, 1), value as never, 2);
		}

		const bytes = writer.flush();
		expect(readRecords(bytes).next().value).toStrictEqual({
			kind: 'header',
			header: { version: { major: 1, minor: 0 }, extraHeader: 'héader' },
		});
		expect(dataRecords(bytes).filter(({ name }) => !name.startsWith('/.schema/'))).toStrictEqual(
			values.map(([, value, decoded], index) => ({ name: `/${index}`, timestamp: 2, payload: decoded ?? value })),
		);
	});

	test('round-trips timestamps at length boundaries, including negative ones', ({ expect }) => {
		const timestamps = [
			0,
			255,
			256,
			2 ** 32,
			2 ** 48 - 1,
			2 ** 48,
			Number.MAX_SAFE_INTEGER,
			-1,
			Number.MIN_SAFE_INTEGER,
		];
		const writer = new DataLogWriter();
		const entryId = writer.start('/value', 'double', '', 0);
		for (const timestamp of timestamps) writer.append(entryId, timestamp, timestamp);
		expect(dataRecords(writer.flush()).map(({ timestamp }) => timestamp)).toStrictEqual(timestamps);
		for (const timestamp of [0.5, Number.NaN, 2 ** 53]) {
			expect(() => writer.append(entryId, 1, timestamp)).toThrow(TypeError);
		}
	});

	test('flushes chunks that concatenate into one log', ({ expect }) => {
		const writer = new DataLogWriter();
		const entryId = writer.start('/value', 'string', '', 0);
		const chunks: Uint8Array[] = [];
		for (let i = 0; i < 3; i++) {
			// Large enough to grow the internal buffer.
			writer.append(entryId, 'x'.repeat(5000 * i), i);
			chunks.push(writer.flush());
		}
		chunks.push(writer.flush());
		expect(chunks[3]).toStrictEqual(new Uint8Array());
		const log = new Uint8Array(Buffer.concat(chunks));
		expect(dataRecords(log).map(({ payload }) => (payload as string).length)).toStrictEqual([0, 5000, 10_000]);
	});

	test('writes start, metadata and finish control records', ({ expect }) => {
		const writer = new DataLogWriter();
		const first = writer.start('/value', 'boolean', 'a', 1);
		writer.setMetadata(first, 'b', 2);
		writer.finish(first, 3);
		expect(() => writer.append(first, true)).toThrowError(expect.objectContaining({ name: 'WPILOG_W0001' }));
		// A finished entry's name can be started again with a new ID.
		const second = writer.start('/value', 'int64', '', 4);
		expect(second).toBe(first + 1);
		expect(() => writer.start('/value', 'int64')).toThrowError(expect.objectContaining({ name: 'WPILOG_W0002' }));

		const records = Array.from(parseDataLog(writer.flush(), { strict: true }));
		expect(records.map((record) => [record.timestamp, record.payload])).toStrictEqual([
			[1, { controlRecordType: 0, entryId: 1, entryName: '/value', entryType: 'boolean', entryMetadata: 'a' }],
			[2, { controlRecordType: 2, entryId: 1, entryMetadata: 'b' }],
			[3, { controlRecordType: 1, entryId: 1 }],
			[4, { controlRecordType: 0, entryId: 2, entryName: '/value', entryType: 'int64', entryMetadata: '' }],
		]);
	});

	test('writes each struct schema once and requires schemas before values', ({ expect }) => {
		const writer = new DataLogWriter();
		writer.addStructSchema('Outer', 'Inner inner', 0);
		const entryId = writer.start('/value', 'struct:Outer', '', 0);
		expect(() => writer.append(entryId, { inner: { value: 1 } })).toThrowError(
			expect.objectContaining({ name: 'WPILOG_W0003', message: 'Missing struct schema Inner for entry /value' }),
		);
		writer.addStructSchema('Inner', 'uint8 value', 1);
		writer.addStructSchema('Inner', 'uint8 value', 2);
		writer.append(entryId, { inner: { value: 1 } }, 3);
		writer.addStructSchema('Inner', 'uint16 value', 4);
		writer.append(entryId, { inner: { value: 513 } }, 5);
		expect(() => writer.addStructSchema('Bad', 'int32')).toThrow(Diagnostic);

		expect(dataRecords(writer.flush())).toStrictEqual([
			{ name: '/.schema/struct:Outer', timestamp: 0, payload: 'Inner inner' },
			{ name: '/.schema/struct:Inner', timestamp: 1, payload: 'uint8 value' },
			{ name: '/value', timestamp: 3, payload: { inner: { value: 1 } } },
			{ name: '/.schema/struct:Inner', timestamp: 4, payload: 'uint16 value' },
			{ name: '/value', timestamp: 5, payload: { inner: { value: 513 } } },
		]);
	});

	test('discards a record whose value is rejected partway through', ({ expect }) => {
		const writer = new DataLogWriter();
		writer.addStructSchema('Point', 'double x;double y', 0);
		const points = writer.start('/points', 'struct:Point[]', '', 0);
		const integers = writer.start('/integers', 'int64[]', '', 0);
		const strings = writer.start('/strings', 'string[]', '', 0);
		expect(() => writer.append(points, [{ x: 1, y: 2 }, { x: 3 }], 1)).toThrow(TypeError);
		expect(() => writer.append(integers, [1n, 2n ** 63n], 1)).toThrow(RangeError);
		expect(() => writer.append(strings, ['a', 1] as never, 1)).toThrow(TypeError);
		expect(() => writer.append(integers, 1n as never, 1)).toThrow(TypeError);
		writer.append(points, [{ x: 1, y: 2 }], 2);

		expect(dataRecords(writer.flush()).filter(({ name }) => name === '/points')).toStrictEqual([
			{ name: '/points', timestamp: 2, payload: [{ x: 1, y: 2 }] },
		]);
	});

	test.for([
		['boolean', 1],
		['int64', 1.5],
		['int64', 2 ** 53],
		['float', 1n],
		['string', 1],
		['double[]', 1],
		['struct:Point', [1, 2]],
		['raw', [1, 2]],
	] as const)('rejects %o values of %o', ([type, value], { expect }) => {
		const writer = new DataLogWriter();
		writer.addStructSchema('Point', 'double x;double y', 0);
		expect(() => writer.append(writer.start('/value', type, '', 0), value as never, 1)).toThrow(TypeError);
	});
});
