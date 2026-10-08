import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch, parsePatch } from 'diff';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const normalize = (text) => text.replaceAll('\r\n', '\n');
const hash = (text) => createHash('sha256').update(normalize(text)).digest('hex');

export function applyDependencyPatches(root = projectRoot) {
  root = fs.realpathSync(root);
  const contract = JSON.parse(fs.readFileSync(join(root, 'patches/dependency-patches.json'), 'utf8'));
  if (contract.schemaVersion !== 1 || !Array.isArray(contract.files) || !contract.files.length) throw new Error('Invalid dependency patch contract.');
  const entries = new Map();
  for (const entry of contract.files) {
    if (!/^node_modules\/(?:@[\w-]+\/)?[\w.-]+\/[\w./-]+$/.test(entry.file)
      || entry.file.split('/').includes('..') || !/^[\w@+.-]+\.patch$/.test(entry.patch)
      || !/^[a-f0-9]{64}$/.test(entry.before) || !/^[a-f0-9]{64}$/.test(entry.after)
      || entries.has(entry.file)) throw new Error('Invalid dependency patch target.');
    entries.set(entry.file, entry);
  }
  const patches = [...new Set(contract.files.map((entry) => entry.patch))].sort();
  if (JSON.stringify(patches) !== JSON.stringify(fs.readdirSync(join(root, 'patches')).filter((file) => file.endsWith('.patch')).sort())) {
    throw new Error('Every dependency patch must have a reviewed hash contract.');
  }
  const plans = [];
  const seen = new Set();
  // Validate every source, package version, hunk and post-image before writing
  // any target. Unknown versions or partial/unexpected patches fail closed.
  for (const name of patches) {
    const patchPath = join(root, 'patches', name);
    if (fs.realpathSync(patchPath) !== patchPath) throw new Error('Symlinked dependency patch.');
    const version = name.slice(name.lastIndexOf('+') + 1, -6);
    for (const patch of parsePatch(normalize(fs.readFileSync(patchPath, 'utf8')))) {
      const relative = patch.newFileName?.replace(/^b\//, '');
      const entry = entries.get(relative);
      if (!entry || entry.patch !== name || patch.oldFileName !== `a/${relative}` || seen.has(relative)) throw new Error('Unreviewed dependency patch target.');
      seen.add(relative);
      const target = join(root, relative);
      if (fs.realpathSync(target) !== target || !fs.lstatSync(target).isFile()) throw new Error(`Unsafe dependency target: ${relative}`);
      const segments = relative.split('/');
      const packageDir = join(root, ...segments.slice(0, segments[1].startsWith('@') ? 3 : 2));
      if (JSON.parse(fs.readFileSync(join(packageDir, 'package.json'), 'utf8')).version !== version) throw new Error(`Unexpected dependency version: ${name}`);
      const original = fs.readFileSync(target, 'utf8');
      if (hash(original) === entry.after) continue;
      if (hash(original) !== entry.before) throw new Error(`Unexpected dependency source: ${relative}`);
      const patched = applyPatch(normalize(original), patch, { fuzzFactor: 0, autoConvertLineEndings: false });
      if (patched === false || hash(patched) !== entry.after) throw new Error(`Dependency patch verification failed: ${relative}`);
      fs.accessSync(dirname(target), fs.constants.W_OK);
      plans.push({ target, content: original.includes('\r\n') ? patched.replaceAll('\n', '\r\n') : patched, mode: fs.statSync(target).mode & 0o777 });
    }
  }
  if (seen.size !== entries.size) throw new Error('Missing reviewed dependency patch.');
  const staged = [];
  try {
    // Stage all files first; ENOSPC never truncates an installed module. Each
    // rename is atomic and a rerun safely accepts already-patched post-images.
    for (const [index, plan] of plans.entries()) {
      const temp = `${plan.target}.orkestrai-patch-${process.pid}-${index}`;
      const fd = fs.openSync(temp, 'wx', plan.mode);
      staged.push({ temp, target: plan.target });
      try { fs.writeFileSync(fd, plan.content, 'utf8'); } finally { fs.closeSync(fd); }
    }
    for (const file of staged) fs.renameSync(file.temp, file.target);
  } finally {
    for (const file of staged) if (fs.existsSync(file.temp)) fs.unlinkSync(file.temp);
  }
  return { verified: entries.size, applied: plans.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = applyDependencyPatches();
  console.log(`Dependency patches verified: ${result.verified}; applied: ${result.applied}.`);
}
