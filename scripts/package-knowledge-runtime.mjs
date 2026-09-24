import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { x as extract } from 'tar';

export const KNOWLEDGE_RUNTIME_FILES = [
  'tesseract.js/src/worker-script/node/index.js',
  ...['', '-simd', '-relaxedsimd'].flatMap(variant => ['js', 'wasm'].map(extension => `tesseract.js-core/tesseract-core${variant}-lstm.${extension}`)),
  'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',
];

/** @param {string} platform @param {string | number} arch */
export function knowledgeCanvasTarget(platform, arch) {
  const cpu = typeof arch === 'number' ? new Map([[1, 'x64'], [3, 'arm64']]).get(arch) ?? '' : arch;
  const suffix = new Map([['darwin', ''], ['linux', '-gnu'], ['win32', '-msvc']]).get(platform);
  if (!['x64', 'arm64'].includes(cpu) || suffix === undefined) throw new Error(`Unsupported PDF raster target: ${platform}/${arch}`);
  const target = `${platform}-${cpu}${suffix}`;
  return { name: `@napi-rs/canvas-${target}`, binary: `skia.${target}.node` };
}

/** @param {import('app-builder-lib').AfterPackContext} context */
export async function packageKnowledgeRuntime(context) {
  const { name, binary } = knowledgeCanvasTarget(context.electronPlatformName, context.arch);
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const modules = join(resources, 'app', 'node_modules');
  // Fail packaging, not the user's first scan, if offline OCR resources are missing.
  for (const code of ['eng', 'por', 'spa']) {
    if (!(await stat(join(modules, `@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`))).size) throw new Error(`Missing OCR language: ${code}`);
  }
  for (const file of KNOWLEDGE_RUNTIME_FILES) await stat(join(modules, file));
  const canvas = JSON.parse(await readFile(join(modules, '@napi-rs/canvas/package.json'), 'utf8'));
  const project = context.packager.projectDir;
  const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${name}`];
  const url = `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${canvas.version}.tgz`;
  if (!entry || entry.version !== canvas.version || canvas.optionalDependencies?.[name] !== entry.version
    || entry.resolved !== url || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? '')) throw new Error(`Unverified PDF raster package: ${name}`);
  /** @param {Uint8Array} bytes */
  const digest = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const cache = join(project, 'node_modules/.cache/orkestrai-knowledge-runtime');
  const archive = join(cache, `${name.split('/')[1]}-${entry.version}.tgz`);
  let bytes = await readFile(archive).catch(() => null);
  if (!bytes || digest(bytes) !== entry.integrity) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Unable to download PDF raster package: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== entry.integrity) throw new Error(`PDF raster integrity mismatch: ${name}`);
    await mkdir(cache, { recursive: true }); await writeFile(archive, bytes);
  }
  const staging = await mkdtemp(join(tmpdir(), 'orkestrai-knowledge-package-'));
  const files = ['package.json', binary, 'README.md'];
  try {
    await extract({ file: archive, cwd: staging, strip: 1, strict: true, filter: (path, item) => 'type' in item && item.type === 'File' && files.some(file => path === `package/${file}`) });
    const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== entry.version) throw new Error(`PDF raster target mismatch: ${name}`);
    if (!(await stat(join(staging, binary))).size) throw new Error(`Empty PDF raster binary: ${name}`);
    const destination = join(modules, name);
    await mkdir(destination, { recursive: true });
    for (const file of files) await copyFile(join(staging, file), join(destination, file));
    console.log(`Offline OCR runtime packaged: ${name}@${entry.version}, eng/por/spa`);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
