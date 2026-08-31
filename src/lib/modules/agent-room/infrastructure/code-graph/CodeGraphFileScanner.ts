import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath, readFile, stat } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { CodeGraphDiagnostic, CodeGraphLanguage } from '../../domain/code-graph.js';
import type { ScannedCodeFile } from './types.js';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 1_500_000;
const MAX_FILES = 20_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Map<string, CodeGraphLanguage>([
  ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.mts', 'typescript'], ['.cts', 'typescript'],
  ['.js', 'javascript'], ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.svelte', 'svelte'], ['.php', 'php'],
]);
const CONTRACT_FILE = /(?:^|[._-])(openapi|swagger)(?:[._-]|$)/i;
const CONTRACT_GLOBS = ['*openapi*.json', '*openapi*.yaml', '*openapi*.yml', '*swagger*.json', '*swagger*.yaml', '*swagger*.yml'];
const IGNORED_GLOBS = [
  '.git/**', 'node_modules/**', 'vendor/**', '.svelte-kit/**', '.next/**', '.nuxt/**',
  'build/**', 'dist/**', 'release/**', 'coverage/**', 'target/**', '.cache/**',
  'storage/framework/**', 'bootstrap/cache/**', '**/*.min.js', '**/*.map',
];

export type ScanResult = {
  rootPath: string;
  files: ScannedCodeFile[];
  diagnostics: CodeGraphDiagnostic[];
  skipped: number;
};

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

function isGenerated(path: string): boolean {
  return /(^|\/)(generated|__generated__|gen)(\/|$)|\.generated\.|\.g\.(ts|js|php)$|\.d\.ts$/i.test(path);
}

export class CodeGraphFileScanner {
  async scan(inputRoot: string): Promise<ScanResult> {
    const rootPath = await realpath(resolve(inputRoot));
    const rootInfo = await stat(rootPath);
    if (!rootInfo.isDirectory()) throw new Error(`Code graph root is not a directory: ${rootPath}`);

    const diagnostics: CodeGraphDiagnostic[] = [];
    const { rgPath } = await import('@vscode/ripgrep');
    const args = [
      '--files', '--hidden', '--no-follow', '--max-filesize', String(MAX_FILE_BYTES),
      ...IGNORED_GLOBS.flatMap((glob) => ['--glob', `!${glob}`]),
      ...[...SOURCE_EXTENSIONS.keys()].flatMap((extension) => ['--glob', `*${extension}`]),
      ...CONTRACT_GLOBS.flatMap((glob) => ['--glob', glob]),
      '--', rootPath,
    ];
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync(rgPath, args, {
        timeout: 30_000,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      }));
    } catch (error) {
      const candidate = error as { code?: number; stdout?: string };
      if (candidate.code !== 1 || !candidate.stdout) throw error;
      stdout = candidate.stdout;
    }

    const paths = stdout.split(/\r?\n/).filter(Boolean).slice(0, MAX_FILES + 1);
    if (paths.length > MAX_FILES) {
      diagnostics.push({
        path: null,
        severity: 'warning',
        code: 'file_limit',
        message: `Indexing stopped after ${MAX_FILES} supported source files.`,
      });
    }

    let skipped = Math.max(0, paths.length - MAX_FILES);
    const files: ScannedCodeFile[] = [];
    for (const candidate of paths.slice(0, MAX_FILES)) {
      try {
        const absolutePath = await realpath(resolve(candidate));
        if (!isInside(rootPath, absolutePath)) {
          skipped += 1;
          diagnostics.push({ path: candidate, severity: 'warning', code: 'outside_root', message: 'Symlink target is outside the repository root.' });
          continue;
        }
        const info = await stat(absolutePath);
        const extension = extname(absolutePath).toLowerCase();
        const language = SOURCE_EXTENSIONS.get(extension)
          ?? (CONTRACT_FILE.test(basename(absolutePath)) && extension === '.json' ? 'json' : null)
          ?? (CONTRACT_FILE.test(basename(absolutePath)) && ['.yaml', '.yml'].includes(extension) ? 'yaml' : null);
        if (!language || !info.isFile() || info.size > MAX_FILE_BYTES) {
          skipped += 1;
          continue;
        }
        const content = await readFile(absolutePath, 'utf8');
        if (content.includes('\0')) {
          skipped += 1;
          continue;
        }
        const relativePath = relative(rootPath, absolutePath).split(sep).join('/');
        files.push({
          absolutePath,
          relativePath,
          language,
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
          byteSize: Buffer.byteLength(content),
          modifiedAt: info.mtime.toISOString(),
          generated: isGenerated(relativePath),
        });
      } catch (error) {
        skipped += 1;
        diagnostics.push({
          path: relative(rootPath, candidate).split(sep).join('/'),
          severity: 'warning',
          code: 'file_read_failed',
          message: error instanceof Error ? error.message.slice(0, 300) : 'Source file could not be read.',
        });
      }
    }

    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return { rootPath, files, diagnostics: diagnostics.slice(0, 200), skipped };
  }
}

export const codeGraphFileScanner = new CodeGraphFileScanner();
