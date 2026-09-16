import { lstat, mkdir, readdir, rename, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { computerNodeConfigSchema, type ComputerNodeConfig } from '../../contracts/schemas/computer.schema.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { workspacePathService } from './WorkspacePathService.js';
import type { Workspace } from '../../domain/types.js';

const MiB = 1024 * 1024;
export const COMPUTER_STORAGE_LIMITS = { totalBytes: 2048 * MiB, totalFiles: 5000, workspaceFiles: 1500, temporaryBytes: 32 * MiB, temporaryFiles: 64, temporaryMs: 15 * 60_000, minimumFreeBytes: 1024 * MiB };
const ownedFile = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;
type Entry = { path: string; bytes: number; modified: number };
export type ComputerStorageStats = { bytes: number; files: number; temporaryBytes: number; temporaryFiles: number; checkedAt: string | null; error: boolean };
const runtime = globalThis as typeof globalThis & { __orkestraiComputerStorageQueue?: Promise<unknown> };

export class ComputerEvidenceService {
  private stats = new Map<string, ComputerStorageStats>();

  usage(workspaceId: string): ComputerStorageStats {
    return this.stats.get(workspaceId) ?? { bytes: 0, files: 0, temporaryBytes: 0, temporaryFiles: 0, checkedAt: null, error: false };
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = (runtime.__orkestraiComputerStorageQueue ?? Promise.resolve()).catch(() => undefined).then(work);
    runtime.__orkestraiComputerStorageQueue = next.catch(() => undefined);
    return next;
  }

  private async directory(workspace: Workspace, kind: string): Promise<string> {
    const root = await workspacePathService.resolveExisting(workspace, '.');
    let current = root;
    for (const segment of ['.orkestrai', 'computer', kind]) {
      current = join(current, segment);
      const info = await lstat(current).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Computer storage directories must not be symbolic links.');
    }
    return workspacePathService.resolveWritable(workspace, `.orkestrai/computer/${kind}`);
  }

  async capture(workspaceId: string, config: ComputerNodeConfig, temporary: boolean, write: (path: string) => Promise<{ width: number | null; height: number | null }>, accept?: (path: string) => Promise<boolean>) {
    return this.serial(async () => {
      await this.sweepUnchecked();
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      if (!workspace) throw new Error('Workspace not found.');
      const pending = await this.directory(workspace, 'pending');
      const directory = await this.directory(workspace, temporary ? 'observations' : 'evidence');
      await mkdir(pending, { recursive: true, mode: 0o700 });
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const free = await statfs(directory);
      if (free.bavail * free.bsize < COMPUTER_STORAGE_LIMITS.minimumFreeBytes) throw new Error('Computer capture paused: less than 1 GiB of free disk space.');
      const evidenceId = uuidv7();
      const staging = join(pending, `${evidenceId}.png`);
      const destination = join(directory, `${evidenceId}.png`);
      try {
        const dimensions = await write(staging);
        const file = await lstat(staging);
        const limit = temporary ? COMPUTER_STORAGE_LIMITS.temporaryBytes : config.evidenceMaxMiB * MiB;
        if (!file.isFile() || file.isSymbolicLink() || file.size > Math.min(limit, 64 * MiB)) throw new Error('Computer capture exceeded its storage limit.');
        if (accept && !await accept(staging)) return null;
        if (!(await workspaceRepository.listNodes(workspaceId)).some((node) => node.type === 'computer')) throw new Error('The Computer node was removed during capture.');
        await rename(staging, destination);
        await this.sweepUnchecked(destination);
        const remaining = await statfs(directory);
        if (remaining.bavail * remaining.bsize < COMPUTER_STORAGE_LIMITS.minimumFreeBytes) throw new Error('Computer capture paused: less than 1 GiB of free disk space.');
        return { evidenceId, path: `.orkestrai/computer/${temporary ? 'observations' : 'evidence'}/${evidenceId}.png`, ...dimensions };
      } catch (error) {
        await unlink(destination).catch(() => undefined);
        throw error;
      } finally { await unlink(staging).catch(() => undefined); }
    }).catch((error) => {
      this.stats.set(workspaceId, { ...this.usage(workspaceId), checkedAt: new Date().toISOString(), error: true });
      throw error;
    });
  }

  async sweep(): Promise<void> { await this.serial(() => this.sweepUnchecked()); }

  private async entries(directory: string): Promise<Entry[]> {
    const entries: Entry[] = [];
    let files;
    try { files = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return entries; throw error; }
    for (const file of files) {
      if (!file.isFile() || !ownedFile.test(file.name)) continue;
      const path = join(directory, file.name);
      const info = await lstat(path).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (info?.isFile() && !info.isSymbolicLink()) entries.push({ path, bytes: info.size, modified: info.mtimeMs });
    }
    return entries.sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path));
  }

  private async trim(entries: Entry[], cutoff: number, maxBytes: number, maxFiles: number, protect?: string): Promise<Entry[]> {
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    let count = entries.length;
    const kept: Entry[] = [];
    for (const entry of entries) {
      if (entry.path !== protect && (entry.modified < cutoff || bytes > maxBytes || count > maxFiles)) {
        await unlink(entry.path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        bytes -= entry.bytes;
        count--;
      } else kept.push(entry);
    }
    if (bytes > maxBytes || count > maxFiles) throw new Error('Computer evidence quota could not be enforced.');
    return kept;
  }

  private async sweepUnchecked(protect?: string): Promise<void> {
    const workspaces = await workspaceRepository.listWorkspaces();
    const groups: { workspaceId: string; evidence: Entry[]; temporary: Entry[] }[] = [];
    const seen = new Set<string>();
    for (const workspace of workspaces) {
      try {
        const node = (await workspaceRepository.listNodes(workspace.id)).find((candidate) => candidate.type === 'computer');
        if (!node) continue;
        const config = computerNodeConfigSchema.parse((node.payload as Record<string, unknown>)?.computerConfig ?? {});
        const root = await workspacePathService.resolveWritable(workspace, '.orkestrai/computer');
        if (seen.has(root)) continue;
        seen.add(root);
        // Resolve each child too: never traverse a substituted evidence-directory symlink.
        const paths = await Promise.all(['evidence', 'observations', 'pending'].map((kind) => this.directory(workspace, kind)));
        const evidence = await this.trim(await this.entries(paths[0]), Date.now() - config.evidenceRetentionDays * 86_400_000, config.evidenceMaxMiB * MiB, COMPUTER_STORAGE_LIMITS.workspaceFiles, protect);
        const temporaryEntries = [...await this.entries(paths[1]), ...await this.entries(paths[2])].sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path));
        const temporary = await this.trim(temporaryEntries, Date.now() - COMPUTER_STORAGE_LIMITS.temporaryMs, COMPUTER_STORAGE_LIMITS.temporaryBytes, COMPUTER_STORAGE_LIMITS.temporaryFiles, protect);
        groups.push({ workspaceId: workspace.id, evidence, temporary });
      } catch {
        this.stats.set(workspace.id, { ...this.usage(workspace.id), checkedAt: new Date().toISOString(), error: true });
        throw new Error('Computer storage cleanup failed. Check workspace access and disk space.');
      }
    }
    const all = groups.flatMap((group) => [...group.evidence, ...group.temporary]).sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path));
    const kept = new Set((await this.trim(all, 0, COMPUTER_STORAGE_LIMITS.totalBytes, COMPUTER_STORAGE_LIMITS.totalFiles, protect)).map((entry) => entry.path));
    for (const group of groups) {
      const evidence = group.evidence.filter((entry) => kept.has(entry.path));
      const temporary = group.temporary.filter((entry) => kept.has(entry.path));
      this.stats.set(group.workspaceId, { bytes: evidence.reduce((sum, e) => sum + e.bytes, 0), files: evidence.length, temporaryBytes: temporary.reduce((sum, e) => sum + e.bytes, 0), temporaryFiles: temporary.length, checkedAt: new Date().toISOString(), error: false });
    }
    for (const id of this.stats.keys()) if (!workspaces.some((workspace) => workspace.id === id)) this.stats.delete(id);
  }
}

export const computerEvidenceService = new ComputerEvidenceService();
