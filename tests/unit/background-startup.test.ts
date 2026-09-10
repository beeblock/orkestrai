import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterDatabaseReady, holdBackgroundStartup } from '$lib/modules/agent-room/infrastructure/background-startup.js';

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__orkestraiDatabaseStartup;
});

describe('background database startup barrier', () => {
  it('does not query a fresh database before all migrations have completed', async () => {
    const release = holdBackgroundStartup();
    const start = vi.fn();
    const pending = afterDatabaseReady(start);
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
    expect(holdBackgroundStartup()).toBe(release);
    release();
    await pending;
    expect(start).toHaveBeenCalledOnce();
    release();
    expect(start).toHaveBeenCalledOnce();
  });

  it('starts normally in development without a production migration barrier', async () => {
    const start = vi.fn();
    await afterDatabaseReady(start);
    expect(start).toHaveBeenCalledOnce();
  });

  it('holds before importing Svelar hooks and releases only after migration success', () => {
    const server = readFileSync('scripts/orkestrai-server.mjs', 'utf8');
    const hold = server.indexOf('const releaseBackgroundStartup = holdBackgroundStartup()');
    const handler = server.indexOf("await import('../build/handler.js')");
    const migrate = server.indexOf('await new Migrator().run(migrations)');
    const release = server.indexOf('releaseBackgroundStartup();');
    expect(hold).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(hold);
    expect(migrate).toBeGreaterThan(handler);
    expect(release).toBeGreaterThan(migrate);
    expect(readFileSync('src/hooks.server.ts', 'utf8')).toContain('if (!building)');
    const packagedFiles = JSON.parse(readFileSync('package.json', 'utf8')).build.files;
    expect(packagedFiles).toContain('src/lib/modules/agent-room/infrastructure/background-startup.ts');
  });
});
