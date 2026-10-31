import { describe, test } from 'vite-plus/test';
import { type DecodedRecord, RecordType, isDataRecord } from '../src/types.ts';

describe('isDataRecord', () => {
	test('returns true for data records', ({ expect }) => {
		const record: DecodedRecord = {
			entryId: 1,
			timestamp: 0n,
			type: RecordType.Double,
			name: '/test',
			metadata: '',
			payload: 1.5,
		};
		expect(isDataRecord(record)).toBe(true);
	});

	test('returns false for control records', ({ expect }) => {
		const record: DecodedRecord = {
			entryId: 0,
			timestamp: 0n,
			type: RecordType.Control,
			payload: { controlRecordType: 1, entryId: 1 },
		};
		expect(isDataRecord(record)).toBe(false);
	});

	test('narrows type to access name field', ({ expect }) => {
		const record: DecodedRecord = {
			entryId: 1,
			timestamp: 0n,
			type: RecordType.String,
			name: '/test/entry',
			metadata: '',
			payload: 'hello',
		};

		if (isDataRecord(record)) {
			// This should compile — name is accessible after narrowing
			expect(record.name).toBe('/test/entry');
		}
	});
});
