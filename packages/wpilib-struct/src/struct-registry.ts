import { diagnostics } from './errors.ts';
import type { StructPayload } from './types.ts';
import { BitFieldTracker } from './bit-field.ts';
import { compileStructClosures } from './compile-struct-closures.ts';
import { allowsCodeGeneration, compileStruct, type CompiledStructDecoder } from './compile-struct.ts';
import { compileStructEncoderClosures } from './compile-struct-encoder-closures.ts';
import { compileStructEncoder } from './compile-struct-encoder.ts';
import { parseStructSpecification } from './parse-struct.ts';
import { StructDependencyGraph } from './struct-dependency-graph.ts';
import type { CompiledStructEncoder } from './struct-encoding.ts';
import { KnownStructTypeName, type StructDeclaration, type StructSpecification } from './types.ts';

/** Options for runtime code generation. */
export type StructRegistryOptions = {
	/** Use `new Function` when available. Defaults to `true`; `false` uses CSP-safe closures. */
	codeGeneration?: boolean;
};

/** Reusable schemas, dependency resolution, layout sizes, decoders, and encoders. */
export class StructRegistry {
	private readonly definitions = new Map<string, StructSpecification>();
	private readonly byteLengths = new Map<string, number>();
	private readonly decoders = new Map<string, CompiledStructDecoder>();
	private readonly encoders = new Map<string, CompiledStructEncoder>();
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
			this.encoders.clear();
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
		const decoder = this.getDecoder(structName);
		const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

		const result: StructPayload[] = [];

		for (let i = 0; i < elements; i++) {
			result.push(decoder(view, payload, i * structByteLengthOrBlocker));
		}

		return result;
	}

	/** Decode one struct at a byte offset. Trailing bytes are allowed; truncated payloads are not. */
	decode(structName: string, payload: Uint8Array, offset = 0): StructPayload | string {
		const byteLength = this.getByteLength(structName);
		if (typeof byteLength === 'string') return byteLength;
		this.validatePayload(payload, offset, byteLength);
		const decoder = this.getDecoder(structName);

		const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
		return decoder(view, payload, offset);
	}

	/**
	 * Encode one struct into new bytes. Missing schemas are returned by name.
	 * Integer fields accept a `number` or `bigint`; `char` fields accept a string that fits as UTF-8 and are zero-padded.
	 */
	encode(structName: string, value: StructPayload): Uint8Array | string {
		const byteLength = this.getByteLength(structName);
		if (typeof byteLength === 'string') return byteLength;
		const bytes = new Uint8Array(byteLength);
		this.getEncoder(structName)(new DataView(bytes.buffer), bytes, 0, value);
		return bytes;
	}

	/** Encode an array using its base type name. Missing schemas are returned by name. */
	encodeArray(structName: string, values: readonly StructPayload[]): Uint8Array | string {
		const byteLength = this.getByteLength(structName);
		if (typeof byteLength === 'string') return byteLength;
		if (byteLength === 0 && values.length > 0) {
			throw new RangeError('Cannot encode an array of zero-length structs');
		}
		const bytes = new Uint8Array(byteLength * values.length);
		const view = new DataView(bytes.buffer);
		const encoder = this.getEncoder(structName);
		for (let i = 0; i < values.length; i++) encoder(view, bytes, i * byteLength, values[i]);
		return bytes;
	}

	/**
	 * Encode one struct into existing bytes at a byte offset, returning the number of bytes written.
	 * Missing schemas are returned by name. Bytes outside the struct are left unchanged.
	 * If encoding throws, the struct's bytes in the target may be partially written.
	 */
	encodeInto(structName: string, value: StructPayload, target: Uint8Array, offset = 0): number | string {
		const byteLength = this.getByteLength(structName);
		if (typeof byteLength === 'string') return byteLength;
		this.validatePayload(target, offset, byteLength);
		const encoder = this.getEncoder(structName);

		// Unused char bytes must be zero, whatever the target held before.
		target.fill(0, offset, offset + byteLength);
		encoder(new DataView(target.buffer, target.byteOffset, target.byteLength), target, offset, value);
		return byteLength;
	}

	private getEncoder(name: string): CompiledStructEncoder {
		return this.compile(this.encoders, name, compileStructEncoder, compileStructEncoderClosures);
	}

	private getDecoder(name: string): CompiledStructDecoder {
		return this.compile(this.decoders, name, compileStruct, compileStructClosures);
	}

	private compile<T>(
		cache: Map<string, T>,
		name: string,
		generate: (registry: StructRegistry, name: string) => T,
		closures: (registry: StructRegistry, name: string) => T,
	): T {
		const existing = cache.get(name);
		if (existing) return existing;

		this.codeGenerationAllowed ??= allowsCodeGeneration();
		let compiled: T | undefined;
		if (this.codeGenerationAllowed) {
			try {
				compiled = generate(this, name);
			} catch (error) {
				// Also handle a policy change between the probe and compilation.
				if (!(error instanceof EvalError)) throw error;
				this.codeGenerationAllowed = false;
			}
		}

		compiled ??= closures(this, name);
		cache.set(name, compiled);
		return compiled;
	}

	private validatePayload(payload: Uint8Array, offset: number, byteLength: number): void {
		if (!Number.isSafeInteger(offset) || offset < 0 || offset + byteLength > payload.byteLength) {
			throw new RangeError('Struct payload is truncated or its byte offset is invalid');
		}
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
