import { afterEach, test, describe, vi } from 'vite-plus/test';
import { catalogEntries, decodeRecords, parseDataLog, readRecords } from '../../src/index.ts';
import { FIXTURES } from './shared.ts';

// Select the production CSP interpreter outside timed parsing, including warmup.
const INTERPRETED_STRUCTS = {
	beforeAll() {
		vi.spyOn(globalThis, 'Function').mockImplementation(function () {
			throw new EvalError('Code generation disallowed by CSP');
		});
	},
	afterAll() {
		vi.restoreAllMocks();
	},
};

// Also restore the constructor if a benchmark fails before its teardown runs.
afterEach(() => vi.restoreAllMocks());

for (const fixture of FIXTURES) {
	describe(`${fixture.name}`, { concurrent: false }, () => {
		test('readRecords', async ({ bench }) => {
			await bench('readRecords', () => {
				for (const _record of readRecords(fixture.bytes)) {
					// discard
				}
			}).run();
		});

		test('decodeRecords', async ({ bench }) => {
			const decode = () => {
				for (const _record of decodeRecords(readRecords(fixture.bytes))) {
					// discard
				}
			};
			await bench.compare(
				bench('decodeRecords', decode),
				bench('interpreted decodeRecords', INTERPRETED_STRUCTS, decode),
			);
		});

		test('parseDataLog', async ({ bench }) => {
			const parse = () => {
				for (const _record of parseDataLog(fixture.bytes)) {
					// discard
				}
			};
			await bench.compare(bench('parseDataLog', parse), bench('interpreted parseDataLog', INTERPRETED_STRUCTS, parse));
		});

		test('catalogEntries', async ({ bench }) => {
			await bench('catalogEntries', () => {
				for (const _entry of catalogEntries(readRecords(fixture.bytes))) {
					// discard
				}
			}).run();
		});
	});
}
