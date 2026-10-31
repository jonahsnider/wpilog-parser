import { defineConfig } from 'vite-plus';

export default defineConfig({
	test: {
		projects: ['packages/*/vite.config.ts'],
	},
	staged: {
		'*': 'vp check --fix',
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
		ignorePatterns: ['**/CHANGELOG.md', '**/etc/*.api.md'],
	},
});
