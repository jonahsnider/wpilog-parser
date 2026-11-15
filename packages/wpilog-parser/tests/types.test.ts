import { describe, test } from 'vite-plus/test';
import { type DecodedRecord, RecordType, isDataRecord } from '../src/types.ts';

describe('isDataRecord', () => {
	test('returns true for data records', ({ expect }) => {
		const record: DecodedRecord = {
			entry: { entryId: 1, name: '/test', type: 'double', metadata: '' },
			timestamp: 0,
			type: RecordType.Double,
			payload: 1.5,
		};
		expect(isDataRecord(record)).toBe(true);
	});

	test('returns false for control records', ({ expect }) => {
		const record: DecodedRecord = {
			entryId: 0,
			timestamp: 0,
			type: RecordType.Control,
			payload: { controlRecordType: 1, entryId: 1 },
		};
		expect(isDataRecord(record)).toBe(false);
	});

	test('narrows type to access name field', ({ expect }) => {
		const record: DecodedRecord = {
			entry: { entryId: 1, name: '/test/entry', type: 'string', metadata: '' },
			timestamp: 0,
			type: RecordType.String,
			payload: 'hello',
		};

		if (isDataRecord(record)) {
			// This should compile — entry is accessible after narrowing
			expect(record.entry.name).toBe('/test/entry');
		}
	});
});
