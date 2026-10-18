import { describe, expect, it } from 'vitest';
import { withWorkspaceImages } from '$lib/components/agent-room/markdown-images.js';

describe('chat images from the workspace', () => {
  it('loads a workspace-relative image through the workspace file route', () => {
    expect(withWorkspaceImages('<p><img alt="Logo" src="./generated/images/logo.png"></p>', 'ws-1'))
      .toBe('<p><img alt="Logo" src="/api/agent-room/workspaces/ws-1/fs/raw?path=generated%2Fimages%2Flogo.png"></p>');
  });

  it('leaves web, data and app URLs as they are', () => {
    for (const src of ['https://example.com/a.png', 'data:image/png;base64,AA', '/api/agent-room/workspaces/x/fs/raw?path=a.png', '//cdn.example.com/a.png']) {
      const html = `<img src="${src}">`;
      expect(withWorkspaceImages(html, 'ws-1')).toBe(html);
    }
  });

  it('changes nothing without a workspace', () => {
    expect(withWorkspaceImages('<img src="a.png">', null)).toBe('<img src="a.png">');
  });
});
