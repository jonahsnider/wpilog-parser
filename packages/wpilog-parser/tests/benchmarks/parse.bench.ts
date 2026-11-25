import { afterEach, test, describe, vi } from 'vite-plus/test';
import { catalogEntries, DataLogStreamParser, decodeRecords, parseDataLog, readRecords } from '../../src/index.ts';
import { FIXTURES } from './shared.ts';

// Select the production CSP closure decoder outside timed parsing, including warmup.
const CLOSURE_STRUCTS = {
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
			await bench('decodeRecords', () => {
				for (const _record of decodeRecords(readRecords(fixture.bytes))) {
					// discard
				}
			}).run();
		});

		test('parseDataLog', async ({ bench }) => {
			const parse = () => {
				for (const _record of parseDataLog(fixture.bytes)) {
					// discard
				}
			};
			await bench.compare(bench('parseDataLog', parse), bench('closure parseDataLog', CLOSURE_STRUCTS, parse));
		});

		// Chunks the size of a typical download read, with records split between them
		test('DataLogStreamParser (64 KiB chunks)', async ({ bench }) => {
			await bench('DataLogStreamParser (64 KiB chunks)', () => {
				const parser = new DataLogStreamParser();
				for (let offset = 0; offset < fixture.bytes.byteLength; offset += 65_536) {
					for (const _record of parser.push(fixture.bytes.subarray(offset, offset + 65_536))) {
						// discard
					}
				}
				parser.end();
			}).run();
		});

		// Keep every decoded record alive, to measure the memory cost of holding a fully parsed log
		test('parseDataLog (collect)', async ({ bench }) => {
			await bench('parseDataLog (collect)', () => Array.from(parseDataLog(fixture.bytes))).run();
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
