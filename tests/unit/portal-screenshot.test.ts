import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PORTAL_SCREENSHOT_DIRECTORY, pruneOwnPortalScreenshots, savePortalScreenshot } from '$lib/modules/agent-room/application/services/ManagedPortalService.js';
import { portalScreenshotMessage } from '../../packages/orkestrai-cli/src/portal-reference.js';

// A 1x1 PNG: signature, IHDR with width 1 and height 1.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const capture = { dataUrl: `data:image/png;base64,${PNG.toString('base64')}`, width: 1, height: 1 };

describe('Portal screenshots for agents', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('saves the capture as a PNG inside the workspace and keeps only recent ones', async () => {
    const root = mkdtempSync(join(tmpdir(), 'portal-shot-'));
    roots.push(root);
    const file = await savePortalScreenshot(root, 'Loja · Checkout', capture);
    expect(file).toMatchObject({ width: 1, height: 1 });
    expect(file!.relativePath).toMatch(/^\.orkestrai\/portal\/screenshots\/loja-checkout-.+\.png$/);
    expect(readFileSync(file!.path).equals(PNG)).toBe(true);
    for (let index = 0; index < 45; index += 1) await savePortalScreenshot(root, `shot ${index}`, capture);
    expect(readdirSync(join(root, PORTAL_SCREENSHOT_DIRECTORY)).length).toBe(40);
  });

  it('prunes only captures it wrote, leaving other files in the folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'portal-shot-'));
    roots.push(root);
    const saved = [];
    for (let index = 0; index < 3; index += 1) saved.push(await savePortalScreenshot(root, 'Shop', capture));
    const directory = realpathSync(join(root, PORTAL_SCREENSHOT_DIRECTORY));
    writeFileSync(join(directory, 'owner.png'), 'owner');
    await pruneOwnPortalScreenshots(directory, 1);
    expect(readdirSync(directory).sort()).toEqual([basename(saved[2]!.path), 'owner.png'].sort());
  });

  it.skipIf(process.platform === 'win32')('deletes nothing through a screenshots folder exchanged for a link elsewhere', async () => {
    const root = mkdtempSync(join(tmpdir(), 'portal-shot-'));
    const outside = mkdtempSync(join(tmpdir(), 'portal-outside-'));
    roots.push(root, outside);
    const saved = [];
    for (let index = 0; index < 3; index += 1) saved.push(await savePortalScreenshot(root, 'Shop', capture));
    const directory = realpathSync(join(root, PORTAL_SCREENSHOT_DIRECTORY));
    // The owner's files outside, some under the very names of the captures.
    const names = saved.map((file) => basename(file!.path));
    for (const name of names) writeFileSync(join(outside, name), 'owner copy');
    writeFileSync(join(outside, 'photo.png'), 'photo');
    renameSync(directory, `${directory}-moved`);
    symlinkSync(outside, directory);
    await pruneOwnPortalScreenshots(directory, 0);
    expect(readdirSync(outside).sort()).toEqual([...names, 'photo.png'].sort());
    for (const name of names) expect(readFileSync(join(outside, name), 'utf8')).toBe('owner copy');
  });

  it('refuses anything that is not a PNG data URL', async () => {
    const root = mkdtempSync(join(tmpdir(), 'portal-shot-'));
    roots.push(root);
    expect(await savePortalScreenshot(root, null, { dataUrl: 'data:text/html;base64,PGh0bWw+' })).toBeNull();
    expect(await savePortalScreenshot(root, null, { dataUrl: 'data:image/png;base64,aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=' })).toBeNull();
    expect(await savePortalScreenshot(root, null, null)).toBeNull();
  });

  it('tells the agent where the PNG is instead of printing base64', () => {
    const message = portalScreenshotMessage({ ok: true, result: { path: '/w/.orkestrai/portal/screenshots/a.png', relativePath: '.orkestrai/portal/screenshots/a.png', width: 1280, height: 800 } });
    expect(message).toContain('.orkestrai/portal/screenshots/a.png (1280x800)');
    expect(message).toContain('/w/.orkestrai/portal/screenshots/a.png');
    expect(message).not.toContain('base64');
  });
});
