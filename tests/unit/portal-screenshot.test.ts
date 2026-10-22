import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PORTAL_SCREENSHOT_DIRECTORY, savePortalScreenshot } from '$lib/modules/agent-room/application/services/ManagedPortalService.js';
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
