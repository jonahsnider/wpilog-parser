import { CstParser, type ParserMethod } from 'chevrotain';
import type { StructSpecificationCstNode } from './generated.js';
import * as Tokens from './lexer.ts';

export class StructParser extends CstParser {
	// @ts-expect-error This is safe
	public readonly structSpecification: ParserMethod<[], StructSpecificationCstNode> = this.RULE(
		'structSpecification',
		() => {
			this.MANY_SEP({
				SEP: Tokens.Semicolon,
				DEF: () => this.OPTION(() => this.SUBRULE(this.declaration)),
			});
		},
	);

	private readonly declaration = this.RULE('declaration', () => {
		this.OPTION(() => this.SUBRULE(this.enumSpecification));

		this.SUBRULE(this.optionalWhitespace);

		this.CONSUME(Tokens.Identifier);

		this.SUBRULE1(this.optionalWhitespace);

		this.CONSUME1(Tokens.Identifier);

		this.OPTION1(() =>
			this.OR({
				DEF: [
					{ ALT: () => this.SUBRULE(this.bitFieldDeclaration) },
					{ ALT: () => this.SUBRULE(this.standardDeclarationArray) },
				],
			}),
		);
	});

	private readonly standardDeclarationArray = this.RULE('standardDeclarationArray', () => {
		this.SUBRULE(this.optionalWhitespace);

		this.SUBRULE(this.arraySize);
	});

	private readonly bitFieldDeclaration = this.RULE('bitFieldDeclaration', () => {
		this.SUBRULE(this.optionalWhitespace);
		this.CONSUME(Tokens.Colon);
		this.SUBRULE1(this.optionalWhitespace);
		this.CONSUME(Tokens.Integer);
	});

	private readonly arraySize = this.RULE('arraySize', () => {
		this.CONSUME(Tokens.LeftSquareBrace);
		this.SUBRULE(this.optionalWhitespace);
		this.CONSUME(Tokens.Integer);
		this.SUBRULE1(this.optionalWhitespace);
		this.CONSUME(Tokens.RightSquareBrace);
	});

	private readonly enumSpecification = this.RULE('enumSpecification', () => {
		this.OPTION(() => this.CONSUME(Tokens.EnumKeyword));
		this.SUBRULE(this.optionalWhitespace);
		this.CONSUME(Tokens.LeftCurlyBrace);
		this.MANY_SEP({ SEP: Tokens.Comma, DEF: () => this.SUBRULE(this.enumMember) });
		this.SUBRULE1(this.optionalWhitespace);
		this.CONSUME(Tokens.RightCurlyBrace);
	});

	private readonly enumMember = this.RULE('enumMember', () => {
		this.SUBRULE(this.optionalWhitespace);
		this.CONSUME(Tokens.Identifier);
		this.SUBRULE1(this.optionalWhitespace);
		this.CONSUME(Tokens.Equals);
		this.SUBRULE2(this.optionalWhitespace);
		this.CONSUME(Tokens.Integer);
		this.SUBRULE3(this.optionalWhitespace);
	});

	private readonly optionalWhitespace = this.RULE('optionalWhitespace', () => {
		this.OPTION(() => this.CONSUME(Tokens.WhiteSpace));
	});

	constructor() {
		super(Tokens.allTokens);

		this.performSelfAnalysis();
	}
}

export const parser = new StructParser();
