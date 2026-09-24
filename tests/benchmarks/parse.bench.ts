import { test, describe } from 'vite-plus/test';
import { catalogEntries, decodeRecords, parseDataLog, readRecords } from '../../src/index.js';
import { FIXTURES } from './shared.js';

for (const fixture of FIXTURES) {
	describe(`${fixture.name}`, () => {
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
			await bench('parseDataLog', () => {
				for (const _record of parseDataLog(fixture.bytes)) {
					// discard
				}
			}).run();
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
