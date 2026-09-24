import { ByteOffset } from '../byte-offset.ts';
import { diagnostics } from '../diagnostics.ts';
import type { StructPayload } from '../types.ts';
import { parseStructSpecification } from './parse-struct.ts';
import type { StructDecodeQueue } from './struct-decode-queue.ts';
import { KnownStructTypeName, type StructDeclaration, type StructSpecification } from './types.ts';

const STRUCT_ARRAY_SUFFIX = '[]';

export class StructRegistry {
	private static readonly TEXT_DECODER = new TextDecoder('utf-8');
	private readonly definitions = new Map<string, StructSpecification>();
	private readonly byteLengths = new Map<string, number>();

	constructor(private readonly structDecodeQueue: StructDecodeQueue) {}

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
			throw diagnostics.WPILOG_R0013({ name });
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
		const offset = new ByteOffset();

		const result: StructPayload[] = [];

		for (let i = 0; i < elements; i++) {
			const decoded = this.decode(structNameWithoutSuffix, payload, offset);
			if (typeof decoded === 'string') {
				throw new TypeError(
					`Expected struct ${structNameWithoutSuffix} to be defined if the byte length calculation succeeded`,
				);
			}
			result.push(decoded);
		}

		return result;
	}

	decode(structName: string, payload: Uint8Array, offset = new ByteOffset()): StructPayload | string {
		if (!this.definitions.has(structName)) {
			return structName;
		}

		const specification = this.getDefinition(structName);
		const result: StructPayload = new Map();

		const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

		for (const member of specification) {
			if (member.bitWidth) {
				throw diagnostics.WPILOG_R0014();
			}

			switch (member.value) {
				case KnownStructTypeName.Boolean:
					if (member.arraySize !== undefined) {
						const array: boolean[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							array.push(Boolean(view.getUint8(offset.get())));
							offset.advance8();
						}
						result.set(member.name, array);
					} else {
						result.set(member.name, Boolean(view.getUint8(offset.get())));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getInt8(offset.get()));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getInt16(offset.get(), true));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getInt32(offset.get(), true));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getBigInt64(offset.get(), true));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getUint8(offset.get()));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getUint16(offset.get(), true));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getUint32(offset.get(), true));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getBigUint64(offset.get(), true));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getFloat32(offset.get(), true));
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
						result.set(member.name, array);
					} else {
						result.set(member.name, view.getFloat64(offset.get(), true));
						offset.advance64();
					}
					break;
				case KnownStructTypeName.Character:
					if (member.arraySize !== undefined) {
						result.set(
							member.name,
							StructRegistry.TEXT_DECODER.decode(
								payload.subarray(offset.get(), offset.advance(member.arraySize).get()),
							),
						);
					} else {
						result.set(
							member.name,
							StructRegistry.TEXT_DECODER.decode(payload.subarray(offset.get(), offset.advance8().get())),
						);
					}
					break;
				default: {
					if (member.arraySize !== undefined) {
						const array: StructPayload[] = [];
						for (let i = 0; i < member.arraySize; i++) {
							const decoded = this.decode(member.value, payload, offset);
							if (typeof decoded === 'string') {
								return decoded;
							}
							array.push(decoded);
						}
						result.set(member.name, array);
					} else {
						const decoded = this.decode(member.value, payload, offset);
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
			throw diagnostics.WPILOG_R0014();
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
