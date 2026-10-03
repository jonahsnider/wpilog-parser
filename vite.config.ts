import codSpeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	plugins: [codSpeedPlugin()],
	test: {
		isolate: false,
		benchmark: {
			include: ['tests/benchmarks/**/*.bench.ts'],
		},
		// Native ESM avoids module export getter overhead in parser benchmarks.
		experimental: { viteModuleRunner: false },
		// Individual `readRecords` iterations can exceed Vitest's default 5s test timeout,
		// causing benches to be silently killed.
		testTimeout: 30 * 60 * 1000,
		hookTimeout: 30 * 60 * 1000,
	},
	staged: {
		'*': 'vp check --fix',
	},
	pack: {
		entry: ['src/index.ts', 'src/cli.ts'],
		dts: {
			generator: 'tsgo',
		},
		exports: {
			bin: { wpilog: './src/cli.ts' },
			exclude: ['cli'],
		},
	},
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
		},
		categories: {
			correctness: 'error',
			perf: 'error',
		},
	},
	fmt: {
		singleQuote: true,
		useTabs: true,
		printWidth: 120,
		ignorePatterns: ['CHANGELOG.md'],
	},
});
