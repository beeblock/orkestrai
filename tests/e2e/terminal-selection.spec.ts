import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function wordBox(page: Page, word: string) {
  return page.locator('.xterm-rows').evaluate((rows, word) => {
    const walker = document.createTreeWalker(rows, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(word) ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + word.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    throw new Error(`Missing rendered word: ${word}`);
  }, word);
}

for (const dpr of [1, 1.5]) {
  test.describe(`terminal selection at device scale ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width: 1400, height: 1000 } });
    test('copies exactly the pointed text after zoom, scroll, and remount', async ({ page, request }) => {
      test.setTimeout(60_000);
      const root = await mkdtemp(join(tmpdir(), 'orkestrai-selection-'));
      const response = await request.post('/api/agent-room/workspaces', {
        data: { name: 'E2E terminal selection', workingDir: root, codeIntelligenceMode: 'manual' },
      });
      const workspace = (await response.json()).data;
      try {
        await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
          data: { type: 'terminal', title: 'Selection probe', x: 40, y: 40, width: 760, height: 480,
            payload: { command: process.execPath, args: ['-e', 'setTimeout(()=>{process.stdout.write("\\x1b[2J\\x1b[H");for(let i=0;i<60;i++)console.log("line"+i+" alpha bravo charlie");},500);setInterval(()=>{},1000)'] } },
        });
        await page.addInitScript(() => {
          (window as any).orkestraiDesktop = { writeClipboardText: async (text: string) => { (window as any).__copied = text; return true; } };
        });
        await page.goto(`/canvas?workspace=${workspace.id}`);
        await expect(page.locator('.xterm-rows')).toContainText('line59');
        for (const scale of [0.55, 1.25]) {
          await page.locator('.svelte-flow__viewport').evaluate((element, scale) => {
            (element as HTMLElement).style.setProperty('transform', `translate(60px, 80px) scale(${scale})`, 'important');
          }, scale);
          // Use the actual rendered glyph, not xterm internals or assumed metrics.
          const box = await wordBox(page, 'bravo');
          await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
          await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe('bravo');
          await page.screenshot({ path: `/tmp/orkestrai-selection-${dpr}-${scale}.png` });

          await page.mouse.move(box.x + 0.1, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width - 0.1, box.y + box.height / 2, { steps: 8 });
          await page.mouse.up();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
          await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe('bravo');
        }
        await page.mouse.wheel(0, -160);
        await page.waitForTimeout(150);
        const scrolled = await wordBox(page, 'charlie');
        await page.mouse.dblclick(scrolled.x + scrolled.width / 2, scrolled.y + scrolled.height / 2);
        await page.mouse.click(scrolled.x + scrolled.width / 2, scrolled.y + scrolled.height / 2, { button: 'right' });
        await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe('charlie');
        await page.reload();
        await expect(page.locator('.xterm-rows')).toContainText('line59');
        const restored = await wordBox(page, 'alpha');
        await page.mouse.dblclick(restored.x + restored.width / 2, restored.y + restored.height / 2);
        await page.mouse.click(restored.x + restored.width / 2, restored.y + restored.height / 2, { button: 'right' });
        await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe('alpha');
        await page.goto(`/terminal?workspace=${workspace.id}`);
        await page.getByRole('button', { name: 'Selection probe Terminal Terminal', exact: true }).click();
        await expect(page.locator('.xterm-rows')).toContainText('line59');
        const workbench = await wordBox(page, 'bravo');
        await page.mouse.dblclick(workbench.x + workbench.width / 2, workbench.y + workbench.height / 2);
        await page.mouse.click(workbench.x + workbench.width / 2, workbench.y + workbench.height / 2, { button: 'right' });
        await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe('bravo');
        await page.screenshot({ path: `/tmp/orkestrai-selection-${dpr}-workbench.png` });
      } finally {
        await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
        await rm(root, { recursive: true, force: true });
      }
    });
  });
}
