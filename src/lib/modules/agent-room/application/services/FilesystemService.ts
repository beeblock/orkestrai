import { mkdir, open, opendir, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { workspacePathService } from './WorkspacePathService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { openDesktopFolder } from '../../infrastructure/DesktopFolderClient.js';
import { codeGraphGeneratedRoots, isCodeGraphGeneratedPath } from '../../infrastructure/code-graph/CodeGraphSourcePolicy.js';
import { isFloorRuntimePath } from '../../infrastructure/FloorSnapshotPolicy.js';
import type { OpenWorkspaceFolderDto } from '../dto/OpenWorkspaceFolderDto.js';

export type FsEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
};

export type FsInspection = {
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
  contentType: string;
  kind: 'text' | 'markdown' | 'image' | 'pdf' | 'audio' | 'binary';
};

const MAX_READ_BYTES = 512 * 1024; // 512 KB
const MAX_BUFFERED_BINARY_BYTES = 64 * 1024 * 1024;
const IGNORED = new Set(['.git', 'node_modules', '.svelte-kit', 'build', 'dist']);
const execFileAsync = promisify(execFile);
const mutationKey = Symbol.for('orkestrai.workspaceFileMutations');
const mutationGlobals = globalThis as typeof globalThis & { [mutationKey]?: Map<string, Promise<unknown>> };
const mutations = mutationGlobals[mutationKey] ??= new Map<string, Promise<unknown>>();

/** Retain serialized writes/deletes after removing synchronous filesystem I/O.
 * A slow write holds only this path; unrelated files and Core remain usable. */
async function mutateFile<T>(file: string, run: () => Promise<T>): Promise<T> {
  let ancestor = file;
  const missing: string[] = [];
  let canonical: string;
  for (;;) {
    try { canonical = join(await realpath(ancestor), ...missing); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
      missing.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const previous = mutations.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(run);
  mutations.set(key, pending);
  try { return await pending; }
  finally { if (mutations.get(key) === pending) mutations.delete(key); }
}

/**
 * Acesso ao filesystem confinado ao working_dir do workspace.
 */
export class FilesystemService {
  async openFolder(dto: OpenWorkspaceFolderDto): Promise<{ opened: true; path: string }> {
    const workspace = await workspaceRepository.getWorkspace(dto.workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const candidate = await workspacePathService.resolveExisting(workspace, dto.path);
    const details = await stat(candidate);
    if (dto.select ? !details.isFile() && !details.isDirectory() : !details.isDirectory()) {
      throw new Error('The requested path is not a supported file or folder.');
    }
    const alias = dto.path.match(/^@([a-z0-9][a-z0-9_-]*)/i)?.[1];
    const root = await workspacePathService.resolveExisting(workspace, alias ? `@${alias}` : '.');
    return autonomyPolicyService.execute({
      workspaceId: workspace.id, capability: 'filesystem', operation: dto.select ? 'filesystem.reveal_file' : 'filesystem.open_folder',
      actorType: dto.actorId ? 'agent' : 'user', actorId: dto.actorId, mutation: false,
      filesystem: { path: candidate, permission: 'read' }, input: { path: dto.path },
    }, async () => {
      if (dto.select) await openDesktopFolder(root, candidate, true);
      else await openDesktopFolder(root, candidate);
      return { opened: true as const, path: dto.path };
    });
  }

  private async root(workspaceId: string): Promise<string> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace nao encontrado.');
    return resolve(workspace.workingDir);
  }

  private async resolveSafe(workspaceId: string, path?: string | null): Promise<string> {
    const root = await this.root(workspaceId);
    const input = (path ?? '').trim();
    // Caminho absoluto e aceito desde que dentro do root; relativo resolve contra o root.
    const resolved = input.startsWith(sep) || /^[A-Za-z]:[\\/]/.test(input) ? resolve(input) : resolve(root, input);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new Error('Caminho fora do diretorio do workspace.');
    }
    return resolved;
  }

  async list(workspaceId: string, path?: string | null): Promise<FsEntry[]> {
    const dir = await this.resolveSafe(workspaceId, path);
    if (!(await stat(dir).catch(() => null))?.isDirectory()) {
      throw new Error(`Diretorio nao encontrado: ${path ?? '/'}`);
    }
    const files = (await readdir(dir, { withFileTypes: true })).filter(entry => !IGNORED.has(entry.name));
    const entries: FsEntry[] = [];
    // A large asset directory must not synchronously stat thousands of files
    // or enqueue all of them on libuv's filesystem thread pool at once.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, async () => {
      for (let index = next++; index < files.length; index = next++) {
        const entry = files[index];
        const fullPath = join(dir, entry.name);
        const size = entry.isFile() ? await stat(fullPath).then(info => info.size, () => 0) : 0;
        entries[index] = {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
          size,
        };
      }
    }));
    return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  }

  async read(workspaceId: string, path: string): Promise<{ path: string; content: string; truncated: boolean }> {
    const file = await this.resolveSafe(workspaceId, path);
    const info = await stat(file);
    if (!info.isFile()) throw new Error(`Arquivo nao encontrado: ${path}`);
    const handle = await open(file, 'r');
    let content: string;
    try {
      const chunk = Buffer.alloc(Math.min(MAX_READ_BYTES, info.size));
      const { bytesRead } = chunk.length ? await handle.read(chunk, 0, chunk.length, 0) : { bytesRead: 0 };
      content = chunk.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
    return {
      path: file,
      content,
      truncated: info.size > MAX_READ_BYTES,
    };
  }

  async inspect(workspaceId: string, path: string): Promise<FsInspection> {
    const file = await this.resolveSafe(workspaceId, path);
    const info = await stat(file);
    if (!info.isFile()) throw new Error(`Arquivo nao encontrado: ${path}`);
    const name = file.split(/[\\/]/).at(-1) ?? 'arquivo';
    const normalizedName = name.toLowerCase();
    const extension = name.includes('.') ? (name.split('.').at(-1)?.toLowerCase() ?? '') : '';
    const imageTypes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
    };
    const textTypes: Record<string, string> = {
      js: 'text/javascript', jsx: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
      ts: 'text/typescript', tsx: 'text/typescript', mts: 'text/typescript', cts: 'text/typescript',
      svelte: 'text/plain', vue: 'text/plain', html: 'text/html', htm: 'text/html', css: 'text/css',
      scss: 'text/x-scss', sass: 'text/x-sass', less: 'text/x-less', json: 'application/json',
      jsonc: 'application/json', yaml: 'application/yaml', yml: 'application/yaml', toml: 'text/plain',
      xml: 'application/xml', txt: 'text/plain', log: 'text/plain', csv: 'text/csv', env: 'text/plain',
      sh: 'text/x-shellscript', bash: 'text/x-shellscript', zsh: 'text/x-shellscript', fish: 'text/plain',
      py: 'text/x-python', rb: 'text/x-ruby', php: 'text/x-php', java: 'text/x-java', kt: 'text/plain',
      kts: 'text/plain', go: 'text/x-go', rs: 'text/x-rust', c: 'text/x-c', h: 'text/x-c',
      cpp: 'text/x-c++', hpp: 'text/x-c++', cs: 'text/x-csharp', swift: 'text/x-swift', sql: 'text/x-sql',
      graphql: 'application/graphql', gql: 'application/graphql', dockerfile: 'text/plain', lock: 'text/plain',
    };
    if (extension === 'md' || extension === 'mdx' || extension === 'markdown') {
      return { path: file, name, extension, size: info.size, modifiedAt: info.mtime.toISOString(), contentType: 'text/markdown', kind: 'markdown' };
    }
    if (imageTypes[extension]) {
      return { path: file, name, extension, size: info.size, modifiedAt: info.mtime.toISOString(), contentType: imageTypes[extension], kind: 'image' };
    }
    if (extension === 'pdf') {
      return { path: file, name, extension, size: info.size, modifiedAt: info.mtime.toISOString(), contentType: 'application/pdf', kind: 'pdf' };
    }
    const audioTypes: Record<string,string> = { wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',m4a:'audio/mp4',flac:'audio/flac',opus:'audio/ogg' };
    if (audioTypes[extension]) return { path:file,name,extension,size:info.size,modifiedAt:info.mtime.toISOString(),contentType:audioTypes[extension],kind:'audio' };
    let looksBinary = false;
    const handle = await open(file, 'r');
    try {
      const sample = Buffer.alloc(Math.min(8192, info.size));
      if (sample.length) await handle.read(sample, 0, sample.length, 0);
      looksBinary = sample.includes(0);
    } finally {
      await handle.close();
    }
    const explicitTextType = textTypes[extension] ?? textTypes[normalizedName];
    const kind = !looksBinary || explicitTextType ? 'text' : 'binary';
    return {
      path: file,
      name,
      extension,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      contentType: explicitTextType ?? (kind === 'text' ? 'text/plain' : 'application/octet-stream'),
      kind,
    };
  }

  /**
   * Busca por conteudo dentro dos arquivos do workspace (nome ou texto).
   * Cap de 50 resultados; ignora pastas pesadas (.git, node_modules...).
   */
  async search(
    workspaceId: string,
    query: string,
    options: { byContent?: boolean; limit?: number } = {}
  ): Promise<Array<{ path: string; line?: number; preview?: string }>> {
    const root = await this.root(workspaceId);
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50) || 50));
    const ripgrepResults = await this.searchWithRipgrep(root, query, {
      byContent: options.byContent ?? false,
      limit,
    }).catch(error => {
      // A timeout/output limit is not permission to start another full scan
      // on the Core thread. Only a missing search executable uses the fallback.
      if (['ENOENT', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error?.code)) return null;
      throw error;
    });
    if (ripgrepResults) return ripgrepResults;

    const results: Array<{ path: string; line?: number; preview?: string }> = [];
    const generatedRoots = await codeGraphGeneratedRoots(root);

    const deadline = Date.now() + 2_500;
    let visited = 0;
    const pending = [root];
    while (pending.length && results.length < limit) {
      const directory = pending.pop()!;
      const dir = await opendir(directory).catch(() => null);
      if (!dir) continue;
      for await (const entry of dir) {
        if (results.length >= limit) break;
        if (++visited > 20_000 || Date.now() > deadline) {
          throw new Error('workspace_search_budget');
        }
        if (IGNORED.has(entry.name) || entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const fullPath = join(directory, entry.name);
        if (isCodeGraphGeneratedPath(fullPath.slice(root.length + 1), generatedRoots)) continue;
        if (entry.isDirectory()) {
          pending.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!options.byContent && entry.name.toLowerCase().includes(needle)) {
          results.push({ path: fullPath });
          continue;
        }
        if (options.byContent) {
          try {
            const info = await stat(fullPath);
            if (!info.isFile() || info.size > 256 * 1024) continue;
            const handle = await open(fullPath, 'r');
            let content: string;
            try {
              const bytes = Buffer.alloc(256 * 1024);
              const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
              content = bytes.toString('utf8', 0, bytesRead);
            } finally { await handle.close(); }
            if (content.includes('\0')) continue; // binario
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && results.length < limit; i += 1) {
              if (lines[i].toLowerCase().includes(needle)) {
                results.push({ path: fullPath, line: i + 1, preview: lines[i].trim().slice(0, 120) });
              }
            }
          } catch {
            // arquivo ilegivel e ignorado
          }
        }
      }
    }
    return results;
  }

  private async searchWithRipgrep(
    root: string,
    query: string,
    options: { byContent: boolean; limit: number },
  ): Promise<Array<{ path: string; line?: number; preview?: string }> | null> {
    const { rgPath } = await import('@vscode/ripgrep');
    const ignoredGlobs = [...IGNORED].flatMap((name) => ['--glob', `!${name}/**`]);
    const generatedRoots = await codeGraphGeneratedRoots(root);
    ignoredGlobs.push(...generatedRoots.flatMap(name => ['--iglob', `!/${name}/**`]));
    // Search one checkout, preserving portable .orkestrai skills/roles/designs.
    ignoredGlobs.push('--iglob', '!**/.orkestrai/floors/**', '--iglob', '!**/.orkestrai/reviews/**');
    if (!options.byContent) {
      const { stdout } = await execFileAsync(rgPath, [
        '--files',
        '--hidden',
        ...ignoredGlobs,
        '.',
      ], { cwd: root, timeout: 2_500, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      const needle = query.trim().toLocaleLowerCase();
      return stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((path) => path.toLocaleLowerCase().includes(needle))
        .slice(0, options.limit)
        .map((path) => ({ path: resolve(root, path) }))
        .filter(({ path }) => (path === root || path.startsWith(root + sep)) && !isFloorRuntimePath(path.slice(root.length + 1)));
    }

    let stdout = '';
    try {
      ({ stdout } = await execFileAsync(rgPath, [
        '--json',
        '--hidden',
        '--ignore-case',
        '--fixed-strings',
        '--max-filesize',
        '256K',
        ...ignoredGlobs,
        '--',
        query.trim(),
        '.',
      ], { cwd: root, timeout: 2_500, maxBuffer: 4 * 1024 * 1024, windowsHide: true }));
    } catch (error) {
      const candidate = error as { code?: number; stdout?: string };
      if (candidate.code === 1) return [];
      if (!candidate.stdout) throw error;
      stdout = candidate.stdout;
    }

    const results: Array<{ path: string; line?: number; preview?: string }> = [];
    for (const line of stdout.split(/\r?\n/)) {
      if (!line || results.length >= options.limit) break;
      try {
        const event = JSON.parse(line) as {
          type?: string;
          data?: {
            path?: { text?: string };
            lines?: { text?: string };
            line_number?: number;
          };
        };
        if (event.type !== 'match' || !event.data?.path?.text) continue;
        const path = resolve(root, event.data.path.text);
        if (path !== root && !path.startsWith(root + sep)) continue;
        if (isFloorRuntimePath(path.slice(root.length + 1))) continue;
        results.push({
          path,
          line: event.data.line_number,
          preview: event.data.lines?.text?.trim().slice(0, 120),
        });
      } catch {
        // Eventos JSON incompletos nao invalidam os demais resultados.
      }
    }
    return results;
  }

  async writeBinary(workspaceId: string, path: string, data: Uint8Array): Promise<{ path: string; written: number }> {
    const file = await this.resolveSafe(workspaceId, path);
    await mutateFile(file, async () => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, data);
    });
    return { path: file, written: data.length };
  }

  async readBinary(workspaceId: string, path: string): Promise<{ data: Uint8Array; contentType: string; name: string }> {
    const file = await this.resolveSafe(workspaceId, path);
    const info = await stat(file);
    if (!info.isFile()) throw new Error(`Arquivo nao encontrado: ${path}`);
    if (info.size > MAX_BUFFERED_BINARY_BYTES) throw new Error('File is too large for a buffered image operation. Use the streaming file endpoint.');
    const handle = await open(file, 'r');
    try {
      const data = Buffer.alloc(info.size);
      let length = 0;
      while (length < data.length) {
        const { bytesRead } = await handle.read(data, length, Math.min(64 * 1024, data.length - length), length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      return { data: data.subarray(0, length), ...this.binaryMetadata(file) };
    } finally { await handle.close(); }
  }

  /** HTTP previews/downloads do not buffer the entire asset on the Core heap. */
  async streamBinary(workspaceId: string, path: string, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; size: number; contentType: string; name: string }> {
    const file = await this.resolveSafe(workspaceId, path);
    if (!(await stat(file)).isFile()) throw new Error(`Arquivo nao encontrado: ${path}`);
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error(`Arquivo nao encontrado: ${path}`);
      if (!info.size) {
        await handle.close();
        return { body: new ReadableStream({ start: controller => controller.close() }), size: 0, ...this.binaryMetadata(file) };
      }
      // Backpressure is measured in bytes, rather than 64K chunks of 64K bytes.
      const stream = handle.createReadStream({ highWaterMark: 64 * 1024, end: info.size - 1, signal });
      const body = Readable.toWeb(stream, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } }) as ReadableStream<Uint8Array>;
      return { body, size: info.size, ...this.binaryMetadata(file) };
    } catch (error) { await handle.close(); throw error; }
  }

  private binaryMetadata(file: string): { contentType: string; name: string } {
    const ext = file.split('.').at(-1)?.toLowerCase() ?? '';
    const contentType =
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        pdf: 'application/pdf',
        wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
        txt: 'text/plain; charset=utf-8',
        md: 'text/markdown; charset=utf-8',
        json: 'application/json; charset=utf-8',
      }[ext] ??
      'application/octet-stream';
    return { contentType, name: file.split(/[\\/]/).at(-1) ?? 'attachment' };
  }

  async deleteFile(workspaceId: string, path: string): Promise<boolean> {
    const file = await this.resolveSafe(workspaceId, path);
    return mutateFile(file, async () => {
      const info = await stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) return false;
      if (!info.isFile()) throw new Error(`Arquivo nao encontrado: ${path}`);
      return unlink(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    });
  }

  async write(workspaceId: string, path: string, content: string): Promise<{ path: string; written: number }> {
    const file = await this.resolveSafe(workspaceId, path);
    await mutateFile(file, () => writeFile(file, content, 'utf8'));
    return { path: file, written: content.length };
  }
}

export const filesystemService = new FilesystemService();
