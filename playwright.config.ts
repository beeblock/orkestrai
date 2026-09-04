import { defineConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const e2eDataDir = resolve('test-results/runtime');
const e2eNodeOptions = process.env.NODE_OPTIONS?.includes('--max-old-space-size')
  ? process.env.NODE_OPTIONS
  : [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' ');
const e2eServerCommand = process.env.CI
  ? 'PORT=5199 node scripts/orkestrai-server.mjs'
  : 'npm run build && PORT=5199 node scripts/orkestrai-server.mjs';
rmSync(e2eDataDir, { recursive: true, force: true });

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Testes que dependem de PTY/timing externo flapeiam raramente na corrida
  // completa (passam isolados) — 1 retry local nao mascara regressao real.
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5199',
    // Onboarding marcado como visto: o wizard nao bloqueia os testes quando
    // o banco esta sem workspaces (ex.: apos um purge).
    storageState: 'tests/e2e/storage-state.json',
    trace: 'on-first-retry',
  },
  expect: {
    timeout: 10_000,
  },
  webServer: {
    command: e2eServerCommand,
    env: {
      APP_KEY: process.env.APP_KEY ?? 'orkestrai-e2e-test-key',
      NODE_OPTIONS: e2eNodeOptions,
      ORKESTRAI_DATA_DIR: e2eDataDir,
    },
    url: 'http://127.0.0.1:5199',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
