import {
	type DataLogGenerator,
	type DataLogInput,
	type ReadRecord,
	RecordCursor,
	readControlRecordPayload,
	withProgress,
} from './read-records.ts';
import { StructDecodeQueue } from './struct/struct-decode-queue.ts';
import { StructRegistry } from './struct/struct-registry.ts';
import { ByteOffset } from './byte-offset.ts';
import { diagnostics } from './diagnostics.ts';
import {
	type CatalogEntry,
	type ControlRecordPayload,
	ControlRecordType,
	type DecodedRecord,
	type DataRecord,
	type RawRecord,
	RecordType,
	type StartControlRecord,
} from './types.ts';

const TEXT_DECODER = new TextDecoder();
const STRUCT_PREFIX = 'struct:';
const STRUCT_ARRAY_SUFFIX = '[]';
const STRUCT_SCHEMA_NAME_PREFIX = '/.schema/' + STRUCT_PREFIX;

type PlainDataRecord = Exclude<DataRecord, { structName: string }>;

/**
 * Build a non-struct data record as one flat object literal.
 * Struct records are built inline with the same field order plus `structName`.
 */
function dataRecord<T extends PlainDataRecord['type']>(
	entry: CatalogEntry,
	timestamp: number,
	type: T,
	payload: Extract<PlainDataRecord, { type: T }>['payload'],
): DataRecord {
	return { entry, timestamp, type, payload } as DataRecord;
}

function byteToBoolean(byte: number): boolean {
	switch (byte) {
		case 0:
			return false;
		case 1:
			return true;
		default:
			throw diagnostics.WPILOG_R0005({ byte });
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
	private readonly entries = new Map<StartControlRecord['entryId'], CatalogEntry>();
	private readonly recordEntries = new WeakMap<RawRecord, CatalogEntry>();
	private readonly structDecodeQueue: StructDecodeQueue;
	private readonly structRegistry: StructRegistry;
	private readonly options: DecodeRecordsOptions;

	constructor(options: DecodeRecordsOptions) {
		this.options = options;
		this.structDecodeQueue = new StructDecodeQueue((_structName, queuedRecords) => {
			for (const raw of queuedRecords) {
				const entry = this.recordEntries.get(raw);
				if (!entry) continue;

				const structName = entry.type.slice(STRUCT_PREFIX.length);
				if (entry.type.endsWith(STRUCT_ARRAY_SUFFIX)) {
					const payload = this.structRegistry.decodeArray(structName, raw.payload);
					if (typeof payload !== 'string') {
						this.delayedRecords.push({
							entry,
							timestamp: raw.timestamp,
							type: RecordType.StructArray,
							structName,
							payload,
						});
					}
				} else {
					const payload = this.structRegistry.decode(structName, raw.payload);
					if (typeof payload !== 'string') {
						this.delayedRecords.push({
							entry,
							timestamp: raw.timestamp,
							type: RecordType.Struct,
							structName,
							payload,
						});
					}
				}
			}
		});
		this.structRegistry = new StructRegistry(this.structDecodeQueue);
	}

	decodeControl(entryId: number, timestamp: number, payload: ControlRecordPayload): DecodedRecord {
		switch (payload.controlRecordType) {
			case ControlRecordType.Start:
				this.entries.set(payload.entryId, {
					entryId: payload.entryId,
					name: normalizeEntryName(payload.entryName),
					type: payload.entryType,
					metadata: payload.entryMetadata,
				});
				break;
			case ControlRecordType.Finish:
				this.entries.delete(payload.entryId);
				break;
			case ControlRecordType.SetMetadata: {
				const existing = this.entries.get(payload.entryId);
				if (existing) {
					// Replace instead of mutating so records decoded earlier keep their metadata
					this.entries.set(payload.entryId, { ...existing, metadata: payload.entryMetadata });
				}
				break;
			}
		}

		return { entryId, timestamp, type: RecordType.Control, payload };
	}

	decodeData(
		entryId: number,
		timestamp: number,
		bytes: Uint8Array,
		view: DataView,
		payloadOffset: number,
		payloadSize: number,
	): DecodedRecord | undefined {
		const entry = this.entries.get(entryId);
		if (!entry) {
			if (this.options.strict) {
				throw diagnostics.WPILOG_R0006({ entryId });
			}
			return undefined;
		}
		switch (entry.type) {
			case 'boolean':
				return dataRecord(entry, timestamp, RecordType.Boolean, byteToBoolean(view.getUint8(payloadOffset)));
			case 'int64':
				return dataRecord(entry, timestamp, RecordType.Int64, view.getBigInt64(payloadOffset, true));
			case 'float':
				return dataRecord(entry, timestamp, RecordType.Float, view.getFloat32(payloadOffset, true));
			case 'double':
				return dataRecord(entry, timestamp, RecordType.Double, view.getFloat64(payloadOffset, true));
		}

		const payload =
			payloadOffset === 0 && payloadSize === bytes.byteLength
				? bytes
				: bytes.subarray(payloadOffset, payloadOffset + payloadSize);
		const raw = { entryId, timestamp, payload };
		const payloadView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
		const decoded = decodeNonScalarPayload(raw, entry, payloadView, this.structRegistry, this.structDecodeQueue);
		if (!decoded) {
			this.recordEntries.set(raw, entry);
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
export function parseDataLog(
	input: DataLogInput,
	options: DecodeRecordsOptions = { strict: false },
): DataLogGenerator<DecodedRecord> {
	const state: { cursor?: RecordCursor } = {};
	return withProgress(
		decodeCursorRecords(input, options, state),
		() => state.cursor?.offset ?? 0,
		() => state.cursor?.truncated ?? false,
	);
}

function* decodeCursorRecords(
	input: DataLogInput,
	options: DecodeRecordsOptions,
	state: { cursor?: RecordCursor },
): Generator<DecodedRecord> {
	const cursor = new RecordCursor(input);
	state.cursor = cursor;
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
	entry: CatalogEntry,
	view: DataView,
	structRegistry: StructRegistry,
	structDecodeQueue: StructDecodeQueue,
): DecodedRecord | undefined {
	const { timestamp } = raw;
	const { type: entryType, name } = entry;
	switch (entryType) {
		case 'string':
			return dataRecord(entry, timestamp, RecordType.String, TEXT_DECODER.decode(raw.payload));
		case 'boolean[]': {
			const payload: boolean[] = [];
			for (let i = 0; i < raw.payload.byteLength; i++) {
				payload.push(byteToBoolean(view.getUint8(i)));
			}
			return dataRecord(entry, timestamp, RecordType.BooleanArray, payload);
		}
		case 'int64[]': {
			const payload: bigint[] = [];
			for (let i = 0; i < raw.payload.byteLength; i += 8) {
				payload.push(view.getBigInt64(i, true));
			}
			return dataRecord(entry, timestamp, RecordType.Int64Array, payload);
		}
		case 'float[]': {
			const payload: number[] = [];
			for (let i = 0; i < raw.payload.byteLength; i += 4) {
				payload.push(view.getFloat32(i, true));
			}
			return dataRecord(entry, timestamp, RecordType.FloatArray, payload);
		}
		case 'double[]': {
			const payload: number[] = [];
			for (let i = 0; i < raw.payload.byteLength; i += 8) {
				payload.push(view.getFloat64(i, true));
			}
			return dataRecord(entry, timestamp, RecordType.DoubleArray, payload);
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
			return dataRecord(entry, timestamp, RecordType.StringArray, payload);
		}
		case 'structschema': {
			// Schema records: register the struct, but emit as a string record
			const structName = name.slice(name.indexOf(STRUCT_SCHEMA_NAME_PREFIX) + STRUCT_SCHEMA_NAME_PREFIX.length);
			const payload = TEXT_DECODER.decode(raw.payload);
			structRegistry.register(structName, payload);
			return dataRecord(entry, timestamp, RecordType.String, payload);
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
						entry,
						timestamp,
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
					entry,
					timestamp,
					type: RecordType.Struct,
					structName,
					payload: decoded,
				};
			}

			// Unknown type — return raw
			// Create a copy of the bytes instead of a view over the original log buffer
			return dataRecord(entry, timestamp, RecordType.Raw, new Uint8Array(raw.payload));
		}
	}
}
