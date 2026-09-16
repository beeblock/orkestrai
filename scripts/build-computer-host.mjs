import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  configFile: false,
  root,
  build: {
    ssr: 'src/lib/modules/agent-room/application/adapters/computers/CuaComputerHost.ts',
    outDir: 'build/computer-host',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'index.mjs' } },
  },
  ssr: { external: ['@trycua/cua-driver', '@beeblock/svelar/validation'] },
});
