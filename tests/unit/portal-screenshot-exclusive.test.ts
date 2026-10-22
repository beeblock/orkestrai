import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every capture gets the same name here, as two captures in one millisecond would without a unique part.
vi.mock('node:crypto', async (original) => ({ ...(await original<typeof import('node:crypto')>()), randomUUID: () => '0badc0de-0000-4000-8000-000000000000' }));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const capture = { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` };

describe('Portal screenshot files', () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('never follows a link left at the capture path, even outside the workspace', async () => {
    const { savePortalScreenshot } = await import('$lib/modules/agent-room/application/services/ManagedPortalService.js');
    const workspace = mkdtempSync(join(tmpdir(), 'portal-workspace-'));
    const outside = mkdtempSync(join(tmpdir(), 'portal-outside-'));
    roots.push(workspace, outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    const directory = join(workspace, '.orkestrai', 'portal', 'screenshots');
    mkdirSync(directory, { recursive: true });
    symlinkSync(join(outside, 'keep.txt'), join(directory, 'shop-2026-10-22T12-00-00-000Z-0badc0de.png'));
    await expect(savePortalScreenshot(workspace, 'Shop', capture)).rejects.toThrow();
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('keeps two captures of one Portal in the same instant as separate files', async () => {
    vi.resetModules();
    vi.doUnmock('node:crypto');
    const { savePortalScreenshot } = await import('$lib/modules/agent-room/application/services/ManagedPortalService.js');
    const workspace = mkdtempSync(join(tmpdir(), 'portal-workspace-'));
    roots.push(workspace);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    const files = await Promise.all([savePortalScreenshot(workspace, 'Shop', capture), savePortalScreenshot(workspace, 'Shop', capture)]);
    expect(new Set(files.map((file) => file!.path)).size).toBe(2);
    expect(readdirSync(join(workspace, '.orkestrai', 'portal', 'screenshots'))).toHaveLength(2);
    for (const file of files) expect(readFileSync(file!.path).equals(PNG)).toBe(true);
  });
});
