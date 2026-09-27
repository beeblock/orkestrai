import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });

it('flushes complete CLI JSON to a pipe beyond the 64 KiB buffer before exiting', async () => {
  const data = Array.from({ length: 70 }, (_, i) => ({ id: String(i), title: `Task ${i}`, description: 'context '.repeat(600) }));
  const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const cwd = await mkdtemp(join(tmpdir(), 'orkestrai-cli-output-')); directories.push(cwd);
    const apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await mkdir(join(cwd, '.orkestrai'));
    await writeFile(join(cwd, '.orkestrai/workspace.json'), JSON.stringify({ apiUrl, token: 'test-only' }));
    const { stdout } = await promisify(execFile)(process.execPath, [resolve('packages/orkestrai-cli/bin/orkestrai.js'), 'task', 'list', '--json'], {
      cwd, env: { ...process.env, ORKESTRAI_API_URL: apiUrl, ORKESTRAI_WORKSPACE_CONFIG: join(cwd, '.orkestrai/workspace.json') },
      timeout: 10_000, maxBuffer: 2_000_000,
    });
    expect(Buffer.byteLength(stdout)).toBeGreaterThan(65_536);
    expect(JSON.parse(stdout)).toEqual(data);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
