import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test } from 'vite-plus/test';
import { LOG_FIXTURES } from './helpers/log-fixtures.ts';

const runNode = promisify(execFile);

// Heap cost of keeping every decoded record alive, measured after GC.
// CodSpeed's memory instrument only tracks malloc, so it can't see records on the V8 heap.
const MAX_HEAP_BYTES_PER_RECORD = 130;

const MEASURE_HEAP = path.join(import.meta.dirname, 'helpers', 'measure-heap.ts');

// The WPILIB_TBD fixture is too small for per-record cost to outweigh fixed overhead
const MATCH_LOGS = LOG_FIXTURES.filter(({ name }) => name.startsWith('FRC_'));

describe('heap usage', () => {
	for (const fixture of MATCH_LOGS) {
		test(`retained records from ${fixture.name}`, async ({ expect }) => {
			// Test files share workers, so measure each log in a fresh process
			const { stdout } = await runNode(process.execPath, ['--expose-gc', MEASURE_HEAP, fixture.filePath]);

			expect(Number(stdout)).toBeLessThan(MAX_HEAP_BYTES_PER_RECORD);
		});
	}
});
