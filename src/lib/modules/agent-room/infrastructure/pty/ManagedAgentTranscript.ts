import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
/** Owned by Orkestrai on the guest; independent of every provider's authentication directory. */
export function managedTranscriptRoot(cwd: string): string {
  return join(resolve(process.env.ORKESTRAI_DATA_DIR ?? 'storage'), 'model-access', 'transcripts', createHash('sha256').update(cwd).digest('hex').slice(0, 32));
}
export function managedTranscriptPath(cwd: string, sessionId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sessionId)) throw new Error('INFERENCE_SESSION_INVALID');
  return join(managedTranscriptRoot(cwd), `${sessionId}.jsonl`);
}
