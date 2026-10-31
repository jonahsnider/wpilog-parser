import { readdir } from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.join(import.meta.dirname, '..', 'fixtures', 'logs');

export const LOG_FIXTURES = (await readdir(FIXTURES_DIR))
	.filter((fileName) => fileName.endsWith('.wpilog'))
	.sort()
	.map((fileName) => ({
		name: path.basename(fileName, '.wpilog'),
		filePath: path.join(FIXTURES_DIR, fileName),
	}));
