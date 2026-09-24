import { describe, expect, it } from 'vitest';
import { fork, type ForkOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scannedPdf } from '../helpers/scanned-pdf.js';
import { knowledgeCanvasTarget, KNOWLEDGE_RUNTIME_FILES } from '../../scripts/package-knowledge-runtime.mjs';
import type { DocumentExtraction } from '$lib/modules/agent-room/infrastructure/knowledge/DocumentExtractor.js';

describe('offline packaged OCR runtime', () => {
  it('checks the actual pinned engine and font assets rather than obsolete PDF font names', async () => {
    for (const file of KNOWLEDGE_RUNTIME_FILES) expect((await stat(resolve('node_modules', file))).size).toBeGreaterThan(0);
  });
  it('runs actual OCR with Electron in Node mode and no network, without persisting document images', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ork-ocr-runtime-test-'));
    const bytes = await scannedPdf([{ text: 'Invoice 4567. Total: 650 reais.' }]);
    const electron = createRequire(import.meta.url)('electron') as string;
    const child = fork(resolve('src/lib/modules/agent-room/infrastructure/knowledge/document-worker.mjs'), [], {
      execPath: electron, execArgv: ['--require', resolve('tests/fixtures/knowledge-no-network.cjs')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced', windowsHide: true,
    } as ForkOptions & { windowsHide: boolean });
    const closed = new Promise(resolve => child.once('close', resolve));
    child.stdout?.resume(); child.stderr?.resume();
    let timer: ReturnType<typeof setTimeout>;
    try {
      const result = await new Promise<DocumentExtraction>((resolveResult, reject) => {
        timer = setTimeout(() => reject(new Error('OCR runtime timed out')), 25_000);
        child.once('error', reject);
        child.once('exit', () => reject(new Error('OCR runtime exited before completion')));
        child.on('message', (message: { type: string; result: DocumentExtraction }) => { if (message.type === 'complete') resolveResult(message.result); });
        child.send({ bytes, extension: 'pdf', directory });
      });
      expect(result.status).toBe('ready');
      expect(result.extraction?.ocrPages).toEqual([1]);
      expect(result.passages[0].text).toContain('4567');
      expect(await readdir(directory)).toEqual(expect.arrayContaining(['eng.traineddata.gz', 'por.traineddata.gz', 'spa.traineddata.gz']));
      expect((await readdir(directory)).length).toBe(3);
    } finally { clearTimeout(timer!); child.kill('SIGKILL'); await closed; await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
  it('targets the correct native rasterizer for every desktop package architecture', () => {
    for (const platform of ['darwin', 'linux', 'win32']) for (const arch of ['arm64', 'x64']) {
      const target = knowledgeCanvasTarget(platform, arch);
      expect(target.name).toContain(`${platform}-${arch}`);
      expect(target.binary).toContain(`${platform}-${arch}`);
    }
    expect(knowledgeCanvasTarget('darwin', 1).name).toBe('@napi-rs/canvas-darwin-x64');
    expect(() => knowledgeCanvasTarget('win32', 'ia32')).toThrow();
  });
});
