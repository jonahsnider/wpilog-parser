import { type DataLogInput, type ReadRecord, readRecords } from './read-records.js';
import { StructDecodeQueue } from './struct/struct-decode-queue.js';
import { StructRegistry } from './struct/struct-registry.js';
import { ControlRecordType, type DecodedRecord, type RawRecord, RecordType, type StartControlRecord } from './types.js';

const TEXT_DECODER = new TextDecoder();
const STRUCT_PREFIX = 'struct:';
const STRUCT_ARRAY_SUFFIX = '[]';
const IS_LITTLE_ENDIAN = (() => {
	const buf = new ArrayBuffer(2);
	new DataView(buf).setUint16(0, 1, true);
	return new Uint16Array(buf)[0] === 1;
})();

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

function normalizeEntryName(rawName: string): string {
	if (rawName.startsWith('/')) {
		return rawName;
	}
	return `/${rawName}`;
}

/**
 * Decode raw WPILOG records into typed values.
 *
 * Accepts either the output of {@link readRecords} or raw WPILOG bytes directly.
 * Passing raw bytes is faster because it avoids composing two generators.
 * Yields fully decoded records, including struct decoding with dependency resolution.
 */
export function* decodeRecords(input: Iterable<ReadRecord> | DataLogInput): Generator<DecodedRecord> {
	const records: Iterable<ReadRecord> =
		input instanceof Uint8Array || input instanceof ArrayBuffer ? readRecords(input) : input;
	const asyncDecodedStructs: DecodedRecord[] = [];

	const structDecodeQueue = new StructDecodeQueue((structName, queuedRecords) => {
		for (const raw of queuedRecords) {
			const ctx = context.get(raw.entryId);
			if (!ctx) continue;

			const entryType = ctx.entryType;
			const name = normalizeEntryName(ctx.entryName);
			const metadata = ctx.entryMetadata;

			if (entryType.endsWith(STRUCT_ARRAY_SUFFIX)) {
				const normalizedName = entryType.slice(STRUCT_PREFIX.length);
				const decoded = structRegistry.decodeArray(normalizedName, raw.payload);
				if (typeof decoded !== 'string') {
					asyncDecodedStructs.push({
						entryId: raw.entryId,
						timestamp: raw.timestamp,
						name,
						metadata,
						type: RecordType.StructArray,
						structName: normalizedName,
						payload: decoded,
					});
				}
			} else {
				const normalizedName = entryType.slice(STRUCT_PREFIX.length);
				const decoded = structRegistry.decode(normalizedName, raw.payload);
				if (typeof decoded !== 'string') {
					asyncDecodedStructs.push({
						entryId: raw.entryId,
						timestamp: raw.timestamp,
						name,
						metadata,
						type: RecordType.Struct,
						structName: normalizedName,
						payload: decoded,
					});
				}
			}
		}
	});

	const structRegistry = new StructRegistry(structDecodeQueue);

	let sharedView: DataView | undefined;

	const context = new Map<
		StartControlRecord['entryId'],
		Pick<StartControlRecord, 'entryName' | 'entryType' | 'entryMetadata'>
	>();

	for (const readRecord of records) {
		if (readRecord.kind === 'header') {
			// Header records are informational — consumers can filter for them if needed
			continue;
		}

		if (readRecord.kind === 'control') {
			const controlPayload = readRecord.payload;

			switch (controlPayload.controlRecordType) {
				case ControlRecordType.Start:
					context.set(controlPayload.entryId, controlPayload);
					break;
				case ControlRecordType.Finish:
					context.delete(controlPayload.entryId);
					break;
			}

			yield {
				entryId: readRecord.entryId,
				timestamp: readRecord.timestamp,
				type: RecordType.Control,
				payload: controlPayload,
			};
			continue;
		}

		// Data record
		const raw = readRecord.record;
		const recordContext = context.get(raw.entryId);

		if (recordContext === undefined) {
			throw new RangeError(`No type registered for entry ID ${raw.entryId}`);
		}

		const name = normalizeEntryName(recordContext.entryName);
		const metadata = recordContext.entryMetadata;
		const payload = raw.payload;
		let view = sharedView;
		if (view === undefined || view.buffer !== payload.buffer) {
			view = new DataView(payload.buffer);
			sharedView = view;
		}
		const payloadOffset = payload.byteOffset;
		const payloadLength = payload.byteLength;

		const decoded = decodePayload(
			raw,
			recordContext.entryType,
			name,
			metadata,
			view,
			payloadOffset,
			payloadLength,
			structRegistry,
			structDecodeQueue,
		);

		if (decoded) {
			yield decoded;
		}

		// Yield any structs that became decodable after schema registration
		if (asyncDecodedStructs.length > 0) {
			for (const s of asyncDecodedStructs) {
				yield s;
			}
			asyncDecodedStructs.length = 0;
		}
	}
}

function decodePayload(
	raw: RawRecord,
	entryType: string,
	name: string,
	metadata: string,
	view: DataView,
	payloadOffset: number,
	payloadLength: number,
	structRegistry: StructRegistry,
	structDecodeQueue: StructDecodeQueue,
): DecodedRecord | undefined {
	const entryId = raw.entryId;
	const timestamp = raw.timestamp;

	switch (entryType) {
		case 'boolean':
			return {
				entryId,
				timestamp,
				name,
				metadata,
				type: RecordType.Boolean,
				payload: byteToBoolean(view.getUint8(payloadOffset)),
			};
		case 'int64':
			return {
				entryId,
				timestamp,
				name,
				metadata,
				type: RecordType.Int64,
				payload: view.getBigInt64(payloadOffset, true),
			};
		case 'float':
			return {
				entryId,
				timestamp,
				name,
				metadata,
				type: RecordType.Float,
				payload: view.getFloat32(payloadOffset, true),
			};
		case 'double':
			return {
				entryId,
				timestamp,
				name,
				metadata,
				type: RecordType.Double,
				payload: view.getFloat64(payloadOffset, true),
			};
		case 'string':
			return {
				entryId,
				timestamp,
				name,
				metadata,
				type: RecordType.String,
				payload: TEXT_DECODER.decode(raw.payload),
			};
		case 'boolean[]': {
			const payload: boolean[] = new Array(payloadLength);
			for (let i = 0; i < payloadLength; i++) {
				payload[i] = byteToBoolean(view.getUint8(payloadOffset + i));
			}
			return { entryId, timestamp, name, metadata, type: RecordType.BooleanArray, payload };
		}
		case 'int64[]': {
			const count = payloadLength >>> 3;
			let payload: bigint[];
			if ((payloadOffset & 7) === 0 && IS_LITTLE_ENDIAN) {
				payload = Array.from(new BigInt64Array(view.buffer, payloadOffset, count));
			} else {
				payload = new Array(count);
				for (let i = 0; i < count; i++) {
					payload[i] = view.getBigInt64(payloadOffset + (i << 3), true);
				}
			}
			return { entryId, timestamp, name, metadata, type: RecordType.Int64Array, payload };
		}
		case 'float[]': {
			const count = payloadLength >>> 2;
			let payload: number[];
			if ((payloadOffset & 3) === 0 && IS_LITTLE_ENDIAN) {
				payload = Array.from(new Float32Array(view.buffer, payloadOffset, count));
			} else {
				payload = new Array(count);
				for (let i = 0; i < count; i++) {
					payload[i] = view.getFloat32(payloadOffset + (i << 2), true);
				}
			}
			return { entryId, timestamp, name, metadata, type: RecordType.FloatArray, payload };
		}
		case 'double[]': {
			const count = payloadLength >>> 3;
			let payload: number[];
			if ((payloadOffset & 7) === 0 && IS_LITTLE_ENDIAN) {
				payload = Array.from(new Float64Array(view.buffer, payloadOffset, count));
			} else {
				payload = new Array(count);
				for (let i = 0; i < count; i++) {
					payload[i] = view.getFloat64(payloadOffset + (i << 3), true);
				}
			}
			return { entryId, timestamp, name, metadata, type: RecordType.DoubleArray, payload };
		}
		case 'string[]': {
			let offset = payloadOffset;
			const arrayLength = view.getUint32(offset, true);
			offset += 4;
			const payload: string[] = new Array(arrayLength);
			const bytes = raw.payload;
			const bytesStart = bytes.byteOffset;
			for (let i = 0; i < arrayLength; i++) {
				const stringLength = view.getUint32(offset, true);
				offset += 4;
				const relStart = offset - bytesStart;
				payload[i] = TEXT_DECODER.decode(bytes.subarray(relStart, relStart + stringLength));
				offset += stringLength;
			}
			return { entryId, timestamp, name, metadata, type: RecordType.StringArray, payload };
		}
		case 'structschema': {
			// Schema records: register the struct, but emit as a string record
			const structName = name.slice('/.schema/'.length + STRUCT_PREFIX.length);
			const payload = TEXT_DECODER.decode(raw.payload);
			structRegistry.register(structName, payload);
			return { entryId, timestamp, name, metadata, type: RecordType.String, payload };
		}
		default: {
			// Try to decode as struct
			if (entryType.startsWith(STRUCT_PREFIX)) {
				if (entryType.endsWith(STRUCT_ARRAY_SUFFIX)) {
					const normalizedStructName = entryType.slice(STRUCT_PREFIX.length);
					const decoded = structRegistry.decodeArray(normalizedStructName, raw.payload);

					if (typeof decoded === 'string') {
						structDecodeQueue.queueStructRecord(decoded, raw);
						return undefined;
					}

					return {
						entryId,
						timestamp,
						name,
						metadata,
						type: RecordType.StructArray,
						structName: normalizedStructName,
						payload: decoded,
					};
				}

				const normalizedStructName = entryType.slice(STRUCT_PREFIX.length);
				const decoded = structRegistry.decode(normalizedStructName, raw.payload);

				if (typeof decoded === 'string') {
					structDecodeQueue.queueStructRecord(decoded, raw);
					return undefined;
				}

				return {
					entryId,
					timestamp,
					name,
					metadata,
					type: RecordType.Struct,
					structName: normalizedStructName,
					payload: decoded,
				};
			}

			// Unknown type — return raw
			return { entryId, timestamp, name, metadata, type: RecordType.Raw, payload: raw.payload };
		}
	}
}
