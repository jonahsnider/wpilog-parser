import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Diagnostic } from 'nostics';
import { expect, test } from 'vite-plus/test';
import { catalogFile, selectCatalogFormat } from '../src/cli/catalog.js';
import { parseDataLog } from '../src/decode-records.js';
import { parseStructSpecification } from '../src/struct/parse-struct.js';

test('parser errors have a stable code and actionable fix', () => {
	try {
		Array.from(parseDataLog(new Uint8Array(0)));
	} catch (error) {
		expect(error).toBeInstanceOf(Diagnostic);
		expect(error).toMatchObject({
			name: 'WPILOG_R0002',
			message: 'Not a WPILOG file (truncated header)',
			fix: 'Provide a complete WPILOG file.',
		});
		return;
	}
	throw new Error('Expected a parser diagnostic');
});

test('struct syntax diagnostics retain the parser errors as their cause', () => {
	try {
		parseStructSpecification('int32');
	} catch (error) {
		expect(error).toBeInstanceOf(Diagnostic);
		expect(error).toMatchObject({ name: 'WPILOG_R0008', cause: expect.any(AggregateError) });
		return;
	}
	throw new Error('Expected a struct syntax diagnostic');
});

test('CLI diagnostics retain file system errors as their cause', async () => {
	await expect(catalogFile('/nonexistent/wpilog-file.wpilog')).rejects.toMatchObject({
		name: 'WPILOG_C0003',
		cause: { code: 'ENOENT' },
	});
	expect(() => selectCatalogFormat({ json: true, csv: true })).toThrowError('Output flags cannot be combined');
});

test('CLI parser diagnostics point to the input file', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'wpilog-parser-'));
	const filePath = join(directory, 'invalid.wpilog');
	try {
		await writeFile(filePath, new Uint8Array());
		await expect(catalogFile(filePath)).rejects.toMatchObject({
			name: 'WPILOG_R0002',
			sources: [filePath],
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
