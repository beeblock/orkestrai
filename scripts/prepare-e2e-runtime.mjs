import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Run once before the server, not when Playwright loads configuration in workers.
// Output cleanup must never unlink a running server's SQLite database or home.
const root = resolve('test-runtime');
if (process.env.ORKESTRAI_DATA_DIR !== root || process.env.HOME !== resolve(root, 'home') || process.env.DB_PATH !== resolve(root, 'database.db')) {
  throw new Error('E2E runtime paths are not isolated. Refusing cleanup.');
}
rmSync(root, { recursive: true, force: true });
mkdirSync(resolve(root, 'home'), { recursive: true });
