import { describe, test } from 'vite-plus/test';
import { RecordCursor, readRecords } from '../src/read-records.ts';

describe('timestamps', () => {
	for (let length = 1; length <= 8; length++) {
		test(`decodes exact ${length}-byte timestamps through both readers`, ({ expect }) => {
			const max = (1n << BigInt(length * 8)) - 1n;
			const candidates = [
				0n,
				1n,
				0x80n,
				0xffn,
				0x100n,
				0x7fffffn,
				0xffffffn,
				0x7fffffffn,
				0x80000000n,
				0xffffffffn,
				0x100000000n,
				(1n << 40n) - 1n,
				1n << 40n,
				(1n << 48n) - 1n,
				1n << 48n,
				(1n << 53n) - 1n,
				1n << 53n,
				(1n << 53n) + 1n,
				max - 1n,
				max,
			];
			for (const timestamp of new Set(candidates.filter((value) => value <= max))) {
				// End the record at the buffer boundary: short timestamps must not over-read.
				// Use a nonzero input byteOffset as well as an unaligned timestamp offset.
				const backing = new Uint8Array(5 + 12 + 3 + length);
				const bytes = backing.subarray(5);
				bytes.set([0x57, 0x50, 0x49, 0x4c, 0x4f, 0x47, 0, 1]);
				bytes.set([(length - 1) << 4, 1, 0], 12);
				let remaining = timestamp;
				for (let i = 0; i < length; i++) {
					bytes[15 + i] = Number(remaining & 0xffn);
					remaining >>= 8n;
				}

				const records = [...readRecords(bytes)];
				expect(records).toHaveLength(2);
				expect(records[1]).toMatchObject({ kind: 'data', record: { timestamp } });
				const cursor = new RecordCursor(bytes);
				expect(cursor.next()).toBe(true);
				expect(cursor.timestamp).toBe(timestamp);
				expect(cursor.next()).toBe(false);
			}
		});
	}
});
