import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('E2E user-state isolation', () => {
  it('writes runtime discovery only inside the test home', () => {
    const home = mkdtempSync(join(tmpdir(), 'orkestrai-home-isolation-'));
    try {
      const script = `import { writeOrkestraiRuntimeFile } from ${JSON.stringify(new URL('../../scripts/install-orkestrai-shim.mjs', import.meta.url).href)}; writeOrkestraiRuntimeFile('http://127.0.0.1:5199');`;
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 10_000 });
      expect(JSON.parse(readFileSync(join(home, '.orkestrai', 'runtime.json'), 'utf8')).apiUrl).toBe('http://127.0.0.1:5199');
      const config = readFileSync(resolve('playwright.config.ts'), 'utf8');
      expect(config).toContain("resolve('test-runtime')");
      expect(config).not.toContain('rmSync');
      expect(config).toContain('node scripts/prepare-e2e-runtime.mjs');
      for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'CODEX_HOME', 'DB_PATH']) expect(config).toMatch(new RegExp(`\\b${name}: (?:e2eHome|resolve\\(e2e(?:Home|DataDir))`));
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
