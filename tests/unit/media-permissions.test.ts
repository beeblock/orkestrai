import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
const { canUseAppMicrophone } = createRequire(import.meta.url)('../../electron/media-permissions.cjs');

describe('Electron microphone permission boundary', () => {
  const own = { contentsId: 1, mainContentsId: 1, url: 'http://127.0.0.1:4173/canvas', requestingUrl: 'http://127.0.0.1:4173/canvas', permission: 'media', mediaTypes: ['audio'], serverPort: 4173 };
  it('allows only audio from the real app renderer and exact live origin', () => {
    expect(canUseAppMicrophone(own)).toBe(true);
    for (const changes of [
      { contentsId: 2 }, { requestingUrl: 'https://untrusted.test/' },
      { url: 'http://localhost.evil.test' }, { url: 'http://127.0.0.1:9999/' },
      { url: 'file:///tmp/test.html' }, { mediaTypes: ['video'] },
      { mediaTypes: ['audio', 'video'] }, { permission: 'geolocation' },
      { serverPort: null },
    ]) expect(canUseAppMicrophone({ ...own, ...changes })).toBe(false);
  });
});
