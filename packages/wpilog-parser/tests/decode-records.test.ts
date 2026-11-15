import { describe, expect, test, vi } from 'vite-plus/test';
import { decodeRecords } from '../src/decode-records.ts';
import type { ReadRecord } from '../src/read-records.ts';
import { ControlRecordType, type DataRecord, RecordType } from '../src/types.ts';

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
		timestamp: 0,
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
		timestamp: 0,
		payload: { controlRecordType: ControlRecordType.Finish, entryId },
	};
}

function setMetadataControl(entryId: number, entryMetadata: string): ReadRecord {
	return {
		kind: 'control',
		entryId: 0,
		timestamp: 0,
		payload: { controlRecordType: ControlRecordType.SetMetadata, entryId, entryMetadata },
	};
}

function dataRecord(entryId: number, payload: Uint8Array, timestamp = 0): ReadRecord {
	return { kind: 'data', record: { entryId, timestamp, payload } };
}

describe('decodeRecords', () => {
	// CSP cases replace the global Function constructor and run sequentially.
	test.for(['generated', 'CSP'] as const)(
		'decodes queued struct arrays after dependencies arrive (%s)',
		{ concurrent: false },
		(mode) => {
			if (mode === 'CSP') {
				vi.spyOn(globalThis, 'Function').mockImplementation(function () {
					throw new EvalError('Code generation disallowed by CSP');
				});
			}
			try {
				const records = [
					headerRecord(),
					startControl(1, 'struct:Outer[]'),
					startControl(2, 'structschema', '.schema/struct:Outer'),
					dataRecord(2, new TextEncoder().encode('Inner value')),
					dataRecord(1, new Uint8Array([42, 7])),
					startControl(3, 'structschema', '.schema/struct:Inner'),
					dataRecord(3, new TextEncoder().encode('uint8 count')),
				];
				const structs = Array.from(decodeRecords(records)).filter((record) => record.type === RecordType.StructArray);
				expect(structs).toHaveLength(1);
				expect(structs[0]?.payload).toStrictEqual([{ value: { count: 42 } }, { value: { count: 7 } }]);
			} finally {
				vi.restoreAllMocks();
			}
		},
	);

	test('decodes scalar payloads', ({ expect }) => {
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
			{
				entry: { entryId: 1, name: '/entry-1', type: 'boolean', metadata: '' },
				timestamp: 0,
				type: RecordType.Boolean,
				payload: true,
			},
			{
				entry: { entryId: 2, name: '/entry-2', type: 'int64', metadata: '' },
				timestamp: 0,
				type: RecordType.Int64,
				payload: -42n,
			},
			{
				entry: { entryId: 3, name: '/entry-3', type: 'float', metadata: '' },
				timestamp: 0,
				type: RecordType.Float,
				payload: 1.5,
			},
			{
				entry: { entryId: 4, name: '/entry-4', type: 'double', metadata: '' },
				timestamp: 0,
				type: RecordType.Double,
				payload: Math.PI,
			},
		]);
	});

	test('applies metadata updates to subsequent data records', ({ expect }) => {
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
				entry: { entryId: 1, name: '/enabled', type: 'boolean', metadata: 'initial' },
				timestamp: 0,
				type: RecordType.Boolean,
				payload: true,
			},
			{
				entry: { entryId: 1, name: '/enabled', type: 'boolean', metadata: 'updated' },
				timestamp: 0,
				type: RecordType.Boolean,
				payload: false,
			},
		]);
	});

	test('retains the original entry context while waiting for a struct schema', ({ expect }) => {
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
				entry: { entryId: 1, name: '/old-entry', type: 'struct:Old', metadata: 'old-metadata' },
				timestamp: 0,
				type: RecordType.Struct,
				structName: 'Old',
				payload: { value: 42 },
			},
		]);
	});

	describe('orphan data records (no Start control record)', () => {
		test('skips orphan data records by default (lenient mode)', ({ expect }) => {
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
			expect(dataResults[0]).toMatchObject({ entry: { entryId: 1 }, type: RecordType.Int64, payload: 42n });
			expect(dataResults[1]).toMatchObject({ entry: { entryId: 1 }, type: RecordType.Int64, payload: 43n });
			// Records from the same entry share one entry object instead of copying its fields
			expect((dataResults[0] as DataRecord).entry).toBe((dataResults[1] as DataRecord).entry);
		});

		test('throws on orphan data records when strict: true', ({ expect }) => {
			const records = [headerRecord(), dataRecord(99, new Uint8Array([0]))];

			expect(() => Array.from(decodeRecords(records, { strict: true }))).toThrowError(
				/No type registered for entry ID 99/,
			);
		});
	});
});
