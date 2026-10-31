import { readFile } from 'node:fs/promises';
import { encode as encodeAsToon } from '@toon-format/toon';
import { Diagnostic } from 'nostics';
import { catalogEntries, type CatalogEntry } from '../catalog.ts';
import { diagnostics } from '../diagnostics.ts';
import { readRecords } from '../read-records.ts';

export type CatalogFormat = 'toon' | 'json' | 'jsonl' | 'ndjson' | 'csv';

export type CatalogOutputOptions = {
	json?: boolean;
	jsonl?: boolean;
	ndjson?: boolean;
	csv?: boolean;
};

export async function catalogFile(filePath: string): Promise<CatalogEntry[]> {
	let bytes: Buffer<ArrayBuffer>;
	try {
		bytes = await readFile(filePath);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			throw diagnostics.WPILOG_C0003({ filePath, cause: error });
		}

		throw error;
	}

	try {
		return Array.from(catalogEntries(readRecords(bytes)));
	} catch (error) {
		if (error instanceof Diagnostic) {
			error.sources = [filePath, ...(error.sources ?? [])];
		}
		throw error;
	}
}

export function selectCatalogFormat(options: CatalogOutputOptions): CatalogFormat {
	const selected = [options.json && 'json', (options.jsonl || options.ndjson) && 'jsonl', options.csv && 'csv'].filter(
		(format): format is CatalogFormat => Boolean(format),
	);
	if (selected.length > 1) {
		throw diagnostics.WPILOG_C0002();
	}
	return selected[0] ?? 'toon';
}

function escapeCsv(value: string | number): string {
	const text = String(value);
	if (/[",\r\n]/.test(text)) {
		return `"${text.replaceAll('"', '""')}"`;
	}
	return text;
}

/** Serialize catalog entries in the selected output format. */
export function formatCatalog(entries: CatalogEntry[], format: CatalogFormat = 'toon'): string {
	switch (format) {
		case 'toon':
			return encodeAsToon(entries);
		case 'json':
			return JSON.stringify(entries, null, 2);
		case 'jsonl':
		case 'ndjson':
			return entries.map((entry) => JSON.stringify(entry)).join('\n');
		case 'csv':
			return [
				'entryId,name,type,metadata',
				...entries.map((entry) =>
					[entry.entryId, entry.name, entry.type, entry.metadata].map((value) => escapeCsv(value)).join(','),
				),
			].join('\n');
	}
}
