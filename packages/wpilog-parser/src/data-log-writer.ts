import { StructRegistry } from 'wpilib-struct';
import { diagnostics } from './diagnostics.ts';
import { withStructDiagnostics } from './struct/diagnostics.ts';
import { ControlRecordType, type StructPayload } from './types.ts';

const TEXT_ENCODER = new TextEncoder();
const MAGIC = TEXT_ENCODER.encode('WPILOG');
const STRUCT_PREFIX = 'struct:';
const STRUCT_ARRAY_SUFFIX = '[]';
const STRUCT_SCHEMA_NAME_PREFIX = '/.schema/' + STRUCT_PREFIX;
const MAX_UINT32 = 0xffff_ffff;
const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;

/**
 * A value for {@link DataLogWriter.append}. The entry's type decides which values are accepted:
 * `boolean`, `int64` (a `bigint` or safe integer `number`), `float`, `double`, `string`, their arrays,
 * `struct:Name` (a {@link StructPayload}), `struct:Name[]`, and `Uint8Array` for any other type, such as `raw`.
 */
export type DataLogValue =
	| boolean
	| number
	| bigint
	| string
	| readonly boolean[]
	| readonly (number | bigint)[]
	| readonly string[]
	| StructPayload
	| readonly StructPayload[]
	| Uint8Array;

/** Options for {@link DataLogWriter}. */
export type DataLogWriterOptions = {
	/** Arbitrary text stored in the file header. Defaults to an empty string. */
	extraHeader?: string;
};

type WriterEntry = {
	name: string;
	type: string;
	/** The struct name for `struct:` entries, or the schema's struct name for `structschema` entries. */
	structName?: string;
};

/** Microseconds since the JavaScript time origin, from a monotonic clock. */
function now(): number {
	return Math.trunc(performance.now() * 1000);
}

function uintByteLength(value: number): number {
	let length = 1;
	while (value >= 2 ** (8 * length)) length++;
	return length;
}

function writeUint(bytes: Uint8Array, at: number, value: number, length: number): number {
	for (let i = 0; i < length; i++) {
		bytes[at + i] = value % 256;
		value = Math.floor(value / 256);
	}
	return at + length;
}

function describe(entry: WriterEntry): string {
	return `${entry.name} (${entry.type})`;
}

function toArray(value: DataLogValue, entry: WriterEntry): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`Expected an array for ${describe(entry)}`);
	return value;
}

function toBoolean(value: unknown, entry: WriterEntry): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`Expected a boolean for ${describe(entry)}`);
	return value;
}

function toNumber(value: unknown, entry: WriterEntry): number {
	if (typeof value !== 'number') throw new TypeError(`Expected a number for ${describe(entry)}`);
	return value;
}

function toString(value: unknown, entry: WriterEntry): string {
	if (typeof value !== 'string') throw new TypeError(`Expected a string for ${describe(entry)}`);
	return value;
}

function toInt64(value: unknown, entry: WriterEntry): bigint {
	if (typeof value === 'number') {
		// Larger numbers have probably lost precision already.
		if (!Number.isSafeInteger(value)) throw new TypeError(`Expected a safe integer or bigint for ${describe(entry)}`);
		return BigInt(value);
	}
	if (typeof value !== 'bigint') throw new TypeError(`Expected an integer for ${describe(entry)}`);
	if (value < MIN_INT64 || value > MAX_INT64) throw new RangeError(`${describe(entry)} must fit in an int64`);
	return value;
}

/**
 * Write a WPILOG file incrementally.
 *
 * Records are buffered in memory until {@link DataLogWriter.readable} is read, so a log can be streamed to a file
 * while it is written, or built in memory and read once. Timestamps are integer microseconds. When omitted, they
 * come from a monotonic clock that counts from the JavaScript time origin.
 *
 * Every method writes a complete record or, if it throws, nothing.
 */
export class DataLogWriter {
	/**
	 * The log's bytes, starting with the file header. Each read returns every record written since the previous read,
	 * waiting for the next record if there are none. The stream ends after {@link DataLogWriter.close}.
	 * Cancelling it closes the writer and discards unread records.
	 */
	readonly readable: ReadableStream<Uint8Array>;

	private bytes = new Uint8Array(4096);
	private view = new DataView(this.bytes.buffer);
	private length = 0;
	private closed = false;
	/** Resolves a read that is waiting for the next record. */
	private wake?: () => void;
	private nextEntryId = 1;
	private readonly entries = new Map<number, WriterEntry>();
	private readonly entryIds = new Map<string, number>();
	private readonly structs = new StructRegistry();
	private readonly schemas = new Map<string, string>();

	constructor(options: DataLogWriterOptions = {}) {
		const extraHeader = TEXT_ENCODER.encode(options.extraHeader ?? '');
		this.ensureCapacity(12 + extraHeader.byteLength);
		this.bytes.set(MAGIC);
		// Version 1.0, stored as minor then major.
		this.view.setUint16(6, 0x0100, true);
		this.view.setUint32(8, extraHeader.byteLength, true);
		this.bytes.set(extraHeader, 12);
		this.length = 12 + extraHeader.byteLength;

		this.readable = new ReadableStream(
			{
				pull: async (controller) => {
					while (this.length === 0 && !this.closed) {
						// Waking doesn't guarantee a record, since one can be discarded after it starts.
						// oxlint-disable-next-line eslint/no-await-in-loop
						await new Promise<void>((resolve) => (this.wake = resolve));
					}
					if (this.length > 0) {
						controller.enqueue(this.bytes.slice(0, this.length));
						this.length = 0;
					}
					if (this.closed) controller.close();
				},
				cancel: () => {
					this.closed = true;
					this.length = 0;
				},
			},
			// Only take bytes when a reader asks for them, so each chunk holds every record written until then.
			{ highWaterMark: 0 },
		);
	}

	/** Stop writing. {@link DataLogWriter.readable} ends once its remaining records are read. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.wake?.();
	}

	/**
	 * Start an entry and return its ID. Entry IDs are never reused, even after an entry is finished.
	 * Data for `struct:` entries can only be appended once {@link DataLogWriter.addStructSchema} has added its schemas.
	 */
	start(name: string, type: string, metadata = '', timestamp = now()): number {
		if (this.entryIds.has(name)) throw diagnostics.WPILOG_W0002({ name });
		const entryId = this.nextEntryId;
		if (entryId > MAX_UINT32) throw new RangeError('A log cannot have more than 4,294,967,295 entries');

		let structName: string | undefined;
		if (type === 'structschema') {
			// Match the reader, which also accepts prefixed names such as NT:/.schema/struct:Name.
			const prefixIndex = name.indexOf(STRUCT_SCHEMA_NAME_PREFIX);
			if (prefixIndex === -1) {
				throw new TypeError(`structschema entry names must contain ${STRUCT_SCHEMA_NAME_PREFIX}<name>`);
			}
			structName = name.slice(prefixIndex + STRUCT_SCHEMA_NAME_PREFIX.length);
		} else if (type.startsWith(STRUCT_PREFIX)) {
			structName = type.slice(STRUCT_PREFIX.length);
			if (structName.endsWith(STRUCT_ARRAY_SUFFIX)) structName = structName.slice(0, -STRUCT_ARRAY_SUFFIX.length);
		}

		const encodedName = TEXT_ENCODER.encode(name);
		const encodedType = TEXT_ENCODER.encode(type);
		const encodedMetadata = TEXT_ENCODER.encode(metadata);
		let at = this.beginRecord(
			0,
			timestamp,
			17 + encodedName.byteLength + encodedType.byteLength + encodedMetadata.byteLength,
		);
		this.bytes[at++] = ControlRecordType.Start;
		this.view.setUint32(at, entryId, true);
		at = this.writeString(at + 4, encodedName);
		at = this.writeString(at, encodedType);
		this.length = this.writeString(at, encodedMetadata);

		this.nextEntryId++;
		this.entries.set(entryId, { name, type, structName });
		this.entryIds.set(name, entryId);
		return entryId;
	}

	/** Finish an entry. Its ID cannot be used afterward, and its name can be started again. */
	finish(entryId: number, timestamp = now()): void {
		const entry = this.getEntry(entryId);
		const at = this.beginRecord(0, timestamp, 5);
		this.bytes[at] = ControlRecordType.Finish;
		this.view.setUint32(at + 1, entryId, true);
		this.length = at + 5;
		this.entries.delete(entryId);
		this.entryIds.delete(entry.name);
	}

	/** Replace an entry's metadata. */
	setMetadata(entryId: number, metadata: string, timestamp = now()): void {
		this.getEntry(entryId);
		const encoded = TEXT_ENCODER.encode(metadata);
		const at = this.beginRecord(0, timestamp, 9 + encoded.byteLength);
		this.bytes[at] = ControlRecordType.SetMetadata;
		this.view.setUint32(at + 1, entryId, true);
		this.length = this.writeString(at + 5, encoded);
	}

	/**
	 * Add a struct schema, such as `addStructSchema('Translation2d', 'double x;double y')`, in a
	 * `/.schema/struct:Name` entry. Add the schemas of nested structs too. Adding the same schema again does nothing.
	 */
	addStructSchema(name: string, schema: string, timestamp = now()): void {
		if (this.schemas.get(name) === schema) return;
		const entryName = STRUCT_SCHEMA_NAME_PREFIX + name;
		const entryId = this.entryIds.get(entryName) ?? this.start(entryName, 'structschema', '', timestamp);
		this.append(entryId, schema, timestamp);
	}

	/** Append a value to an entry, encoded according to the entry's type. See {@link DataLogValue}. */
	append(entryId: number, value: DataLogValue, timestamp = now()): void {
		const entry = this.getEntry(entryId);
		switch (entry.type) {
			case 'boolean': {
				const at = this.beginRecord(entryId, timestamp, 1);
				this.bytes[at] = toBoolean(value, entry) ? 1 : 0;
				this.length = at + 1;
				return;
			}
			case 'int64': {
				const at = this.beginRecord(entryId, timestamp, 8);
				this.view.setBigInt64(at, toInt64(value, entry), true);
				this.length = at + 8;
				return;
			}
			case 'float': {
				const at = this.beginRecord(entryId, timestamp, 4);
				this.view.setFloat32(at, toNumber(value, entry), true);
				this.length = at + 4;
				return;
			}
			case 'double': {
				const at = this.beginRecord(entryId, timestamp, 8);
				this.view.setFloat64(at, toNumber(value, entry), true);
				this.length = at + 8;
				return;
			}
			case 'string':
				this.appendBytes(entryId, timestamp, TEXT_ENCODER.encode(toString(value, entry)));
				return;
			case 'structschema': {
				const schema = toString(value, entry);
				const encoded = TEXT_ENCODER.encode(schema);
				// Register the schema only once its record can't fail, so a schema is never used without being written.
				const at = this.beginRecord(entryId, timestamp, encoded.byteLength);
				withStructDiagnostics(() => this.structs.register(entry.structName!, schema));
				this.schemas.set(entry.structName!, schema);
				this.bytes.set(encoded, at);
				this.length = at + encoded.byteLength;
				return;
			}
			case 'boolean[]': {
				const values = toArray(value, entry);
				const at = this.beginRecord(entryId, timestamp, values.length);
				for (let i = 0; i < values.length; i++) this.bytes[at + i] = toBoolean(values[i], entry) ? 1 : 0;
				this.length = at + values.length;
				return;
			}
			case 'int64[]': {
				const values = toArray(value, entry);
				const at = this.beginRecord(entryId, timestamp, values.length * 8);
				for (let i = 0; i < values.length; i++) this.view.setBigInt64(at + i * 8, toInt64(values[i], entry), true);
				this.length = at + values.length * 8;
				return;
			}
			case 'float[]': {
				const values = toArray(value, entry);
				const at = this.beginRecord(entryId, timestamp, values.length * 4);
				for (let i = 0; i < values.length; i++) this.view.setFloat32(at + i * 4, toNumber(values[i], entry), true);
				this.length = at + values.length * 4;
				return;
			}
			case 'double[]': {
				const values = toArray(value, entry);
				const at = this.beginRecord(entryId, timestamp, values.length * 8);
				for (let i = 0; i < values.length; i++) this.view.setFloat64(at + i * 8, toNumber(values[i], entry), true);
				this.length = at + values.length * 8;
				return;
			}
			case 'string[]': {
				const strings = toArray(value, entry).map((string) => TEXT_ENCODER.encode(toString(string, entry)));
				let at = this.beginRecord(
					entryId,
					timestamp,
					strings.reduce((size, string) => size + 4 + string.byteLength, 4),
				);
				this.view.setUint32(at, strings.length, true);
				at += 4;
				for (const string of strings) at = this.writeString(at, string);
				this.length = at;
				return;
			}
		}

		if (entry.structName !== undefined) {
			this.appendStruct(entryId, entry, value, timestamp);
			return;
		}
		if (!(value instanceof Uint8Array)) throw new TypeError(`Expected a Uint8Array for ${describe(entry)}`);
		this.appendBytes(entryId, timestamp, value);
	}

	private appendStruct(entryId: number, entry: WriterEntry, value: DataLogValue, timestamp: number): void {
		const structName = entry.structName!;
		const byteLength = this.structs.getByteLength(structName);
		if (typeof byteLength === 'string') throw diagnostics.WPILOG_W0003({ name: byteLength, entry: entry.name });

		if (!entry.type.endsWith(STRUCT_ARRAY_SUFFIX)) {
			const at = this.beginRecord(entryId, timestamp, byteLength);
			this.structs.encodeInto(structName, value as StructPayload, this.bytes, at);
			this.length = at + byteLength;
			return;
		}

		const values = toArray(value, entry) as readonly StructPayload[];
		if (byteLength === 0 && values.length > 0) throw new RangeError('Cannot encode an array of zero-length structs');
		const at = this.beginRecord(entryId, timestamp, values.length * byteLength);
		for (let i = 0; i < values.length; i++)
			this.structs.encodeInto(structName, values[i]!, this.bytes, at + i * byteLength);
		this.length = at + values.length * byteLength;
	}

	private appendBytes(entryId: number, timestamp: number, payload: Uint8Array): void {
		const at = this.beginRecord(entryId, timestamp, payload.byteLength);
		this.bytes.set(payload, at);
		this.length = at + payload.byteLength;
	}

	private getEntry(entryId: number): WriterEntry {
		const entry = this.entries.get(entryId);
		if (!entry) throw diagnostics.WPILOG_W0001({ entryId });
		return entry;
	}

	/**
	 * Write a record header after the committed bytes and return the payload's offset. The record is committed by
	 * setting `length` to the payload's end, so a record that throws while its payload is written is discarded.
	 */
	private beginRecord(entryId: number, timestamp: number, payloadSize: number): number {
		if (this.closed) throw diagnostics.WPILOG_W0004();
		// A waiting read resumes after this method returns, when the record is committed or discarded.
		this.wake?.();
		if (!Number.isSafeInteger(timestamp)) throw new TypeError('Timestamps must be safe integers in microseconds');
		if (payloadSize > MAX_UINT32) throw new RangeError('Record payloads must be smaller than 4 GiB');

		const entryIdLength = uintByteLength(entryId);
		const payloadSizeLength = uintByteLength(payloadSize);
		// Timestamps are int64_t, so only a full eight bytes can carry the sign bit.
		const timestampLength = timestamp < 0 ? 8 : uintByteLength(timestamp);
		let at = this.length;
		this.ensureCapacity(at + 1 + entryIdLength + payloadSizeLength + timestampLength + payloadSize);

		const bytes = this.bytes;
		bytes[at++] = (entryIdLength - 1) | ((payloadSizeLength - 1) << 2) | ((timestampLength - 1) << 4);
		at = writeUint(bytes, at, entryId, entryIdLength);
		at = writeUint(bytes, at, payloadSize, payloadSizeLength);
		if (timestamp < 0) {
			this.view.setBigInt64(at, BigInt(timestamp), true);
			return at + 8;
		}
		return writeUint(bytes, at, timestamp, timestampLength);
	}

	private writeString(at: number, encoded: Uint8Array): number {
		this.view.setUint32(at, encoded.byteLength, true);
		this.bytes.set(encoded, at + 4);
		return at + 4 + encoded.byteLength;
	}

	private ensureCapacity(byteLength: number): void {
		if (byteLength <= this.bytes.byteLength) return;
		const bytes = new Uint8Array(Math.max(byteLength, this.bytes.byteLength * 2));
		bytes.set(this.bytes.subarray(0, this.length));
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer);
	}
}
