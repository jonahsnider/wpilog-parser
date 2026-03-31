import { describe, expect, test } from 'vite-plus/test';
import { type ReadRecord, readRecords } from '../src/read-records.js';
import { ControlRecordType } from '../src/types.js';

const TEXT_ENCODER = new TextEncoder();

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new Blob([bytes]).stream();
}

/** Build a minimal WPILOG file with the given records appended after the header. */
function buildWpilog(...recordBytes: Uint8Array[]): Uint8Array {
	const magic = TEXT_ENCODER.encode('WPILOG');
	// Header: WPILOG + version 1.0 + 0 extra header length
	const header = new Uint8Array([
		...magic,
		0x00,
		0x01, // version minor=0, major=1
		0x00,
		0x00,
		0x00,
		0x00, // extra header length = 0
	]);

	const totalLength = header.byteLength + recordBytes.reduce((sum, r) => sum + r.byteLength, 0);
	const result = new Uint8Array(totalLength);
	result.set(header, 0);
	let offset = header.byteLength;
	for (const r of recordBytes) {
		result.set(r, offset);
		offset += r.byteLength;
	}
	return result;
}

async function collectRecords(stream: ReadableStream<Uint8Array>): Promise<ReadRecord[]> {
	const results: ReadRecord[] = [];
	for await (const record of readRecords(stream)) {
		results.push(record);
	}
	return results;
}

/**
 * Build a data record with given parameters.
 * Uses minimal header lengths (1 byte each for entryId, payloadSize, timestamp).
 */
function buildDataRecord(entryId: number, timestamp: number, payload: Uint8Array): Uint8Array {
	// Header length byte: all lengths = 1 byte => 0x00
	const record = new Uint8Array(1 + 1 + 1 + 1 + payload.byteLength);
	const view = new DataView(record.buffer);
	record[0] = 0x00; // entryIdLength=1, payloadSizeLength=1, timestampLength=1
	view.setUint8(1, entryId);
	view.setUint8(2, payload.byteLength);
	view.setUint8(3, timestamp);
	record.set(payload, 4);
	return record;
}

describe('readRecords', () => {
	describe('header parsing', () => {
		test('reads header from minimal WPILOG file', async () => {
			const results = await collectRecords(streamFromBytes(buildWpilog()));

			expect(results).toHaveLength(1);
			expect(results[0]).toStrictEqual({
				kind: 'header',
				header: { version: { major: 1, minor: 0 }, extraHeader: '' },
			});
		});

		test('reads header with extra header data', async () => {
			const extraHeader = TEXT_ENCODER.encode('extra');
			const magic = TEXT_ENCODER.encode('WPILOG');
			const header = new Uint8Array([
				...magic,
				0x00,
				0x01, // version minor=0, major=1
				...new Uint8Array(new Uint32Array([extraHeader.byteLength]).buffer), // extra header length (LE)
				...extraHeader,
			]);
			const results = await collectRecords(streamFromBytes(header));

			expect(results).toHaveLength(1);
			expect(results[0]).toStrictEqual({
				kind: 'header',
				header: { version: { major: 1, minor: 0 }, extraHeader: 'extra' },
			});
		});

		test('rejects non-WPILOG files', async () => {
			const file = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

			await expect(async () => {
				for await (const _ of readRecords(streamFromBytes(file))) {
					// consume
				}
			}).rejects.toThrowError('Not a WPILOG file');
		});
	});

	describe('record header length bitfield', () => {
		test('all lengths = 1 (0x00)', async () => {
			// entryId=1, payloadSize=0, timestamp=0
			const record = new Uint8Array([0x00, 0x05, 0x00, 0x00]);
			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			expect(results).toHaveLength(2); // header + data
			const dataRecord = results[1];
			expect(dataRecord).toMatchObject({ kind: 'data' });
			if (dataRecord.kind === 'data') {
				expect(dataRecord.record.entryId).toBe(5);
				expect(dataRecord.record.timestamp).toBe(0n);
			}
		});

		test('timestampLength=3 (0x20)', async () => {
			// bitfield 0x20 = 0b00100000 => entryIdLength=1, payloadSizeLength=1, timestampLength=3
			const record = new Uint8Array([0x20, 0x01, 0x00, 0x80, 0x00, 0x00]);
			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			expect(results).toHaveLength(2);
			const dataRecord = results[1];
			if (dataRecord.kind === 'data') {
				expect(dataRecord.record.entryId).toBe(1);
				expect(dataRecord.record.timestamp).toBe(128n);
			}
		});
	});

	describe('entry ID parsing', () => {
		test('1-byte entry ID', async () => {
			const record = buildDataRecord(42, 0, new Uint8Array(0));
			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			expect(results[1]).toMatchObject({ kind: 'data' });
			if (results[1].kind === 'data') {
				expect(results[1].record.entryId).toBe(42);
			}
		});

		test('2-byte entry ID', async () => {
			// bitfield: entryIdLength=2(0b01), payloadSizeLength=1(0b00), timestampLength=1(0b000) => 0x01
			const record = new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x00]);
			const view = new DataView(record.buffer);
			view.setUint16(1, 300, true); // entry ID = 300
			record[3] = 0x00; // payload size = 0
			record[4] = 0x00; // timestamp = 0
			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			if (results[1].kind === 'data') {
				expect(results[1].record.entryId).toBe(300);
			}
		});

		test('3-byte entry ID', async () => {
			// bitfield: entryIdLength=3(0b10), payloadSizeLength=1(0b00), timestampLength=1(0b000) => 0x02
			const record = new Uint8Array([0x02, 0x01, 0x00, 0x00, 0x00, 0x00]);
			record[1] = 0x01; // byte0
			record[2] = 0x00; // byte1
			record[3] = 0x00; // byte2
			record[4] = 0x00; // payload size = 0
			record[5] = 0x00; // timestamp = 0
			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			if (results[1].kind === 'data') {
				expect(results[1].record.entryId).toBe(1);
			}
		});

		test('4-byte entry ID', async () => {
			// bitfield: entryIdLength=4(0b11), payloadSizeLength=1(0b00), timestampLength=1(0b000) => 0x03
			const record = new Uint8Array([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
			const view = new DataView(record.buffer);
			view.setUint32(1, 1, true); // entry ID = 1
			record[5] = 0x00; // payload size = 0
			record[6] = 0x00; // timestamp = 0
			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			if (results[1].kind === 'data') {
				expect(results[1].record.entryId).toBe(1);
			}
		});
	});

	describe('control records', () => {
		test('start control record', async () => {
			const entryName = TEXT_ENCODER.encode('test');
			const entryType = TEXT_ENCODER.encode('double');
			const entryMetadata = new Uint8Array(0);

			const payloadSize = 1 + 4 + 4 + entryName.byteLength + 4 + entryType.byteLength + 4 + entryMetadata.byteLength;
			const payload = new Uint8Array(payloadSize);
			const pView = new DataView(payload.buffer);
			let off = 0;

			pView.setUint8(off, ControlRecordType.Start);
			off += 1;
			pView.setUint32(off, 1, true);
			off += 4;
			pView.setUint32(off, entryName.byteLength, true);
			off += 4;
			payload.set(entryName, off);
			off += entryName.byteLength;
			pView.setUint32(off, entryType.byteLength, true);
			off += 4;
			payload.set(entryType, off);
			off += entryType.byteLength;
			pView.setUint32(off, entryMetadata.byteLength, true);
			off += 4;

			// Use 2-byte payload size since payloadSize > 255 possible
			// bitfield: entryIdLength=1(0b00), payloadSizeLength=1(0b00), timestampLength=1(0b000) => 0x00
			const record = new Uint8Array(1 + 1 + 1 + 1 + payloadSize);
			const rView = new DataView(record.buffer);
			record[0] = 0x00;
			rView.setUint8(1, 0); // entryId = 0 (control)
			rView.setUint8(2, payloadSize);
			rView.setUint8(3, 0); // timestamp = 0
			record.set(payload, 4);

			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			expect(results).toHaveLength(2);
			expect(results[1]).toStrictEqual({
				kind: 'control',
				entryId: 0,
				timestamp: 0n,
				payload: {
					controlRecordType: ControlRecordType.Start,
					entryId: 1,
					entryName: 'test',
					entryType: 'double',
					entryMetadata: '',
				},
			});
		});

		test('finish control record', async () => {
			const payloadSize = 1 + 4; // type + entryId
			const payload = new Uint8Array(payloadSize);
			const pView = new DataView(payload.buffer);
			pView.setUint8(0, ControlRecordType.Finish);
			pView.setUint32(1, 1, true);

			const record = new Uint8Array(1 + 1 + 1 + 1 + payloadSize);
			record[0] = 0x00;
			record[1] = 0; // entryId = 0
			record[2] = payloadSize;
			record[3] = 0;
			record.set(payload, 4);

			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			expect(results).toHaveLength(2);
			expect(results[1]).toStrictEqual({
				kind: 'control',
				entryId: 0,
				timestamp: 0n,
				payload: {
					controlRecordType: ControlRecordType.Finish,
					entryId: 1,
				},
			});
		});

		test('set metadata control record', async () => {
			const metadata = TEXT_ENCODER.encode('meta');
			const payloadSize = 1 + 4 + 4 + metadata.byteLength;
			const payload = new Uint8Array(payloadSize);
			const pView = new DataView(payload.buffer);
			let off = 0;
			pView.setUint8(off, ControlRecordType.SetMetadata);
			off += 1;
			pView.setUint32(off, 1, true);
			off += 4;
			pView.setUint32(off, metadata.byteLength, true);
			off += 4;
			payload.set(metadata, off);

			const record = new Uint8Array(1 + 1 + 1 + 1 + payloadSize);
			record[0] = 0x00;
			record[1] = 0;
			record[2] = payloadSize;
			record[3] = 0;
			record.set(payload, 4);

			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			expect(results).toHaveLength(2);
			expect(results[1]).toStrictEqual({
				kind: 'control',
				entryId: 0,
				timestamp: 0n,
				payload: {
					controlRecordType: ControlRecordType.SetMetadata,
					entryId: 1,
					entryMetadata: 'meta',
				},
			});
		});
	});

	describe('data records', () => {
		test('reads data record payload', async () => {
			const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
			const record = buildDataRecord(5, 100, payload);
			const results = await collectRecords(streamFromBytes(buildWpilog(record)));

			expect(results).toHaveLength(2);
			const data = results[1];
			expect(data.kind).toBe('data');
			if (data.kind === 'data') {
				expect(data.record.entryId).toBe(5);
				expect(data.record.timestamp).toBe(100n);
				expect(data.record.payload).toStrictEqual(payload);
			}
		});

		test('reads multiple records', async () => {
			const record1 = buildDataRecord(1, 10, new Uint8Array([0x01]));
			const record2 = buildDataRecord(2, 20, new Uint8Array([0x02]));
			const results = await collectRecords(streamFromBytes(buildWpilog(record1, record2)));

			expect(results).toHaveLength(3); // header + 2 data
			if (results[1].kind === 'data' && results[2].kind === 'data') {
				expect(results[1].record.entryId).toBe(1);
				expect(results[2].record.entryId).toBe(2);
			}
		});
	});
});
