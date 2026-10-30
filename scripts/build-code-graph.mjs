import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';
import { readFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeDependencies = Object.keys(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).dependencies);
await build({ configFile: false, root, resolve: { alias: { '$lib': resolve(root, 'src/lib') } },
  // Svelte is a development dependency. Its static parser must travel inside
  // this standalone worker bundle, just as it does in the SvelteKit server.
  ssr: { noExternal: true, external: runtimeDependencies },
  build: { ssr: 'src/lib/modules/agent-room/infrastructure/code-graph/CodeGraphBuildEngine.ts',
    outDir: 'build/code-graph-build', emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'index.mjs' } } } });
