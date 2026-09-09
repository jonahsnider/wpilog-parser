import { describe, expect, test } from 'vite-plus/test';
import { decodeRecords } from '../src/decode-records.js';
import type { ReadRecord } from '../src/read-records.js';
import { ControlRecordType, RecordType } from '../src/types.js';

function headerRecord(): ReadRecord {
	return {
		kind: 'header',
		header: { version: { major: 1, minor: 0 }, extraHeader: '' },
	};
}

function startControl(
	entryId: number,
	entryType: string,
	entryName = `entry-${entryId}`,
	entryMetadata = '',
): ReadRecord {
	return {
		kind: 'control',
		entryId: 0,
		timestamp: 0n,
		payload: {
			controlRecordType: ControlRecordType.Start,
			entryId,
			entryName,
			entryType,
			entryMetadata,
		},
	};
}

function setMetadataControl(entryId: number, entryMetadata: string): ReadRecord {
	return {
		kind: 'control',
		entryId: 0,
		timestamp: 0n,
		payload: { controlRecordType: ControlRecordType.SetMetadata, entryId, entryMetadata },
	};
}

function dataRecord(entryId: number, payload: Uint8Array, timestamp = 0n): ReadRecord {
	return { kind: 'data', record: { entryId, timestamp, payload } };
}

describe('decodeRecords', () => {
	test('applies metadata updates to subsequent data records', () => {
		const records = [
			headerRecord(),
			startControl(1, 'boolean', 'enabled', 'initial'),
			dataRecord(1, new Uint8Array([1])),
			setMetadataControl(1, 'updated'),
			dataRecord(1, new Uint8Array([0])),
		];

		const dataResults = Array.from(decodeRecords(records)).filter((record) => record.type === RecordType.Boolean);

		expect(dataResults).toStrictEqual([
			{
				entryId: 1,
				timestamp: 0n,
				name: '/enabled',
				metadata: 'initial',
				type: RecordType.Boolean,
				payload: true,
			},
			{
				entryId: 1,
				timestamp: 0n,
				name: '/enabled',
				metadata: 'updated',
				type: RecordType.Boolean,
				payload: false,
			},
		]);
	});

	describe('orphan data records (no Start control record)', () => {
		test('skips orphan data records by default (lenient mode)', () => {
			const records = [
				headerRecord(),
				startControl(1, 'int64'),
				dataRecord(1, new Uint8Array(new BigInt64Array([42n]).buffer)),
				// Orphan: entry ID 99 was never started
				dataRecord(99, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])),
				dataRecord(1, new Uint8Array(new BigInt64Array([43n]).buffer)),
			];

			const results = Array.from(decodeRecords(records));
			const dataResults = results.filter((r) => r.type !== RecordType.Control);

			expect(dataResults).toHaveLength(2);
			expect(dataResults[0]).toMatchObject({ entryId: 1, type: RecordType.Int64, payload: 42n });
			expect(dataResults[1]).toMatchObject({ entryId: 1, type: RecordType.Int64, payload: 43n });
		});

		test('throws on orphan data records when strict: true', () => {
			const records = [headerRecord(), dataRecord(99, new Uint8Array([0]))];

			expect(() => Array.from(decodeRecords(records, { strict: true }))).toThrowError(
				/No type registered for entry ID 99/,
			);
		});
	});
});
