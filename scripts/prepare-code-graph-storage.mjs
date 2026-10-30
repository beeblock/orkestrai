import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';

/** Startup-only move. Runtime queries use the private asynchronous ORM transport. */
/** @param {string} source @param {{onPhase?: (phase: string) => void | Promise<void>, workerPath?: string}} [options] */
export async function prepareCodeGraphStorage(source, { onPhase, workerPath = resolve('electron/code-graph-storage-worker.cjs') } = {}) {
  await onPhase?.('migrating');
  const worker = new Worker(workerPath, { workerData: { source, filename: `${source}.code-graph.sqlite` } });
  let timer;
  try {
    return await new Promise((resolveReady, reject) => {
      timer = setTimeout(() => reject(new Error('Code graph preparation timed out; existing data was preserved.')), 10 * 60_000);
      worker.on('error', reject);
      worker.on('exit', code => reject(new Error(`Code graph preparation stopped (${code}).`)));
      worker.on('message', message => {
        if (message.ready) worker.postMessage({ id: 1, operation: 'retire-legacy' });
        else if (message.id === 1) {
          if (message.error) reject(new Error(message.error.message));
          else resolveReady(message.result);
        }
      });
    });
  } finally { clearTimeout(timer); await worker.terminate(); }
}
