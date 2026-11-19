import { BitFieldTracker, isSignedInteger } from './bit-field.ts';
import type { StructRegistry } from './struct-registry.ts';
import { KnownStructTypeName } from './types.ts';

/**
 * Writes a struct value at `base`. Bit-field storage is written whole, but unused bytes of a `char` field are not
 * written, so the target bytes must be zero beforehand.
 */
export type CompiledStructEncoder = (view: DataView, bytes: Uint8Array, base: number, value: unknown) => void;

export type PrimitiveEncoding = {
	bytes: number;
	setter: string;
	kind: 'boolean' | 'number' | 'integer' | 'bigint';
};

export const PRIMITIVES = new Map<string, PrimitiveEncoding>([
	['bool', { bytes: 1, setter: 'setUint8', kind: 'boolean' }],
	['int8', { bytes: 1, setter: 'setInt8', kind: 'integer' }],
	['uint8', { bytes: 1, setter: 'setUint8', kind: 'integer' }],
	['int16', { bytes: 2, setter: 'setInt16', kind: 'integer' }],
	['uint16', { bytes: 2, setter: 'setUint16', kind: 'integer' }],
	['int32', { bytes: 4, setter: 'setInt32', kind: 'integer' }],
	['uint32', { bytes: 4, setter: 'setUint32', kind: 'integer' }],
	['int64', { bytes: 8, setter: 'setBigInt64', kind: 'bigint' }],
	['uint64', { bytes: 8, setter: 'setBigUint64', kind: 'bigint' }],
	['float', { bytes: 4, setter: 'setFloat32', kind: 'number' }],
	['float32', { bytes: 4, setter: 'setFloat32', kind: 'number' }],
	['double', { bytes: 8, setter: 'setFloat64', kind: 'number' }],
	['float64', { bytes: 8, setter: 'setFloat64', kind: 'number' }],
]);

export function integerBounds(type: string, bits: number): [min: bigint, max: bigint] {
	return isSignedInteger(type)
		? [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n]
		: [0n, (1n << BigInt(bits)) - 1n];
}

// Both encoders call these helpers, so they validate the same values in the same order with the same errors.

export function toObject(value: unknown, label: string): object {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`Expected an object for ${label}`);
	}
	return value;
}

/** Own properties only, so inherited names such as `__proto__` and `constructor` never count as fields. */
export function requireField(value: object, key: string, label: string): void {
	if (!Object.hasOwn(value, key)) throw new TypeError(`Missing field ${label}`);
}

export function getField(value: object, key: string, label: string): unknown {
	requireField(value, key, label);
	return (value as Record<string, unknown>)[key];
}

export function toArray(value: unknown, length: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length !== length) {
		throw new TypeError(`Expected an array of ${length} values for ${label}`);
	}
	return value;
}

export function toBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`Expected a boolean for ${label}`);
	return value;
}

export function toNumber(value: unknown, label: string): number {
	if (typeof value !== 'number') throw new TypeError(`Expected a number for ${label}`);
	return value;
}

/** Integers of 32 bits or fewer stay numbers, avoiding `BigInt` conversions for the common field types. */
export function toInteger(value: unknown, min: number, max: number, label: string): number {
	if (typeof value === 'number') {
		if (!Number.isInteger(value)) throw new TypeError(`Expected an integer for ${label}`);
		if (value >= min && value <= max) return value;
	} else if (typeof value === 'bigint') {
		if (value >= min && value <= max) return Number(value);
	} else {
		throw new TypeError(`Expected an integer for ${label}`);
	}
	throw new RangeError(`${label} must be between ${min} and ${max}`);
}

export function toBigInteger(value: unknown, min: bigint, max: bigint, label: string): bigint {
	let integer: bigint;
	if (typeof value === 'bigint') {
		integer = value;
	} else if (typeof value === 'number' && Number.isSafeInteger(value)) {
		integer = BigInt(value);
	} else if (typeof value === 'number' && Number.isInteger(value)) {
		// Larger numbers have probably lost precision already.
		throw new TypeError(`${label} is not a safe integer; pass a bigint instead`);
	} else {
		throw new TypeError(`Expected an integer for ${label}`);
	}
	if (integer < min || integer > max) throw new RangeError(`${label} must be between ${min} and ${max}`);
	return integer;
}

const textEncoder = new TextEncoder();

export function writeString(bytes: Uint8Array, at: number, length: number, value: unknown, label: string): void {
	if (typeof value !== 'string') throw new TypeError(`Expected a string for ${label}`);
	// encodeInto stops before a code point that does not fit, so an overflow never leaves part of a character.
	if (textEncoder.encodeInto(value, bytes.subarray(at, at + length)).read !== value.length) {
		throw new RangeError(`${label} must fit in ${length} bytes of UTF-8`);
	}
}

export type ValueFieldPlan = {
	kind: 'value';
	type: string;
	key: string;
	label: string;
	offset: number;
	elementSize: number;
	arraySize?: number;
};

export type BitFieldPlan = { type: string; key: string; label: string; bitShift: number; bitWidth: number };

/** Bit fields sharing one storage unit, which is written once after all of them are validated. */
export type BitUnitPlan = { kind: 'bits'; offset: number; storageByteLength: number; fields: BitFieldPlan[] };

/** The fields of a struct in declaration order, with their byte offsets. */
export function planStructEncoding(registry: StructRegistry, structName: string): Array<ValueFieldPlan | BitUnitPlan> {
	const plan: Array<ValueFieldPlan | BitUnitPlan> = [];
	const bitFields = new BitFieldTracker();
	let unit: BitUnitPlan | undefined;
	let offset = 0;

	for (const member of registry.getDefinition(structName)) {
		const elementSize =
			member.value === KnownStructTypeName.Character
				? 1
				: (PRIMITIVES.get(member.value)?.bytes ?? registry.getByteLength(member.value));
		if (typeof elementSize !== 'number') throw new TypeError(`Missing schema: ${elementSize}`);
		const memberSize = elementSize * (member.arraySize ?? 1);
		const bitField = bitFields.next(member, memberSize);
		const field = { type: member.value, key: member.name, label: `${structName}.${member.name}` };

		if (bitField) {
			offset += bitField.bytesToAdvance;
			if (unit?.offset !== offset) {
				unit = { kind: 'bits', offset, storageByteLength: bitField.storageByteLength, fields: [] };
				plan.push(unit);
			}
			unit.fields.push({ ...field, bitShift: bitField.bitShift, bitWidth: bitField.bitWidth });
		} else {
			offset += bitFields.flush();
			unit = undefined;
			plan.push({ kind: 'value', ...field, offset, elementSize, arraySize: member.arraySize });
			offset += memberSize;
		}
	}

	return plan;
}
