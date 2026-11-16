import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { describe, test } from 'vite-plus/test';
import { type DataLogGenerator, decodeRecords, parseDataLog, readRecords, RecordType } from '../src/index.ts';

describe('parseDataLog', () => {
	test('matches the composed parser for a real log', async ({ expect }) => {
		const bytes = await readFile(new URL('./fixtures/logs/FRC_20250727_235138__E14.wpilog', import.meta.url));
		const expected = decodeRecords(readRecords(bytes));
		const actual = parseDataLog(bytes);
		let count = 0;

		while (true) {
			const expectedResult = expected.next();
			const actualResult = actual.next();
			if (!isDeepStrictEqual(actualResult, expectedResult)) {
				throw new Error(`Fused parser result differs at record ${count}`);
			}
			if (expectedResult.done) break;
			count++;
		}

		expect(count).toBe(200_349);
	});

	test('decodes control word bit fields from a real log', async ({ expect }) => {
		const bytes = await readFile(new URL('./fixtures/logs/WPILIB_TBD_aba74b981a582b4b.wpilog', import.meta.url));
		const controlWords = Array.from(parseDataLog(bytes)).flatMap((record) => {
			if (
				record.type !== RecordType.Struct ||
				(record.entry.name !== '/NT:/DriverStation/ControlWord' && record.entry.name !== '/DS:controlWord')
			) {
				return [];
			}
			return [{ name: record.entry.name, payload: record.payload }];
		});

		const expectedPayload = {
			opModeHash: 0n,
			robotMode: 0n,
			enabled: false,
			eStop: false,
			fmsAttached: false,
			dsAttached: false,
		};
		expect(controlWords).toStrictEqual([
			{ name: '/NT:/DriverStation/ControlWord', payload: expectedPayload },
			{ name: '/DS:controlWord', payload: expectedPayload },
		]);
	});

	test('supports strict orphan-record validation', ({ expect }) => {
		const bytes = new Uint8Array([...new TextEncoder().encode('WPILOG'), 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1]);

		expect(() => Array.from(parseDataLog(bytes, { strict: true }))).toThrowError('No type registered for entry ID 1');
	});

	test('reports bytes read as records are consumed', async ({ expect }) => {
		const bytes = await readFile(new URL('./fixtures/logs/WPILIB_TBD_aba74b981a582b4b.wpilog', import.meta.url));

		for (const records of [parseDataLog(bytes), readRecords(bytes)]) {
			let previous = records.bytesRead;
			for (const _record of records) {
				expect(records.bytesRead).toBeGreaterThanOrEqual(previous);
				expect(records.bytesRead).toBeLessThanOrEqual(bytes.byteLength);
				previous = records.bytesRead;
			}
			expect(records.bytesRead).toBe(bytes.byteLength);
		}
	});

	test('reports whether the log ended partway through a record', async ({ expect }) => {
		const bytes = await readFile(new URL('./fixtures/logs/WPILIB_TBD_aba74b981a582b4b.wpilog', import.meta.url));

		const parsers: Array<(input: Uint8Array) => DataLogGenerator<unknown>> = [parseDataLog, readRecords];
		for (const parse of parsers) {
			const complete = parse(bytes);
			Array.from(complete);
			expect(complete.truncated).toBe(false);

			// Cutting off the final byte leaves the last record's payload incomplete
			const truncated = parse(bytes.subarray(0, -1));
			expect(truncated.truncated).toBe(false);
			Array.from(truncated);
			expect(truncated.truncated).toBe(true);
			expect(truncated.bytesRead).toBe(bytes.byteLength - 1);
		}
	});

	test('validates the file header', ({ expect }) => {
		expect(() => Array.from(parseDataLog(new Uint8Array(0)))).toThrowError('Not a WPILOG file');
	});
});
