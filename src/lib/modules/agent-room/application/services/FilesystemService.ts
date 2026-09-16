import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, sep } from 'node:path';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

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
const IGNORED = new Set(['.git', 'node_modules', '.svelte-kit', 'build', 'dist']);
const execFileAsync = promisify(execFile);

/**
 * Acesso ao filesystem confinado ao working_dir do workspace.
 */
export class FilesystemService {
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
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`Diretorio nao encontrado: ${path ?? '/'}`);
    }
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !IGNORED.has(entry.name))
      .map((entry) => {
        const fullPath = join(dir, entry.name);
        let size = 0;
        try {
          size = entry.isFile() ? statSync(fullPath).size : 0;
        } catch {
          // arquivo sumiu entre readdir e stat
        }
        return {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
          size,
        };
      });
    return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  }

  async read(workspaceId: string, path: string): Promise<{ path: string; content: string; truncated: boolean }> {
    const file = await this.resolveSafe(workspaceId, path);
    if (!existsSync(file)) {
      throw new Error(`Arquivo nao encontrado: ${path}`);
    }
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
    const limit = options.limit ?? 50;
    const ripgrepResults = await this.searchWithRipgrep(root, query, {
      byContent: options.byContent ?? false,
      limit,
    }).catch(() => null);
    if (ripgrepResults) return ripgrepResults;

    const results: Array<{ path: string; line?: number; preview?: string }> = [];

    const walk = (dir: string) => {
      if (results.length >= limit) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= limit) return;
        if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!options.byContent && entry.name.toLowerCase().includes(needle)) {
          results.push({ path: fullPath });
          continue;
        }
        if (options.byContent) {
          try {
            if (statSync(fullPath).size > 256 * 1024) continue;
            const content = readFileSync(fullPath, 'utf8');
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
    };

    walk(root);
    return results;
  }

  private async searchWithRipgrep(
    root: string,
    query: string,
    options: { byContent: boolean; limit: number },
  ): Promise<Array<{ path: string; line?: number; preview?: string }> | null> {
    const { rgPath } = await import('@vscode/ripgrep');
    const ignoredGlobs = [...IGNORED].flatMap((name) => ['--glob', `!${name}/**`]);
    if (!options.byContent) {
      const { stdout } = await execFileAsync(rgPath, [
        '--files',
        '--hidden',
        ...ignoredGlobs,
        root,
      ], { timeout: 2_500, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      const needle = query.trim().toLocaleLowerCase();
      return stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((path) => path.toLocaleLowerCase().includes(needle))
        .slice(0, options.limit)
        .map((path) => ({ path: resolve(path) }));
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
        root,
      ], { timeout: 2_500, maxBuffer: 4 * 1024 * 1024, windowsHide: true }));
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
        const path = resolve(event.data.path.text);
        if (path !== root && !path.startsWith(root + sep)) continue;
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
    const { writeFileSync: writeBytes, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(file), { recursive: true });
    writeBytes(file, data);
    return { path: file, written: data.length };
  }

  async readBinary(workspaceId: string, path: string): Promise<{ data: Uint8Array; contentType: string; name: string }> {
    const file = await this.resolveSafe(workspaceId, path);
    if (!existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`Arquivo nao encontrado: ${path}`);
    }
    const { readFileSync: readBytes } = await import('node:fs');
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
    return { data: readBytes(file), contentType, name: file.split(/[\\/]/).at(-1) ?? 'attachment' };
  }

  async deleteFile(workspaceId: string, path: string): Promise<boolean> {
    const file = await this.resolveSafe(workspaceId, path);
    if (!existsSync(file)) return false;
    if (!statSync(file).isFile()) throw new Error(`Arquivo nao encontrado: ${path}`);
    unlinkSync(file);
    return true;
  }

  async write(workspaceId: string, path: string, content: string): Promise<{ path: string; written: number }> {
    const file = await this.resolveSafe(workspaceId, path);
    writeFileSync(file, content, 'utf8');
    return { path: file, written: content.length };
  }
}

export const filesystemService = new FilesystemService();
