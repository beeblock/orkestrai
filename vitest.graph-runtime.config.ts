import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';
const config = mergeConfig(base, defineConfig({ test: { fileParallelism: false, maxWorkers: 1, testTimeout: 360_000, hookTimeout: 240_000 } }));
config.test = { ...config.test, include: ['benchmarks/code-graph-runtime.test.ts'] };
export default config;
