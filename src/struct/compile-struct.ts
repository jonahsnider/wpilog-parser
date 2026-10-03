import { BitFieldTracker, type BitFieldLayout } from './bit-field.ts';
import type { StructRegistry } from './struct-registry.ts';
import type { StructDeclaration } from './types.ts';
import type { StructPayload } from '../types.ts';

type Reader = { method: string; bytes: number };

const READERS: Record<string, Reader> = {
	bool: { method: 'getUint8', bytes: 1 },
	char: { method: 'getUint8', bytes: 1 },
	int8: { method: 'getInt8', bytes: 1 },
	int16: { method: 'getInt16', bytes: 2 },
	int32: { method: 'getInt32', bytes: 4 },
	int64: { method: 'getBigInt64', bytes: 8 },
	uint8: { method: 'getUint8', bytes: 1 },
	uint16: { method: 'getUint16', bytes: 2 },
	uint32: { method: 'getUint32', bytes: 4 },
	uint64: { method: 'getBigUint64', bytes: 8 },
	float: { method: 'getFloat32', bytes: 4 },
	float32: { method: 'getFloat32', bytes: 4 },
	double: { method: 'getFloat64', bytes: 8 },
	float64: { method: 'getFloat64', bytes: 8 },
};

export type CompiledStructDecoder = (view: DataView, bytes: Uint8Array, base: number) => StructPayload;

/** Probe lazily, once per registry, so CSP restrictions leave the interpreter available. */
export function allowsCodeGeneration(): boolean {
	try {
		// oxlint-disable-next-line typescript/no-implied-eval
		new Function('');
		return true;
	} catch {
		return false;
	}
}

function getBitFieldMethod(bitField: BitFieldLayout) {
	switch (bitField.storageByteLength) {
		case 1:
			return 'getUint8';
		case 2:
			return 'getUint16';
		case 4:
			return 'getUint32';
		case 8:
			return 'getBigUint64';
		default:
			throw new RangeError('Invalid bit-field storage size');
	}
}

function generateBitFieldExpression(type: string, bitField: BitFieldLayout, offset: number): string {
	const method = getBitFieldMethod(bitField);
	const raw = `view.${method}(base + ${offset}, true)`;
	const bigint = bitField.storageByteLength === 8 ? raw : `BigInt(${raw})`;
	const mask = (1n << BigInt(bitField.bitWidth)) - 1n;
	let expression = `((${bigint} >> ${bitField.bitShift}n) & ${mask}n)`;
	if (type === 'bool') return `${expression} !== 0n`;
	if (type.startsWith('int')) expression = `BigInt.asIntN(${bitField.bitWidth}, ${expression})`;
	return type === 'int64' || type === 'uint64' ? expression : `Number(${expression})`;
}

/** Compile a schema snapshot after all of its dependencies have been registered. */
export function compileStruct(registry: StructRegistry, name: string): CompiledStructDecoder {
	const functions = new Map<string, string>();
	const sources: string[] = [];

	function generateMemberValue(
		member: StructDeclaration,
		index: number,
		offset: number,
		size: number,
		reader: Reader | undefined,
		statements: string[],
	): string {
		const position = `base + ${offset}`;
		if (member.value === 'char') {
			return `textDecoder.decode(bytes.subarray(${position}, ${position} + ${size * (member.arraySize ?? 1)}))`;
		}

		const nested = reader ? undefined : generate(member.value);
		const read = (at: string) => {
			if (!reader) return `${nested}(view, bytes, ${at})`;
			const value = `view.${reader.method}(${at}, true)`;
			return member.value === 'bool' ? `Boolean(${value})` : value;
		};
		if (member.arraySize === undefined) return read(position);

		const expression = `a${index}`;
		statements.push(
			`const ${expression} = [];`,
			`for (let i = 0; i < ${member.arraySize}; i++) ${expression}.push(${read(`${position} + i * ${size}`)});`,
		);
		return expression;
	}

	function generate(structName: string): string {
		const existing = functions.get(structName);
		if (existing) return existing;

		const functionName = `s${functions.size}`;
		functions.set(structName, functionName);
		const statements: string[] = [];
		const bitFields = new BitFieldTracker();
		let offset = 0;

		for (const [index, member] of registry.getDefinition(structName).entries()) {
			const reader = Object.hasOwn(READERS, member.value) ? READERS[member.value] : undefined;
			const size = reader?.bytes ?? registry.getByteLength(member.value);
			if (typeof size !== 'number') throw new TypeError(`Missing schema: ${size}`);
			const memberSize = size * (member.arraySize ?? 1);
			const bitField = bitFields.next(member, memberSize);
			let expression: string;

			if (bitField) {
				offset += bitField.bytesToAdvance;
				expression = generateBitFieldExpression(member.value, bitField, offset);
			} else {
				offset += bitFields.flush();
				expression = generateMemberValue(member, index, offset, size, reader, statements);
				offset += memberSize;
			}

			// Treat schema names as data, including __proto__ and reserved words.
			const key = JSON.stringify(member.name);
			statements.push(`result.set(${key}, ${expression});`);
		}

		sources.push(`function ${functionName}(view, bytes, base) {
			const result = new Map();
			${statements.join('\n')}
			return result;
		}`);
		return functionName;
	}

	const root = generate(name);
	// Only quoted field names and numeric layout constants enter the generated source.
	// oxlint-disable-next-line typescript/no-implied-eval
	const factory = new Function(
		'textDecoder',
		`"use strict";
		${sources.join('\n')}
		return ${root};`,
	) as (textDecoder: TextDecoder) => CompiledStructDecoder;
	return factory(new TextDecoder());
}
