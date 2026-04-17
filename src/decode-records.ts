import { ByteOffset } from './byte-offset.js';
import type { ReadRecord } from './read-records.js';
import { StructDecodeQueue } from './struct/struct-decode-queue.js';
import { StructRegistry } from './struct/struct-registry.js';
import { ControlRecordType, type DecodedRecord, type RawRecord, RecordType, type StartControlRecord } from './types.js';

const TEXT_DECODER = new TextDecoder();
const STRUCT_PREFIX = 'struct:';
const STRUCT_ARRAY_SUFFIX = '[]';

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
 * Accepts the output of {@link readRecords} and yields fully decoded records,
 * including struct decoding with dependency resolution.
 */
export function* decodeRecords(records: Iterable<ReadRecord>): Generator<DecodedRecord> {
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
		const view = new DataView(raw.payload.buffer, raw.payload.byteOffset, raw.payload.byteLength);

		const decoded = decodePayload(
			raw,
			recordContext.entryType,
			name,
			metadata,
			view,
			structRegistry,
			structDecodeQueue,
		);

		if (decoded) {
			yield decoded;
		}

		// Yield any structs that became decodable after schema registration
		yield* asyncDecodedStructs;
		asyncDecodedStructs.length = 0;
	}
}

function decodePayload(
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
		case 'boolean':
			return { ...base, type: RecordType.Boolean, payload: byteToBoolean(view.getUint8(0)) };
		case 'int64':
			return { ...base, type: RecordType.Int64, payload: view.getBigInt64(0, true) };
		case 'float':
			return { ...base, type: RecordType.Float, payload: view.getFloat32(0, true) };
		case 'double':
			return { ...base, type: RecordType.Double, payload: view.getFloat64(0, true) };
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
			const structName = name.slice('/.schema/'.length + STRUCT_PREFIX.length);
			const payload = TEXT_DECODER.decode(raw.payload);
			structRegistry.register(structName, payload);
			return { ...base, type: RecordType.String, payload };
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
						...base,
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
					...base,
					type: RecordType.Struct,
					structName: normalizedStructName,
					payload: decoded,
				};
			}

			// Unknown type — return raw
			return { ...base, type: RecordType.Raw, payload: raw.payload };
		}
	}
}
