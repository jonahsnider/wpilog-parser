import {
	type DecodeRecordsOptions,
	normalizeEntryName,
	PROTOBUF_SCHEMA_TYPE,
	RecordDecoder,
} from './decode-records.ts';
import { diagnostics } from './diagnostics.ts';
import { type DataLogInput, openDataLog, readControlRecordPayload, readTimestamp, readVarInt } from './read-records.ts';
import { type CatalogEntry, ControlRecordType, type DataLogHeader, type DataRecord } from './types.ts';

/** An entry of an indexed log, from its Start control record to its Finish control record, see {@link indexDataLog}. */
export type IndexedEntry = CatalogEntry & {
	/** Whether a Finish control record ended it. */
	finished: boolean;
	/** How many data records it has. */
	length: number;
	/** Timestamp of each data record in microseconds, in file order. Only the first `length` are used. */
	timestamps: Float64Array<ArrayBuffer>;
	/** Where each data record's payload starts in the log's bytes. Only the first `length` are used. */
	payloadOffsets: Float64Array<ArrayBuffer>;
	/** Size of each data record's payload in bytes. Only the first `length` are used. */
	payloadSizes: Uint32Array<ArrayBuffer>;
};

/** Where the records of a WPILOG file are, see {@link indexDataLog}. */
export type DataLogIndex = {
	header: DataLogHeader;
	/** The log's bytes, which payload offsets point into. */
	bytes: Uint8Array;
	/**
	 * Every entry in the order they were started, with their latest metadata. An entry ID that was started again after
	 * it finished has an entry for each start.
	 */
	entries: IndexedEntry[];
	/** Bytes of the input up to the end of the last record indexed, including the file header. */
	bytesRead: number;
	/** Whether the input ended partway through a record, such as a log cut off by a power loss. */
	truncated: boolean;
	/**
	 * Why indexing stopped before the end of the input: a control record that couldn't be read, or in strict mode a data
	 * record of an entry that wasn't started. Records before it are indexed.
	 */
	error: Error | undefined;
};

const INITIAL_CAPACITY = 16;

function startEntry(entryId: number, name: string, type: string, metadata: string): IndexedEntry {
	return {
		entryId,
		name: normalizeEntryName(name),
		type,
		metadata,
		finished: false,
		length: 0,
		timestamps: new Float64Array(INITIAL_CAPACITY),
		payloadOffsets: new Float64Array(INITIAL_CAPACITY),
		payloadSizes: new Uint32Array(INITIAL_CAPACITY),
	};
}

function addRecord(entry: IndexedEntry, timestamp: number, payloadOffset: number, payloadSize: number): void {
	const { length } = entry;
	if (length === entry.timestamps.length) {
		const timestamps = new Float64Array(length * 2);
		timestamps.set(entry.timestamps);
		entry.timestamps = timestamps;
		const payloadOffsets = new Float64Array(length * 2);
		payloadOffsets.set(entry.payloadOffsets);
		entry.payloadOffsets = payloadOffsets;
		const payloadSizes = new Uint32Array(length * 2);
		payloadSizes.set(entry.payloadSizes);
		entry.payloadSizes = payloadSizes;
	}
	entry.timestamps[length] = timestamp;
	entry.payloadOffsets[length] = payloadOffset;
	entry.payloadSizes[length] = payloadSize;
	entry.length = length + 1;
}

/**
 * Find where each entry's records are in a WPILOG buffer without decoding their values, so the values of only the
 * entries needed can be decoded, in any order, with {@link DataLogIndexDecoder}. Much faster than `parseDataLog`.
 *
 * Throws if the input isn't a WPILOG file. Indexing stops at a damaged record, see {@link DataLogIndex.error}. With
 * `strict`, a data record of an entry that wasn't started is damage, otherwise it's skipped.
 */
export function indexDataLog(input: DataLogInput, options: { strict?: boolean } = {}): DataLogIndex {
	const { bytes, view, header, recordsOffset } = openDataLog(input);
	const entries: IndexedEntry[] = [];
	// Started and not finished entries by entry ID
	const open: (IndexedEntry | undefined)[] = [];
	const total = bytes.byteLength;
	let offset = recordsOffset;
	let truncated = false;
	let error: Error | undefined;

	while (offset < total) {
		const bitfield = view.getUint8(offset);
		const entryIdLength = 1 + (bitfield & 0b11);
		const payloadSizeLength = 1 + ((bitfield >> 2) & 0b11);
		const timestampLength = 1 + ((bitfield >> 4) & 0b111);
		const payloadOffset = offset + 1 + entryIdLength + payloadSizeLength + timestampLength;
		if (payloadOffset > total) {
			truncated = true;
			break;
		}
		const entryId = readVarInt(view, offset + 1, entryIdLength);
		const payloadSize = readVarInt(view, offset + 1 + entryIdLength, payloadSizeLength);
		const end = payloadOffset + payloadSize;
		if (end > total) {
			truncated = true;
			break;
		}
		const timestamp = readTimestamp(view, offset + 1 + entryIdLength + payloadSizeLength, timestampLength);

		if (entryId === 0) {
			let payload;
			try {
				payload = readControlRecordPayload(bytes.subarray(payloadOffset, end));
			} catch (cause) {
				error = cause instanceof Error ? cause : new Error(String(cause));
				break;
			}
			switch (payload.controlRecordType) {
				case ControlRecordType.Start: {
					const entry = startEntry(payload.entryId, payload.entryName, payload.entryType, payload.entryMetadata);
					entries.push(entry);
					open[payload.entryId] = entry;
					break;
				}
				case ControlRecordType.Finish: {
					const entry = open[payload.entryId];
					if (entry) {
						entry.finished = true;
						open[payload.entryId] = undefined;
					}
					break;
				}
				case ControlRecordType.SetMetadata: {
					const entry = open[payload.entryId];
					if (entry) {
						entry.metadata = payload.entryMetadata;
					}
					break;
				}
			}
		} else {
			const entry = open[entryId];
			if (entry) {
				addRecord(entry, timestamp, payloadOffset, payloadSize);
			} else if (options.strict) {
				error = diagnostics.WPILOG_R0006({ entryId });
				break;
			}
		}
		offset = end;
	}

	return { header, bytes, entries, bytesRead: offset, truncated, error };
}

/**
 * Decodes the values of an indexed log's entries, see {@link indexDataLog}. Struct and protobuf schemas are read from
 * the whole log first, so values logged before their schema decode too.
 */
export class DataLogIndexDecoder {
	private readonly bytes: Uint8Array;
	private readonly view: DataView;
	private readonly decoder: RecordDecoder;

	/** Accepts the `invalidValues` option of `parseDataLog`. */
	constructor(index: DataLogIndex, options: Pick<DecodeRecordsOptions, 'invalidValues'> = {}) {
		this.bytes = index.bytes;
		this.view = new DataView(index.bytes.buffer, index.bytes.byteOffset, index.bytes.byteLength);
		this.decoder = new RecordDecoder(options);
		for (const entry of index.entries) {
			if (entry.type === 'structschema' || entry.type === PROTOBUF_SCHEMA_TYPE) {
				for (let i = 0; i < entry.length; i++) {
					this.decode(entry, i);
				}
			}
		}
	}

	/**
	 * Decode every value of a `double`, `float`, or `int64` entry as a number, in file order, without making a record for
	 * each. `int64` values beyond `Number.MAX_SAFE_INTEGER` round to the nearest number. Returns `undefined` for other
	 * types, and when a value is too short to read, so its records can be decoded one at a time with {@link DataLogIndexDecoder.decode}.
	 */
	decodeNumbers(entry: IndexedEntry): Float64Array<ArrayBuffer> | undefined {
		const { length, payloadOffsets, payloadSizes } = entry;
		const { view } = this;
		const values = new Float64Array(length);
		switch (entry.type) {
			case 'double':
				for (let i = 0; i < length; i++) {
					if (payloadSizes[i]! < 8) return undefined;
					values[i] = view.getFloat64(payloadOffsets[i]!, true);
				}
				return values;
			case 'float':
				for (let i = 0; i < length; i++) {
					if (payloadSizes[i]! < 4) return undefined;
					values[i] = view.getFloat32(payloadOffsets[i]!, true);
				}
				return values;
			case 'int64':
				for (let i = 0; i < length; i++) {
					if (payloadSizes[i]! < 8) return undefined;
					const offset = payloadOffsets[i]!;
					// One rounding of the exact sum, like converting the bigint
					values[i] = view.getUint32(offset, true) + view.getInt32(offset + 4, true) * 2 ** 32;
				}
				return values;
			default:
				return undefined;
		}
	}

	/**
	 * Decode data record `index` of `entry`. Returns `undefined` for a struct or protobuf value whose schema was never
	 * logged. Throws for an invalid value unless `invalidValues` is `'raw'`.
	 */
	decode(entry: IndexedEntry, index: number): DataRecord | undefined {
		// Only control records decode to anything else
		return this.decoder.decodeEntryData(
			entry,
			entry.timestamps[index]!,
			this.bytes,
			this.view,
			entry.payloadOffsets[index]!,
			entry.payloadSizes[index]!,
		) as DataRecord | undefined;
	}
}
