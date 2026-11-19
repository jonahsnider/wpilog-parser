import type { StructRegistry } from './struct-registry.ts';
import {
	type BitUnitPlan,
	type CompiledStructEncoder,
	integerBounds,
	planStructEncoding,
	PRIMITIVES,
	requireField,
	toArray,
	toBigInteger,
	toBoolean,
	toInteger,
	toNumber,
	toObject,
	type ValueFieldPlan,
	writeString,
} from './struct-encoding.ts';

const HELPERS = { requireField, toArray, toBigInteger, toBoolean, toInteger, toNumber, toObject, writeString };

/** Source for a validated, converted value, with numeric bounds for an integer of `bits` bits. */
function convert(type: string, bits: number, value: string, label: string): string {
	const [min, max] = integerBounds(type, bits);
	switch (PRIMITIVES.get(type)!.kind) {
		case 'boolean':
			return `toBoolean(${value}, ${label})`;
		case 'number':
			return `toNumber(${value}, ${label})`;
		case 'integer':
			return `toInteger(${value}, ${min}, ${max}, ${label})`;
		case 'bigint':
			return `toBigInteger(${value}, ${min}n, ${max}n, ${label})`;
	}
}

/** Compile a schema snapshot after all of its dependencies have been registered. */
export function compileStructEncoder(registry: StructRegistry, name: string): CompiledStructEncoder {
	const functions = new Map<string, string>();
	const sources: string[] = [];

	function writeElement(type: string, at: string, value: string, label: string): string {
		const primitive = PRIMITIVES.get(type);
		if (!primitive) return `${generate(type)}(view, bytes, ${at}, ${value});`;
		const converted =
			type === 'bool' ? `${convert(type, 8, value, label)} ? 1 : 0` : convert(type, primitive.bytes * 8, value, label);
		return `view.${primitive.setter}(${at}, ${converted}${primitive.bytes > 1 ? ', true' : ''});`;
	}

	function generateValue(field: ValueFieldPlan, index: number, statements: string[]): void {
		// Treat schema names as data, including __proto__ and reserved words.
		const label = JSON.stringify(field.label);
		const value = `v${index}`;
		const position = `base + ${field.offset}`;
		const key = JSON.stringify(field.key);
		statements.push(`requireField(value, ${key}, ${label});`, `const ${value} = value[${key}];`);

		if (field.type === 'char') {
			statements.push(`writeString(bytes, ${position}, ${field.arraySize ?? 1}, ${value}, ${label});`);
		} else if (field.arraySize === undefined) {
			statements.push(writeElement(field.type, position, value, label));
		} else {
			const array = `a${index}`;
			statements.push(
				`const ${array} = toArray(${value}, ${field.arraySize}, ${label});`,
				`for (let i = 0; i < ${field.arraySize}; i++) ${writeElement(field.type, `${position} + i * ${field.elementSize}`, `${array}[i]`, label)}`,
			);
		}
	}

	function generateBitUnit(unit: BitUnitPlan, index: number, statements: string[]): void {
		const wide = unit.storageByteLength === 8;
		const parts = unit.fields.map(({ type, key, label: rawLabel, bitShift, bitWidth }, part) => {
			const label = JSON.stringify(rawLabel);
			const field = JSON.stringify(key);
			statements.push(`requireField(value, ${field}, ${label});`);
			const value = `value[${field}]`;
			let bits: string;
			if (type === 'bool') {
				const boolean = convert(type, 8, value, label);
				bits = wide ? `${boolean} ? ${1n << BigInt(bitShift)}n : 0n` : `(${boolean} ? 1 : 0) << ${bitShift}`;
			} else if (wide) {
				bits = `BigInt.asUintN(${bitWidth}, ${convert(type, bitWidth, value, label)}) << ${bitShift}n`;
			} else bits = `(${convert(type, bitWidth, value, label)} & ${2 ** bitWidth - 1}) << ${bitShift}`;
			// Validate each field in declaration order, as the closure encoder does.
			const name = `b${index}_${part}`;
			statements.push(`const ${name} = ${bits};`);
			return name;
		});
		const setter = { 1: 'setUint8', 2: 'setUint16', 4: 'setUint32', 8: 'setBigUint64' }[unit.storageByteLength];
		if (!setter) throw new RangeError('Invalid bit-field storage size');
		const littleEndian = unit.storageByteLength > 1 ? ', true' : '';
		statements.push(`view.${setter}(base + ${unit.offset}, ${parts.join(' | ')}${littleEndian});`);
	}

	function generate(structName: string): string {
		const existing = functions.get(structName);
		if (existing) return existing;

		const functionName = `s${functions.size}`;
		functions.set(structName, functionName);
		const statements = [`toObject(value, ${JSON.stringify(structName)});`];
		for (const [index, field] of planStructEncoding(registry, structName).entries()) {
			if (field.kind === 'bits') generateBitUnit(field, index, statements);
			else generateValue(field, index, statements);
		}

		sources.push(`function ${functionName}(view, bytes, base, value) {
			${statements.join('\n')}
		}`);
		return functionName;
	}

	const root = generate(name);
	// Only quoted names and numeric layout constants enter the generated source.
	// oxlint-disable-next-line typescript/no-implied-eval
	const factory = new Function(
		'helpers',
		`"use strict";
		const { ${Object.keys(HELPERS).join(', ')} } = helpers;
		${sources.join('\n')}
		return ${root};`,
	) as (helpers: typeof HELPERS) => CompiledStructEncoder;
	return factory(HELPERS);
}
