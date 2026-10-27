import { test } from 'vite-plus/test';
import { parseStruct } from '../../src/struct/parse-struct.ts';

test.for([
	'double vx;double vy;double omega',
	'Translation2d translation;Rotation2d rotation',
	'enum {a=1,b=2} int8 val;uint32 flags:8;double values[16]',
])('parse schema: %s', async (schema, { bench, expect }) => {
	let result = parseStruct(schema);
	await bench('uncached', () => {
		// Amortize instrumentation overhead over 1,000 parses.
		for (let i = 0; i < 1_000; i++) result = parseStruct(schema);
	}).run();
	expect(result.length).toBeGreaterThan(0);
});
