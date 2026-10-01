import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { mergeMacManifests } from '../../scripts/merge-macos-manifests.mjs';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orkestrai-mac-feed-'));
  directories.push(directory);
  for (const arch of ['x64', 'arm64']) {
    const suffix = arch === 'arm64' ? '-arm64' : '';
    const files = [`Orkestrai-1.2.3${suffix}-mac.zip`, `Orkestrai-1.2.3${suffix}.dmg`].map((url) => {
      const bytes = Buffer.from(`fixture:${url}`);
      writeFileSync(join(directory, url), bytes);
      return { url, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') };
    });
    writeFileSync(join(directory, `latest-mac-${arch}.yml`), stringify({ version: '1.2.3', files, path: files[0].url, sha512: files[0].sha512, releaseDate: '2026-10-01T12:00:00.000Z' }));
  }
  return directory;
}

describe('parallel macOS producer manifests', () => {
  it('combines both CPUs without colliding feeds and preserves legacy Intel metadata', async () => {
    const directory = fixture();
    const result = await mergeMacManifests(directory, '1.2.3');
    expect(result.files.map((entry: { url: string }) => entry.url)).toEqual([
      'Orkestrai-1.2.3-mac.zip', 'Orkestrai-1.2.3.dmg', 'Orkestrai-1.2.3-arm64-mac.zip', 'Orkestrai-1.2.3-arm64.dmg',
    ]);
    expect(result.path).toBe('Orkestrai-1.2.3-mac.zip');
    expect(parse(readFileSync(join(directory, 'latest-mac.yml'), 'utf8'))).toEqual(result);
    expect(readdirSync(directory).filter((name) => name.startsWith('latest-mac'))).toEqual(['latest-mac.yml']);
  });

  it.each(['wrong-version', 'wrong-architecture', 'checksum', 'unsigned-rollout'])('rejects %s before writing or removing either input', async (failure) => {
    const directory = fixture();
    const input = join(directory, 'latest-mac-arm64.yml');
    const manifest = parse(readFileSync(input, 'utf8'));
    if (failure === 'wrong-version') manifest.version = '1.2.4';
    if (failure === 'wrong-architecture') manifest.files[0].url = '../Orkestrai-1.2.3-mac.zip';
    if (failure === 'checksum') manifest.files[1].sha512 = Buffer.alloc(64).toString('base64');
    if (failure === 'unsigned-rollout') manifest.stagingPercentage = 0;
    writeFileSync(input, stringify(manifest));
    await expect(mergeMacManifests(directory, '1.2.3')).rejects.toThrow();
    const files = readdirSync(directory);
    expect(files).toContain('latest-mac-x64.yml');
    expect(files).toContain('latest-mac-arm64.yml');
    expect(files).not.toContain('latest-mac.yml');
  });
});
