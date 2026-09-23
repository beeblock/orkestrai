import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { knowledgeTextTruncated, textPassages, type KnowledgeDocument } from '../../domain/knowledge.js';

export type DocumentExtraction = Pick<KnowledgeDocument, 'passages' | 'status' | 'truncated'>;
let pending: Promise<unknown> = Promise.resolve();

export async function extractKnowledgeDocument(bytes: Uint8Array, extension: string): Promise<DocumentExtraction> {
  if (['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'xml', 'log'].includes(extension)) {
    const content = new TextDecoder().decode(bytes);
    if (content.includes('\0')) return { passages: [], status: 'unsupported', truncated: false };
    const passages = textPassages(content);
    return { passages, status: passages.length ? 'ready' : 'empty', truncated: knowledgeTextTruncated(content) };
  }
  if (!['pdf', 'xlsx', 'csv'].includes(extension)) return { passages: [], status: 'unsupported', truncated: false };
  // One bounded parser at a time, shared across workspaces. Terminate on timeout/OOM.
  const run = pending.catch(() => undefined).then(() => new Promise<DocumentExtraction>((resolveResult) => {
    const worker = new Worker(resolve('src/lib/modules/agent-room/infrastructure/knowledge/document-worker.mjs'), {
      workerData: { bytes, extension }, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
      stdout: true, stderr: true,
    });
    let settled = false;
    const finish = (result: DocumentExtraction) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      void worker.terminate().finally(() => resolveResult(result));
    };
    const failed: DocumentExtraction = { passages: [], truncated: false, status: 'error' };
    const timeout = setTimeout(() => finish(failed), 20_000);
    worker.stdout?.resume(); worker.stderr?.resume();
    worker.once('message', finish);
    worker.once('error', () => finish(failed));
    worker.once('exit', () => { if (!settled) finish(failed); });
  }));
  pending = run;
  return run;
}
