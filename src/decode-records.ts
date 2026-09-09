import { type DataLogInput, type ReadRecord, RecordCursor, readControlRecordPayload } from './read-records.js';
import { StructDecodeQueue } from './struct/struct-decode-queue.js';
import { StructRegistry } from './struct/struct-registry.js';
import { ByteOffset } from './byte-offset.js';
import {
	type ControlRecordPayload,
	ControlRecordType,
	type DecodedRecord,
	type RawRecord,
	RecordType,
	type StartControlRecord,
} from './types.js';

const TEXT_DECODER = new TextDecoder();
const STRUCT_PREFIX = 'struct:';
const STRUCT_ARRAY_SUFFIX = '[]';
const STRUCT_SCHEMA_NAME_PREFIX = '/.schema/' + STRUCT_PREFIX;

type EntryContext = {
	name: string;
	entryType: StartControlRecord['entryType'];
	metadata: string;
};

function byteToBoolean(byte: number): boolean {
	switch (byte) {
		case 0:
			return false;
		case 1:
			return true;
		default:
			throw new RangeError(`Invalid boolean value ${byte}`);
	}
}

export function normalizeEntryName(rawName: string): string {
	if (rawName.startsWith('/')) {
		return rawName;
	}
	return `/${rawName}`;
}

/** Options for {@link decodeRecords} and {@link parseDataLog}. */
export type DecodeRecordsOptions = {
	/**
	 * When `true`, throw if a data record references an entry ID with no preceding
	 * Start control record (i.e. a corrupt or truncated log). When `false` (default),
	 * such orphan records are silently skipped.
	 */
	strict?: boolean;
};

class RecordDecoder {
	readonly delayedRecords: DecodedRecord[] = [];
	private readonly context = new Map<StartControlRecord['entryId'], EntryContext>();
	private readonly recordContexts = new WeakMap<RawRecord, EntryContext>();
	private readonly structDecodeQueue: StructDecodeQueue;
	private readonly structRegistry: StructRegistry;

	constructor(private readonly options: DecodeRecordsOptions) {
		this.structDecodeQueue = new StructDecodeQueue((_structName, queuedRecords) => {
			for (const raw of queuedRecords) {
				const context = this.recordContexts.get(raw);
				if (!context) continue;

				const { entryType, name, metadata } = context;
				const structName = entryType.slice(STRUCT_PREFIX.length);
				const base = { entryId: raw.entryId, timestamp: raw.timestamp, name, metadata, structName };
				if (entryType.endsWith(STRUCT_ARRAY_SUFFIX)) {
					const payload = this.structRegistry.decodeArray(structName, raw.payload);
					if (typeof payload !== 'string') {
						this.delayedRecords.push({
							...base,
							type: RecordType.StructArray,
							payload,
						});
					}
				} else {
					const payload = this.structRegistry.decode(structName, raw.payload);
					if (typeof payload !== 'string') {
						this.delayedRecords.push({
							...base,
							type: RecordType.Struct,
							payload,
						});
					}
				}
			}
		});
		this.structRegistry = new StructRegistry(this.structDecodeQueue);
	}

	decodeControl(entryId: number, timestamp: bigint, payload: ControlRecordPayload): DecodedRecord {
		switch (payload.controlRecordType) {
			case ControlRecordType.Start:
				this.context.set(payload.entryId, {
					name: normalizeEntryName(payload.entryName),
					entryType: payload.entryType,
					metadata: payload.entryMetadata,
				});
				break;
			case ControlRecordType.Finish:
				this.context.delete(payload.entryId);
				break;
			case ControlRecordType.SetMetadata: {
				const existing = this.context.get(payload.entryId);
				if (existing) {
					this.context.set(payload.entryId, { ...existing, metadata: payload.entryMetadata });
				}
				break;
			}
		}

		return { entryId, timestamp, type: RecordType.Control, payload };
	}

	decodeData(
		entryId: number,
		timestamp: bigint,
		bytes: Uint8Array,
		view: DataView,
		payloadOffset: number,
		payloadSize: number,
	): DecodedRecord | undefined {
		const context = this.context.get(entryId);
		if (!context) {
			if (this.options.strict) {
				throw new RangeError(`No type registered for entry ID ${entryId}`);
			}
			return undefined;
		}
		const base = { entryId, timestamp, name: context.name, metadata: context.metadata };
		switch (context.entryType) {
			case 'boolean':
				return { ...base, type: RecordType.Boolean, payload: byteToBoolean(view.getUint8(payloadOffset)) };
			case 'int64':
				return { ...base, type: RecordType.Int64, payload: view.getBigInt64(payloadOffset, true) };
			case 'float':
				return { ...base, type: RecordType.Float, payload: view.getFloat32(payloadOffset, true) };
			case 'double':
				return { ...base, type: RecordType.Double, payload: view.getFloat64(payloadOffset, true) };
		}

		const payload =
			payloadOffset === 0 && payloadSize === bytes.byteLength
				? bytes
				: bytes.subarray(payloadOffset, payloadOffset + payloadSize);
		const raw = { entryId, timestamp, payload };
		const payloadView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
		const decoded = decodeNonScalarPayload(
			raw,
			context.entryType,
			context.name,
			context.metadata,
			payloadView,
			this.structRegistry,
			this.structDecodeQueue,
		);
		if (!decoded) {
			this.recordContexts.set(raw, context);
		}
		return decoded;
	}
}

/**
 * Decode raw WPILOG records into typed values.
 *
 * Accepts the output of {@link readRecords} and yields fully decoded records,
 * including struct decoding with dependency resolution.
 *
 * By default, data records that reference an entry ID with no preceding Start
 * control record are silently skipped. Pass `{ strict: true }` to throw instead.
 */
export function* decodeRecords(
	records: Iterable<ReadRecord>,
	options: DecodeRecordsOptions = { strict: false },
): Generator<DecodedRecord> {
	const decoder = new RecordDecoder(options);

	for (const readRecord of records) {
		if (readRecord.kind === 'header') {
			continue;
		}

		if (readRecord.kind === 'control') {
			yield decoder.decodeControl(readRecord.entryId, readRecord.timestamp, readRecord.payload);
			continue;
		}

		const raw = readRecord.record;
		const view = new DataView(raw.payload.buffer, raw.payload.byteOffset, raw.payload.byteLength);
		const decoded = decoder.decodeData(raw.entryId, raw.timestamp, raw.payload, view, 0, raw.payload.byteLength);
		if (decoded) {
			yield decoded;
		}
		if (decoder.delayedRecords.length > 0) {
			yield* decoder.delayedRecords;
			decoder.delayedRecords.length = 0;
		}
	}
}

/**
 * Read and decode a WPILOG buffer in a single pass.
 *
 * This is the preferred API for fully decoded records. It avoids allocating the
 * intermediate records produced by composing {@link readRecords} and
 * {@link decodeRecords} while preserving the same output and strict-mode behavior.
 */
export function* parseDataLog(
	input: DataLogInput,
	options: DecodeRecordsOptions = { strict: false },
): Generator<DecodedRecord> {
	const cursor = new RecordCursor(input);
	const decoder = new RecordDecoder(options);

	while (cursor.next()) {
		if (cursor.entryId === 0) {
			yield decoder.decodeControl(cursor.entryId, cursor.timestamp, readControlRecordPayload(cursor.getPayload()));
			continue;
		}

		const decoded = decoder.decodeData(
			cursor.entryId,
			cursor.timestamp,
			cursor.bytes,
			cursor.view,
			cursor.payloadOffset,
			cursor.payloadSize,
		);
		if (decoded) {
			yield decoded;
		}
		if (decoder.delayedRecords.length > 0) {
			yield* decoder.delayedRecords;
			decoder.delayedRecords.length = 0;
		}
	}
}
/**
 * Decode non-scalar payloads that require a byte slice or payload-local view.
 * Fixed-width scalar types return from {@link RecordDecoder#decodeData} before this function so their payloads can be read directly from the input buffer.
 */
function decodeNonScalarPayload(
	raw: RawRecord,
	entryType: string,
	name: string,
	metadata: string,
	view: DataView,
	structRegistry: StructRegistry,
	structDecodeQueue: StructDecodeQueue,
): DecodedRecord | undefined {
	const base = { entryId: raw.entryId, timestamp: raw.timestamp, name, metadata };

	switch (entryType) {
		case 'string':
			return { ...base, type: RecordType.String, payload: TEXT_DECODER.decode(raw.payload) };
		case 'boolean[]': {
			const payload: boolean[] = [];
			for (let i = 0; i < raw.payload.byteLength; i++) {
				payload.push(byteToBoolean(view.getUint8(i)));
			}
			return { ...base, type: RecordType.BooleanArray, payload };
		}
		case 'int64[]': {
			const payload: bigint[] = [];
			for (let i = 0; i < raw.payload.byteLength; i += 8) {
				payload.push(view.getBigUint64(i, true));
			}
			return { ...base, type: RecordType.Int64Array, payload };
		}
		case 'float[]': {
			const payload: number[] = [];
			for (let i = 0; i < raw.payload.byteLength; i += 4) {
				payload.push(view.getFloat32(i, true));
			}
			return { ...base, type: RecordType.FloatArray, payload };
		}
		case 'double[]': {
			const payload: number[] = [];
			for (let i = 0; i < raw.payload.byteLength; i += 8) {
				payload.push(view.getFloat64(i, true));
			}
			return { ...base, type: RecordType.DoubleArray, payload };
		}
		case 'string[]': {
			const payload: string[] = [];
			const offset = new ByteOffset();
			const arrayLength = view.getUint32(offset.get(), true);
			offset.advance32();
			for (let i = 0; i < arrayLength; i++) {
				const stringLength = view.getUint32(offset.get(), true);
				offset.advance32();
				const string = TEXT_DECODER.decode(raw.payload.subarray(offset.get(), offset.get() + stringLength));
				offset.advance(stringLength);
				payload.push(string);
			}
			return { ...base, type: RecordType.StringArray, payload };
		}
		case 'structschema': {
			// Schema records: register the struct, but emit as a string record
			const structName = name.slice(STRUCT_SCHEMA_NAME_PREFIX.length);
			const payload = TEXT_DECODER.decode(raw.payload);
			structRegistry.register(structName, payload);
			return { ...base, type: RecordType.String, payload };
		}
		default: {
			// Try to decode as struct
			if (entryType.startsWith(STRUCT_PREFIX)) {
				const structName = entryType.slice(STRUCT_PREFIX.length);
				if (entryType.endsWith(STRUCT_ARRAY_SUFFIX)) {
					const decoded = structRegistry.decodeArray(structName, raw.payload);

					if (typeof decoded === 'string') {
						structDecodeQueue.queueStructRecord(decoded, raw);
						return undefined;
					}

					return {
						...base,
						type: RecordType.StructArray,
						structName,
						payload: decoded,
					};
				}

				const decoded = structRegistry.decode(structName, raw.payload);

				if (typeof decoded === 'string') {
					structDecodeQueue.queueStructRecord(decoded, raw);
					return undefined;
				}

				return {
					...base,
					type: RecordType.Struct,
					structName,
					payload: decoded,
				};
			}

			// Unknown type — return raw
			return { ...base, type: RecordType.Raw, payload: raw.payload };
		}
	}
}
