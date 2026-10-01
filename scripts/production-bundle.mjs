import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MANIFEST = 'production-provenance.json';
const REQUIRED = ['index.js', 'handler.js', 'computer-host/index.mjs', 'desktop-messages/index.cjs'];

async function bundleFiles(root, relative = '') {
  const result = [];
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (name === MANIFEST) continue;
    if (entry.isSymbolicLink()) throw new Error('Production bundle must not contain symbolic links.');
    if (entry.isDirectory()) result.push(...await bundleFiles(root, name));
    else if (entry.isFile()) {
      if (/\.(?:node|dylib|dll|exe|so)$/i.test(name)) throw new Error('Native binaries must be packaged separately for each target.');
      const file = join(root, name);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      result.push({ name, size: (await stat(file)).size, sha256: hash.digest('hex') });
    } else throw new Error('Unsupported production bundle file.');
  }
  return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function identity({ sourceSha, version, lockfile = resolve('package-lock.json') }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid production bundle identity.');
  return { sourceSha, version, lockSha256: createHash('sha256').update(readFileSync(lockfile)).digest('hex') };
}

export async function stampProductionBundle(directory, options) {
  const expected = identity(options);
  const files = await bundleFiles(directory);
  if (REQUIRED.some((name) => !files.some((file) => file.name === name))) throw new Error('Incomplete production bundle.');
  const manifest = { ...expected, files };
  writeFileSync(join(directory, MANIFEST), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

export async function verifyProductionBundle(directory, options) {
  const expected = identity(options);
  const path = join(directory, MANIFEST);
  if ((await stat(path)).size > 16_777_216) throw new Error('Oversized production provenance.');
  const actual = JSON.parse(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) throw new Error(`Production bundle ${key} does not match the tested source.`);
  }
  const files = await bundleFiles(directory);
  if (!Array.isArray(actual.files) || actual.files.length > 50_000 || JSON.stringify(actual.files) !== JSON.stringify(files)
    || REQUIRED.some((name) => !files.some((file) => file.name === name))) {
    throw new Error('Production bundle files do not match their provenance.');
  }
  return actual;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , mode, directory = 'build', sourceSha = ''] = process.argv;
  const options = { sourceSha, version: JSON.parse(readFileSync('package.json', 'utf8')).version };
  if (mode === 'stamp') await stampProductionBundle(resolve(directory), options);
  else if (mode === 'verify') await verifyProductionBundle(resolve(directory), options);
  else throw new Error('Usage: production-bundle.mjs stamp|verify <build directory> <source SHA>');
}
