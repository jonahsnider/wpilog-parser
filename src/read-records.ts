import { ByteOffset } from './byte-offset.js';
import { type ControlRecordPayload, ControlRecordType, type DataLogHeader, type RawRecord } from './types.js';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const MAGIC = TEXT_ENCODER.encode('WPILOG');

function readControlRecordPayload(payload: Uint8Array): ControlRecordPayload {
	const offset = new ByteOffset();
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

	const type = view.getUint8(offset.get());
	offset.advance8();

	switch (type) {
		case ControlRecordType.Start: {
			const entryId = view.getUint32(offset.get(), true);
			offset.advance32();
			const entryNameLength = view.getUint32(offset.get(), true);
			offset.advance32();
			const entryName = TEXT_DECODER.decode(payload.subarray(offset.get(), offset.get() + entryNameLength));
			offset.advance(entryNameLength);
			const entryTypeLength = view.getUint32(offset.get(), true);
			offset.advance32();
			const entryType = TEXT_DECODER.decode(payload.subarray(offset.get(), offset.get() + entryTypeLength));
			offset.advance(entryTypeLength);
			const entryMetadataLength = view.getUint32(offset.get(), true);
			offset.advance32();
			const entryMetadata = TEXT_DECODER.decode(payload.subarray(offset.get(), offset.get() + entryMetadataLength));
			offset.advance(entryMetadataLength);

			return {
				controlRecordType: type,
				entryId,
				entryName,
				entryType,
				entryMetadata,
			};
		}
		case ControlRecordType.Finish: {
			const entryId = view.getUint32(offset.get(), true);
			offset.advance32();
			return { controlRecordType: type, entryId };
		}
		case ControlRecordType.SetMetadata: {
			const entryId = view.getUint32(offset.get(), true);
			offset.advance32();
			const entryMetadataLength = view.getUint32(offset.get(), true);
			offset.advance32();
			const entryMetadata = TEXT_DECODER.decode(payload.subarray(offset.get(), offset.get() + entryMetadataLength));
			offset.advance(entryMetadataLength);
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

function readTimestamp(view: DataView, offset: number, length: number): bigint {
	switch (length) {
		case 1:
			return BigInt(view.getUint8(offset));
		case 2:
			return BigInt(view.getUint16(offset, true));
		case 3: {
			const b0 = BigInt(view.getUint8(offset));
			const b1 = BigInt(view.getUint8(offset + 1));
			const b2 = BigInt(view.getUint8(offset + 2));
			return (b2 << 16n) | (b1 << 8n) | b0;
		}
		case 4:
			return BigInt(view.getUint32(offset, true));
		case 5: {
			const b0 = BigInt(view.getUint8(offset));
			const b1 = BigInt(view.getUint8(offset + 1));
			const b2 = BigInt(view.getUint8(offset + 2));
			const b3 = BigInt(view.getUint8(offset + 3));
			const b4 = BigInt(view.getUint8(offset + 4));
			return (b4 << 32n) | (b3 << 24n) | (b2 << 16n) | (b1 << 8n) | b0;
		}
		case 6: {
			const b0 = BigInt(view.getUint8(offset));
			const b1 = BigInt(view.getUint8(offset + 1));
			const b2 = BigInt(view.getUint8(offset + 2));
			const b3 = BigInt(view.getUint8(offset + 3));
			const b4 = BigInt(view.getUint8(offset + 4));
			const b5 = BigInt(view.getUint8(offset + 5));
			return (b5 << 40n) | (b4 << 32n) | (b3 << 24n) | (b2 << 16n) | (b1 << 8n) | b0;
		}
		case 7: {
			const b0 = BigInt(view.getUint8(offset));
			const b1 = BigInt(view.getUint8(offset + 1));
			const b2 = BigInt(view.getUint8(offset + 2));
			const b3 = BigInt(view.getUint8(offset + 3));
			const b4 = BigInt(view.getUint8(offset + 4));
			const b5 = BigInt(view.getUint8(offset + 5));
			const b6 = BigInt(view.getUint8(offset + 6));
			return (b6 << 48n) | (b5 << 40n) | (b4 << 32n) | (b3 << 24n) | (b2 << 16n) | (b1 << 8n) | b0;
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
			const controlPayload = readControlRecordPayload(payload);
			yield { kind: 'control', entryId, timestamp, payload: controlPayload };
		} else {
			yield { kind: 'data', record: { entryId, timestamp, payload } };
		}
	}
}
