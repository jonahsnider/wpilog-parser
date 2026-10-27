import { test } from 'vite-plus/test';
import { parseStruct, parseStructSpecification } from '../../src/struct/parse-struct.ts';

test.for([
	'double vx;double vy;double omega',
	'Translation2d translation;Rotation2d rotation',
	'enum {a=1,b=2} int8 val;uint32 flags:8;double values[16]',
])('parse schema: %s', async (schema, { bench, expect }) => {
	let result = parseStructSpecification(schema);
	// Batch 1,000 parses per sample so instrumentation overhead doesn't dominate cache hits.
	await bench.compare(
		bench('uncached', () => {
			for (let i = 0; i < 1_000; i++) result = parseStruct(schema);
		}),
		bench('cached', () => {
			for (let i = 0; i < 1_000; i++) result = parseStructSpecification(schema);
		}),
	);
	expect(result.length).toBeGreaterThan(0);
});
