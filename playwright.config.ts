import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const e2eDataDir = resolve('test-runtime');
const e2eNodeOptions = process.env.NODE_OPTIONS?.includes('--max-old-space-size')
  ? process.env.NODE_OPTIONS
  : [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' ');
const e2eServerCommand = process.env.CI
  ? 'node scripts/prepare-e2e-runtime.mjs && PORT=5199 node scripts/orkestrai-server.mjs'
  : 'node scripts/prepare-e2e-runtime.mjs && npm run build && PORT=5199 node scripts/orkestrai-server.mjs';
const e2eHome = resolve(e2eDataDir, 'home');

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
      APP_KEY: 'orkestrai-e2e-test-key',
      DB_PATH: resolve(e2eDataDir, 'database.db'),
      NODE_OPTIONS: e2eNodeOptions,
      ORKESTRAI_DATA_DIR: e2eDataDir,
      // Bridge provisioning and provider discovery also write/read user-level files.
      HOME: e2eHome,
      USERPROFILE: e2eHome,
      APPDATA: resolve(e2eHome, 'AppData', 'Roaming'),
      LOCALAPPDATA: resolve(e2eHome, 'AppData', 'Local'),
      XDG_CONFIG_HOME: resolve(e2eHome, '.config'),
      CODEX_HOME: resolve(e2eHome, '.codex'),
    },
    url: 'http://127.0.0.1:5199',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
