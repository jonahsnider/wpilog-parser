import { diagnostics } from '../diagnostics.ts';
import { KnownStructTypeName } from './types.ts';

const EMPTY_SET: Set<never> = new Set();

export class StructDependencyGraph {
	private readonly allDependencies = new Map<string, Set<string>>(
		Object.values(KnownStructTypeName).map((type) => [type, EMPTY_SET]),
	);

	registerSchema(name: string, innerStructNames: Iterable<string>): void {
		const existing = this.allDependencies.get(name);

		if (existing) {
			for (const innerStructName of innerStructNames) {
				existing.add(innerStructName);
			}
		} else {
			this.allDependencies.set(name, new Set(innerStructNames));
		}

		if (this.hasCycle(name)) {
			throw diagnostics.WPILOG_R0012({ name });
		}
	}

	private hasCycle(current: string, path = new Set<string>()): boolean {
		if (path.has(current)) {
			return true;
		}
		path.add(current);
		const directDependencies = this.allDependencies.get(current);
		if (directDependencies) {
			for (const dep of directDependencies) {
				if (this.hasCycle(dep, path)) {
					return true;
				}
			}
		}
		path.delete(current);

		return false;
	}

	getDependencies(name: string): ReadonlySet<string> {
		const result = new Set<string>();

		const queue = [name];

		while (queue.length > 0) {
			const current = queue.pop()!;

			if (result.has(current)) {
				continue;
			}

			result.add(current);

			const dependencies = this.allDependencies.get(current);

			if (dependencies) {
				queue.push(...dependencies);
			}
		}

		return result;
	}

	getDecodableStructs(): string[] {
		const result: string[] = [];

		for (const structName of this.allDependencies.keys()) {
			const dependencies = this.getDependencies(structName);
			// A struct is decodable if all its dependencies have registered schemas
			let allResolved = true;
			for (const dep of dependencies) {
				if (!this.allDependencies.has(dep)) {
					allResolved = false;
					break;
				}
			}
			if (allResolved) {
				result.push(structName);
			}
		}

		return result;
	}
}
