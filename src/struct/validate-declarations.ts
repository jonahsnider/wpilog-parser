import { diagnostics } from '../diagnostics.ts';
import { KnownStructTypeName, type StructDeclaration } from './types.ts';

export function validateDeclarations(declarations: StructDeclaration[]): StructDeclaration[] {
	// Check field types and widths after the complete schema has parsed.
	for (const declaration of declarations) {
		const { value, enumSpecification, bitWidth } = declaration;
		if (enumSpecification) {
			switch (value) {
				case KnownStructTypeName.Int8:
				case KnownStructTypeName.Uint8:
				case KnownStructTypeName.Int16:
				case KnownStructTypeName.Uint16:
				case KnownStructTypeName.Int32:
				case KnownStructTypeName.Uint32:
				case KnownStructTypeName.Int64:
				case KnownStructTypeName.Uint64:
					break;
				default:
					throw diagnostics.WPILOG_R0009();
			}
		}
		if (bitWidth !== undefined) validateBitWidth(value, bitWidth);
	}
	return declarations;
}

function validateBitWidth(value: string, parsed: number): void {
	switch (value) {
		case KnownStructTypeName.Boolean:
			if (parsed !== 1) throw diagnostics.WPILOG_R0010({ type: value, width: parsed, maxBits: 1 });
			break;
		case KnownStructTypeName.Int8:
		case KnownStructTypeName.Uint8:
			if (parsed > 8) throw diagnostics.WPILOG_R0010({ type: value, width: parsed, maxBits: 8 });
			break;
		case KnownStructTypeName.Int16:
		case KnownStructTypeName.Uint16:
			if (parsed > 16) throw diagnostics.WPILOG_R0010({ type: value, width: parsed, maxBits: 16 });
			break;
		case KnownStructTypeName.Int32:
		case KnownStructTypeName.Uint32:
			if (parsed > 32) throw diagnostics.WPILOG_R0010({ type: value, width: parsed, maxBits: 32 });
			break;
		case KnownStructTypeName.Int64:
		case KnownStructTypeName.Uint64:
			if (parsed > 64) throw diagnostics.WPILOG_R0010({ type: value, width: parsed, maxBits: 64 });
			break;
		default:
			throw diagnostics.WPILOG_R0011();
	}
}
