import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transcriptTail } from '../../infrastructure/transcript/TranscriptFiles.js';

const MAX_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 10_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sensitive = /^(?:\.env(?:\..*)?|\.?credentials(?:\.json)?|auth\.json)$|\.(?:pem|p12|key)$/i;

type Artifact = { source: string; target: string; relative: string; size: number; dev: number; ino: number };
type TransferInput = { sessionId: string; cwd: string; posixCwd?: boolean; homeDir?: string; sourceRoot?: string; targetRoot?: string };

/** Only the explicitly selected conversation; never credentials, settings or other sessions. */
export class ProfileSessionContinuityService {
  async prepare(input: TransferInput): Promise<{ commit: () => Promise<void> }> {
    if (!UUID.test(input.sessionId)) throw new Error('PROFILE_SESSION_INVALID');
    const sourceRoot = await realpath(input.sourceRoot ?? join(input.homeDir ?? homedir(), '.claude'));
    const targetRoot = await realpath(input.targetRoot ?? join(input.homeDir ?? homedir(), '.claude'));
    const cwd = input.posixCwd ? input.cwd : await realpath(input.cwd);
    const project = join('projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    const transcript = join(project, `${input.sessionId}.jsonl`);
    const source = join(sourceRoot, transcript);
    await this.safePath(sourceRoot, transcript, false);
    const samples = await Promise.all([transcriptTail(source, 256 * 1024, true), transcriptTail(source, 256 * 1024)]);
    const resumable = samples.some(text => text?.split('\n').some(line => {
      try { const record = JSON.parse(line); return record.sessionId === input.sessionId && record.isSidechain === false
        && ['user', 'assistant'].includes(record.type); } catch { return false; }
    }));
    if (!resumable) throw new Error('PROFILE_SAVED_CONVERSATION_UNAVAILABLE');
    if (sourceRoot === targetRoot) return { commit: async () => {} };
    const scan = async () => {
      const files: Artifact[] = [];
      let entries = 0, totalBytes = 0;
      const visit = async (rel: string, required = false, depth = 0): Promise<void> => {
        if (depth > 8 || ++entries > MAX_FILES) throw new Error('PROFILE_SESSION_TOO_LARGE');
        const path = join(sourceRoot, rel);
        let item;
        try { item = await lstat(path); } catch (error) {
          if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        if (item.isSymbolicLink() || sensitive.test(rel.split(/[/\\]/).at(-1)!)) throw new Error('PROFILE_SESSION_UNSAFE_PATH');
        await this.safePath(sourceRoot, rel, false);
        await this.safePath(targetRoot, rel, true);
        if (item.isDirectory()) {
          const destination = await lstat(join(targetRoot, rel)).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          });
          if (destination && !destination.isDirectory()) throw new Error('PROFILE_SESSION_CONFLICT');
          for (const child of await readdir(path)) await visit(join(rel, child), true, depth + 1);
        } else {
          if (!item.isFile()) throw new Error('PROFILE_SESSION_UNSAFE_PATH');
          const target = join(targetRoot, rel);
          const current = await lstat(target).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          });
          if (current && (!current.isFile() || current.isSymbolicLink() || current.size > item.size
            || !(await this.prefixMatches(path, target, current.size)))) throw new Error('PROFILE_SESSION_CONFLICT');
          files.push({ source: path, target, relative: rel, size: item.size, dev: item.dev, ino: item.ino });
          if ((totalBytes += item.size) > MAX_BYTES) throw new Error('PROFILE_SESSION_TOO_LARGE');
        }
      };
      await visit(transcript, true);
      // Session-scoped result files, subagent transcripts and rewind snapshots.
      await visit(join(project, input.sessionId));
      await visit(join('file-history', input.sessionId));
      const bytes = files.reduce((total, file) => total + file.size, 0);
      const disk = await statfs(targetRoot);
      if (disk.bavail * disk.bsize < bytes + 512 * 1024 * 1024) throw new Error('PROFILE_SESSION_NO_SPACE');
      return files;
    };
    await scan(); // Validate every source and destination before stopping the old PTY.
    return { commit: async () => {
      const files = await scan(); // The caller has now stopped the provider; include its final writes.
      const stage = join(targetRoot, `.orkestrai-session-transfer-${randomUUID()}`);
      await mkdir(stage, { mode: 0o700 });
      const stageIdentity = await lstat(stage);
      try {
        for (let index = 0; index < files.length; index++) {
          const file = files[index];
          await this.safePath(sourceRoot, file.relative, false);
          const from = await open(file.source, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const before = await from.stat();
            if (before.dev !== file.dev || before.ino !== file.ino || before.size !== file.size) throw new Error('PROFILE_SESSION_CHANGED');
            const to = await open(join(stage, String(index)), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
            try {
              const buffer = Buffer.allocUnsafe(64 * 1024);
              for (let at = 0; at < before.size;) {
                const { bytesRead } = await from.read(buffer, 0, Math.min(buffer.length, before.size - at), at);
                if (!bytesRead) throw new Error('PROFILE_SESSION_CHANGED');
                let written = 0;
                while (written < bytesRead) written += (await to.write(buffer, written, bytesRead - written)).bytesWritten;
                at += bytesRead;
              }
              await to.sync();
            } finally { await to.close(); }
            const after = await from.stat();
            if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('PROFILE_SESSION_CHANGED');
          } finally { await from.close(); }
        }
        // Recheck ALL targets after staging; a conflict leaves the existing transcripts intact.
        await scan();
        // Install companions before the transcript, so no reader sees incomplete context.
        for (const index of [...files.keys()].sort((a, b) => (files[a].relative === transcript ? 1 : 0) - (files[b].relative === transcript ? 1 : 0))) {
          const file = files[index];
          await this.ensureParent(targetRoot, file.relative);
          await this.safePath(targetRoot, file.relative, true);
          await rename(join(stage, String(index)), file.target);
        }
      } finally {
        const current = await lstat(stage).catch(() => null);
        if (current?.isDirectory() && !current.isSymbolicLink() && current.dev === stageIdentity.dev && current.ino === stageIdentity.ino
          && await realpath(stage) === stage) await rm(stage, { recursive: true, force: true });
      }
    } };
  }

  private async safePath(root: string, rel: string, missing: boolean): Promise<void> {
    const target = resolve(root, rel);
    if (relative(root, target).startsWith('..') || target === root) throw new Error('PROFILE_SESSION_UNSAFE_PATH');
    let current = root;
    const parts = rel.split(/[/\\]/);
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      try {
        const item = await lstat(current);
        if (item.isSymbolicLink() || (index < parts.length - 1 && !item.isDirectory())) throw new Error('PROFILE_SESSION_UNSAFE_PATH');
      } catch (error) {
        if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    }
  }

  private async ensureParent(root: string, rel: string): Promise<void> {
    const parent = dirname(rel);
    await this.safePath(root, parent, true);
    await mkdir(join(root, parent), { recursive: true, mode: 0o700 });
    await this.safePath(root, parent, false);
  }

  private async prefixMatches(source: string, target: string, length: number): Promise<boolean> {
    const from = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const into = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const left = Buffer.allocUnsafe(64 * 1024), right = Buffer.allocUnsafe(left.length);
        for (let at = 0; at < length;) {
          const size = Math.min(left.length, length - at);
          const [a, b] = await Promise.all([from.read(left, 0, size, at), into.read(right, 0, size, at)]);
          if (a.bytesRead !== size || b.bytesRead !== size || !left.subarray(0, size).equals(right.subarray(0, size))) return false;
          at += size;
        }
        return true;
      } finally { await into.close(); }
    } finally { await from.close(); }
  }
}

export const profileSessionContinuityService = new ProfileSessionContinuityService();
