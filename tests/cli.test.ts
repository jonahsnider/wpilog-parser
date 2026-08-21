import { describe, expect, test } from 'vite-plus/test';
import { formatCatalog, selectCatalogFormat } from '../src/cli/catalog.js';

const ENTRIES = [
	{ entryId: 1, name: '/Robot/Pose', type: 'struct:Pose2d', metadata: '' },
	{ entryId: 12, name: '/DS:enabled', type: 'boolean', metadata: '{"source":"DS"}' },
];

describe('formatCatalog', () => {
	test('uses TOON by default', () => {
		expect(formatCatalog(ENTRIES)).toBe(
			[
				'[2]{entryId,name,type,metadata}:',
				'  1,/Robot/Pose,"struct:Pose2d",""',
				'  12,"/DS:enabled",boolean,"{\\"source\\":\\"DS\\"}"',
			].join('\n'),
		);
	});

	test('formats JSON', () => {
		expect(formatCatalog(ENTRIES, 'json')).toBe(JSON.stringify(ENTRIES, null, 2));
	});

	test.each(['jsonl', 'ndjson'] as const)('formats %s', (format) => {
		expect(formatCatalog(ENTRIES, format)).toBe(ENTRIES.map((entry) => JSON.stringify(entry)).join('\n'));
	});

	test('formats CSV and escapes special characters', () => {
		expect(
			formatCatalog([{ entryId: 1, name: '/quoted,"name"', type: 'string', metadata: 'line 1\nline 2' }], 'csv'),
		).toBe('entryId,name,type,metadata\n1,"/quoted,""name""",string,"line 1\nline 2"');
	});

	test('formats an empty catalog', () => {
		expect(formatCatalog([], 'jsonl')).toBe('');
		expect(formatCatalog([], 'csv')).toBe('entryId,name,type,metadata');
	});
});

describe('selectCatalogFormat', () => {
	test('uses TOON when no output flag is present', () => {
		expect(selectCatalogFormat({})).toBe('toon');
	});

	test('selects explicit output formats', () => {
		expect(selectCatalogFormat({ json: true })).toBe('json');
		expect(selectCatalogFormat({ jsonl: true, ndjson: true })).toBe('jsonl');
		expect(selectCatalogFormat({ csv: true })).toBe('csv');
	});

	test('rejects conflicting output flags', () => {
		expect(() => selectCatalogFormat({ json: true, csv: true })).toThrow('Output flags cannot be combined');
	});
});
