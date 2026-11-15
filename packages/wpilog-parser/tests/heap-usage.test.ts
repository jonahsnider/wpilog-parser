import { readFile } from 'node:fs/promises';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, test } from 'vite-plus/test';
import { parseDataLog } from '../src/index.ts';
import { LOG_FIXTURES } from './helpers/log-fixtures.ts';

// Heap cost of keeping every decoded record alive, measured after GC.
// CodSpeed's memory instrument only tracks malloc, so it can't see records on the V8 heap.
const MAX_HEAP_BYTES_PER_RECORD = 170;

v8.setFlagsFromString('--expose-gc');
const gc: () => void = vm.runInNewContext('gc');

function usedHeapSize(): number {
	gc();
	return v8.getHeapStatistics().used_heap_size;
}

// The WPILIB_TBD fixture is too small for per-record cost to outweigh fixed overhead
const MATCH_LOGS = LOG_FIXTURES.filter(({ name }) => name.startsWith('FRC_'));

describe('heap usage', () => {
	for (const fixture of MATCH_LOGS) {
		test(`retained records from ${fixture.name}`, async ({ expect }) => {
			const bytes = await readFile(fixture.filePath);

			// Everything between the two measurements is synchronous, so concurrent tests can't allocate in between
			const before = usedHeapSize();
			const records = Array.from(parseDataLog(bytes));
			const bytesPerRecord = (usedHeapSize() - before) / records.length;

			expect(bytesPerRecord).toBeLessThan(MAX_HEAP_BYTES_PER_RECORD);
		});
	}
});
