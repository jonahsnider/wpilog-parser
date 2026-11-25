import { type DecodeRecordsOptions, RecordDecoder } from './decode-records.ts';
import { RecordCursor, readControlRecordPayload, readHeader, truncatedHeaderError } from './read-records.ts';
import type { DataLogHeader, DecodedRecord } from './types.ts';

const EMPTY = new Uint8Array(0);
const MIN_BUFFER_SIZE = 65_536;

/**
 * Read and decode a WPILOG file from chunks of its bytes as they arrive, such as a download, keeping only the bytes of
 * a record split between chunks. Produces the same records as `parseDataLog`.
 *
 * @example
 * ```ts
 * const parser = new DataLogStreamParser();
 * for await (const chunk of response.body) {
 *   for (const record of parser.push(chunk)) {
 *     console.log(record);
 *   }
 * }
 * parser.end();
 * ```
 */
export class DataLogStreamParser {
	private readonly decoder: RecordDecoder;
	// Holds the pushed bytes not decoded yet, from `cursor.offset` to `cursor.bytes.byteLength`, with room for more after
	private buffer = EMPTY;
	private view = new DataView(EMPTY.buffer);
	// Reads `buffer` up to the end of the pushed bytes
	private cursor = new RecordCursor(EMPTY, this.view, 0);
	// Bytes of the input before `buffer`
	private discarded = 0;
	private fileHeader: DataLogHeader | undefined;
	// Records decoded but not yet read, starting at `pendingIndex`. Only records decoded with another one, ex. structs
	// whose schema just arrived, wait here, so they aren't lost when iteration stops early.
	private readonly pending: DecodedRecord[] = [];
	private pendingIndex = 0;
	private ended = false;

	/** Accepts the same options as `parseDataLog` */
	constructor(options: DecodeRecordsOptions = { strict: false }) {
		this.decoder = new RecordDecoder(options);
	}

	/** The file header, `undefined` until enough of the file has been pushed to read it */
	get header(): DataLogHeader | undefined {
		return this.fileHeader;
	}

	/** Bytes of the input read into the file header and decoded records, the rest is part of a record that isn't complete yet */
	get bytesRead(): number {
		return this.discarded + this.cursor.offset;
	}

	/**
	 * Whether the input ended partway through a record, such as a log cut off by a power loss.
	 * The incomplete record is not yielded. This is `false` until {@link DataLogStreamParser.end} is called and every record has been read.
	 */
	get truncated(): boolean {
		return this.ended && this.cursor.offset < this.cursor.bytes.byteLength;
	}

	/**
	 * Add the next chunk of the file and decode the records it completes.
	 * The chunk is copied, so it can be reused once this returns.
	 *
	 * Records left unread when iteration stops early are yielded by the next push.
	 * Throws while iterating if the file is damaged, the records before the damage have already been yielded.
	 */
	push(chunk: Uint8Array): Generator<DecodedRecord> {
		let { offset } = this.cursor;
		let end = this.cursor.bytes.byteLength;
		if (end + chunk.byteLength > this.buffer.byteLength) {
			// Move the bytes not decoded yet to a new buffer. Doubling its size keeps a record spanning many chunks from
			// being copied on every push. Bytes are never written over, since queued records keep views of them.
			const rest = end - offset;
			const buffer = new Uint8Array(Math.max(MIN_BUFFER_SIZE, 2 * rest + chunk.byteLength));
			buffer.set(this.buffer.subarray(offset, end));
			this.discarded += offset;
			this.buffer = buffer;
			this.view = new DataView(buffer.buffer);
			offset = 0;
			end = rest;
		}
		this.buffer.set(chunk, end);
		this.cursor = new RecordCursor(this.buffer.subarray(0, end + chunk.byteLength), this.view, offset);
		return this.records();
	}

	/** Signal the end of the file. Throws if it ended before the file header did. */
	end(): void {
		this.ended = true;
		if (!this.fileHeader) {
			throw truncatedHeaderError(this.cursor.bytes.byteLength);
		}
	}

	private *records(): Generator<DecodedRecord> {
		yield* this.drainPending();
		const { cursor, decoder } = this;
		if (!this.fileHeader) {
			const opened = readHeader(cursor.bytes, cursor.view);
			if (!opened) {
				return;
			}
			this.fileHeader = opened.header;
			cursor.offset = opened.recordsOffset;
		}

		while (true) {
			const start = cursor.offset;
			if (!cursor.next()) {
				// The cursor skips to the end of an incomplete record, keep it for the next chunk
				cursor.offset = start;
				cursor.truncated = false;
				return;
			}

			let decoded: DecodedRecord | undefined;
			try {
				decoded =
					cursor.entryId === 0
						? decoder.decodeControl(0, cursor.timestamp, readControlRecordPayload(cursor.getPayload()))
						: decoder.decodeData(
								cursor.entryId,
								cursor.timestamp,
								cursor.bytes,
								cursor.view,
								cursor.payloadOffset,
								cursor.payloadSize,
							);
			} catch (error) {
				// The damaged record wasn't read
				cursor.offset = start;
				throw error;
			}
			// Queued before yielding, so they're kept if iteration stops at this record
			if (decoder.delayedRecords.length > 0) {
				this.pending.push(...decoder.delayedRecords);
				decoder.delayedRecords.length = 0;
			}
			if (decoded) {
				yield decoded;
			}
			if (this.pending.length > 0) {
				yield* this.drainPending();
			}
		}
	}

	private *drainPending(): Generator<DecodedRecord> {
		while (this.pendingIndex < this.pending.length) {
			yield this.pending[this.pendingIndex++]!;
		}
		this.pending.length = 0;
		this.pendingIndex = 0;
	}
}
