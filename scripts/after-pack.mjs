import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import extractZip from '@electron-internal/extract-zip';

const NODE_VERSION = 'v24.12.0';
const WINDOWS_NODE_ARCHIVE = `node-${NODE_VERSION}-win-x64.zip`;
const NODE_DIST_URL = `https://nodejs.org/dist/${NODE_VERSION}`;
const WINDOWS_NODE_SHA256 = '9c125f61ae947b52e779095830f9cac267846a043ef7192183c84016aaad2812';

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function verifiedArchive(projectDir) {
  const cacheDir = resolve(projectDir, 'node_modules', '.cache', 'orkestrai-cli-runtime');
  const archivePath = join(cacheDir, WINDOWS_NODE_ARCHIVE);
  try {
    const actual = createHash('sha256').update(await readFile(archivePath)).digest('hex');
    if (actual === WINDOWS_NODE_SHA256) return archivePath;
  } catch {
    // Missing or stale cache: download the pinned archive below.
  }
  await download(`${NODE_DIST_URL}/${WINDOWS_NODE_ARCHIVE}`, archivePath);
  const actual = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  if (actual !== WINDOWS_NODE_SHA256) {
    await rm(archivePath, { force: true });
    throw new Error(`SHA-256 mismatch for ${WINDOWS_NODE_ARCHIVE}.`);
  }
  return archivePath;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const archivePath = await verifiedArchive(context.packager.projectDir);
  const staging = await mkdtemp(join(tmpdir(), 'orkestrai-cli-runtime-'));
  try {
    await extractZip(archivePath, { dir: staging });
    const source = join(staging, WINDOWS_NODE_ARCHIVE.replace(/\.zip$/, ''), 'node.exe');
    const destination = join(context.appOutDir, 'resources', 'orkestrai-cli-runtime', 'node.exe');
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
