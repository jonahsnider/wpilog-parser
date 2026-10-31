import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'vite-plus/test';
import { LOG_FIXTURES } from '../helpers/log-fixtures.ts';

const runNode = promisify(execFile);

test.for(LOG_FIXTURES)(
	'$name decodes identically when V8 forbids string code generation',
	async ({ filePath }, { expect }) => {
		const parserUrl = new URL('../../src/index.ts', import.meta.url).href;
		// Hash streamed values without retaining a whole decoded log in memory.
		// V8 serialization can encode equal numbers differently depending on object
		// layout. Tag bigint and special numbers to compare their values consistently.
		const source = `
		import { readFileSync } from 'node:fs';
		import { createHash } from 'node:crypto';
		import { parseDataLog, RecordType } from ${JSON.stringify(parserUrl)};
		const hash = createHash('sha256');
		let structs = 0;
		for (const record of parseDataLog(readFileSync(${JSON.stringify(filePath)}))) {
			hash.update(JSON.stringify(record, (_key, value) => {
				if (typeof value === 'bigint') return { $bigint: value.toString() };
				if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
					return { $number: Object.is(value, -0) ? '-0' : String(value) };
				}
				return value;
			}));
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
	},
);
