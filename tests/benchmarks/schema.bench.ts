import { describe, expect, test } from 'vite-plus/test';
import { parseStruct } from '../../src/struct/parser.ts';
import { parseStructSpecification } from '../../src/struct/parse-struct.ts';

for (const schema of [
	'double vx;double vy;double omega',
	'Translation2d translation;Rotation2d rotation',
	'enum {a=1,b=2} int8 val;uint32 flags:8;double values[16]',
]) {
	describe(schema, () => {
		test('parse schema', async ({ bench }) => {
			let result = parseStructSpecification(schema);
			await bench.compare(
				bench('uncached', () => (result = parseStruct(schema))),
				bench('cached', () => (result = parseStructSpecification(schema))),
			);
			expect(result.length).toBeGreaterThan(0);
		});
	});
}
