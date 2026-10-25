#!/usr/bin/env node

import { RootCommand, script } from '@bomb.sh/tab';
import { boolean, command, commandsInfo, positional, run } from '@drizzle-team/brocli';
import { Diagnostic, formatDiagnostic } from 'nostics';
import oscStatus from 'osc-status';
import packageJson from '../package.json' with { type: 'json' };
import { catalogFile, formatCatalog, selectCatalogFormat } from './cli/catalog.ts';

const completions = new RootCommand();

const commands = [
	command({
		name: 'catalog',
		desc: 'List the entries available in a WPILOG file',
		options: {
			file: positional().desc('WPILOG file to catalog').required(),
			json: boolean().desc('Output as JSON'),
			jsonl: boolean().desc('Output as newline-delimited JSON'),
			ndjson: boolean().desc('Output as newline-delimited JSON'),
			csv: boolean().desc('Output as CSV'),
		},
		async handler(options) {
			const format = selectCatalogFormat(options);
			oscStatus.working({ app: 'wpilog', message: 'Cataloging log' });
			const entries = await catalogFile(options.file);
			console.log(formatCatalog(entries, format));
			oscStatus.done({ app: 'wpilog', message: `Cataloged ${entries.length} entries` });
		},
	}),
	command({
		name: 'complete',
		desc: 'Generate shell completion scripts',
		options: {
			shell: positional().enum('zsh', 'bash', 'fish', 'powershell').desc('Shell type'),
		},
		handler({ shell }) {
			if (shell) {
				script(shell, 'wpilog', 'wpilog');
			} else {
				completions.parse([]);
			}
		},
	}),
];

for (const info of Object.values(commandsInfo(commands))) {
	const completion = completions.command(info.name, info.desc ?? '');
	for (const option of Object.values(info.options ?? {})) {
		if (option.type === 'positional') {
			completion.argument(option.name);
		} else {
			completion.option(option.name.replace(/^-+/, ''), option.description ?? '');
		}
	}
}

// Shells send partial arguments after `complete --`, which must bypass command validation.
if (process.argv[2] === 'complete' && process.argv[3] === '--') {
	completions.parse(process.argv.slice(4));
} else {
	await run(commands, {
		name: 'wpilog',
		description: packageJson.description,
		version: packageJson.version,
		theme(event) {
			if (event.type !== 'error') return false;
			oscStatus.error({ app: 'wpilog', message: 'Command failed' });
			if (event.violation === 'unknown_error' && event.error instanceof Diagnostic) {
				console.error(formatDiagnostic(event.error));
				return true;
			}
			return false;
		},
	});
}
