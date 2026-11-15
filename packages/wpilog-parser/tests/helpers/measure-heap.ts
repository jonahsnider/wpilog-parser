// Prints the heap bytes retained per decoded record for one log.
// Run in a fresh process with `node --expose-gc`, since record field layouts depend on every value the isolate has
// stored before (e.g. one large timestamp boxes timestamps in all later records).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDataLog } from '../../src/index.ts';

const [filePath] = process.argv.slice(2);
assert(filePath, 'Usage: node --expose-gc measure-heap.ts <log file>');
assert(globalThis.gc, 'Run with --expose-gc');
const { gc } = globalThis;

const bytes = await readFile(filePath);

gc();
const before = process.memoryUsage().heapUsed;
const records = Array.from(parseDataLog(bytes));
gc();

console.log((process.memoryUsage().heapUsed - before) / records.length);
