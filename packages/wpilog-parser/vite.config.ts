import codSpeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	plugins: [codSpeedPlugin()],
	test: {
		name: 'wpilog-parser',
		root: import.meta.dirname,
		isolate: false,
		sequence: { concurrent: true },
		benchmark: { include: ['tests/benchmarks/**/*.bench.ts'] },
		// Native ESM avoids module export getter overhead in parser benchmarks.
		experimental: { viteModuleRunner: false },
		// A single readRecords benchmark iteration can exceed the default timeout.
		testTimeout: 30 * 60 * 1000,
		hookTimeout: 30 * 60 * 1000,
	},
	pack: {
		entry: ['src/index.ts', 'src/cli.ts'],
		dts: { generator: 'tsgo' },
		exports: {
			bin: { wpilog: './src/cli.ts' },
			exclude: ['cli'],
		},
	},
});
