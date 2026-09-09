import { bench, describe } from 'vite-plus/test';
import { catalogEntries, decodeRecords, parseDataLog, readRecords } from '../../src/index.js';
import { FIXTURES } from './shared.js';

for (const fixture of FIXTURES) {
	describe(`${fixture.name}`, () => {
		bench('readRecords', () => {
			for (const _record of readRecords(fixture.bytes)) {
				// discard
			}
		});

		bench('decodeRecords', () => {
			for (const _record of decodeRecords(readRecords(fixture.bytes))) {
				// discard
			}
		});

		bench('parseDataLog', () => {
			for (const _record of parseDataLog(fixture.bytes)) {
				// discard
			}
		});

		bench('catalogEntries', () => {
			for (const _entry of catalogEntries(readRecords(fixture.bytes))) {
				// discard
			}
		});
	});
}
