import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { bench, describe } from 'vite-plus/test';
import { catalogEntries } from '../../src/catalog.js';
import { readRecords } from '../../src/read-records.js';
import { FIXTURES } from './shared.js';

describe('catalogEntries - in-memory (Uint8Array)', () => {
	for (const fixture of FIXTURES) {
		bench(fixture.name, async () => {
			for await (const _entry of catalogEntries(readRecords(fixture.bytes))) {
				// discard
			}
		});
	}
});

describe('catalogEntries - streamed (fs ReadableStream)', () => {
	for (const fixture of FIXTURES) {
		bench(fixture.name, async () => {
			for await (const _entry of catalogEntries(readRecords(Readable.toWeb(createReadStream(fixture.filePath))))) {
				// discard
			}
		});
	}
});
