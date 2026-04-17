import type { StructPayload } from '../types.js';
import { parseStructSpecification } from './parse-struct.js';
import type { StructDecodeQueue } from './struct-decode-queue.js';
import { KnownStructTypeName, type StructDeclaration, type StructSpecification } from './types.js';

const STRUCT_ARRAY_SUFFIX = '[]';

type DecodeState = { offset: number };

export class StructRegistry {
	private static readonly TEXT_DECODER = new TextDecoder('utf-8');
	private readonly definitions = new Map<string, StructSpecification>();
	private readonly byteLengths = new Map<string, number>();
	private cachedView: DataView | undefined;
	private cachedBuffer: ArrayBufferLike | undefined;

	constructor(private readonly structDecodeQueue: StructDecodeQueue) {}

	private getView(payload: Uint8Array): DataView {
		if (this.cachedBuffer !== payload.buffer) {
			this.cachedView = new DataView(payload.buffer);
			this.cachedBuffer = payload.buffer;
		}
		return this.cachedView as DataView;
	}

	register(name: string, definition: string): void {
		const specification = parseStructSpecification(definition);

		this.definitions.set(name, specification);
		this.structDecodeQueue.registerSchema(
			name,
			specification.map((member) => member.value),
		);
	}

	getDefinition(name: string): StructSpecification {
		const definition = this.definitions.get(name);

		if (!definition) {
			throw new RangeError(`Unknown struct definition: ${name}`);
		}

		return definition;
	}

	decodeArray(structName: string, payload: Uint8Array): StructPayload[] | string {
		const structNameWithoutSuffix = structName.slice(0, -STRUCT_ARRAY_SUFFIX.length);
		const structByteLengthOrBlocker = this.getByteLength(structNameWithoutSuffix);

		if (typeof structByteLengthOrBlocker === 'string') {
			return structByteLengthOrBlocker;
		}

		const elements = payload.byteLength / structByteLengthOrBlocker;
		const view = this.getView(payload);

		const result: StructPayload[] = new Array(elements);
		const state: DecodeState = { offset: payload.byteOffset };

		for (let i = 0; i < elements; i++) {
			const decoded = this.decodeInternal(structNameWithoutSuffix, payload, view, state);
			if (typeof decoded === 'string') {
				throw new TypeError(
					`Expected struct ${structNameWithoutSuffix} to be defined if the byte length calculation succeeded`,
				);
			}
			result[i] = decoded;
		}

		return result;
	}

	decode(structName: string, payload: Uint8Array): StructPayload | string {
		if (!this.definitions.has(structName)) {
			return structName;
		}

		const view = this.getView(payload);
		const state: DecodeState = { offset: payload.byteOffset };
		return this.decodeInternal(structName, payload, view, state);
	}

	private decodeInternal(
		structName: string,
		payload: Uint8Array,
		view: DataView,
		state: DecodeState,
	): StructPayload | string {
		if (!this.definitions.has(structName)) {
			return structName;
		}

		const specification = this.getDefinition(structName);
		const result: StructPayload = new Map();

		for (const member of specification) {
			if (member.bitWidth) {
				throw new Error('Bit-field members are not implemented');
			}

			const arraySize = member.arraySize;

			switch (member.value) {
				case KnownStructTypeName.Boolean:
					if (arraySize !== undefined) {
						const array: boolean[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = Boolean(view.getUint8(offset));
							offset += 1;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, Boolean(view.getUint8(state.offset)));
						state.offset += 1;
					}
					break;
				case KnownStructTypeName.Int8:
					if (arraySize !== undefined) {
						const array: number[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getInt8(offset);
							offset += 1;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getInt8(state.offset));
						state.offset += 1;
					}
					break;
				case KnownStructTypeName.Int16:
					if (arraySize !== undefined) {
						const array: number[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getInt16(offset, true);
							offset += 2;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getInt16(state.offset, true));
						state.offset += 2;
					}
					break;
				case KnownStructTypeName.Int32:
					if (arraySize !== undefined) {
						const array: number[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getInt32(offset, true);
							offset += 4;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getInt32(state.offset, true));
						state.offset += 4;
					}
					break;
				case KnownStructTypeName.Int64:
					if (arraySize !== undefined) {
						const array: bigint[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getBigInt64(offset, true);
							offset += 8;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getBigInt64(state.offset, true));
						state.offset += 8;
					}
					break;
				case KnownStructTypeName.Uint8:
					if (arraySize !== undefined) {
						const array: number[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getUint8(offset);
							offset += 1;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getUint8(state.offset));
						state.offset += 1;
					}
					break;
				case KnownStructTypeName.Uint16:
					if (arraySize !== undefined) {
						const array: number[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getUint16(offset, true);
							offset += 2;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getUint16(state.offset, true));
						state.offset += 2;
					}
					break;
				case KnownStructTypeName.Uint32:
					if (arraySize !== undefined) {
						const array: number[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getUint32(offset, true);
							offset += 4;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getUint32(state.offset, true));
						state.offset += 4;
					}
					break;
				case KnownStructTypeName.Uint64:
					if (arraySize !== undefined) {
						const array: bigint[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getBigUint64(offset, true);
							offset += 8;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getBigUint64(state.offset, true));
						state.offset += 8;
					}
					break;
				case KnownStructTypeName.Float32:
				case KnownStructTypeName.Float:
					if (arraySize !== undefined) {
						const array: number[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getFloat32(offset, true);
							offset += 4;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getFloat32(state.offset, true));
						state.offset += 4;
					}
					break;
				case KnownStructTypeName.Float64:
				case KnownStructTypeName.Double:
					if (arraySize !== undefined) {
						const array: number[] = new Array(arraySize);
						let offset = state.offset;
						for (let i = 0; i < arraySize; i++) {
							array[i] = view.getFloat64(offset, true);
							offset += 8;
						}
						state.offset = offset;
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getFloat64(state.offset, true));
						state.offset += 8;
					}
					break;
				case KnownStructTypeName.Character: {
					const len = arraySize ?? 1;
					const relStart = state.offset - payload.byteOffset;
					result.set(member.name, StructRegistry.TEXT_DECODER.decode(payload.subarray(relStart, relStart + len)));
					state.offset += len;
					break;
				}
				default: {
					if (arraySize !== undefined) {
						const array: StructPayload[] = new Array(arraySize);
						for (let i = 0; i < arraySize; i++) {
							const decoded = this.decodeInternal(member.value, payload, view, state);
							if (typeof decoded === 'string') {
								return decoded;
							}
							array[i] = decoded;
						}
						result.set(member.name, array);
					} else {
						const decoded = this.decodeInternal(member.value, payload, view, state);
						if (typeof decoded === 'string') {
							return decoded;
						}
						result.set(member.name, decoded);
					}
				}
			}
		}

		return result;
	}

	getByteLength(name: string): number | string {
		const existing = this.byteLengths.get(name);

		if (existing !== undefined) {
			return existing;
		}

		const definition = this.getDefinition(name);

		let totalByteLength = 0;

		for (const member of definition) {
			const memberByteLengthOrBlocker = this.calculateByteLength(member);

			if (typeof memberByteLengthOrBlocker === 'string') {
				return memberByteLengthOrBlocker;
			}

			totalByteLength += memberByteLengthOrBlocker;
		}

		this.byteLengths.set(name, totalByteLength);
		return totalByteLength;
	}

	private calculateByteLength(member: StructDeclaration): number | string {
		if (member.bitWidth) {
			throw new Error('Bit-field members are not implemented');
		}

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
