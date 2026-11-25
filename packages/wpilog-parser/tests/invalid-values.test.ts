import { describe, test } from 'vite-plus/test';
import { type DecodedRecord, decodeRecords, parseDataLog, readRecords } from '../src/index.ts';

const encoder = new TextEncoder();

type Record = [entryId: number, timestamp: number, payload: Uint8Array];

/** A WPILOG file holding `records`, which the writer would refuse to write when their values are invalid */
function log(records: Record[]): Uint8Array {
	const parts: Uint8Array[] = [encoder.encode('WPILOG'), new Uint8Array([0, 1, 0, 0, 0, 0])];
	for (const [entryId, timestamp, payload] of records) {
		// One-byte entry ID, payload size, and timestamp
		parts.push(new Uint8Array([0, entryId, payload.byteLength, timestamp]), payload);
	}
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return bytes;
}

function start(entryId: number, name: string, type: string): Record {
	const strings = [name, type, ''].map((string) => encoder.encode(string));
	const payload = new Uint8Array(5 + strings.reduce((length, string) => length + 4 + string.byteLength, 0));
	const view = new DataView(payload.buffer);
	view.setUint32(1, entryId, true);
	let offset = 5;
	for (const string of strings) {
		view.setUint32(offset, string.byteLength, true);
		payload.set(string, offset + 4);
		offset += 4 + string.byteLength;
	}
	return [0, 0, payload];
}

function doubles(...values: number[]): Uint8Array {
	return new Uint8Array(new Float64Array(values).buffer);
}

const parsers = {
	parseDataLog: (bytes: Uint8Array, options: Parameters<typeof parseDataLog>[1]) =>
		Array.from(parseDataLog(bytes, options)),
	decodeRecords: (bytes: Uint8Array, options: Parameters<typeof parseDataLog>[1]) =>
		Array.from(decodeRecords(readRecords(bytes), options)),
};

function dataRecords(records: DecodedRecord[]) {
	return records.flatMap((record) =>
		record.type === 'control' ? [] : [{ name: record.entry.name, type: record.type, payload: record.payload }],
	);
}

describe('invalid values', () => {
	const translation = log([
		start(1, '/.schema/struct:Translation2d', 'structschema'),
		start(2, '/Position', 'struct:Translation2d'),
		start(3, '/Positions', 'struct:Translation2d[]'),
		start(4, '/Enabled', 'boolean'),
		start(5, '/.schema/struct:Broken', 'structschema'),
		// Logged before their schema, so they're decoded when it arrives
		[2, 1, doubles(1)],
		[2, 2, doubles(1, 2)],
		[1, 3, encoder.encode('double x;double y')],
		[2, 4, doubles(3)],
		[3, 5, doubles(1, 2, 3)],
		[4, 6, new Uint8Array([2])],
		[4, 7, new Uint8Array([1])],
		[5, 8, encoder.encode('double x[')],
		[2, 9, doubles(5, 6)],
	]);

	test.for(Object.keys(parsers) as (keyof typeof parsers)[])(
		'yields them as raw records (%s)',
		(parser, { expect }) => {
			const records = dataRecords(parsers[parser](translation, { strict: true, invalidValues: 'raw' }));

			expect(records).toStrictEqual([
				{ name: '/.schema/struct:Translation2d', type: 'string', payload: 'double x;double y' },
				// Decoded when the schema arrived, the short value doesn't stop the valid one after it
				{ name: '/Position', type: 'raw', payload: doubles(1) },
				{ name: '/Position', type: 'struct', payload: { x: 1, y: 2 } },
				{ name: '/Position', type: 'raw', payload: doubles(3) },
				// Not a whole number of structs
				{ name: '/Positions', type: 'raw', payload: doubles(1, 2, 3) },
				{ name: '/Enabled', type: 'raw', payload: new Uint8Array([2]) },
				{ name: '/Enabled', type: 'boolean', payload: true },
				{ name: '/.schema/struct:Broken', type: 'raw', payload: encoder.encode('double x[') },
				{ name: '/Position', type: 'struct', payload: { x: 5, y: 6 } },
			]);
		},
	);

	test.for(Object.keys(parsers) as (keyof typeof parsers)[])('throw by default (%s)', (parser, { expect }) => {
		expect(() => parsers[parser](translation, undefined)).toThrowError(
			'Struct payload is truncated or its byte offset is invalid',
		);
		expect(() =>
			parsers[parser](log([start(1, '/Enabled', 'boolean'), [1, 1, new Uint8Array([2])]]), { strict: true }),
		).toThrowError('Invalid boolean value 2');
	});
});
