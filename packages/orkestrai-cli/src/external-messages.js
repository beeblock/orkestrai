import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const nonce = /^[a-f0-9]{32}$/;
/** @param {any} value */
const credentials = value => value && nonce.test(value.clientId) && nonce.test(value.requestId) && /^[a-f0-9]{64}$/.test(value.receipt);
const LIMIT = 4096;

/** Private, bounded return addresses, never credentials in a workspace/project.
 * @param {{home: string, token: string, call: (method: string, path: string, body?: any) => Promise<any>}} options
 */
export function externalMessages({ home, token, call }) {
  const scope = createHash('sha256').update(token).digest('hex');
  const directory = join(home, '.orkestrai', 'external-messages', scope);
  const clientId = randomBytes(16).toString('hex');
  const active = new Set();
  const announced = new Set();
  let scanOffset = 0;
  async function prepare() {
    for (const path of [join(home, '.orkestrai'), join(home, '.orkestrai', 'external-messages'), directory]) {
      await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && path !== join(home, '.orkestrai') && (stat.mode & 0o077))) throw new Error('External message storage must be a private directory.');
    }
  }
  /** @param {string} id */
  async function read(id) {
    if (!nonce.test(id)) throw new Error('Use the receiptId returned by the external ask.');
    await prepare();
    const path = join(directory, `${id}.json`);
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) throw new Error('Invalid external message receipt.');
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 || stat.dev !== before.dev || stat.ino !== before.ino
        || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Invalid external message receipt.');
      const value = JSON.parse(await handle.readFile('utf8'));
      if (!credentials(value) || value.requestId !== id) throw new Error('Invalid external message receipt.');
      return { clientId: value.clientId, requestId: value.requestId, receipt: value.receipt };
    } finally { await handle.close(); }
  }
  async function reserve() {
    await prepare();
    const entries = await opendir(directory);
    let count = 0;
    for await (const entry of entries) {
      if (++count >= LIMIT) throw new Error('External message receipt storage is full. Keep pending receipts; remove old completed receipts before sending more.');
    }
    const directoryStat = await lstat(directory);
    const external = { clientId, requestId: randomBytes(16).toString('hex'), receipt: randomBytes(32).toString('hex') };
    const handle = await open(join(directory, `${external.requestId}.json`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const [parent, named, opened] = await Promise.all([lstat(directory), lstat(join(directory, `${external.requestId}.json`)), handle.stat()]);
      if (parent.isSymbolicLink() || parent.dev !== directoryStat.dev || parent.ino !== directoryStat.ino
        || named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino) throw new Error('External message storage changed during creation.');
      await handle.writeFile(JSON.stringify(external)); await handle.sync();
    } finally { await handle.close(); }
    return external;
  }
  /** @param {string} id */
  async function result(id, waitMs = 0) {
    const external = await read(id);
    const value = await call('POST', '/api/agent-room/bridge/messages/result', { external, waitMs });
    active.add(id);
    return { ...value, receiptId: id };
  }
  return {
    /** @param {Record<string, any>} body */
    async ask(body) {
      const { receiptId, ...request } = body;
      const external = receiptId ? await read(receiptId) : await reserve();
      active.add(external.requestId);
      let value;
      try { value = await call('POST', '/api/agent-room/bridge/ask', { ...request, from: null, external }); }
      catch { throw new Error(`External ask was not confirmed. Read receiptId ${external.requestId}; if the request never arrived, retry ask with that same receiptId and unchanged content.`); }
      if (!value.externalReply && value.inbox) throw new Error('This Core cannot return external agent replies. Update Core before using external asks; the submitted message must not be resent blindly.');
      // Plain shells retain their synchronous output contract.
      if (!value.externalReply) { active.delete(external.requestId); await unlink(join(directory, `${external.requestId}.json`)); return value; }
      if (value.replyConfirmed) announced.add(external.requestId);
      return { ...value, receiptId: external.requestId,
        ...(!value.replyConfirmed ? { nextAction: 'Use message_wait with this receiptId, or message_read later. Do not resend the ask.' } : {}) };
    },
    result,
    async inbox(limit = 10) {
      const items = [];
      const pending = [...active].filter(id => !announced.has(id));
      const selected = [...pending.slice(scanOffset), ...pending.slice(0, scanOffset)].slice(0, Math.max(1, Math.min(50, limit)));
      scanOffset = pending.length ? (scanOffset + selected.length) % pending.length : 0;
      for (const id of selected) {
        const value = await result(id);
        if (value.replyConfirmed) items.push({ id: value.messageId, receiptId: id, kind: 'reply', content: value.reply });
      }
      return { items, remaining: 0 };
    },
    /** @param {Array<{receiptId?: string}>} items */
    acknowledge(items) { for (const item of items) if (item.receiptId) { announced.add(item.receiptId); active.delete(item.receiptId); } },
  };
}
