import { describe, test } from 'vite-plus/test';
import { StructDependencyGraph } from '../../src/struct/struct-dependency-graph.ts';

describe('struct dependency graph', () => {
	test('replaces old dependencies when a schema changes', ({ expect }) => {
		const graph = new StructDependencyGraph();
		graph.registerSchema('A', ['B']);
		graph.registerSchema('B', []);
		graph.registerSchema('A', []);
		graph.registerSchema('B', ['A']);
		expect(graph.getDependencies('B')).toStrictEqual(new Set(['B', 'A']));
	});
	test('A', ({ expect }) => {
		const graph = new StructDependencyGraph();
		graph.registerSchema('MyStruct', []);

		const dependencies = graph.getDependencies('MyStruct');
		expect(dependencies).toStrictEqual(new Set(['MyStruct']));
	});

	test('A -> B', ({ expect }) => {
		const graph = new StructDependencyGraph();
		graph.registerSchema('MyStruct', ['InnerStruct']);

		const dependencies = graph.getDependencies('MyStruct');
		expect(dependencies).toStrictEqual(new Set(['MyStruct', 'InnerStruct']));
	});

	test('A -> B -> C', ({ expect }) => {
		const graph = new StructDependencyGraph();
		graph.registerSchema('A', ['B']);
		graph.registerSchema('B', ['C']);

		const dependencies = graph.getDependencies('A');
		expect(dependencies).toStrictEqual(new Set(['A', 'B', 'C']));
	});

	test('A -> B -> C -> A (circular dependency)', ({ expect }) => {
		const graph = new StructDependencyGraph();
		graph.registerSchema('A', ['B']);
		graph.registerSchema('B', ['C']);
		expect(() => graph.registerSchema('C', ['A'])).toThrowError();
	});

	test('A -> B, A -> C, C -> D, B -> C', ({ expect }) => {
		const graph = new StructDependencyGraph();
		graph.registerSchema('A', ['B', 'C']);
		expect(graph.getDependencies('A')).toStrictEqual(new Set(['A', 'B', 'C']));
		graph.registerSchema('C', ['D']);
		expect(graph.getDependencies('A')).toStrictEqual(new Set(['A', 'B', 'C', 'D']));
		graph.registerSchema('B', ['C']);
		expect(graph.getDependencies('A')).toStrictEqual(new Set(['A', 'B', 'C', 'D']));
	});
});
