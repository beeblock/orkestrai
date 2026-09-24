import { fork, type ForkOptions } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { knowledgeTextTruncated, textPassages, type KnowledgeDocument } from '../../domain/knowledge.js';

export type DocumentExtraction = Pick<KnowledgeDocument, 'passages' | 'status' | 'truncated' | 'extraction'>;
export const KNOWLEDGE_EXTRACTOR_VERSION = 'pdf-ocr-1';
let pending: Promise<unknown> = Promise.resolve();

export function knowledgeParserEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' };
  for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (env[key]) result[key] = env[key];
  }
  return result;
}

export async function extractKnowledgeDocument(bytes: Uint8Array, extension: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<DocumentExtraction> {
  if (['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'xml', 'log'].includes(extension)) {
    const content = new TextDecoder().decode(bytes);
    if (content.includes('\0')) return { passages: [], status: 'unsupported', truncated: false };
    const passages = textPassages(content);
    return { passages, status: passages.length ? 'ready' : 'empty', truncated: knowledgeTextTruncated(content) };
  }
  if (!['pdf', 'xlsx', 'csv'].includes(extension)) return { passages: [], status: 'unsupported', truncated: false };
  // A process boundary also kills Tesseract's WASM worker on timeout or parent exit.
  // Keep native raster buffers and parser failures outside the application server.
  const run = pending.catch(() => undefined).then(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-document-'));
    try {
      return await new Promise<DocumentExtraction>((resolveResult) => {
        const failed: DocumentExtraction = { passages: [], truncated: false, status: 'error' };
        if (options.signal?.aborted) { resolveResult(failed); return; }
        let latest = failed;
        let settled = false;
        const worker = fork(resolve('src/lib/modules/agent-room/infrastructure/knowledge/document-worker.mjs'), [], {
          execArgv: ['--max-old-space-size=256'], serialization: 'advanced', windowsHide: true,
          env: knowledgeParserEnvironment(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        } as ForkOptions & { windowsHide: boolean });
        const finish = (result: DocumentExtraction) => {
          if (settled) return;
          settled = true; clearTimeout(timeout); options.signal?.removeEventListener('abort', abort);
          worker.kill('SIGKILL');
          // Do not start another parser before this one (including nested workers) exits.
          if (worker.exitCode !== null || worker.signalCode !== null) resolveResult(result);
          else worker.once('close', () => resolveResult(result));
        };
        const interrupted = (issue: 'timeout' | 'cancelled' | 'parser_error') => finish({
          ...latest, status: latest.passages.length ? 'ready' : 'error', truncated: true,
          ...(latest.extraction ? { extraction: { ...latest.extraction, issue } } : {}),
        });
        const abort = () => interrupted('cancelled');
        const timeout = setTimeout(() => interrupted('timeout'), Math.min(options.timeoutMs ?? (extension === 'pdf' ? 120_000 : 20_000), 120_000));
        options.signal?.addEventListener('abort', abort, { once: true });
        worker.stdout?.resume(); worker.stderr?.resume();
        worker.on('message', (message: { type: string; result: DocumentExtraction }) => {
          latest = message.result;
          if (message.type === 'complete') finish(latest);
        });
        worker.once('error', () => interrupted('parser_error'));
        worker.once('exit', () => { if (!settled) interrupted('parser_error'); });
        worker.send({ bytes, extension, directory }, error => { if (error) interrupted('parser_error'); });
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }).catch((): DocumentExtraction => ({ passages: [], truncated: false, status: 'error' }));
  pending = run;
  return run;
}
