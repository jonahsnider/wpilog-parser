import { ByteOffset } from './byte-offset.ts';
import { diagnostics } from './diagnostics.ts';
import { type ControlRecordPayload, ControlRecordType, type DataLogHeader, type RawRecord } from './types.ts';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const MAGIC = TEXT_ENCODER.encode('WPILOG');

function readString(payload: Uint8Array, view: DataView, offset: ByteOffset): string {
	const length = view.getUint32(offset.get(), true);
	offset.advance32();
	const value = TEXT_DECODER.decode(payload.subarray(offset.get(), offset.get() + length));
	offset.advance(length);
	return value;
}

export function readControlRecordPayload(payload: Uint8Array): ControlRecordPayload {
	const offset = new ByteOffset();
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

	const type = view.getUint8(offset.get());
	offset.advance8();

	switch (type) {
		case ControlRecordType.Start: {
			const entryId = view.getUint32(offset.get(), true);
			offset.advance32();
			const entryName = readString(payload, view, offset);
			const entryType = readString(payload, view, offset);
			const entryMetadata = readString(payload, view, offset);

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
			const entryMetadata = readString(payload, view, offset);
			return { controlRecordType: type, entryId, entryMetadata };
		}
		default:
			throw diagnostics.WPILOG_R0001({ type });
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

/** Accepted input types for {@link readRecords} and `parseDataLog`. */
export type DataLogInput = Uint8Array | ArrayBuffer;

function toUint8Array(input: DataLogInput): Uint8Array {
	if (input instanceof Uint8Array) {
		return input;
	}
	return new Uint8Array(input);
}

function openDataLog(input: DataLogInput): {
	bytes: Uint8Array;
	view: DataView;
	header: DataLogHeader;
	recordsOffset: number;
} {
	const bytes = toUint8Array(input);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	if (bytes.byteLength < 12) {
		throw diagnostics.WPILOG_R0002();
	}
	for (let i = 0; i < MAGIC.byteLength; i++) {
		if (bytes[i] !== MAGIC[i]) {
			throw diagnostics.WPILOG_R0003();
		}
	}

	const extraHeaderLength = view.getUint32(8, true);
	const recordsOffset = 12 + extraHeaderLength;
	if (recordsOffset > bytes.byteLength) {
		throw diagnostics.WPILOG_R0004();
	}

	return {
		bytes,
		view,
		header: {
			version: { major: view.getUint8(7), minor: view.getUint8(6) },
			extraHeader: TEXT_DECODER.decode(bytes.subarray(12, recordsOffset)),
		},
		recordsOffset,
	};
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

/** Mutable record cursor used by the fused decoder to avoid intermediate record allocations. */
export class RecordCursor {
	readonly bytes: Uint8Array;
	readonly view: DataView;
	readonly header: DataLogHeader;
	entryId = 0;
	timestamp = 0n;
	payloadOffset = 0;
	payloadSize = 0;
	private offset: number;

	constructor(input: DataLogInput) {
		const source = openDataLog(input);
		this.bytes = source.bytes;
		this.view = source.view;
		this.header = source.header;
		this.offset = source.recordsOffset;
	}

	next(): boolean {
		const total = this.bytes.byteLength;
		let offset = this.offset;
		if (offset >= total) {
			return false;
		}

		const view = this.view;
		const bitfield = view.getUint8(offset++);
		const entryIdLength = 1 + (bitfield & 0b11);
		const payloadSizeLength = 1 + ((bitfield >> 2) & 0b11);
		const timestampLength = 1 + ((bitfield >> 4) & 0b111);

		if (offset + entryIdLength + payloadSizeLength + timestampLength > total) {
			this.offset = total;
			return false;
		}

		const entryId = readVarInt(view, offset, entryIdLength);
		offset += entryIdLength;
		const payloadSize = readVarInt(view, offset, payloadSizeLength);
		offset += payloadSizeLength;
		const timestamp = readTimestamp(view, offset, timestampLength);
		offset += timestampLength;

		if (offset + payloadSize > total) {
			this.offset = total;
			return false;
		}

		this.entryId = entryId;
		this.timestamp = timestamp;
		this.payloadOffset = offset;
		this.payloadSize = payloadSize;
		this.offset = offset + payloadSize;
		return true;
	}

	getPayload(): Uint8Array {
		return this.bytes.subarray(this.payloadOffset, this.payloadOffset + this.payloadSize);
	}
}

/**
 * Read raw WPILOG records from an in-memory buffer.
 *
 * Yields a header record first, then control and data records in order.
 * Data record payloads are not decoded. Prefer `parseDataLog` when raw records
 * or an intermediate transformation are not needed.
 */
export function* readRecords(input: DataLogInput): Generator<ReadRecord> {
	const { bytes, view, header, recordsOffset } = openDataLog(input);
	const total = bytes.byteLength;
	let offset = recordsOffset;

	yield { kind: 'header', header };

	while (offset < total) {
		const bitfield = view.getUint8(offset++);
		const entryIdLength = 1 + (bitfield & 0b11);
		const payloadSizeLength = 1 + ((bitfield >> 2) & 0b11);
		const timestampLength = 1 + ((bitfield >> 4) & 0b111);

		if (offset + entryIdLength + payloadSizeLength + timestampLength > total) {
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
			yield { kind: 'control', entryId, timestamp, payload: readControlRecordPayload(payload) };
		} else {
			yield { kind: 'data', record: { entryId, timestamp, payload } };
		}
	}
}
