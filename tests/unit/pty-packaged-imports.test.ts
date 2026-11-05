import { expect, it } from 'vitest';
import { copyFile, glob, mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('loads the production PTY transport with only source files included by the desktop manifest', async () => {
  const source = process.cwd();
  const stage = await mkdtemp(join(tmpdir(), 'ork-packaged-pty-'));
  try {
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    await copyFile(join(source, 'package.json'), join(stage, 'package.json'));
    await symlink(resolve(source, 'node_modules'), join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const pattern of manifest.build.files.filter((value: unknown) => typeof value === 'string' && value.startsWith('src/'))) {
      for await (const file of glob(pattern, { cwd: source })) {
        if (file.split(/[\\/]/).includes('..')) throw new Error('Manifest source path escapes the package.');
        if (!(await stat(join(source, file))).isFile()) continue;
        await mkdir(dirname(join(stage, file)), { recursive: true });
        await copyFile(join(source, file), join(stage, file));
      }
    }
    const transport = pathToFileURL(join(stage, 'src/lib/modules/agent-room/infrastructure/pty/pty-ws.ts')).href;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(transport)}); console.log('PACKAGED_PTY_READY')`], {
      cwd: stage, timeout: 10_000, maxBuffer: 256 * 1024,
    });
    expect(stdout).toContain('PACKAGED_PTY_READY');
  } finally {
    await rm(stage, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  }
}, 20_000);
