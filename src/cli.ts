#!/usr/bin/env node

import tab from '@bomb.sh/tab/cac';
import { cac } from 'cac';
import { Diagnostic, formatDiagnostic } from 'nostics';
import oscStatus from 'osc-status';
import packageJson from '../package.json' with { type: 'json' };
import { catalogFile, type CatalogOutputOptions, formatCatalog, selectCatalogFormat } from './cli/catalog.ts';
import { diagnostics } from './diagnostics.ts';

const cli = cac('wpilog');

cli
	.command('catalog <file>', 'List the entries available in a WPILOG file')
	.option('--json', 'Output as JSON')
	.option('--jsonl', 'Output as newline-delimited JSON')
	.option('--ndjson', 'Output as newline-delimited JSON')
	.option('--csv', 'Output as CSV')
	.example('wpilog catalog ./example.wpilog')
	.example('wpilog catalog ./example.wpilog --json')
	.action(async (file: string, options: CatalogOutputOptions) => {
		const format = selectCatalogFormat(options);
		oscStatus.working({ app: 'wpilog', message: 'Cataloging log' });
		const entries = await catalogFile(file);
		console.log(formatCatalog(entries, format));
		oscStatus.done({ app: 'wpilog', message: `Cataloged ${entries.length} entries` });
	});

cli.help();
cli.version(packageJson.version);

try {
	await tab(cli);
	const completeCommand = cli.commands.find((command) => command.name === 'complete');
	if (completeCommand) {
		completeCommand.description = 'Generate shell completion scripts';
		completeCommand
			.usage('complete <zsh|bash|fish|powershell>')
			.example('source <(wpilog complete zsh)')
			.example('source <(wpilog complete bash)')
			.example('wpilog complete fish > ~/.config/fish/completions/wpilog.fish')
			.example('wpilog complete powershell | Out-String | Invoke-Expression');
	}

	const parsed = cli.parse(process.argv, { run: false });

	if (!cli.matchedCommand && !parsed.options.help && !parsed.options.version) {
		if (parsed.args[0]) {
			throw diagnostics.WPILOG_C0001({ command: parsed.args[0] });
		}
		cli.outputHelp();
	}

	await cli.runMatchedCommand();
} catch (error) {
	const message =
		error instanceof Diagnostic ? formatDiagnostic(error) : error instanceof Error ? error.message : String(error);
	console.error(error instanceof Diagnostic ? message : `wpilog: ${message}`);
	process.exitCode = 1;
	oscStatus.error({ app: 'wpilog', message: 'Command failed' });
}
