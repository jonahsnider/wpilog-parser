import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import { LOG_FIXTURES } from '../helpers/log-fixtures.ts';

const runNode = promisify(execFile);

test.for(LOG_FIXTURES)('$name decodes identically when V8 forbids string code generation', async ({ filePath }) => {
	const parserUrl = new URL('../../src/index.ts', import.meta.url).href;
	// Hash streamed records to compare every value, including Maps and bigint,
	// without retaining a whole decoded log in memory.
	const source = `
		import { readFileSync } from 'node:fs';
		import { createHash } from 'node:crypto';
		import { serialize } from 'node:v8';
		import { parseDataLog, RecordType } from ${JSON.stringify(parserUrl)};
		const hash = createHash('sha256');
		let structs = 0;
		for (const record of parseDataLog(readFileSync(${JSON.stringify(filePath)}))) {
			hash.update(serialize(record));
			if (record.type === RecordType.Struct || record.type === RecordType.StructArray) structs++;
		}
		console.log(JSON.stringify({ digest: hash.digest('hex'), structs }));
	`;
	const compiled = await runNode(process.execPath, ['--input-type=module', '--eval', source]);
	const restricted = await runNode(process.execPath, [
		'--disallow-code-generation-from-strings',
		'--input-type=module',
		'--eval',
		source,
	]);
	const result = JSON.parse(compiled.stdout) as { digest: string; structs: number };
	// Ensure the comparison actually exercises struct payloads.
	expect(result.structs).toBeGreaterThan(0);
	expect(restricted.stdout).toBe(compiled.stdout);
});
