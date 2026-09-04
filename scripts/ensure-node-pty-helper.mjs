import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const packageRoot = join(root, 'node_modules', 'node-pty');
  const candidates = [join(packageRoot, 'build', 'Release', 'spawn-helper')];
  const prebuilds = join(packageRoot, 'prebuilds');

  if (existsSync(prebuilds)) {
    for (const directory of readdirSync(prebuilds)) {
      candidates.push(join(prebuilds, directory, 'spawn-helper'));
    }
  }

  for (const helper of candidates) {
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
