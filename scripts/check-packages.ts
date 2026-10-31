import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'wpilib-packages-'));
const packages = ['wpilib-struct', 'wpilog-parser'] as const;
const run = (command: string, args: string[], cwd = root) =>
	execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

try {
	const dependencies: Record<string, string> = {};
	for (const name of packages) {
		const directory = join(root, 'packages', name);
		const { version } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { version: string };
		run('pnpm', ['--dir', directory, 'pack', '--pack-destination', temporary]);
		const archive = join(temporary, `${name}-${version}.tgz`);
		const manifest = run('tar', ['-xOf', archive, 'package/package.json']);
		assert(!manifest.includes('workspace:'), `${name} contains a workspace protocol`);
		assert(!manifest.includes('catalog:'), `${name} contains a catalog protocol`);
		const files = run('tar', ['-tf', archive]).split('\n');
		assert(files.includes('package/dist/index.mjs'));
		assert(files.includes('package/dist/index.d.mts'));
		assert(files.includes('package/dist/tsdoc-metadata.json'));
		assert(files.includes('package/README.md'));
		if (name === 'wpilog-parser') {
			assert(files.includes('package/dist/cli.mjs'));
			assert(files.includes('package/skills/analyze-wpilog/SKILL.md'));
		}
		dependencies[name] = `file:${archive}`;
	}

	writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }));
	// The shared package is not published yet. Resolve the consumer's semver
	// dependency to the same local archive, never to a workspace symlink.
	writeFileSync(
		join(temporary, 'pnpm-workspace.yaml'),
		`overrides:\n  wpilib-struct: ${JSON.stringify(dependencies['wpilib-struct'])}\n`,
	);
	run('pnpm', ['install', '--prefer-offline', '--ignore-scripts', '--no-frozen-lockfile'], temporary);
	writeFileSync(
		join(temporary, 'consumer.ts'),
		`
		import { StructRegistry, type StructPayload, type StructDeclaration } from 'wpilib-struct';
		import { parseDataLog, parseStructSpecification, type StructPayload as LogStructPayload } from 'wpilog-parser';
		const declarations: StructDeclaration[] = parseStructSpecification('uint8 value');
		const value: StructPayload | string = new StructRegistry().decode('Value', new Uint8Array());
		const payload: LogStructPayload = { value: 42n };
		const sharedPayload: StructPayload = payload;
		const records = parseDataLog(new Uint8Array());
		void [declarations, value, sharedPayload, records];
		`,
	);
	run(
		join(root, 'node_modules/.bin/tsgo'),
		[
			'--noEmit',
			'--strict',
			'--module',
			'NodeNext',
			'--moduleResolution',
			'NodeNext',
			'--target',
			'ESNext',
			'--skipLibCheck',
			'consumer.ts',
		],
		temporary,
	);
	run(
		process.execPath,
		[
			'--input-type=module',
			'--eval',
			`
			import assert from 'node:assert/strict';
			import { StructRegistry, StructError } from 'wpilib-struct';
			import { parseStructSpecification, parseDataLog } from 'wpilog-parser';
			for (const codeGeneration of [true, false]) {
				const registry = new StructRegistry({ codeGeneration });
				registry.register('Value', 'uint8 value');
				assert.deepEqual(registry.decodeArray('Value', new Uint8Array([1, 2])), [{ value: 1 }, { value: 2 }]);
			}
			assert.equal(parseStructSpecification('uint8 value')[0].name, 'value');
			assert.equal(typeof parseDataLog, 'function');
			assert.throws(() => parseStructSpecification('int32'), { code: 'WPILOG_R0008' });
			assert.equal(typeof StructError, 'function');
			`,
		],
		temporary,
	);
	const { version } = JSON.parse(readFileSync(join(root, 'packages/wpilog-parser/package.json'), 'utf8')) as {
		version: string;
	};
	assert.equal(run(resolve(temporary, 'node_modules/.bin/wpilog'), ['--version'], temporary).trim(), version);
	const catalog = run(
		resolve(temporary, 'node_modules/.bin/wpilog'),
		['catalog', join(root, 'packages/wpilog-parser/tests/fixtures/logs/WPILIB_TBD_aba74b981a582b4b.wpilog'), '--json'],
		temporary,
	);
	assert((JSON.parse(catalog) as { name: string }[]).some((entry) => entry.name === '/messages'));
	console.log('Both npm archives install and run outside the workspace; CLI, skills, types, and metadata are present.');
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
