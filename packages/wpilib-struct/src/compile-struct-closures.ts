import { BitFieldTracker, decodeBitField, type BitFieldLayout } from './bit-field.ts';
import type { CompiledStructDecoder } from './compile-struct.ts';
import type { StructRegistry } from './struct-registry.ts';
import type { StructDeclaration, StructPayload } from './types.ts';

type Reader = {
	bytes: number;
	read: (view: DataView, offset: number) => number | bigint | boolean;
};

const READERS: Record<string, Reader> = {
	bool: { bytes: 1, read: (view, offset) => Boolean(view.getUint8(offset)) },
	char: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
	int8: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
	int16: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
	int32: { bytes: 4, read: (view, offset) => view.getInt32(offset, true) },
	int64: { bytes: 8, read: (view, offset) => view.getBigInt64(offset, true) },
	uint8: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
	uint16: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
	uint32: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
	uint64: { bytes: 8, read: (view, offset) => view.getBigUint64(offset, true) },
	float: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
	float32: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
	double: { bytes: 8, read: (view, offset) => view.getFloat64(offset, true) },
	float64: { bytes: 8, read: (view, offset) => view.getFloat64(offset, true) },
};

type FieldReader = (view: DataView, bytes: Uint8Array, base: number) => StructPayload[string];

/** Compile a schema snapshot into reusable closures without runtime string evaluation. */
export function compileStructClosures(registry: StructRegistry, name: string): CompiledStructDecoder {
	const functions = new Map<string, CompiledStructDecoder>();
	const textDecoder = new TextDecoder();

	function compileMemberValue(
		member: StructDeclaration,
		offset: number,
		size: number,
		reader: Reader | undefined,
	): FieldReader {
		if (member.value === 'char') {
			const length = size * (member.arraySize ?? 1);
			return (_view, bytes, base) => textDecoder.decode(bytes.subarray(base + offset, base + offset + length));
		}

		const nested = reader ? undefined : compile(member.value);
		const readOne = (view: DataView, bytes: Uint8Array, at: number) => {
			if (!reader) return nested!(view, bytes, at);
			return reader.read(view, at);
		};
		if (member.arraySize === undefined) {
			return (view, bytes, base) => readOne(view, bytes, base + offset);
		}

		const arraySize = member.arraySize;
		return (view, bytes, base) => {
			const values: NonNullable<StructPayload[string]>[] = [];
			for (let i = 0; i < arraySize; i++) values.push(readOne(view, bytes, base + offset + i * size));
			return values as StructPayload[string];
		};
	}

	function compileBitField(member: StructDeclaration, bitField: BitFieldLayout, offset: number): FieldReader {
		return (view, _bytes, base) => decodeBitField(view, base + offset, member, bitField);
	}

	function compile(structName: string): CompiledStructDecoder {
		const existing = functions.get(structName);
		if (existing) return existing;

		const fields: Array<{ name: string; read: FieldReader }> = [];
		const bitFields = new BitFieldTracker();
		let offset = 0;

		// Insert a placeholder so recursive lookups within this compilation reuse the same decoder.
		const decoder: CompiledStructDecoder = (view, bytes, base) => {
			const result: StructPayload = {};
			for (const field of fields) {
				if (field.name === '__proto__') {
					Object.defineProperty(result, field.name, {
						value: field.read(view, bytes, base),
						enumerable: true,
						writable: true,
						configurable: true,
					});
					continue;
				}
				result[field.name] = field.read(view, bytes, base);
			}
			return result;
		};
		functions.set(structName, decoder);

		for (const member of registry.getDefinition(structName)) {
			const reader = Object.hasOwn(READERS, member.value) ? READERS[member.value] : undefined;
			const size = reader?.bytes ?? registry.getByteLength(member.value);
			if (typeof size !== 'number') throw new TypeError(`Missing schema: ${size}`);
			const memberSize = size * (member.arraySize ?? 1);
			const bitField = bitFields.next(member, memberSize);
			let read: FieldReader;

			if (bitField) {
				offset += bitField.bytesToAdvance;
				read = compileBitField(member, bitField, offset);
			} else {
				offset += bitFields.flush();
				read = compileMemberValue(member, offset, size, reader);
				offset += memberSize;
			}

			fields.push({ name: member.name, read });
		}

		return decoder;
	}

	return compile(name);
}
