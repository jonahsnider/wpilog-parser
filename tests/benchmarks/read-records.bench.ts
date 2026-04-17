import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { bench, describe } from 'vite-plus/test';
import { readRecords } from '../../src/read-records.js';
import { FIXTURES } from './shared.js';

describe('readRecords - in-memory (Uint8Array)', () => {
	for (const fixture of FIXTURES) {
		bench(fixture.name, async () => {
			for await (const _record of readRecords(fixture.bytes)) {
				// discard
			}
		});
	}
});

describe('readRecords - streamed (fs ReadableStream)', () => {
	for (const fixture of FIXTURES) {
		bench(fixture.name, async () => {
			for await (const _record of readRecords(Readable.toWeb(createReadStream(fixture.filePath)))) {
				// discard
			}
		});
	}
});
