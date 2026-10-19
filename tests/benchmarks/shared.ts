import { readFile } from 'node:fs/promises';
import { LOG_FIXTURES } from '../helpers/log-fixtures.ts';

// Run a smaller set of benchmarks in CI to avoid timeouts
const CI_FIXTURE_NAMES = new Set(['FRC_20250727_235138__E14', 'WPILIB_TBD_aba74b981a582b4b']);

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

const IS_CI = Boolean(process.env.CI);

export const FIXTURES: readonly Fixture[] = await Promise.all(
	LOG_FIXTURES.filter(({ name }) => !IS_CI || CI_FIXTURE_NAMES.has(name)).map(loadFixture),
);
