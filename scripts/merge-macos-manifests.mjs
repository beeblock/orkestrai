import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';

export async function mergeMacManifests(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid macOS release version.');
  const manifests = [];
  const inputs = [];
  for (const arch of ['x64', 'arm64']) {
    const input = join(directory, `latest-mac-${arch}.yml`);
    if ((await stat(input)).size > 16_384) throw new Error('Oversized macOS update manifest.');
    const manifest = parse(readFileSync(input, 'utf8'));
    const suffix = arch === 'arm64' ? '-arm64' : '';
    const zip = `Orkestrai-${version}${suffix}-mac.zip`;
    const expected = new Set([zip, `Orkestrai-${version}${suffix}.dmg`]);
    if (manifest?.version !== version || manifest.stagingPercentage !== undefined
      || !Array.isArray(manifest.files) || manifest.files.length !== 2
      || manifest.path !== zip || !Number.isFinite(Date.parse(manifest.releaseDate))) {
      throw new Error(`Invalid ${arch} macOS update manifest.`);
    }
    for (const entry of manifest.files) {
      if (!expected.delete(entry?.url) || !Number.isSafeInteger(entry.size) || entry.size <= 0
        || typeof entry.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512)) {
        throw new Error(`Invalid ${arch} macOS installer reference.`);
      }
      const file = join(directory, entry.url);
      if ((await stat(file)).size !== entry.size) throw new Error(`macOS installer size mismatch: ${entry.url}`);
      const hash = createHash('sha512');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      if (hash.digest('base64') !== entry.sha512) throw new Error(`macOS installer checksum mismatch: ${entry.url}`);
    }
    if (manifest.sha512 !== manifest.files.find((entry) => entry.url === zip)?.sha512) throw new Error(`Invalid ${arch} legacy update checksum.`);
    manifests.push(manifest);
    inputs.push(input);
  }
  // Both producers are validated before the combined public feed is written.
  const combined = {
    version, files: manifests.flatMap((manifest) => manifest.files),
    path: manifests[0].path, sha512: manifests[0].sha512,
    releaseDate: manifests.map((manifest) => manifest.releaseDate).sort().at(-1),
  };
  writeFileSync(join(directory, 'latest-mac.yml'), stringify(combined), { flag: 'wx' });
  for (const input of inputs) unlinkSync(input);
  return combined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await mergeMacManifests(resolve(process.argv[2] ?? 'release'), process.argv[3] ?? '');
}
