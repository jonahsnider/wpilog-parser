import codSpeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	plugins: [codSpeedPlugin()],
	test: {
		benchmark: {
			include: ['tests/benchmarks/**/*.bench.ts'],
		},
	},
	staged: {
		'*': 'vp check --fix',
	},
	pack: {
		dts: {
			tsgo: true,
		},
		exports: true,
	},
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	fmt: {
		singleQuote: true,
		useTabs: true,
		printWidth: 120,
		ignorePatterns: ['CHANGELOG.md'],
	},
});
