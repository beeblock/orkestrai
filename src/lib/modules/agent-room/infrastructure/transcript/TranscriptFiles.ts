import { open, readdir, realpath, stat } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';

const paths = new Map<string, { at: number; value: Promise<string | null> }>();
const listings = new Map<string, { at: number; value: Promise<Array<{ path: string; mtime: number }>> }>();
const CACHE_LIMIT = 128;

function trimCache<T>(cache: Map<string, T>): void {
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export async function transcriptCwd(cwd: string, posixCwd = false): Promise<string> {
  return posixCwd ? posix.normalize(cwd) : realpath(cwd).catch(() => resolve(cwd));
}

/** Async filesystem operations must not stall PTY input, especially on WSL UNC. */
export async function transcriptTail(path: string, maxBytes: number, head = false): Promise<string | null> {
  const file = await open(path, 'r').catch(() => null);
  if (!file) return null;
  try {
    const { size } = await file.stat();
    const start = head ? 0 : Math.max(0, size - maxBytes);
    const buffer = Buffer.allocUnsafe(Math.min(size, maxBytes));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8', 0, bytesRead);
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return null;
  } finally {
    await file.close();
  }
}

export async function transcriptExists(path: string): Promise<boolean> {
  return stat(path).then((value) => value.isFile(), () => false);
}

export async function transcriptRevision(path: string, since: number): Promise<string | null> {
  return stat(path).then((value) => value.isFile() && value.mtimeMs >= since - 2_000
    ? `${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}` : null, () => null);
}

export function findTranscriptFile(root: string, sessionId: string, maxDepth: number): Promise<string | null> {
  const key = JSON.stringify([root, sessionId, maxDepth]);
  const cached = paths.get(key);
  if (cached && Date.now() - cached.at < 2_000) return cached.value;
  const walk = async (dir: string, depth: number): Promise<string | null> => {
    if (depth > maxDepth) return null;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    // Recent date directories first; exact session ids still select the result.
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith(`-${sessionId}.jsonl`)) return path;
      if (entry.isDirectory()) {
        const found = await walk(path, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  const value = (async () => {
    // A known file avoids scanning years of session directories on every poll.
    const previous = await cached?.value;
    return previous && await transcriptExists(previous) ? previous : walk(root, 0);
  })();
  paths.set(key, { at: Date.now(), value });
  trimCache(paths);
  return value;
}

export function recentTranscriptFiles(root: string, maxDepth: number): Promise<Array<{ path: string; mtime: number }>> {
  const key = JSON.stringify([root, maxDepth]);
  const cached = listings.get(key);
  if (cached && Date.now() - cached.at < 1_000) return cached.value;
  const value = (async () => {
    const files: Array<{ path: string; mtime: number }> = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const info = await stat(path).catch(() => null);
          if (info) files.push({ path, mtime: info.mtimeMs });
        }
      }
    };
    await walk(root, 0);
    return files.sort((a, b) => b.mtime - a.mtime);
  })();
  listings.set(key, { at: Date.now(), value });
  trimCache(listings);
  return value;
}
