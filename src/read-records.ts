import { type ControlRecordPayload, ControlRecordType, type DataLogHeader, type RawRecord } from './types.js';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const MAGIC = TEXT_ENCODER.encode('WPILOG');

function readControlRecordPayload(payload: Uint8Array, view: DataView): ControlRecordPayload {
	const base = payload.byteOffset;
	let offset = base;

	const type = view.getUint8(offset);
	offset += 1;

	switch (type) {
		case ControlRecordType.Start: {
			const entryId = view.getUint32(offset, true);
			offset += 4;
			const entryNameLength = view.getUint32(offset, true);
			offset += 4;
			const entryName = TEXT_DECODER.decode(payload.subarray(offset - base, offset - base + entryNameLength));
			offset += entryNameLength;
			const entryTypeLength = view.getUint32(offset, true);
			offset += 4;
			const entryType = TEXT_DECODER.decode(payload.subarray(offset - base, offset - base + entryTypeLength));
			offset += entryTypeLength;
			const entryMetadataLength = view.getUint32(offset, true);
			offset += 4;
			const entryMetadata = TEXT_DECODER.decode(payload.subarray(offset - base, offset - base + entryMetadataLength));

			return {
				controlRecordType: type,
				entryId,
				entryName,
				entryType,
				entryMetadata,
			};
		}
		case ControlRecordType.Finish: {
			const entryId = view.getUint32(offset, true);
			return { controlRecordType: type, entryId };
		}
		case ControlRecordType.SetMetadata: {
			const entryId = view.getUint32(offset, true);
			offset += 4;
			const entryMetadataLength = view.getUint32(offset, true);
			offset += 4;
			const entryMetadata = TEXT_DECODER.decode(payload.subarray(offset - base, offset - base + entryMetadataLength));
			return { controlRecordType: type, entryId, entryMetadata };
		}
		default:
			throw new RangeError(`Invalid control record type ${type}`);
	}
}

/** A raw record or control record yielded by {@link readRecords}. */
export type ReadRecord =
	| { kind: 'header'; header: DataLogHeader }
	| {
			kind: 'control';
			entryId: number;
			timestamp: bigint;
			payload: ControlRecordPayload;
	  }
	| { kind: 'data'; record: RawRecord };

/** Accepted input types for {@link readRecords}. */
export type DataLogInput = Uint8Array | ArrayBuffer;

function toUint8Array(input: DataLogInput): Uint8Array {
	if (input instanceof Uint8Array) {
		return input;
	}
	return new Uint8Array(input);
}

function readVarInt(view: DataView, offset: number, length: number): number {
	switch (length) {
		case 1:
			return view.getUint8(offset);
		case 2:
			return view.getUint16(offset, true);
		case 3:
			return (view.getUint8(offset + 2) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset);
		case 4:
			return view.getUint32(offset, true);
		default:
			throw new RangeError(`Invalid varint length ${length}`);
	}
}

const TWO_POW_32 = 0x1_0000_0000n;

function readTimestamp(view: DataView, offset: number, length: number): bigint {
	switch (length) {
		case 1:
			return BigInt(view.getUint8(offset));
		case 2:
			return BigInt(view.getUint16(offset, true));
		case 3:
			return BigInt((view.getUint8(offset + 2) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset));
		case 4:
			return BigInt(view.getUint32(offset, true));
		case 5: {
			const lo = view.getUint32(offset, true);
			const hi = view.getUint8(offset + 4);
			return BigInt(hi) * TWO_POW_32 + BigInt(lo);
		}
		case 6: {
			const lo = view.getUint32(offset, true);
			const hi = view.getUint16(offset + 4, true);
			return BigInt(hi) * TWO_POW_32 + BigInt(lo);
		}
		case 7: {
			const lo = view.getUint32(offset, true);
			const hiLow = view.getUint16(offset + 4, true);
			const hiHigh = view.getUint8(offset + 6);
			const hi = (hiHigh << 16) | hiLow;
			return BigInt(hi) * TWO_POW_32 + BigInt(lo);
		}
		case 8:
			return view.getBigUint64(offset, true);
		default:
			throw new RangeError(`Invalid timestamp length ${length}`);
	}
}

/**
 * Read raw WPILOG records from an in-memory buffer.
 *
 * Yields a header record first, then control and data records in order.
 * Data record payloads are not decoded — use {@link decodeRecords} for that.
 */
export function* readRecords(input: DataLogInput): Generator<ReadRecord> {
	const bytes = toUint8Array(input);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const total = bytes.byteLength;

	// Header: 6-byte magic, 1-byte minor, 1-byte major, 4-byte extra header length, extra header.
	if (total < 12) {
		throw new Error('Not a WPILOG file (truncated header)');
	}

	for (let i = 0; i < MAGIC.byteLength; i++) {
		if (bytes[i] !== MAGIC[i]) {
			throw new Error('Not a WPILOG file (invalid magic bytes)');
		}
	}

	const versionMinor = view.getUint8(6);
	const versionMajor = view.getUint8(7);
	const extraHeaderLength = view.getUint32(8, true);
	let offset = 12;

	if (offset + extraHeaderLength > total) {
		throw new Error('Not a WPILOG file (truncated extra header)');
	}

	const extraHeader = TEXT_DECODER.decode(bytes.subarray(offset, offset + extraHeaderLength));
	offset += extraHeaderLength;

	yield {
		kind: 'header',
		header: { version: { major: versionMajor, minor: versionMinor }, extraHeader },
	};

	while (offset < total) {
		const bitfield = view.getUint8(offset);
		offset += 1;

		const entryIdLength = 1 + (bitfield & 0b11);
		const payloadSizeLength = 1 + ((bitfield >> 2) & 0b11);
		const timestampLength = 1 + ((bitfield >> 4) & 0b111);

		if (offset + entryIdLength + payloadSizeLength + timestampLength > total) {
			// Truncated record header; treat as end-of-stream to match the
			// previous behavior of silently terminating on EOF.
			return;
		}

		const entryId = readVarInt(view, offset, entryIdLength);
		offset += entryIdLength;
		const payloadSize = readVarInt(view, offset, payloadSizeLength);
		offset += payloadSizeLength;
		const timestamp = readTimestamp(view, offset, timestampLength);
		offset += timestampLength;

		if (offset + payloadSize > total) {
			return;
		}

		const payload = bytes.subarray(offset, offset + payloadSize);
		offset += payloadSize;

		if (entryId === 0) {
			const controlPayload = readControlRecordPayload(payload, view);
			yield { kind: 'control', entryId, timestamp, payload: controlPayload };
		} else {
			yield { kind: 'data', record: { entryId, timestamp, payload } };
		}
	}
}

/**
 * Internal: Iterate only the control record payloads, skipping data record payload allocation.
 *
 * Used by `catalogEntries` fast path. Not part of the public API.
 */
export function* readControlRecordsOnly(input: DataLogInput): Generator<ControlRecordPayload> {
	const bytes = toUint8Array(input);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const total = bytes.byteLength;

	if (total < 12) {
		throw new Error('Not a WPILOG file (truncated header)');
	}

	for (let i = 0; i < MAGIC.byteLength; i++) {
		if (bytes[i] !== MAGIC[i]) {
			throw new Error('Not a WPILOG file (invalid magic bytes)');
		}
	}

	const extraHeaderLength = view.getUint32(8, true);
	let offset = 12;

	if (offset + extraHeaderLength > total) {
		throw new Error('Not a WPILOG file (truncated extra header)');
	}

	offset += extraHeaderLength;

	while (offset < total) {
		const bitfield = view.getUint8(offset);
		offset += 1;

		const entryIdLength = 1 + (bitfield & 0b11);
		const payloadSizeLength = 1 + ((bitfield >> 2) & 0b11);
		const timestampLength = 1 + ((bitfield >> 4) & 0b111);

		if (offset + entryIdLength + payloadSizeLength + timestampLength > total) {
			return;
		}

		const entryId = readVarInt(view, offset, entryIdLength);
		offset += entryIdLength;
		const payloadSize = readVarInt(view, offset, payloadSizeLength);
		offset += payloadSizeLength + timestampLength;

		if (offset + payloadSize > total) {
			return;
		}

		if (entryId === 0) {
			const payload = bytes.subarray(offset, offset + payloadSize);
			yield readControlRecordPayload(payload, view);
		}

		offset += payloadSize;
	}
}
