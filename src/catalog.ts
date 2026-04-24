import { normalizeEntryName } from './decode-records.js';
import type { ReadRecord } from './read-records.js';
import { ControlRecordType } from './types.js';

/** An entry definition from the WPILOG catalog. */
export type CatalogEntry = {
	entryId: number;
	name: string;
	type: string;
	metadata: string;
};

/**
 * Collect all entry definitions from a WPILOG record stream.
 *
 * Iterates through records, collecting Start control records.
 * Data record bytes are still read from the stream but not decoded,
 * making this much cheaper than full decoding via {@link decodeRecords}.
 */
export function* catalogEntries(records: Iterable<ReadRecord>): Generator<CatalogEntry> {
	const entries = new Map<number, CatalogEntry>();

	for (const record of records) {
		if (record.kind !== 'control') {
			continue;
		}

		if (record.payload.controlRecordType === ControlRecordType.Start) {
			const entry = {
				entryId: record.payload.entryId,
				name: normalizeEntryName(record.payload.entryName),
				type: record.payload.entryType,
				metadata: record.payload.entryMetadata,
			};

			entries.set(record.payload.entryId, entry);

			yield entry;
		}

		if (record.payload.controlRecordType === ControlRecordType.SetMetadata) {
			const existing = entries.get(record.payload.entryId);
			if (existing) {
				existing.metadata = record.payload.entryMetadata;
			}
		}
	}
}
