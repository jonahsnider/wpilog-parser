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

function finishControl(entryId: number): ReadRecord {
	return {
		kind: 'control',
		entryId: 0,
		timestamp: 0n,
		payload: { controlRecordType: ControlRecordType.Finish, entryId },
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
	test('decodes scalar payloads', () => {
		const int64 = new Uint8Array(8);
		new DataView(int64.buffer).setBigInt64(0, -42n, true);
		const float = new Uint8Array(4);
		new DataView(float.buffer).setFloat32(0, 1.5, true);
		const double = new Uint8Array(8);
		new DataView(double.buffer).setFloat64(0, Math.PI, true);

		const records = [
			headerRecord(),
			startControl(1, 'boolean'),
			dataRecord(1, new Uint8Array([1])),
			startControl(2, 'int64'),
			dataRecord(2, int64),
			startControl(3, 'float'),
			dataRecord(3, float),
			startControl(4, 'double'),
			dataRecord(4, double),
		];

		const results = Array.from(decodeRecords(records)).filter((record) => record.type !== RecordType.Control);

		expect(results).toStrictEqual([
			{ entryId: 1, timestamp: 0n, name: '/entry-1', metadata: '', type: RecordType.Boolean, payload: true },
			{ entryId: 2, timestamp: 0n, name: '/entry-2', metadata: '', type: RecordType.Int64, payload: -42n },
			{ entryId: 3, timestamp: 0n, name: '/entry-3', metadata: '', type: RecordType.Float, payload: 1.5 },
			{ entryId: 4, timestamp: 0n, name: '/entry-4', metadata: '', type: RecordType.Double, payload: Math.PI },
		]);
	});

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

	test('retains the original entry context while waiting for a struct schema', () => {
		const records = [
			headerRecord(),
			startControl(1, 'struct:Old', 'old-entry', 'old-metadata'),
			dataRecord(1, new Uint8Array([42])),
			finishControl(1),
			startControl(1, 'struct:New', 'new-entry', 'new-metadata'),
			startControl(2, 'structschema', '.schema/struct:Old'),
			dataRecord(2, new TextEncoder().encode('uint8 value')),
		];

		const structResults = Array.from(decodeRecords(records)).filter((record) => record.type === RecordType.Struct);

		expect(structResults).toStrictEqual([
			{
				entryId: 1,
				timestamp: 0n,
				name: '/old-entry',
				metadata: 'old-metadata',
				type: RecordType.Struct,
				structName: 'Old',
				payload: new Map([['value', 42]]),
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
