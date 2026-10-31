import { diagnostics } from './errors.ts';
import type { StructDeclaration } from './types.ts';
import { validateDeclarations } from './validate-declarations.ts';

// Scan complete identifiers and decimal integers, skipping whitespace.
const tokenPattern = /\s*([a-zA-Z_]\w*|\d+|[;,=:[\]{}])?/y;
const identifierStartPattern = /^[a-zA-Z_]/;
const integerStartPattern = /^\d/;

/** Parse a WPILib struct schema into field declarations. */
export function parseStruct(source: string): StructDeclaration[] {
	return validateDeclarations(new SchemaParser(source).parse());
}

class SchemaParser {
	private readonly source: string;
	private offset = 0;
	private token = '';
	private tokenOffset = 0;

	constructor(source: string) {
		this.source = source;
	}

	parse(): StructDeclaration[] {
		const declarations: StructDeclaration[] = [];
		this.advance();
		while (this.token) {
			if (this.at(';')) {
				this.advance();
				continue;
			}
			declarations.push(this.readDeclaration());
			if (this.token) this.consume(';');
		}
		return declarations;
	}

	private readDeclaration(): StructDeclaration {
		const enumSpecification = this.at('enum') || this.at('{') ? this.readEnum() : undefined;
		const value = this.readIdentifier();
		const name = this.readIdentifier();
		let arraySize: number | undefined;
		let bitWidth: number | undefined;
		if (this.at('[')) {
			this.advance();
			arraySize = Number(this.readInteger());
			this.consume(']');
		} else if (this.at(':')) {
			this.advance();
			bitWidth = Number(this.readInteger());
		}
		return { name, value, enumSpecification, arraySize, bitWidth };
	}

	private readEnum(): Map<string, bigint> {
		if (this.at('enum')) this.advance();
		this.consume('{');
		const members = new Map<string, bigint>();
		if (!this.at('}')) {
			while (true) {
				const name = this.readIdentifier();
				this.consume('=');
				members.set(name, BigInt(this.readInteger()));
				if (!this.at(',')) break;
				this.advance();
			}
		}
		this.consume('}');
		return members;
	}

	private readIdentifier(): string {
		if (!identifierStartPattern.test(this.token)) this.fail('identifier');
		const value = this.token;
		this.advance();
		return value;
	}

	private readInteger(): string {
		if (!integerStartPattern.test(this.token)) this.fail('integer');
		const value = this.token;
		this.advance();
		return value;
	}

	private at(expected: string): boolean {
		return this.token === expected;
	}

	private consume(expected: string): void {
		if (!this.at(expected)) this.fail(JSON.stringify(expected));
		this.advance();
	}

	private advance(): void {
		tokenPattern.lastIndex = this.offset;
		this.token = tokenPattern.exec(this.source)![1] ?? '';
		this.offset = tokenPattern.lastIndex;
		this.tokenOffset = this.offset - this.token.length;
		if (!this.token && this.offset < this.source.length) {
			throw diagnostics.STRUCT_R0007({
				cause: new AggregateError([new SyntaxError(`Invalid character at offset ${this.offset}`)]),
			});
		}
	}

	private fail(expected: string): never {
		throw diagnostics.STRUCT_R0008({
			cause: new AggregateError([new SyntaxError(`Expected ${expected} at offset ${this.tokenOffset}`)]),
		});
	}
}
