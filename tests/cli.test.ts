import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, test } from 'vite-plus/test';
import packageJson from '../package.json' with { type: 'json' };
import { formatCatalog, selectCatalogFormat } from '../src/cli/catalog.ts';

const ENTRIES = [
	{ entryId: 1, name: '/Robot/Pose', type: 'struct:Pose2d', metadata: '' },
	{ entryId: 12, name: '/DS:enabled', type: 'boolean', metadata: '{"source":"DS"}' },
];

const runNode = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

describe('CLI', () => {
	test.for([[], ['--help'], ['catalog', '--help'], ['complete', '--help']])(
		'shows help for %j without running the command',
		async (args, { expect }) => {
			const { stdout, stderr } = await runNode(process.execPath, [CLI_PATH, ...args]);
			expect(stdout).toMatch(/Usage:\n\s+wpilog/);
			expect(stderr).toBe('');
		},
	);

	test.for(['--version', '-v'])('prints the version for %s', async (flag, { expect }) => {
		const { stdout, stderr } = await runNode(process.execPath, [CLI_PATH, flag]);
		expect(stdout.trim()).toBe(packageJson.version);
		expect(stderr).toBe('');
	});

	test('passes the file and output flags to catalog', async ({ expect }) => {
		const file = fileURLToPath(new URL('./fixtures/logs/WPILIB_TBD_aba74b981a582b4b.wpilog', import.meta.url));
		const { stdout, stderr } = await runNode(process.execPath, [CLI_PATH, 'catalog', file, '--json']);
		expect(JSON.parse(stdout)).toContainEqual({ entryId: 1, name: '/messages', type: 'string', metadata: '' });
		expect(stderr).toBe('');
	});

	test.for([
		{ args: ['unknown'], message: "Unknown command: 'unknown'" },
		{ args: ['catalog'], message: 'missing following required options: file' },
		{ args: ['catalog', 'missing.wpilog', '--unknown'], message: 'Unrecognized options' },
		{ args: ['catalog', 'missing.wpilog', 'extra.wpilog'], message: 'Unrecognized options' },
		{ args: ['catalog', 'missing.wpilog', '--json=invalid'], message: 'Allowed values: true, false, 0, 1' },
		{ args: ['complete', 'unsupported'], message: 'zsh, bash, fish, powershell' },
		{ args: ['catalog', 'missing.wpilog', '--json', '--csv'], message: 'WPILOG_C0002' },
		{ args: ['catalog', 'missing.wpilog'], message: 'WPILOG_C0003' },
	])('reports command errors for $args without stack traces', async ({ args, message }, { expect }) => {
		const result = runNode(process.execPath, [CLI_PATH, ...args]);
		await expect(result).rejects.toMatchObject({
			code: 1,
			stdout: '',
			stderr: expect.stringContaining(message),
		});
		await expect(result).rejects.toMatchObject({ stderr: expect.not.stringMatching(/^\s+at /m) });
	});

	test('formats WPILOG parser diagnostics with the input path and suggested fix', async ({ expect }) => {
		const directory = await mkdtemp(join(tmpdir(), 'wpilog-cli-'));
		const filePath = join(directory, 'invalid.wpilog');
		try {
			await writeFile(filePath, new Uint8Array());
			const result = runNode(process.execPath, [CLI_PATH, 'catalog', filePath]);
			await expect(result).rejects.toMatchObject({
				code: 1,
				stdout: '',
				stderr: expect.stringContaining('[WPILOG_R0002]'),
			});
			await expect(result).rejects.toMatchObject({ stderr: expect.stringContaining(filePath) });
			await expect(result).rejects.toMatchObject({
				stderr: expect.stringContaining('Provide a complete WPILOG file.'),
			});
			await expect(result).rejects.toMatchObject({ stderr: expect.not.stringMatching(/^\s+at /m) });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe('shell completions', () => {
	test.for(['zsh', 'bash', 'fish', 'powershell'])('generates a %s completion script', async (shell, { expect }) => {
		const { stdout, stderr } = await runNode(process.execPath, [CLI_PATH, 'complete', shell]);
		expect(stdout).toMatch(/wpilog complete '?--'?/);
		expect(stderr).toBe('');
	});

	test('completes command names', async ({ expect }) => {
		const { stdout, stderr } = await runNode(process.execPath, [CLI_PATH, 'complete', '--', 'cat']);
		expect(stdout).toMatch(/^catalog\t/m);
		expect(stderr).toBe('');
	});

	test('handles completion requests without running catalog or reporting an unknown command', async ({ expect }) => {
		const { stdout, stderr } = await runNode(process.execPath, [
			CLI_PATH,
			'complete',
			'--',
			'catalog',
			'missing.wpilog',
			'--',
		]);

		expect(stdout).toMatch(/^--json\t/m);
		expect(stdout.endsWith(':4\n')).toBe(true);
		expect(stderr).toBe('');
	});
});

describe('formatCatalog', () => {
	test('uses TOON by default', ({ expect }) => {
		expect(formatCatalog(ENTRIES)).toBe(
			[
				'[2]{entryId,name,type,metadata}:',
				'  1,/Robot/Pose,"struct:Pose2d",""',
				'  12,"/DS:enabled",boolean,"{\\"source\\":\\"DS\\"}"',
			].join('\n'),
		);
	});

	test('formats JSON', ({ expect }) => {
		expect(formatCatalog(ENTRIES, 'json')).toBe(JSON.stringify(ENTRIES, null, 2));
	});

	test.for(['jsonl', 'ndjson'] as const)('formats %s', (format, { expect }) => {
		expect(formatCatalog(ENTRIES, format)).toBe(ENTRIES.map((entry) => JSON.stringify(entry)).join('\n'));
	});

	test('formats CSV and escapes special characters', ({ expect }) => {
		expect(
			formatCatalog([{ entryId: 1, name: '/quoted,"name"', type: 'string', metadata: 'line 1\nline 2' }], 'csv'),
		).toBe('entryId,name,type,metadata\n1,"/quoted,""name""",string,"line 1\nline 2"');
	});

	test('formats an empty catalog', ({ expect }) => {
		expect(formatCatalog([], 'jsonl')).toBe('');
		expect(formatCatalog([], 'csv')).toBe('entryId,name,type,metadata');
	});
});

describe('selectCatalogFormat', () => {
	test('uses TOON when no output flag is present', ({ expect }) => {
		expect(selectCatalogFormat({})).toBe('toon');
	});

	test('selects explicit output formats', ({ expect }) => {
		expect(selectCatalogFormat({ json: true })).toBe('json');
		expect(selectCatalogFormat({ jsonl: true, ndjson: true })).toBe('jsonl');
		expect(selectCatalogFormat({ csv: true })).toBe('csv');
	});

	test('rejects conflicting output flags', ({ expect }) => {
		expect(() => selectCatalogFormat({ json: true, csv: true })).toThrow('Output flags cannot be combined');
	});
});
