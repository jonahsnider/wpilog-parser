import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { describe, test } from 'vite-plus/test';
import { DataLogStreamParser, DataLogWriter, type DecodedRecord, parseDataLog, readRecords } from '../src/index.ts';

const fixture = await readFile(new URL('./fixtures/logs/FRC_20250727_235138__E14.wpilog', import.meta.url));

/** Split bytes into chunks, cycling through `sizes` */
function* chunks(bytes: Uint8Array, sizes: number[]): Generator<Uint8Array> {
	let offset = 0;
	for (let i = 0; offset < bytes.byteLength; i++) {
		const size = sizes[i % sizes.length]!;
		yield bytes.subarray(offset, offset + size);
		offset += size;
	}
}

function* streamRecords(parser: DataLogStreamParser, bytes: Uint8Array, sizes: number[]): Generator<DecodedRecord> {
	// One reused buffer, like a stream reader that fills the same memory for every chunk
	const reused = new Uint8Array(Math.max(...sizes));
	for (const chunk of chunks(bytes, sizes)) {
		reused.set(chunk);
		yield* parser.push(reused.subarray(0, chunk.byteLength));
	}
	parser.end();
}

describe('DataLogStreamParser', () => {
	// Tiny chunks split headers and records everywhere, larger ones cover chunks with many records.
	// Tiny chunks are slow, so only the start of the log is split into them, which also cuts off its last record.
	test.for([
		{ sizes: [1, 2, 3, 5, 7, 11], length: 200_000 },
		{ sizes: [65_521], length: fixture.byteLength },
		{ sizes: [1, 1_000_003], length: fixture.byteLength },
	])('matches parseDataLog for chunks of $sizes bytes', ({ sizes, length }, { expect }) => {
		const bytes = fixture.subarray(0, length);
		const expected = parseDataLog(bytes);
		const parser = new DataLogStreamParser();
		const actual = streamRecords(parser, bytes, sizes);
		let count = 0;

		while (true) {
			const expectedResult = expected.next();
			const actualResult = actual.next();
			if (!isDeepStrictEqual(actualResult, expectedResult)) {
				throw new Error(`Streamed record differs at record ${count}`);
			}
			if (expectedResult.done) break;
			count++;
		}

		expect(count).toBeGreaterThan(1000);
		expect(parser.header).toStrictEqual({ version: { major: 1, minor: 0 }, extraHeader: '' });
		expect(parser.truncated).toBe(expected.truncated);
		expect(parser.bytesRead).toBe(recordEnds(bytes).at(-1));
	});

	test('keeps an incomplete last record out of the bytes read', ({ expect }) => {
		const bytes = fixture.subarray(0, -1);
		const parser = new DataLogStreamParser();
		const records = Array.from(streamRecords(parser, bytes, [65_521]));

		expect(records).toHaveLength(Array.from(parseDataLog(bytes)).length);
		expect(parser.truncated).toBe(true);
		expect(parser.bytesRead).toBe(recordEnds(bytes).at(-1));
		expect(parser.bytesRead).toBeLessThan(bytes.byteLength);
	});

	test('yields records left unread by a previous push', ({ expect }) => {
		const parser = new DataLogStreamParser();
		const [first, second] = chunks(fixture.subarray(0, 50_000), [25_000]);
		const records: DecodedRecord[] = [];
		for (const record of parser.push(first!)) {
			records.push(record);
			break;
		}
		records.push(...parser.push(second!));

		expect(records).toStrictEqual(Array.from(parseDataLog(fixture.subarray(0, 50_000))));
	});

	test('yields the records before a damaged one', async ({ expect }) => {
		const writer = new DataLogWriter();
		const enabled = writer.start('/Enabled', 'boolean');
		writer.append(enabled, true, 1);
		writer.append(enabled, true, 2);
		writer.close();
		const bytes = new Uint8Array(await new Response(writer.readable).arrayBuffer());
		// The last record is the second boolean, 2 isn't a valid boolean
		bytes[bytes.byteLength - 1] = 2;

		const parser = new DataLogStreamParser();
		const records: DecodedRecord[] = [];
		expect(() => {
			for (const record of parser.push(bytes)) records.push(record);
		}).toThrowError('Invalid boolean value 2');

		expect(records.map((record) => record.type)).toStrictEqual(['control', 'boolean']);
		// Where the damaged record starts
		expect(parser.bytesRead).toBe(recordEnds(bytes).at(-2));
	});

	test('validates the file header', ({ expect }) => {
		const short = new DataLogStreamParser();
		expect(Array.from(short.push(new TextEncoder().encode('WPILOG')))).toStrictEqual([]);
		expect(() => short.end()).toThrowError('Not a WPILOG file (truncated header)');

		const invalid = new DataLogStreamParser();
		expect(() => Array.from(invalid.push(new TextEncoder().encode('NOTAWPILOGFILE')))).toThrowError(
			'Not a WPILOG file (invalid magic bytes)',
		);
	});
});

/** Where the header and each complete record of a log end */
function recordEnds(bytes: Uint8Array): number[] {
	const records = readRecords(bytes);
	const ends: number[] = [];
	for (const _record of records) {
		ends.push(records.bytesRead);
	}
	return ends;
}
