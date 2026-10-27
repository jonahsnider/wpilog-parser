import { test } from 'vite-plus/test';
import { parseStruct, parseStructSpecification } from '../../src/struct/parse-struct.ts';

test.for([
	'double vx;double vy;double omega',
	'Translation2d translation;Rotation2d rotation',
	'enum {a=1,b=2} int8 val;uint32 flags:8;double values[16]',
])('parse schema: %s', async (schema, { bench, expect }) => {
	let result = parseStructSpecification(schema);
	await bench.compare(
		bench('uncached', () => (result = parseStruct(schema))),
		bench('cached', () => (result = parseStructSpecification(schema))),
	);
	expect(result.length).toBeGreaterThan(0);
});
