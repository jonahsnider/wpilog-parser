import { ByteOffset } from './byte-offset.ts';
import { diagnostics } from './errors.ts';
import type { StructPayload } from './types.ts';
import { BitFieldTracker, decodeBitField, encodeBitField } from './bit-field.ts';
import { allowsCodeGeneration, compileStruct, type CompiledStructDecoder } from './compile-struct.ts';
import { parseStructSpecification } from './parse-struct.ts';
import { StructDependencyGraph } from './struct-dependency-graph.ts';
import { KnownStructTypeName, type StructDeclaration, type StructSpecification } from './types.ts';

/** Decoder policy. By default runtime compilation is attempted lazily, with a CSP-safe fallback. */
export type StructRegistryOptions = {
	codeGeneration?: boolean;
};

/** Reusable schemas, dependency resolution, layout sizes, and decoders. */
export class StructRegistry {
	private static readonly TEXT_DECODER = new TextDecoder('utf-8');
	private static readonly TEXT_ENCODER = new TextEncoder();
	private readonly definitions = new Map<string, StructSpecification>();
	private readonly byteLengths = new Map<string, number>();
	private readonly decoders = new Map<string, CompiledStructDecoder>();
	private codeGenerationAllowed?: boolean;
	private readonly graph = new StructDependencyGraph();

	constructor(options: StructRegistryOptions = {}) {
		if (options.codeGeneration === false) this.codeGenerationAllowed = false;
	}

	register(name: string, definition: string): void {
		const specification = parseStructSpecification(definition);
		this.graph.registerSchema(
			name,
			specification.map((member) => member.value),
		);

		if (this.definitions.has(name) && this.definitions.get(name) !== specification) {
			// A changed schema can affect the layout of any enclosing struct.
			this.byteLengths.clear();
			this.decoders.clear();
		}
		this.definitions.set(name, specification);
	}

	getDefinition(name: string): StructSpecification {
		const definition = this.definitions.get(name);

		if (!definition) {
			throw diagnostics.STRUCT_R0013({ name });
		}

		return definition;
	}

	/** Decode an array using its base type name. Missing schemas are returned by name. */
	decodeArray(structName: string, payload: Uint8Array): StructPayload[] | string {
		const structByteLengthOrBlocker = this.getByteLength(structName);

		if (typeof structByteLengthOrBlocker === 'string') {
			return structByteLengthOrBlocker;
		}
		if (structByteLengthOrBlocker === 0) {
			if (payload.byteLength === 0) return [];
			throw new RangeError('Cannot decode an array of zero-length structs');
		}
		if (payload.byteLength % structByteLengthOrBlocker !== 0) {
			throw new RangeError('Struct array payload length must be a multiple of the struct byte length');
		}
		const elements = payload.byteLength / structByteLengthOrBlocker;
		const offset = new ByteOffset();
		const decoder = this.getDecoder(structName);
		const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

		const result: StructPayload[] = [];

		for (let i = 0; i < elements; i++) {
			const decoded = decoder
				? decoder(view, payload, i * structByteLengthOrBlocker)
				: this.decodeInterpretedAt(structName, payload, offset);
			if (typeof decoded === 'string') {
				throw new TypeError(`Expected struct ${structName} to be defined if the byte length calculation succeeded`);
			}
			result.push(decoded);
		}

		return result;
	}

	/** Decode one struct at a byte offset. Trailing bytes are allowed; truncated payloads are not. */
	decode(structName: string, payload: Uint8Array, offset = 0): StructPayload | string {
		const byteLength = this.getByteLength(structName);
		if (typeof byteLength === 'string') return byteLength;
		this.validatePayload(payload, offset, byteLength);
		const decoder = this.getDecoder(structName);
		if (!decoder) return this.decodeInterpretedAt(structName, payload, new ByteOffset(offset));

		const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
		return decoder(view, payload, offset);
	}

	private getDecoder(name: string): CompiledStructDecoder | undefined {
		this.codeGenerationAllowed ??= allowsCodeGeneration();
		if (!this.codeGenerationAllowed) return undefined;

		const existing = this.decoders.get(name);
		if (existing) return existing;

		try {
			const decoder = compileStruct(this, name);
			this.decoders.set(name, decoder);
			return decoder;
		} catch (error) {
			// Also handle a policy change between the probe and compilation.
			if (!(error instanceof EvalError)) throw error;
			this.codeGenerationAllowed = false;
			return undefined;
		}
	}

	/** Decode without runtime code generation, including in CSP-restricted environments. */
	decodeInterpreted(structName: string, payload: Uint8Array, offset = 0): StructPayload | string {
		const byteLength = this.getByteLength(structName);
		if (typeof byteLength === 'string') return byteLength;
		this.validatePayload(payload, offset, byteLength);
		return this.decodeInterpretedAt(structName, payload, new ByteOffset(offset));
	}

	/** Encode one struct. Missing schemas return the schema name string (same as decode). */
	encode(structName: string, value: StructPayload): Uint8Array | string {
		const byteLength = this.getByteLength(structName);
		if (typeof byteLength === 'string') return byteLength;
		const payload = new Uint8Array(byteLength);
		const written = this.encodeInterpretedAt(structName, value, payload, new ByteOffset());
		if (typeof written === 'string') return written;
		return payload;
	}

	/** Encode without runtime code generation. Currently the only encode path. */
	encodeInterpreted(structName: string, value: StructPayload): Uint8Array | string {
		return this.encode(structName, value);
	}

	/** Encode into an existing buffer at offset; returns bytes written, or missing schema name. */
	encodeInto(structName: string, value: StructPayload, payload: Uint8Array, offset = 0): number | string {
		const byteLength = this.getByteLength(structName);
		if (typeof byteLength === 'string') return byteLength;
		this.validatePayload(payload, offset, byteLength);
		payload.fill(0, offset, offset + byteLength);
		const written = this.encodeInterpretedAt(structName, value, payload, new ByteOffset(offset));
		if (typeof written === 'string') return written;
		return byteLength;
	}

	/** Encode an array of structs into a contiguous buffer. */
	encodeArray(structName: string, values: StructPayload[]): Uint8Array | string {
		const structByteLengthOrBlocker = this.getByteLength(structName);

		if (typeof structByteLengthOrBlocker === 'string') {
			return structByteLengthOrBlocker;
		}
		if (structByteLengthOrBlocker === 0) {
			if (values.length === 0) return new Uint8Array();
			throw new RangeError('Cannot encode an array of zero-length structs');
		}

		const payload = new Uint8Array(structByteLengthOrBlocker * values.length);
		for (let i = 0; i < values.length; i++) {
			const written = this.encodeInterpretedAt(
				structName,
				values[i]!,
				payload,
				new ByteOffset(i * structByteLengthOrBlocker),
			);
			if (typeof written === 'string') return written;
		}
		return payload;
	}

	private validatePayload(payload: Uint8Array, offset: number, byteLength: number): void {
		if (!Number.isSafeInteger(offset) || offset < 0 || offset + byteLength > payload.byteLength) {
			throw new RangeError('Struct payload is truncated or its byte offset is invalid');
		}
	}

	private decodeInterpretedAt(structName: string, payload: Uint8Array, offset: ByteOffset): StructPayload | string {
		if (!this.definitions.has(structName)) {
			return structName;
		}

		const specification = this.getDefinition(structName);
		const result: StructPayload = {};

		const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
		const bitFields = new BitFieldTracker();

		for (const member of specification) {
			// Define this field before assignment so the inherited setter is never invoked.
			if (member.name === '__proto__') {
				Object.defineProperty(result, member.name, {
					value: undefined,
					enumerable: true,
					writable: true,
					configurable: true,
				});
			}
			const memberByteLength = this.calculateByteLength(member);
			const bitField = typeof memberByteLength === 'number' ? bitFields.next(member, memberByteLength) : undefined;
			if (bitField) {
				offset.advance(bitField.bytesToAdvance);
				result[member.name] = decodeBitField(view, offset.get(), member, bitField);
				continue;
			}

			offset.advance(bitFields.flush());

			switch (member.value) {
				case KnownStructTypeName.Boolean:
					if (member.arraySize !== undefined) {
						const array: boolean[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(Boolean(view.getUint8(offset.get())));
							offset.advance8();
						}
						result[member.name] = array;
					} else {
						result[member.name] = Boolean(view.getUint8(offset.get()));
						offset.advance8();
					}
					break;
				case KnownStructTypeName.Int8:
					if (member.arraySize !== undefined) {
						const array: number[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getInt8(offset.get()));
							offset.advance8();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getInt8(offset.get());
						offset.advance8();
					}
					break;
				case KnownStructTypeName.Int16:
					if (member.arraySize !== undefined) {
						const array: number[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getInt16(offset.get(), true));
							offset.advance16();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getInt16(offset.get(), true);
						offset.advance16();
					}
					break;
				case KnownStructTypeName.Int32:
					if (member.arraySize !== undefined) {
						const array: number[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getInt32(offset.get(), true));
							offset.advance32();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getInt32(offset.get(), true);
						offset.advance32();
					}
					break;
				case KnownStructTypeName.Int64:
					if (member.arraySize !== undefined) {
						const array: bigint[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getBigInt64(offset.get(), true));
							offset.advance64();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getBigInt64(offset.get(), true);
						offset.advance64();
					}
					break;
				case KnownStructTypeName.Uint8:
					if (member.arraySize !== undefined) {
						const array: number[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getUint8(offset.get()));
							offset.advance8();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getUint8(offset.get());
						offset.advance8();
					}
					break;
				case KnownStructTypeName.Uint16:
					if (member.arraySize !== undefined) {
						const array: number[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getUint16(offset.get(), true));
							offset.advance16();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getUint16(offset.get(), true);
						offset.advance16();
					}
					break;
				case KnownStructTypeName.Uint32:
					if (member.arraySize !== undefined) {
						const array: number[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getUint32(offset.get(), true));
							offset.advance32();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getUint32(offset.get(), true);
						offset.advance32();
					}
					break;
				case KnownStructTypeName.Uint64:
					if (member.arraySize !== undefined) {
						const array: bigint[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getBigUint64(offset.get(), true));
							offset.advance64();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getBigUint64(offset.get(), true);
						offset.advance64();
					}
					break;
				case KnownStructTypeName.Float32:
				case KnownStructTypeName.Float:
					if (member.arraySize !== undefined) {
						const array: number[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getFloat32(offset.get(), true));
							offset.advance32();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getFloat32(offset.get(), true);
						offset.advance32();
					}
					break;
				case KnownStructTypeName.Float64:
				case KnownStructTypeName.Double:
					if (member.arraySize !== undefined) {
						const array: number[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(view.getFloat64(offset.get(), true));
							offset.advance64();
						}
						result[member.name] = array;
					} else {
						result[member.name] = view.getFloat64(offset.get(), true);
						offset.advance64();
					}
					break;
				case KnownStructTypeName.Character:
					if (member.arraySize !== undefined) {
						result[member.name] = StructRegistry.TEXT_DECODER.decode(
							payload.subarray(offset.get(), offset.advance(member.arraySize).get()),
						);
					} else {
						result[member.name] = StructRegistry.TEXT_DECODER.decode(
							payload.subarray(offset.get(), offset.advance8().get()),
						);
					}
					break;
				default: {
					if (member.arraySize !== undefined) {
						const array: StructPayload[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							const decoded = this.decodeInterpretedAt(member.value, payload, offset);
							if (typeof decoded === 'string') {
								return decoded;
							}
							array.push(decoded);
						}
						result[member.name] = array;
					} else {
						const decoded = this.decodeInterpretedAt(member.value, payload, offset);
						if (typeof decoded === 'string') {
							return decoded;
						}
						result[member.name] = decoded;
					}
				}
			}
		}
		offset.advance(bitFields.flush());

		return result;
	}

	private encodeInterpretedAt(
		structName: string,
		value: StructPayload,
		payload: Uint8Array,
		offset: ByteOffset,
	): void | string {
		if (!this.definitions.has(structName)) {
			return structName;
		}

		const specification = this.getDefinition(structName);
		const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
		const bitFields = new BitFieldTracker();

		for (const member of specification) {
			const fieldValue = readOwnField(value, member.name);
			const memberByteLength = this.calculateByteLength(member);
			const bitField = typeof memberByteLength === 'number' ? bitFields.next(member, memberByteLength) : undefined;
			if (bitField) {
				offset.advance(bitField.bytesToAdvance);
				encodeBitField(view, offset.get(), member, bitField, toBitFieldValue(member, fieldValue));
				continue;
			}

			offset.advance(bitFields.flush());

			switch (member.value) {
				case KnownStructTypeName.Boolean:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setUint8(offset.get(), expectBoolean(array[i], member.name, i) ? 1 : 0);
							offset.advance8();
						}
					} else {
						view.setUint8(offset.get(), expectBoolean(fieldValue, member.name) ? 1 : 0);
						offset.advance8();
					}
					break;
				case KnownStructTypeName.Int8:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setInt8(offset.get(), expectNumber(array[i], member.name, i));
							offset.advance8();
						}
					} else {
						view.setInt8(offset.get(), expectNumber(fieldValue, member.name));
						offset.advance8();
					}
					break;
				case KnownStructTypeName.Int16:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setInt16(offset.get(), expectNumber(array[i], member.name, i), true);
							offset.advance16();
						}
					} else {
						view.setInt16(offset.get(), expectNumber(fieldValue, member.name), true);
						offset.advance16();
					}
					break;
				case KnownStructTypeName.Int32:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setInt32(offset.get(), expectNumber(array[i], member.name, i), true);
							offset.advance32();
						}
					} else {
						view.setInt32(offset.get(), expectNumber(fieldValue, member.name), true);
						offset.advance32();
					}
					break;
				case KnownStructTypeName.Int64:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setBigInt64(offset.get(), expectBigInt(array[i], member.name, i), true);
							offset.advance64();
						}
					} else {
						view.setBigInt64(offset.get(), expectBigInt(fieldValue, member.name), true);
						offset.advance64();
					}
					break;
				case KnownStructTypeName.Uint8:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setUint8(offset.get(), expectNumber(array[i], member.name, i));
							offset.advance8();
						}
					} else {
						view.setUint8(offset.get(), expectNumber(fieldValue, member.name));
						offset.advance8();
					}
					break;
				case KnownStructTypeName.Uint16:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setUint16(offset.get(), expectNumber(array[i], member.name, i), true);
							offset.advance16();
						}
					} else {
						view.setUint16(offset.get(), expectNumber(fieldValue, member.name), true);
						offset.advance16();
					}
					break;
				case KnownStructTypeName.Uint32:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setUint32(offset.get(), expectNumber(array[i], member.name, i), true);
							offset.advance32();
						}
					} else {
						view.setUint32(offset.get(), expectNumber(fieldValue, member.name), true);
						offset.advance32();
					}
					break;
				case KnownStructTypeName.Uint64:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setBigUint64(offset.get(), expectBigInt(array[i], member.name, i), true);
							offset.advance64();
						}
					} else {
						view.setBigUint64(offset.get(), expectBigInt(fieldValue, member.name), true);
						offset.advance64();
					}
					break;
				case KnownStructTypeName.Float32:
				case KnownStructTypeName.Float:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setFloat32(offset.get(), expectNumber(array[i], member.name, i), true);
							offset.advance32();
						}
					} else {
						view.setFloat32(offset.get(), expectNumber(fieldValue, member.name), true);
						offset.advance32();
					}
					break;
				case KnownStructTypeName.Float64:
				case KnownStructTypeName.Double:
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							view.setFloat64(offset.get(), expectNumber(array[i], member.name, i), true);
							offset.advance64();
						}
					} else {
						view.setFloat64(offset.get(), expectNumber(fieldValue, member.name), true);
						offset.advance64();
					}
					break;
				case KnownStructTypeName.Character: {
					const size = member.arraySize ?? 1;
					const text = expectString(fieldValue, member.name);
					const encoded = StructRegistry.TEXT_ENCODER.encode(text);
					const start = offset.get();
					const toWrite = Math.min(encoded.byteLength, size);
					payload.set(encoded.subarray(0, toWrite), start);
					offset.advance(size);
					break;
				}
				default: {
					if (member.arraySize !== undefined) {
						const array = expectArray(fieldValue, member.name, member.arraySize);
						for (let i = 0; i < member.arraySize; i++) {
							const element = expectStruct(array[i], member.name, i);
							const encoded = this.encodeInterpretedAt(member.value, element, payload, offset);
							if (typeof encoded === 'string') {
								return encoded;
							}
						}
					} else {
						const nested = expectStruct(fieldValue, member.name);
						const encoded = this.encodeInterpretedAt(member.value, nested, payload, offset);
						if (typeof encoded === 'string') {
							return encoded;
						}
					}
				}
			}
		}
		offset.advance(bitFields.flush());
	}

	/** Transitive dependencies, including the requested schema and primitive types. */
	getDependencies(name: string): ReadonlySet<string> {
		return this.graph.getDependencies(name);
	}

	/** All missing schemas needed to decode this type. */
	getMissingDependencies(name: string): ReadonlySet<string> {
		return new Set(
			[...this.graph.getDependencies(name)].filter(
				(dependency) =>
					!this.definitions.has(dependency) && !Object.values<string>(KnownStructTypeName).includes(dependency),
			),
		);
	}

	/** Registered struct names whose dependencies are all available. */
	getDecodableStructs(): string[] {
		return this.graph.getDecodableStructs().filter((name) => this.definitions.has(name));
	}

	/** Byte length, or the name of the first missing schema. */
	getByteLength(name: string): number | string {
		if (!this.definitions.has(name)) return name;
		const existing = this.byteLengths.get(name);

		if (existing !== undefined) {
			return existing;
		}

		const definition = this.getDefinition(name);

		let totalByteLength = 0;
		const bitFields = new BitFieldTracker();

		for (const member of definition) {
			const memberByteLengthOrBlocker = this.calculateByteLength(member);

			if (typeof memberByteLengthOrBlocker === 'string') {
				return memberByteLengthOrBlocker;
			}

			const bitField = bitFields.next(member, memberByteLengthOrBlocker);
			if (bitField) {
				totalByteLength += bitField.bytesToAdvance;
				continue;
			}

			totalByteLength += bitFields.flush() + memberByteLengthOrBlocker;
		}
		totalByteLength += bitFields.flush();

		this.byteLengths.set(name, totalByteLength);
		return totalByteLength;
	}

	private calculateByteLength(member: StructDeclaration): number | string {
		let byteLengthForOne = 0;
		switch (member.value) {
			case KnownStructTypeName.Boolean:
			case KnownStructTypeName.Character:
			case KnownStructTypeName.Int8:
			case KnownStructTypeName.Uint8:
				byteLengthForOne = 1;
				break;
			case KnownStructTypeName.Int16:
			case KnownStructTypeName.Uint16:
				byteLengthForOne = 2;
				break;
			case KnownStructTypeName.Int32:
			case KnownStructTypeName.Uint32:
				byteLengthForOne = 4;
				break;
			case KnownStructTypeName.Int64:
			case KnownStructTypeName.Uint64:
				byteLengthForOne = 8;
				break;
			case KnownStructTypeName.Float32:
			case KnownStructTypeName.Float:
				byteLengthForOne = 4;
				break;
			case KnownStructTypeName.Float64:
			case KnownStructTypeName.Double:
				byteLengthForOne = 8;
				break;
			default: {
				const structByteLengthOrName = this.getByteLength(member.value);
				if (typeof structByteLengthOrName === 'string') {
					return structByteLengthOrName;
				}
				byteLengthForOne = structByteLengthOrName;
				break;
			}
		}

		if (member.arraySize !== undefined) {
			return member.arraySize * byteLengthForOne;
		}

		return byteLengthForOne;
	}
}

function readOwnField(value: StructPayload, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, name);
	if (!descriptor || descriptor.value === undefined) {
		throw new TypeError(`Missing required field '${name}'`);
	}
	return descriptor.value;
}

function fieldLabel(name: string, index?: number): string {
	return index === undefined ? `'${name}'` : `'${name}[${index}]'`;
}

function expectArray(value: unknown, name: string, length: number): unknown[] {
	if (!Array.isArray(value)) {
		throw new TypeError(`Expected field '${name}' to be an array`);
	}
	if (value.length !== length) {
		throw new RangeError(`Expected field '${name}' to have length ${length}, got ${value.length}`);
	}
	return value;
}

function expectBoolean(value: unknown, name: string, index?: number): boolean {
	if (typeof value !== 'boolean') {
		throw new TypeError(`Expected field ${fieldLabel(name, index)} to be a boolean`);
	}
	return value;
}

function expectNumber(value: unknown, name: string, index?: number): number {
	if (typeof value !== 'number') {
		throw new TypeError(`Expected field ${fieldLabel(name, index)} to be a number`);
	}
	return value;
}

function expectBigInt(value: unknown, name: string, index?: number): bigint {
	if (typeof value === 'bigint') return value;
	if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
	throw new TypeError(`Expected field ${fieldLabel(name, index)} to be a bigint or safe integer`);
}

function expectString(value: unknown, name: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`Expected field '${name}' to be a string`);
	}
	return value;
}

function expectStruct(value: unknown, name: string, index?: number): StructPayload {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Expected field ${fieldLabel(name, index)} to be a struct object`);
	}
	return value as StructPayload;
}

function toBitFieldValue(member: StructDeclaration, value: unknown): number | bigint | boolean {
	if (member.value === KnownStructTypeName.Boolean) {
		return expectBoolean(value, member.name);
	}
	if (member.value === KnownStructTypeName.Int64 || member.value === KnownStructTypeName.Uint64) {
		return expectBigInt(value, member.name);
	}
	if (typeof value === 'bigint') return value;
	return expectNumber(value, member.name);
}
