import type { StructRegistry } from './struct-registry.ts';
import {
	type BitUnitPlan,
	type CompiledStructEncoder,
	getField,
	integerBounds,
	planStructEncoding,
	PRIMITIVES,
	toArray,
	toBigInteger,
	toBoolean,
	toInteger,
	toNumber,
	toObject,
	type ValueFieldPlan,
	writeString,
} from './struct-encoding.ts';

type FieldWriter = (view: DataView, bytes: Uint8Array, base: number, struct: object) => void;

function compilePrimitive(type: string, label: string): CompiledStructEncoder {
	const [min, max] = integerBounds(type, PRIMITIVES.get(type)!.bytes * 8);
	const nmin = Number(min);
	const nmax = Number(max);
	switch (type) {
		case 'bool':
			return (view, _bytes, at, value) => view.setUint8(at, toBoolean(value, label) ? 1 : 0);
		case 'int8':
			return (view, _bytes, at, value) => view.setInt8(at, toInteger(value, nmin, nmax, label));
		case 'uint8':
			return (view, _bytes, at, value) => view.setUint8(at, toInteger(value, nmin, nmax, label));
		case 'int16':
			return (view, _bytes, at, value) => view.setInt16(at, toInteger(value, nmin, nmax, label), true);
		case 'uint16':
			return (view, _bytes, at, value) => view.setUint16(at, toInteger(value, nmin, nmax, label), true);
		case 'int32':
			return (view, _bytes, at, value) => view.setInt32(at, toInteger(value, nmin, nmax, label), true);
		case 'uint32':
			return (view, _bytes, at, value) => view.setUint32(at, toInteger(value, nmin, nmax, label), true);
		case 'int64':
			return (view, _bytes, at, value) => view.setBigInt64(at, toBigInteger(value, min, max, label), true);
		case 'uint64':
			return (view, _bytes, at, value) => view.setBigUint64(at, toBigInteger(value, min, max, label), true);
		case 'float':
		case 'float32':
			return (view, _bytes, at, value) => view.setFloat32(at, toNumber(value, label), true);
		default:
			return (view, _bytes, at, value) => view.setFloat64(at, toNumber(value, label), true);
	}
}

function compileBitUnit({ offset, storageByteLength, fields }: BitUnitPlan): FieldWriter {
	if (storageByteLength === 8) {
		const parts = fields.map(({ type, key, label, bitShift, bitWidth }): ((struct: object) => bigint) => {
			const shift = BigInt(bitShift);
			if (type === 'bool') {
				const mask = 1n << shift;
				return (struct) => (toBoolean(getField(struct, key, label), label) ? mask : 0n);
			}
			const [min, max] = integerBounds(type, bitWidth);
			return (struct) => BigInt.asUintN(bitWidth, toBigInteger(getField(struct, key, label), min, max, label)) << shift;
		});
		return (view, _bytes, base, struct) => {
			let bits = 0n;
			for (const part of parts) bits |= part(struct);
			view.setBigUint64(base + offset, bits, true);
		};
	}

	// Storage of up to 32 bits fits in int32 arithmetic; the unsigned setters wrap negative results.
	const parts = fields.map(({ type, key, label, bitShift, bitWidth }): ((struct: object) => number) => {
		if (type === 'bool') return (struct) => (toBoolean(getField(struct, key, label), label) ? 1 : 0) << bitShift;
		const [min, max] = integerBounds(type, bitWidth);
		const nmin = Number(min);
		const nmax = Number(max);
		const mask = 2 ** bitWidth - 1;
		return (struct) => (toInteger(getField(struct, key, label), nmin, nmax, label) & mask) << bitShift;
	});
	const collect = (struct: object) => {
		let bits = 0;
		for (const part of parts) bits |= part(struct);
		return bits;
	};
	switch (storageByteLength) {
		case 1:
			return (view, _bytes, base, struct) => view.setUint8(base + offset, collect(struct));
		case 2:
			return (view, _bytes, base, struct) => view.setUint16(base + offset, collect(struct), true);
		case 4:
			return (view, _bytes, base, struct) => view.setUint32(base + offset, collect(struct), true);
		default:
			throw new RangeError('Invalid bit-field storage size');
	}
}

/** Compile a schema snapshot into reusable encoding closures without runtime string evaluation. */
export function compileStructEncoderClosures(registry: StructRegistry, name: string): CompiledStructEncoder {
	const encoders = new Map<string, CompiledStructEncoder>();

	function compileValue({ type, key, label, offset, elementSize, arraySize }: ValueFieldPlan): FieldWriter {
		if (type === 'char') {
			const length = arraySize ?? 1;
			return (_view, bytes, base, struct) =>
				writeString(bytes, base + offset, length, getField(struct, key, label), label);
		}

		const writeOne = PRIMITIVES.has(type) ? compilePrimitive(type, label) : compile(type);
		if (arraySize === undefined) {
			return (view, bytes, base, struct) => writeOne(view, bytes, base + offset, getField(struct, key, label));
		}
		return (view, bytes, base, struct) => {
			const values = toArray(getField(struct, key, label), arraySize, label);
			for (let i = 0; i < arraySize; i++) writeOne(view, bytes, base + offset + i * elementSize, values[i]);
		};
	}

	function compile(structName: string): CompiledStructEncoder {
		const existing = encoders.get(structName);
		if (existing) return existing;

		const writers = planStructEncoding(registry, structName).map((field) =>
			field.kind === 'bits' ? compileBitUnit(field) : compileValue(field),
		);
		const encoder: CompiledStructEncoder = (view, bytes, base, value) => {
			const struct = toObject(value, structName);
			for (const write of writers) write(view, bytes, base, struct);
		};
		encoders.set(structName, encoder);
		return encoder;
	}

	return compile(name);
}
