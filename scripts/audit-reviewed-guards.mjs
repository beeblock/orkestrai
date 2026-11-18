import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const picoArchive = 'https://codeload.github.com/micromatch/picomatch/tar.gz/3222059ac27492d9c0147fee5c65f751bbd851ab';
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const remoteAdvisories = ['GHSA-3r8g-jcqq-3p5j', 'GHSA-6cf5-gc4q-fm3x'];

/** This opt-in is a release-specific exception, not an audit bypass by severity. */
export async function verifyReviewedGuards(directory = root, now = new Date()) {
  const manifest = readJson(join(directory, 'package.json'));
  const lock = readJson(join(directory, 'package-lock.json'));
  if (manifest.version !== '0.54.0' || now > new Date('2026-11-25T23:59:59Z')) throw new Error('Reviewed audit guards expired; remediate or obtain a new review.');
  const config = (await import(pathToFileURL(join(directory, 'svelte.config.js')).href)).default;
  if (config.kit?.experimental?.remoteFunctions !== false
    || lock.packages['node_modules/@sveltejs/kit']?.version !== '2.70.4') throw new Error('Remote-function exception requires disabled functions and SvelteKit 2.70.4.');
  const scan = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Cannot prove remote-function exclusion through a source symlink.');
      if (entry.isDirectory()) scan(join(directory, entry.name));
      else if (/\.remote\.[cm]?[jt]s$/.test(entry.name)) throw new Error('Remote modules are incompatible with this audit exception.');
    }
  };
  scan(join(directory, 'src'));
  const pico = lock.packages['node_modules/picomatch'];
  const source = readFileSync(join(directory, 'node_modules/picomatch/lib/parse.js'), 'utf8').replaceAll('\r\n', '\n');
  if (manifest.overrides.picomatch !== picoArchive || pico?.resolved !== picoArchive
    || pico.integrity !== 'sha512-5ocIfZMrFMxypoIPxauw0IAOSeLGu01vmUY5tP4oEpWy+P9hcIvOQZstx41UN4x04P8nzFpvnYi3i0FEjsaaQw=='
    || createHash('sha256').update(source).digest('hex') !== 'a63253ab6a3bd38a40d5b9970d26bf6332669048bb45ba7e0b97fb35371a05c3') throw new Error('Unverified Picomatch security source.');
  return new Set([...remoteAdvisories, 'GHSA-fc5q-39xc-vjpf']);
}

export function auditFindings(report, accepted = new Set()) {
  if (!report || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities || report.error) throw new Error('Invalid npm audit result.');
  const blocking = new Map(); const guarded = new Set();
  const walk = (name, parents = new Set()) => {
    // npm includes real cycles (e.g. app-builder-lib <-> dmg-builder).
    // A cycle is valid only if another branch reaches a concrete advisory.
    if (parents.has(name)) return false;
    const item = report.vulnerabilities[name];
    if (!Array.isArray(item.via) || !item.via.length) throw new Error(`Missing advisory chain: ${name}`);
    const next = new Set([...parents, name]);
    let found = false;
    for (const via of item.via) {
      if (typeof via === 'string') {
        if (!report.vulnerabilities[via]) throw new Error(`Missing advisory dependency: ${via}`);
        found = walk(via, next) || found;
        continue;
      }
      if (!['info', 'low', 'moderate', 'high', 'critical'].includes(via.severity) || typeof via.url !== 'string') throw new Error('Invalid advisory.');
      found = true;
      if (['info', 'low'].includes(via.severity)) continue;
      const id = via.url.match(/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/)?.[1];
      const expectedPackage = remoteAdvisories.includes(id) ? '@sveltejs/kit' : id === 'GHSA-fc5q-39xc-vjpf' ? 'picomatch' : null;
      if (id && accepted.has(id) && via.name === expectedPackage) guarded.add(id);
      else blocking.set(via.url, via.title);
    }
    return found;
  };
  for (const name of Object.keys(report.vulnerabilities)) if (!walk(name)) throw new Error(`Unresolved audit chain: ${name}`);
  if (Object.values(report.vulnerabilities).some(v => ['moderate', 'high', 'critical'].includes(v.severity)) && !blocking.size && !guarded.size) throw new Error('Unresolved audit chain.');
  return { blocking: [...blocking.entries()], guarded: [...guarded] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const accepted = process.argv.includes('--allow-reviewed-guards') ? await verifyReviewedGuards() : new Set();
  const args = ['audit', '--json', '--audit-level=moderate'];
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120_000 })
    : spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120_000, shell: process.platform === 'win32' });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('npm audit failed to complete.');
  const findings = auditFindings(JSON.parse(result.stdout), accepted);
  for (const id of findings.guarded) console.log(`Reviewed guard (not an upstream fix): ${id}`);
  for (const [url, title] of findings.blocking) console.error(`${title}: ${url}`);
  console.log(`Blocking advisories: ${findings.blocking.length}; guarded advisories: ${findings.guarded.length}.`);
  process.exitCode = findings.blocking.length ? 1 : 0;
}
