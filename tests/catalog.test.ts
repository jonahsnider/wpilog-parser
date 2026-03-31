import { describe, expect, test } from 'vite-plus/test';
import { catalogEntries } from '../src/catalog.js';
import { readRecords } from '../src/read-records.js';
import { ControlRecordType } from '../src/types.js';

const TEXT_ENCODER = new TextEncoder();

function buildWpilog(...recordBytes: Uint8Array[]): Uint8Array {
	const magic = TEXT_ENCODER.encode('WPILOG');
	const header = new Uint8Array([...magic, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
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

function buildStartControlRecord(entryId: number, name: string, type: string, metadata: string): Uint8Array {
	const nameBytes = TEXT_ENCODER.encode(name);
	const typeBytes = TEXT_ENCODER.encode(type);
	const metadataBytes = TEXT_ENCODER.encode(metadata);
	const payloadSize = 1 + 4 + 4 + nameBytes.byteLength + 4 + typeBytes.byteLength + 4 + metadataBytes.byteLength;
	const record = new Uint8Array(1 + 1 + 1 + 1 + payloadSize);
	const view = new DataView(record.buffer);

	record[0] = 0x00; // all lengths = 1
	view.setUint8(1, 0); // entryId = 0 (control)
	view.setUint8(2, payloadSize);
	view.setUint8(3, 0); // timestamp = 0

	let offset = 4;
	view.setUint8(offset, ControlRecordType.Start);
	offset += 1;
	view.setUint32(offset, entryId, true);
	offset += 4;
	view.setUint32(offset, nameBytes.byteLength, true);
	offset += 4;
	record.set(nameBytes, offset);
	offset += nameBytes.byteLength;
	view.setUint32(offset, typeBytes.byteLength, true);
	offset += 4;
	record.set(typeBytes, offset);
	offset += typeBytes.byteLength;
	view.setUint32(offset, metadataBytes.byteLength, true);
	offset += 4;
	record.set(metadataBytes, offset);

	return record;
}

describe('catalogEntries', () => {
	test('collects start control records', async () => {
		const wpilog = buildWpilog(
			buildStartControlRecord(1, 'Robot/Pose', 'struct:Pose2d', ''),
			buildStartControlRecord(2, 'DS:enabled', 'boolean', ''),
		);

		const catalog = await Array.fromAsync(catalogEntries(readRecords(wpilog)));

		expect(catalog).toStrictEqual([
			{ entryId: 1, name: 'Robot/Pose', type: 'struct:Pose2d', metadata: '' },
			{ entryId: 2, name: 'DS:enabled', type: 'boolean', metadata: '' },
		]);
	});

	test('returns empty array for file with no entries', async () => {
		const wpilog = buildWpilog();
		const catalog = await Array.fromAsync(catalogEntries(readRecords(wpilog)));
		expect(catalog).toStrictEqual([]);
	});
});
