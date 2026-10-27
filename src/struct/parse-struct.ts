import { parseStruct } from './parser.ts';
import type { StructDeclaration } from './types.ts';

const cache = new Map<string, StructDeclaration[]>();

/** Parse a WPILib struct specification string into declarations. */
export function parseStructSpecification(declaration: string): StructDeclaration[] {
	const existing = cache.get(declaration);
	if (existing) return existing;
	const created = parseStruct(declaration);
	cache.set(declaration, created);
	return created;
}
