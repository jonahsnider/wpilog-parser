import { readFile } from 'node:fs/promises';
import { describe, test } from 'vite-plus/test';
import {
	type DataRecord,
	DataLogIndexDecoder,
	type DecodeRecordsOptions,
	indexDataLog,
	isDataRecord,
	parseDataLog,
} from '../src/index.ts';
import { LOG_FIXTURES } from './helpers/log-fixtures.ts';

const options = { strict: true, invalidValues: 'raw' } as const satisfies DecodeRecordsOptions;

/** Each entry's values, by name, ordered by time */
function byName(records: Iterable<DataRecord>): Map<string, [number, string, unknown][]> {
	const names = new Map<string, [number, string, unknown][]>();
	for (const { entry, timestamp, type, payload } of records) {
		let values = names.get(entry.name);
		if (!values) {
			values = [];
			names.set(entry.name, values);
		}
		values.push([timestamp, type, payload]);
	}
	for (const values of names.values()) {
		// Stable, so values logged at the same time stay in file order
		values.sort((a, b) => a[0] - b[0]);
	}
	return names;
}

/** The data records `parseDataLog` reads before any damage */
function* parseUntilDamage(bytes: Uint8Array): Generator<DataRecord> {
	try {
		for (const record of parseDataLog(bytes, options)) {
			if (isDataRecord(record)) yield record;
		}
	} catch {
		// Leftover data after the last record, like a log cut off by a power loss
	}
}

function* decodeAll(bytes: Uint8Array): Generator<DataRecord> {
	const index = indexDataLog(bytes, options);
	const decoder = new DataLogIndexDecoder(index, options);
	for (const entry of index.entries) {
		for (let i = 0; i < entry.length; i++) {
			const record = decoder.decode(entry, i);
			if (record) yield record;
		}
	}
}

describe('indexDataLog', () => {
	test.for(LOG_FIXTURES)('decodes the same values as parseDataLog for $name', async ({ filePath }, { expect }) => {
		const bytes = await readFile(filePath);
		const expected = byName(parseUntilDamage(bytes));

		expect(byName(decodeAll(bytes))).toStrictEqual(expected);
	});

	test.for(LOG_FIXTURES)('decodes numbers like their records for $name', async ({ filePath }, { expect }) => {
		const index = indexDataLog(await readFile(filePath));
		const decoder = new DataLogIndexDecoder(index);
		const entries = index.entries.filter((entry) => ['double', 'float', 'int64'].includes(entry.type));

		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			const records = Array.from({ length: entry.length }, (_, i) => Number(decoder.decode(entry, i)!.payload));
			expect([...decoder.decodeNumbers(entry)!], entry.name).toStrictEqual(records);
		}
	});

	test('stops at a record of an entry that was never started in strict mode', async ({ expect }) => {
		const log = await readFile(LOG_FIXTURES[0]!.filePath);
		// A record of entry 0xffff with an empty payload, then a whole record of a real entry
		const tail = [0x01, 0xff, 0xff, 0, 0, 0x00, 1, 8, 0, 0, 0, 0, 0, 0, 0, 0xf0, 0x3f];
		const bytes = new Uint8Array([...log, ...tail]);
		const records = (index: { entries: { length: number }[] }) =>
			index.entries.reduce((total, entry) => total + entry.length, 0);

		const strict = indexDataLog(bytes, { strict: true });
		expect(strict.error?.message).toContain('No type registered for entry ID 65535');
		expect(strict.bytesRead).toBe(log.byteLength);
		expect(records(strict)).toBe(records(indexDataLog(log)));

		const lenient = indexDataLog(bytes);
		expect(lenient.error).toBeUndefined();
		expect(lenient.bytesRead).toBe(bytes.byteLength);
		expect(records(lenient)).toBe(records(indexDataLog(log)) + 1);
	});

	test('leaves a partial last record out of the bytes read', async ({ expect }) => {
		const bytes = (await readFile(LOG_FIXTURES[0]!.filePath)).subarray(0, -1);
		const index = indexDataLog(bytes);

		expect(index.truncated).toBe(true);
		expect(index.bytesRead).toBeLessThan(bytes.byteLength);
		const whole = indexDataLog(bytes.subarray(0, index.bytesRead));
		expect(whole.truncated).toBe(false);
		expect(whole.bytesRead).toBe(index.bytesRead);
	});
});
