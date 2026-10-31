import { ByteOffset } from './byte-offset.ts';
import { diagnostics } from './errors.ts';
import type { StructPayload } from './types.ts';
import { BitFieldTracker, decodeBitField } from './bit-field.ts';
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
