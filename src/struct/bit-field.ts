import { KnownStructTypeName, type StructDeclaration } from './types.ts';

export type BitFieldLayout = {
	bytesToAdvance: number;
	storageByteLength: number;
	bitShift: number;
	bitWidth: number;
};

export class BitFieldTracker {
	private storageByteLength = 0;
	private bitShift = 0;

	next(member: StructDeclaration, memberByteLength: number): BitFieldLayout | undefined {
		const bitWidth = member.bitWidth;
		if (bitWidth === undefined || bitWidth === 0 || bitWidth === memberByteLength * 8) {
			return undefined;
		}

		let bytesToAdvance = 0;
		let storageByteLength = memberByteLength;
		if (
			member.value === KnownStructTypeName.Boolean &&
			this.storageByteLength !== 0 &&
			this.bitShift + 1 <= this.storageByteLength * 8
		) {
			storageByteLength = this.storageByteLength;
		} else if (storageByteLength !== this.storageByteLength || this.bitShift + bitWidth > storageByteLength * 8) {
			bytesToAdvance = this.flush();
		}

		const layout = {
			bytesToAdvance,
			storageByteLength,
			bitShift: this.bitShift,
			bitWidth,
		};
		this.storageByteLength = storageByteLength;
		this.bitShift += bitWidth;
		return layout;
	}

	flush(): number {
		const bytesToAdvance = this.storageByteLength;
		this.storageByteLength = 0;
		this.bitShift = 0;
		return bytesToAdvance;
	}
}

export function decodeBitField(
	view: DataView,
	offset: number,
	member: StructDeclaration,
	layout: BitFieldLayout,
): number | bigint | boolean {
	let value = readUnsignedInteger(view, offset, layout.storageByteLength);
	value = (value >> BigInt(layout.bitShift)) & ((1n << BigInt(layout.bitWidth)) - 1n);

	if (member.value === KnownStructTypeName.Boolean) {
		return value !== 0n;
	}

	if (isSignedInteger(member.value) && (value & (1n << BigInt(layout.bitWidth - 1))) !== 0n) {
		value -= 1n << BigInt(layout.bitWidth);
	}

	return member.value === KnownStructTypeName.Int64 || member.value === KnownStructTypeName.Uint64
		? value
		: Number(value);
}

function readUnsignedInteger(view: DataView, offset: number, byteLength: number): bigint {
	switch (byteLength) {
		case 1:
			return BigInt(view.getUint8(offset));
		case 2:
			return BigInt(view.getUint16(offset, true));
		case 4:
			return BigInt(view.getUint32(offset, true));
		case 8:
			return view.getBigUint64(offset, true);
		default:
			throw new TypeError(`Invalid bit-field storage size: ${byteLength}`);
	}
}

function isSignedInteger(type: string): boolean {
	switch (type) {
		case KnownStructTypeName.Int8:
		case KnownStructTypeName.Int16:
		case KnownStructTypeName.Int32:
		case KnownStructTypeName.Int64:
			return true;
		default:
			return false;
	}
}
