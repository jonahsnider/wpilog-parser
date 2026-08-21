#!/usr/bin/env node

import { cac } from 'cac';
import packageJson from '../package.json' with { type: 'json' };
import { catalogFile, type CatalogOutputOptions, formatCatalog, selectCatalogFormat } from './cli/catalog.js';

const cli = cac('wpilog');

cli
	.command('catalog <file>', 'List the entries available in a WPILOG file')
	.option('--json', 'Output as JSON')
	.option('--jsonl, --ndjson', 'Output as newline-delimited JSON')
	.option('--csv', 'Output as CSV')
	.example('wpilog catalog ./example.wpilog')
	.example('wpilog catalog ./example.wpilog --json')
	.action(async (file: string, options: CatalogOutputOptions) => {
		const format = selectCatalogFormat(options);
		const entries = await catalogFile(file);
		console.log(formatCatalog(entries, format));
	});

cli.help();
cli.version(packageJson.version);

try {
	const parsed = cli.parse(process.argv, { run: true });

	if (!cli.matchedCommand && !parsed.options.help && !parsed.options.version) {
		if (parsed.args[0]) {
			throw new RangeError(`Unknown command \`${parsed.args[0]}\``);
		}
		cli.outputHelp();
	}
} catch (error) {
	// CAC throws parse and validation errors for callers to present consistently.
	const message = error instanceof Error ? error.message : String(error);
	console.error(`wpilog: ${message}`);
	process.exit(1);
}
