import { describe, expect, test } from 'vite-plus/test';
import { readRecords } from '../src/read-records.js';

const TEXT_ENCODER = new TextEncoder();

function buildMinimalWpilog(): Uint8Array {
	const magic = TEXT_ENCODER.encode('WPILOG');
	return new Uint8Array([...magic, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
}

describe('readRecords input types', () => {
	test('accepts Uint8Array', async () => {
		const bytes = buildMinimalWpilog();
		const records = [];
		for await (const record of readRecords(bytes)) {
			records.push(record);
		}
		expect(records).toHaveLength(1);
		expect(records[0].kind).toBe('header');
	});

	test('accepts ArrayBuffer', async () => {
		const bytes = buildMinimalWpilog();
		const records = [];
		for await (const record of readRecords(bytes.buffer as ArrayBuffer)) {
			records.push(record);
		}
		expect(records).toHaveLength(1);
		expect(records[0].kind).toBe('header');
	});

	test('accepts ReadableStream', async () => {
		const bytes = buildMinimalWpilog();
		const stream = new Blob([bytes]).stream();
		const records = [];
		for await (const record of readRecords(stream)) {
			records.push(record);
		}
		expect(records).toHaveLength(1);
		expect(records[0].kind).toBe('header');
	});
});
