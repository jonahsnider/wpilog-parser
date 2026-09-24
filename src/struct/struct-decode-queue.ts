import type { RawRecord } from '../types.ts';
import { StructDependencyGraph } from './struct-dependency-graph.ts';

export class StructDecodeQueue {
	private readonly graph = new StructDependencyGraph();
	private readonly queuedRecords = new Map<string, RawRecord[]>();
	private readonly onStructDefined: (structName: string, records: RawRecord[]) => void;

	constructor(onStructDefined: (structName: string, records: RawRecord[]) => void) {
		this.onStructDefined = onStructDefined;
	}

	queueStructRecord(structName: string, record: RawRecord): void {
		const existing = this.queuedRecords.get(structName);

		if (existing) {
			existing.push(record);
		} else {
			this.queuedRecords.set(structName, [record]);
		}
	}

	registerSchema(structName: string, innerStructNames: Iterable<string>): void {
		this.graph.registerSchema(structName, innerStructNames);
		this.checkDecodableStructs();
	}

	private checkDecodableStructs(): void {
		for (const structName of this.graph.getDecodableStructs()) {
			const records = this.queuedRecords.get(structName);

			if (records) {
				this.onStructDefined(structName, records);
				this.queuedRecords.delete(structName);
			}
		}
	}
}
