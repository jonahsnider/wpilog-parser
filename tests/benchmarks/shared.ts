import { readFile } from 'node:fs/promises';
import { LOG_FIXTURES } from '../helpers/log-fixtures.ts';

export type Fixture = {
	name: string;
	filePath: string;
	bytes: Uint8Array;
};

async function loadFixture({ name, filePath }: (typeof LOG_FIXTURES)[number]): Promise<Fixture> {
	const buffer = await readFile(filePath);
	const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	return { name, filePath, bytes };
}

export const FIXTURES: readonly Fixture[] = await Promise.all(LOG_FIXTURES.map(loadFixture));
