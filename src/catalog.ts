import { type DataLogInput, readControlRecordsOnly, type ReadRecord } from './read-records.js';
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
export function* catalogEntries(input: Iterable<ReadRecord> | DataLogInput): Generator<CatalogEntry> {
	const entries = new Map<number, CatalogEntry>();

	// Fast path: raw input allows us to skip decoding data record payloads entirely.
	if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
		yield* catalogEntriesFast(input, entries);
		return;
	}

	for (const record of input) {
		if (record.kind !== 'control') {
			continue;
		}

		if (record.payload.controlRecordType === ControlRecordType.Start) {
			const entry = {
				entryId: record.payload.entryId,
				name: record.payload.entryName,
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

function* catalogEntriesFast(input: DataLogInput, entries: Map<number, CatalogEntry>): Generator<CatalogEntry> {
	// Only control records are needed; skip data record payloads entirely (no subarray allocation).
	for (const control of readControlRecordsOnly(input)) {
		if (control.controlRecordType === ControlRecordType.Start) {
			const entry = {
				entryId: control.entryId,
				name: control.entryName,
				type: control.entryType,
				metadata: control.entryMetadata,
			};

			entries.set(control.entryId, entry);

			yield entry;
		} else if (control.controlRecordType === ControlRecordType.SetMetadata) {
			const existing = entries.get(control.entryId);
			if (existing) {
				existing.metadata = control.entryMetadata;
			}
		}
	}
}
