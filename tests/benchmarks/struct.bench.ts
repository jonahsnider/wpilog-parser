import { describe, expect, test } from 'vite-plus/test';
import { compileStruct } from '../../src/struct/compile-struct.ts';
import type { StructPayload } from '../../src/types.ts';
import { createStructFixture, STRUCT_FIXTURES } from '../helpers/struct-fixtures.ts';

for (const fixture of STRUCT_FIXTURES) {
	describe(fixture.name, { concurrent: false }, () => {
		const { registry, payloads } = createStructFixture(fixture);
		const decode = (bytes: Uint8Array) => registry.decode(fixture.name, bytes) as StructPayload;
		const interpreted = (bytes: Uint8Array) => registry.decodeInterpreted(fixture.name, bytes) as StructPayload;
		// Warm both decoders outside timed steady-state decoding.
		decode(payloads[0]!);
		interpreted(payloads[0]!);

		test('decode 32 struct payloads (schemas already registered)', async ({ bench }) => {
			// Keep the decoded values observable to prevent dead-code elimination.
			let decoded: object[] = [];
			await bench.compare(
				bench('object', () => (decoded = payloads.map(decode))),
				bench('interpreted object', () => (decoded = payloads.map(interpreted))),
			);
			expect(decoded).toHaveLength(payloads.length);
		});

		// Repeated source may benefit from the engine's compilation cache.
		test('compile registered schema', async ({ bench }) => {
			let decoder = compileStruct(registry, fixture.name);
			await bench('compile object decoder', () => (decoder = compileStruct(registry, fixture.name))).run();
			const bytes = payloads[0]!;
			expect(
				Object.getPrototypeOf(decoder(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes, 0)),
			).toBe(Object.prototype);
		});
	});
}
