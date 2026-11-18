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
			timestamp: number;
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

function readTimestamp(view: DataView, offset: number, length: number): number {
	switch (length) {
		case 1:
			return view.getUint8(offset);
		case 2:
			return view.getUint16(offset, true);
		case 3:
			return view.getUint16(offset, true) + view.getUint8(offset + 2) * 2 ** 16;
		case 4:
			return view.getUint32(offset, true);
		case 5:
			return view.getUint32(offset, true) + view.getUint8(offset + 4) * 2 ** 32;
		case 6:
			return view.getUint32(offset, true) + view.getUint16(offset + 4, true) * 2 ** 32;
		// Seven and eight byte timestamps can exceed Number.MAX_SAFE_INTEGER and round to the nearest double.
		case 7:
			return (
				view.getUint32(offset, true) +
				(view.getUint16(offset + 4, true) + view.getUint8(offset + 6) * 2 ** 16) * 2 ** 32
			);
		// Timestamps are int64_t, so only a full eight bytes can carry the sign bit.
		// WPILib writes negative timestamps for NetworkTables values set before logging started.
		case 8:
			return view.getUint32(offset, true) + view.getInt32(offset + 4, true) * 2 ** 32;
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
	timestamp = 0;
	payloadOffset = 0;
	payloadSize = 0;
	/** Byte offset of the next record. */
	offset: number;
	/** Whether the input ended partway through a record. */
	truncated = false;

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
			this.truncated = true;
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
			this.truncated = true;
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

/** A generator of records that also reports how far it has read through the input. */
export type DataLogGenerator<T> = Generator<T> & {
	/**
	 * Number of input bytes consumed so far, including the file header. This is `0` until the first record is read.
	 * Divide by the input's `byteLength` to estimate progress; it equals `byteLength` once parsing finishes.
	 */
	readonly bytesRead: number;
	/**
	 * Whether the input ended partway through a record, such as a log cut off by a power loss.
	 * The incomplete record is not yielded. This is `false` until the parser reaches the end of the input.
	 */
	readonly truncated: boolean;
};

/** Expose a parser's progress on its generator without adding work to the per-record loop. */
export function withProgress<T>(
	records: Generator<T>,
	getBytesRead: () => number,
	getTruncated: () => boolean,
): DataLogGenerator<T> {
	return Object.defineProperties(records, {
		bytesRead: { get: getBytesRead },
		truncated: { get: getTruncated },
	}) as DataLogGenerator<T>;
}

// Opening the log inside the generator and keeping offsets in locals benchmarks faster than using RecordCursor
function* readRawRecords(input: DataLogInput, progress: { offset: number; truncated: boolean }): Generator<ReadRecord> {
	const { bytes, view, header, recordsOffset } = openDataLog(input);
	progress.offset = recordsOffset;
	const total = bytes.byteLength;
	let offset = recordsOffset;

	yield { kind: 'header', header };

	while (offset < total) {
		const bitfield = view.getUint8(offset++);
		const entryIdLength = 1 + (bitfield & 0b11);
		const payloadSizeLength = 1 + ((bitfield >> 2) & 0b11);
		const timestampLength = 1 + ((bitfield >> 4) & 0b111);

		if (offset + entryIdLength + payloadSizeLength + timestampLength > total) {
			progress.offset = total;
			progress.truncated = true;
			return;
		}

		const entryId = readVarInt(view, offset, entryIdLength);
		offset += entryIdLength;
		const payloadSize = readVarInt(view, offset, payloadSizeLength);
		offset += payloadSizeLength;
		const timestamp = readTimestamp(view, offset, timestampLength);
		offset += timestampLength;

		if (offset + payloadSize > total) {
			progress.offset = total;
			progress.truncated = true;
			return;
		}

		const payload = bytes.subarray(offset, offset + payloadSize);
		offset += payloadSize;
		progress.offset = offset;

		if (entryId === 0) {
			yield { kind: 'control', entryId, timestamp, payload: readControlRecordPayload(payload) };
		} else {
			yield { kind: 'data', record: { entryId, timestamp, payload } };
		}
	}
}

/**
 * Read raw WPILOG records from an in-memory buffer.
 *
 * Yields a header record first, then control and data records in order.
 * Data record payloads are not decoded. Prefer `parseDataLog` when raw records
 * or an intermediate transformation are not needed.
 */
export function readRecords(input: DataLogInput): DataLogGenerator<ReadRecord> {
	const progress = { offset: 0, truncated: false };
	return withProgress(
		readRawRecords(input, progress),
		() => progress.offset,
		() => progress.truncated,
	);
}
