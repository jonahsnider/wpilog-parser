import { describe, expect, test } from 'vite-plus/test';
import { structPayloadToJson } from '../../src/struct-payload-to-json.ts';
import type { StructPayload } from '../../src/types.ts';
import { createStructFixture, STRUCT_FIXTURES } from '../helpers/struct-fixtures.ts';

for (const fixture of STRUCT_FIXTURES) {
	describe(fixture.name, () => {
		const { registry, payloads } = createStructFixture(fixture);
		const decode = (bytes: Uint8Array) => registry.decode(fixture.name, bytes) as StructPayload;
		// Warm the decoder outside timed steady-state decoding.
		decode(payloads[0]!);

		test('decode 32 struct payloads (schemas already registered)', async ({ bench }) => {
			// Keep the decoded values observable to prevent dead-code elimination.
			let decoded: object[] = [];
			await bench.compare(
				bench('Map', () => (decoded = payloads.map(decode))),
				bench('Map → object', () => (decoded = payloads.map((bytes) => structPayloadToJson(decode(bytes))))),
			);
			expect(decoded).toHaveLength(payloads.length);
		});
	});
}
