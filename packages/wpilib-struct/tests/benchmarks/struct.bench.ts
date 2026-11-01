import { describe, expect, test } from 'vite-plus/test';
import { compileStructClosures } from '../../src/compile-struct-closures.ts';
import { compileStruct } from '../../src/compile-struct.ts';
import { StructRegistry } from '../../src/struct-registry.ts';
import type { StructPayload } from '../../src/types.ts';
import { createStructFixture, STRUCT_FIXTURES } from '../helpers/struct-fixtures.ts';

for (const fixture of STRUCT_FIXTURES) {
	describe(fixture.name, { concurrent: false }, () => {
		const { registry, payloads } = createStructFixture(fixture);
		const decode = (bytes: Uint8Array) => registry.decode(fixture.name, bytes) as StructPayload;
		const closuresRegistry = new StructRegistry({ codeGeneration: 'closures' });
		for (const [name, schema] of Object.entries(fixture.schemas)) closuresRegistry.register(name, schema);
		const closures = (bytes: Uint8Array) => closuresRegistry.decode(fixture.name, bytes) as StructPayload;
		const interpreted = (bytes: Uint8Array) => registry.decodeInterpreted(fixture.name, bytes) as StructPayload;
		// Warm decoders outside timed steady-state decoding.
		decode(payloads[0]!);
		closures(payloads[0]!);
		interpreted(payloads[0]!);
		for (const bytes of payloads) {
			expect(decode(bytes)).toStrictEqual(interpreted(bytes));
			expect(closures(bytes)).toStrictEqual(interpreted(bytes));
		}

		test('decode 32 struct payloads (schemas already registered)', async ({ bench }) => {
			// Keep the decoded values observable to prevent dead-code elimination.
			let decoded: object[] = [];
			await bench.compare(
				bench('compiled function', () => (decoded = payloads.map(decode))),
				bench('compiled closures', () => (decoded = payloads.map(closures))),
				bench('interpreted object', () => (decoded = payloads.map(interpreted))),
			);
			expect(decoded).toHaveLength(payloads.length);
		});

		// Repeated source may benefit from the engine's compilation cache.
		test('compile registered schema', async ({ bench }) => {
			let decoder = compileStruct(registry, fixture.name);
			let closureDecoder = compileStructClosures(registry, fixture.name);
			await bench.compare(
				bench('compile function decoder', () => (decoder = compileStruct(registry, fixture.name))),
				bench('compile closure decoder', () => (closureDecoder = compileStructClosures(registry, fixture.name))),
			);
			const bytes = payloads[0]!;
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			expect(Object.getPrototypeOf(decoder(view, bytes, 0))).toBe(Object.prototype);
			expect(Object.getPrototypeOf(closureDecoder(view, bytes, 0))).toBe(Object.prototype);
		});

		test('register schemas and decode first payload (process caches warm)', async ({ bench }) => {
			let decoded: unknown;
			const firstDecode = (codeGeneration: boolean | 'closures') => {
				const registry = new StructRegistry({ codeGeneration });
				for (const [name, schema] of Object.entries(fixture.schemas)) registry.register(name, schema);
				return registry.decode(fixture.name, payloads[0]!);
			};
			await bench.compare(
				bench('registration + function compilation + first decode', () => (decoded = firstDecode(true))),
				bench('registration + closure compilation + first decode', () => (decoded = firstDecode('closures'))),
				bench('registration + interpreted first decode', () => (decoded = firstDecode(false))),
			);
			expect(decoded).toStrictEqual(decode(payloads[0]!));
		});

		test('decode an array of 32 structs', async ({ bench }) => {
			const array = new Uint8Array(payloads.reduce((size, bytes) => size + bytes.byteLength, 0));
			let offset = 0;
			for (const bytes of payloads) {
				array.set(bytes, offset);
				offset += bytes.byteLength;
			}
			const interpretedRegistry = new StructRegistry({ codeGeneration: false });
			for (const [name, schema] of Object.entries(fixture.schemas)) interpretedRegistry.register(name, schema);
			const expected = payloads.map(decode);
			expect(registry.decodeArray(fixture.name, array)).toStrictEqual(expected);
			expect(closuresRegistry.decodeArray(fixture.name, array)).toStrictEqual(expected);
			expect(interpretedRegistry.decodeArray(fixture.name, array)).toStrictEqual(expected);
			let decoded: unknown;
			await bench.compare(
				bench('compiled function array', () => (decoded = registry.decodeArray(fixture.name, array))),
				bench('compiled closures array', () => (decoded = closuresRegistry.decodeArray(fixture.name, array))),
				bench('interpreted array', () => (decoded = interpretedRegistry.decodeArray(fixture.name, array))),
			);
			expect(decoded).toStrictEqual(expected);
		});
	});
}
