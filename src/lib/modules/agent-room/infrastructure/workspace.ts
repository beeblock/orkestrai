import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

const workspaceRoot = process.cwd();
export const dataRoot = resolve(workspaceRoot, 'data');
export const projectsRoot = resolve(workspaceRoot, 'projects');

export function ensureLocalStorage() {
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });
}

export function isInside(parent: string, child: string) {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '..');
}

export function resolveSafeProjectPath(input?: string | null) {
  ensureLocalStorage();

  if (!input) {
    return projectsRoot;
  }

  const resolved = resolve(input);
  if (!isInside(projectsRoot, resolved)) {
    throw new Error(`workingDirectory precisa ficar dentro de ${projectsRoot}`);
  }

  return resolved;
}

export function assertWritableProjectPath(input?: string | null) {
  const resolved = resolveSafeProjectPath(input);

  if (resolved === projectsRoot) {
    throw new Error('Chamadas com escrita exigem um projeto selecionado em projects/.');
  }

  mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function slugifyProjectName(value: string) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return slug || `project-${Date.now()}`;
}

export function listProjectDirectories() {
  ensureLocalStorage();

  return readdirSync(projectsRoot)
    .map((name) => {
      const path = resolve(projectsRoot, name);
      if (!existsSync(path) || !statSync(path).isDirectory()) return null;
      return {
        name: basename(path),
        path,
        createdAt: statSync(path).birthtime.toISOString(),
      };
    })
    .filter((project): project is { name: string; path: string; createdAt: string } => Boolean(project))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Shell padrao por plataforma. No Windows, WSL e preferido quando disponivel
 * (agentes CLI de unix rodam melhor), com fallback para PowerShell.
 */
export function defaultShell(options: { preferWsl?: boolean } = {}): string {
  if (process.platform === 'win32') {
    return options.preferWsl === false ? 'powershell.exe' : 'wsl.exe';
  }
  return resolvePosixShell();
}

/** Resolves a shell that exists on the current POSIX host. */
export function resolvePosixShell(
  configured = process.env.SHELL,
  platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): string {
  const preferred = configured?.trim();
  if (preferred && pathExists(preferred)) return preferred;

  const candidates = platform === 'darwin'
    ? ['/bin/zsh', '/bin/bash', '/bin/sh']
    : ['/bin/bash', '/bin/sh', '/bin/zsh'];
  return candidates.find(pathExists) ?? '/bin/sh';
}

/** Comandos de shell disponiveis por plataforma (para presets da UI). */
export function shellPresets(): Array<{ command: string; label: string }> {
  if (process.platform === 'win32') {
    return [
      { command: 'wsl.exe', label: 'WSL' },
      { command: '"C:\\Program Files\\Git\\bin\\bash.exe" -l', label: 'Git Bash' },
      { command: 'powershell.exe', label: 'PowerShell' },
      { command: 'cmd.exe', label: 'CMD' },
    ];
  }
  return [{ command: resolvePosixShell(), label: 'Shell' }];
}
