import { diagnostics } from '../diagnostics.ts';
import type {
	ArraySizeCstChildren,
	BitFieldDeclarationCstChildren,
	DeclarationCstChildren,
	EnumMemberCstChildren,
	EnumSpecificationCstChildren,
	StandardDeclarationArrayCstChildren,
	StructSpecificationCstChildren,
} from './generated.js';
import { type EnumSpecification, KnownStructTypeName, type StructDeclaration, type StructTypeName } from './types.ts';
import { BaseStructVisitorWithDefaults } from './visitors.ts';

export class StructAstVisitor extends BaseStructVisitorWithDefaults {
	constructor() {
		super();

		this.validateVisitor();
	}

	structSpecification(children: StructSpecificationCstChildren): StructDeclaration[] {
		return children.declaration?.map((declaration) => this.declaration(declaration.children)) ?? [];
	}

	declaration(children: DeclarationCstChildren): StructDeclaration {
		const [typeName, name] = children.Identifier;

		const enumSpecification = children.enumSpecification
			? this.enumSpecification(children.enumSpecification[0]!.children, typeName!.image)
			: undefined;

		const arraySize = children.standardDeclarationArray
			? this.standardDeclarationArray(children.standardDeclarationArray[0]!.children)
			: undefined;

		const bitWidth = children.bitFieldDeclaration
			? this.bitFieldDeclaration(children.bitFieldDeclaration[0]!.children, typeName!.image)
			: undefined;

		return {
			name: name!.image,
			value: typeName!.image,
			enumSpecification,
			arraySize,
			bitWidth,
		};
	}

	enumSpecification(children: EnumSpecificationCstChildren, dataType: StructTypeName): EnumSpecification {
		switch (dataType) {
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

		const entries = children.enumMember?.map((member) => this.enumMember(member.children));

		return new Map(entries);
	}

	enumMember(children: EnumMemberCstChildren): [name: string, value: bigint] {
		const [name] = children.Identifier;
		const [value] = children.Integer;

		return [name!.image, BigInt(value!.image)];
	}

	bitFieldDeclaration(children: BitFieldDeclarationCstChildren, dataType: StructTypeName): number {
		const [value] = children.Integer;
		const parsed = Number(value!.image);

		switch (dataType) {
			case KnownStructTypeName.Boolean:
				if (parsed !== 1) throw diagnostics.WPILOG_R0010({ type: dataType, width: parsed, maxBits: 1 });
				break;
			case KnownStructTypeName.Int8:
			case KnownStructTypeName.Uint8:
				if (parsed > 8) throw diagnostics.WPILOG_R0010({ type: dataType, width: parsed, maxBits: 8 });
				break;
			case KnownStructTypeName.Int16:
			case KnownStructTypeName.Uint16:
				if (parsed > 16) throw diagnostics.WPILOG_R0010({ type: dataType, width: parsed, maxBits: 16 });
				break;
			case KnownStructTypeName.Int32:
			case KnownStructTypeName.Uint32:
				if (parsed > 32) throw diagnostics.WPILOG_R0010({ type: dataType, width: parsed, maxBits: 32 });
				break;
			case KnownStructTypeName.Int64:
			case KnownStructTypeName.Uint64:
				if (parsed > 64) throw diagnostics.WPILOG_R0010({ type: dataType, width: parsed, maxBits: 64 });
				break;
			default:
				throw diagnostics.WPILOG_R0011();
		}

		return parsed;
	}

	standardDeclarationArray(children: StandardDeclarationArrayCstChildren): number {
		return this.arraySize(children.arraySize[0]!.children);
	}

	arraySize(children: ArraySizeCstChildren): number {
		const [value] = children.Integer;

		return Number(value!.image);
	}
}
