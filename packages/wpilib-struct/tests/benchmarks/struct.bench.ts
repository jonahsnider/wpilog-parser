import { describe, expect, test } from 'vite-plus/test';
import { StructRegistry } from '../../src/struct-registry.ts';
import type { StructPayload } from '../../src/types.ts';
import { createStructFixture, STRUCT_FIXTURES } from '../helpers/struct-fixtures.ts';

// Keep a representative nested struct workload rather than tracking every schema and phase.
const fixture = STRUCT_FIXTURES.find((fixture) => fixture.name === 'Pose2d')!;

describe(fixture.name, { concurrent: false }, () => {
	const { registry, payloads } = createStructFixture(fixture);
	const decode = (bytes: Uint8Array) => registry.decode(fixture.name, bytes) as StructPayload;
	const closuresRegistry = new StructRegistry({ codeGeneration: false });
	for (const [name, schema] of Object.entries(fixture.schemas)) closuresRegistry.register(name, schema);
	const closures = (bytes: Uint8Array) => closuresRegistry.decode(fixture.name, bytes) as StructPayload;
	// Warm decoders outside timed steady-state decoding.
	decode(payloads[0]!);
	closures(payloads[0]!);
	for (const bytes of payloads) {
		expect(closures(bytes)).toStrictEqual(decode(bytes));
	}

	test('decode 32 struct payloads (schemas already registered)', async ({ bench }) => {
		// Keep the decoded values observable to prevent dead-code elimination.
		let decoded: object[] = [];
		await bench.compare(
			bench('object', () => (decoded = payloads.map(decode))),
			bench('compiled closures', () => (decoded = payloads.map(closures))),
		);
		expect(decoded).toHaveLength(payloads.length);
	});

	test('register schemas and decode first payload (process caches warm)', async ({ bench }) => {
		let decoded: unknown;
		const firstDecode = (codeGeneration: boolean) => {
			const registry = new StructRegistry({ codeGeneration });
			for (const [name, schema] of Object.entries(fixture.schemas)) registry.register(name, schema);
			return registry.decode(fixture.name, payloads[0]!);
		};
		await bench.compare(
			bench('registration + compilation + first decode', () => (decoded = firstDecode(true))),
			bench('registration + closure compilation + first decode', () => (decoded = firstDecode(false))),
		);
		expect(decoded).toStrictEqual(decode(payloads[0]!));
	});
});
