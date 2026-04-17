import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.join(import.meta.dirname, '..', 'fixtures', 'logs');

const FIXTURE_NAMES = ['FRC_20241110_165657__Q68', 'FRC_20250727_235138__E14', 'FRC_20251109_211045__E2'] as const;

type FixtureName = (typeof FIXTURE_NAMES)[number];

export type Fixture = {
	name: FixtureName;
	filePath: string;
	bytes: Uint8Array;
};

async function loadFixture(name: FixtureName): Promise<Fixture> {
	const filePath = path.join(FIXTURES_DIR, `${name}.wpilog`);
	const buffer = await readFile(filePath);
	const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	return { name, filePath, bytes };
}

export const FIXTURES: readonly Fixture[] = await Promise.all(FIXTURE_NAMES.map(loadFixture));
