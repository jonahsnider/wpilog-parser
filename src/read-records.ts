import { ByteOffset } from './byte-offset.js';
import { InputStream, StreamFinishedError } from './input-stream.js';
import { type ControlRecordPayload, ControlRecordType, type DataLogHeader, type RawRecord } from './types.js';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const MAGIC = TEXT_ENCODER.encode('WPILOG');

type RecordHeaderLength = {
	entryIdLength: number;
	payloadSizeLength: number;
	timestampLength: number;
};

async function readHeader(buffer: InputStream): Promise<DataLogHeader> {
	const magic = await buffer.readBytesAndAdvance(MAGIC.byteLength);

	for (let i = 0; i < MAGIC.byteLength; i++) {
		if (magic[i] !== MAGIC[i]) {
			throw new Error('Not a WPILOG file (invalid magic bytes)');
		}
	}

	const chunk = await buffer.readBytesAndAdvance(1 + 1 + 4);
	const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

	const versionMinor = view.getUint8(0);
	const versionMajor = view.getUint8(1);
	const extraHeaderLength = view.getUint32(2, true);
	const extraHeader = await buffer.readBytesAndAdvance(extraHeaderLength);

	return {
		version: { major: versionMajor, minor: versionMinor },
		extraHeader: TEXT_DECODER.decode(extraHeader),
	};
}

async function readRecordHeaderLength(buffer: InputStream): Promise<RecordHeaderLength> {
	const chunk = await buffer.readBytesAndAdvance(1);
	const bitfield = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint8(0);

	return {
		entryIdLength: 1 + (bitfield & 0b11),
		payloadSizeLength: 1 + ((bitfield >> 2) & 0b11),
		timestampLength: 1 + ((bitfield >> 4) & 0b111),
	};
}

async function readVarInt(buffer: InputStream, length: number): Promise<number> {
	const chunk = await buffer.readBytesAndAdvance(length);
	const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

	switch (length) {
		case 1:
			return view.getUint8(0);
		case 2:
			return view.getUint16(0, true);
		case 3:
			return (view.getUint8(2) << 16) | (view.getUint8(1) << 8) | view.getUint8(0);
		case 4:
			return view.getUint32(0, true);
		default:
			throw new RangeError(`Invalid varint length ${length}`);
	}
}

async function readTimestamp(buffer: InputStream, length: number): Promise<bigint> {
	const chunk = await buffer.readBytesAndAdvance(length);
	const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

	switch (length) {
		case 1:
			return BigInt(view.getUint8(0));
		case 2:
			return BigInt(view.getUint16(0, true));
		case 3: {
			const b0 = BigInt(view.getUint8(0));
			const b1 = BigInt(view.getUint8(1));
			const b2 = BigInt(view.getUint8(2));
			return (b2 << 16n) | (b1 << 8n) | b0;
		}
		case 4:
			return BigInt(view.getUint32(0, true));
		case 5: {
			const b0 = BigInt(view.getUint8(0));
			const b1 = BigInt(view.getUint8(1));
			const b2 = BigInt(view.getUint8(2));
			const b3 = BigInt(view.getUint8(3));
			const b4 = BigInt(view.getUint8(4));
			return (b4 << 32n) | (b3 << 24n) | (b2 << 16n) | (b1 << 8n) | b0;
		}
		case 6: {
			const b0 = BigInt(view.getUint8(0));
			const b1 = BigInt(view.getUint8(1));
			const b2 = BigInt(view.getUint8(2));
			const b3 = BigInt(view.getUint8(3));
			const b4 = BigInt(view.getUint8(4));
			const b5 = BigInt(view.getUint8(5));
			return (b5 << 40n) | (b4 << 32n) | (b3 << 24n) | (b2 << 16n) | (b1 << 8n) | b0;
		}
		case 7: {
			const b0 = BigInt(view.getUint8(0));
			const b1 = BigInt(view.getUint8(1));
			const b2 = BigInt(view.getUint8(2));
			const b3 = BigInt(view.getUint8(3));
			const b4 = BigInt(view.getUint8(4));
			const b5 = BigInt(view.getUint8(5));
			const b6 = BigInt(view.getUint8(6));
			return (b6 << 48n) | (b5 << 40n) | (b4 << 32n) | (b3 << 24n) | (b2 << 16n) | (b1 << 8n) | b0;
		}
		case 8:
			return view.getBigUint64(0, true);
		default:
			throw new RangeError(`Invalid timestamp length ${length}`);
	}
}

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
export type DataLogInput = ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer;

function toReadableStream(input: DataLogInput): ReadableStream<Uint8Array> {
	if (input instanceof ReadableStream) {
		return input;
	}
	return new Blob([input as ArrayBuffer | Uint8Array<ArrayBuffer>]).stream();
}

/**
 * Read raw WPILOG records from a byte stream.
 *
 * Yields a header record first, then control and data records in order.
 * Data record payloads are not decoded — use {@link decodeRecords} for that.
 */
export async function* readRecords(input: DataLogInput): AsyncGenerator<ReadRecord> {
	const inputStream = new InputStream(toReadableStream(input));

	const header = await readHeader(inputStream);
	yield { kind: 'header', header };

	while (true) {
		let headerLength: RecordHeaderLength;

		try {
			headerLength = await readRecordHeaderLength(inputStream);
		} catch (error) {
			if (error instanceof StreamFinishedError) {
				return;
			}
			throw error;
		}

		const entryId = await readVarInt(inputStream, headerLength.entryIdLength);
		const payloadSize = await readVarInt(inputStream, headerLength.payloadSizeLength);
		const timestamp = await readTimestamp(inputStream, headerLength.timestampLength);
		const payload = await inputStream.readBytesAndAdvance(payloadSize);

		if (entryId === 0) {
			const controlPayload = readControlRecordPayload(payload);
			yield { kind: 'control', entryId, timestamp, payload: controlPayload };
		} else {
			yield { kind: 'data', record: { entryId, timestamp, payload } };
		}
	}
}
