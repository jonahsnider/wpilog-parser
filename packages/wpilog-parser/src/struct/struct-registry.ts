import { StructRegistry as SharedStructRegistry } from 'wpilib-struct';
import type { ByteOffset } from '../byte-offset.ts';
import { withStructDiagnostics } from './diagnostics.ts';
import type { StructDecodeQueue } from './struct-decode-queue.ts';

/** WPILOG schema registration and queued-record policy stay outside the shared codec. */
export class StructRegistry {
	private readonly registry = new SharedStructRegistry();
	private readonly queue: StructDecodeQueue;

	constructor(queue: StructDecodeQueue) {
		this.queue = queue;
	}

	register(name: string, definition: string): void {
		withStructDiagnostics(() => this.registry.register(name, definition));
		this.queue.registerSchema(
			name,
			this.registry.getDefinition(name).map((member) => member.value),
		);
	}

	getByteLength(name: string) {
		return this.registry.getByteLength(name);
	}

	decode(name: string, payload: Uint8Array, offset?: ByteOffset) {
		const result = this.registry.decode(name, payload, offset?.get());
		if (typeof result !== 'string') offset?.advance(this.registry.getByteLength(name) as number);
		return result;
	}

	decodeArray(name: string, payload: Uint8Array) {
		return this.registry.decodeArray(name.slice(0, -'[]'.length), payload);
	}
}
