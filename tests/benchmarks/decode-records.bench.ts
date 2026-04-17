import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { bench, describe } from 'vite-plus/test';
import { decodeRecords } from '../../src/decode-records.js';
import { readRecords } from '../../src/read-records.js';
import { FIXTURES } from './shared.js';

describe('decodeRecords - in-memory (Uint8Array)', () => {
	for (const fixture of FIXTURES) {
		bench(fixture.name, async () => {
			for await (const _record of decodeRecords(readRecords(fixture.bytes))) {
				// discard
			}
		});
	}
});

describe('decodeRecords - streamed (fs ReadableStream)', () => {
	for (const fixture of FIXTURES) {
		bench(fixture.name, async () => {
			for await (const _record of decodeRecords(readRecords(Readable.toWeb(createReadStream(fixture.filePath))))) {
				// discard
			}
		});
	}
});
