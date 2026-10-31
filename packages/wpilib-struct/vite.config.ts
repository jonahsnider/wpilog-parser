import codSpeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	plugins: [codSpeedPlugin()],
	test: {
		name: 'wpilib-struct',
		root: import.meta.dirname,
		isolate: false,
		sequence: { concurrent: true },
		benchmark: { include: ['tests/benchmarks/**/*.bench.ts'] },
		experimental: { viteModuleRunner: false },
	},
	pack: {
		entry: ['src/index.ts'],
		dts: { generator: 'tsgo' },
		exports: true,
	},
});
