import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';

const config = mergeConfig(baseConfig, defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
}));

config.test = {
  ...config.test,
  include: ['benchmarks/code-graph-performance.test.ts'],
};

export default config;
