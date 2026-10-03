import { describe, test } from 'vite-plus/test';
import { readRecords } from '../src/read-records.ts';

const TEXT_ENCODER = new TextEncoder();

function buildMinimalWpilog(): Uint8Array {
	const magic = TEXT_ENCODER.encode('WPILOG');
	return new Uint8Array([...magic, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
}

describe('readRecords input types', () => {
	test('accepts Uint8Array', ({ expect }) => {
		const bytes = buildMinimalWpilog();
		const records = Array.from(readRecords(bytes));
		expect(records).toHaveLength(1);
		expect(records[0].kind).toBe('header');
	});

	test('accepts ArrayBuffer', ({ expect }) => {
		const bytes = buildMinimalWpilog();
		const records = Array.from(readRecords(bytes.buffer as ArrayBuffer));
		expect(records).toHaveLength(1);
		expect(records[0].kind).toBe('header');
	});
});
