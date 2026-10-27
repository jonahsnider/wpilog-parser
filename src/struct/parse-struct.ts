import { diagnostics } from '../diagnostics.ts';
import { lexer } from './lexer.ts';
import { parser } from './parser.ts';
import type { StructDeclaration } from './types.ts';
import { StructAstVisitor } from './struct-ast-visitor.ts';

const structAstVisitor = new StructAstVisitor();

const cache = new Map<string, StructDeclaration[]>();

/** Parse a WPILib struct specification string into declarations. */
export function parseStructSpecification(declaration: string): StructDeclaration[] {
	const existing = cache.get(declaration);

	if (existing) {
		return existing;
	}

	const created = parseStruct(declaration);
	cache.set(declaration, created);
	return created;
}

/** Parse a WPILib struct specification without caching the result. */
export function parseStruct(declaration: string): StructDeclaration[] {
	const lexingResult = lexer.tokenize(declaration);

	if (lexingResult.errors.length > 0) {
		throw diagnostics.WPILOG_R0007({ cause: new AggregateError(lexingResult.errors) });
	}

	parser.input = lexingResult.tokens;

	const cstNode = parser.structSpecification();

	if (parser.errors.length > 0) {
		throw diagnostics.WPILOG_R0008({ cause: new AggregateError(parser.errors) });
	}

	return structAstVisitor.structSpecification(cstNode.children);
}
