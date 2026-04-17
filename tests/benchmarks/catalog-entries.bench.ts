import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { bench, describe } from 'vite-plus/test';
import { catalogEntries } from '../../src/catalog.js';
import { readRecords } from '../../src/read-records.js';
import { BENCH_OPTIONS, FIXTURES } from './shared.js';

for (const fixture of FIXTURES) {
	describe(`catalogEntries - ${fixture.name}`, () => {
		bench(
			'in-memory (Uint8Array)',
			async () => {
				for await (const _entry of catalogEntries(readRecords(fixture.bytes))) {
					// discard
				}
			},
			BENCH_OPTIONS,
		);

		bench(
			'streamed (fs ReadableStream)',
			async () => {
				for await (const _entry of catalogEntries(readRecords(Readable.toWeb(createReadStream(fixture.filePath))))) {
					// discard
				}
			},
			BENCH_OPTIONS,
		);
	});
}
