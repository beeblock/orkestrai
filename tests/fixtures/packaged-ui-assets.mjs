import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

/** A healthy Core must also serve intact lazy-loaded pages and their imports. */
export async function verifyPackagedUiAssets(appRoot, apiUrl, request = fetch) {
  const scripts = [];
  for (const directory of ['entry', 'nodes', 'chunks', 'workers']) {
    const root = join(appRoot, 'build/client/_app/immutable', directory);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isFile() && /\.m?js$/.test(entry.name)) scripts.push({ directory, name: entry.name, file: join(root, entry.name) });
    }
  }
  assert.ok(scripts.length > 0 && scripts.length <= 5000, 'Invalid packaged UI script inventory');
  let cursor = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(4, scripts.length) }, async () => {
    while (!failed && cursor < scripts.length) {
      const script = scripts[cursor++];
      try {
        const size = (await stat(script.file)).size;
        assert.ok(size > 0 && size <= 16 * 1024 * 1024, 'Invalid packaged UI script size');
        const expected = await readFile(script.file);
        const url = `${apiUrl}/_app/immutable/${script.directory}/${encodeURIComponent(script.name)}`;
        const response = await request(url, { headers: { 'accept-encoding': 'br, gzip' }, signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200, `Packaged UI script failed: ${script.directory}/${script.name}`);
        assert.match(response.headers.get('content-type') ?? '', /(?:javascript|ecmascript)/i, 'UI script has a non-JavaScript response');
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            assert.ok(received <= expected.byteLength, 'UI response exceeded its packaged size');
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        assert.ok(Buffer.concat(chunks).equals(expected), 'Served UI script differs from the packaged file');
      } catch (error) { failed = true; throw error; }
    }
  }));
  return { scripts: scripts.length, http: 'passed', content: 'passed' };
}
