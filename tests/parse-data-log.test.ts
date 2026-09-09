import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, test } from 'vite-plus/test';
import { decodeRecords, parseDataLog, readRecords } from '../src/index.js';

describe('parseDataLog', () => {
	test('matches the composed parser for a real log', async () => {
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

	test('supports strict orphan-record validation', () => {
		const bytes = new Uint8Array([...new TextEncoder().encode('WPILOG'), 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1]);

		expect(() => Array.from(parseDataLog(bytes, { strict: true }))).toThrowError('No type registered for entry ID 1');
	});

	test('validates the file header', () => {
		expect(() => Array.from(parseDataLog(new Uint8Array(0)))).toThrowError('Not a WPILOG file');
	});
});
