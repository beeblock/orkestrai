// Model cold ESM evaluation: an IPC payload sent at fork time can arrive before
// the parser registers its message listener. Only its ready handshake admits it.
import { setTimeout } from 'node:timers/promises';
await setTimeout(200);
await import('../../src/lib/modules/agent-room/infrastructure/knowledge/document-worker.mjs');
