import { describe, expect, it } from 'vitest';
import { MAX_POSTED_IMAGES, postedImagePaths } from '../../src/lib/modules/agent-room/domain/channels.js';

describe('postedImagePaths', () => {
  it('reads workspace images from markdown, in order and without repeats', () => {
    expect(postedImagePaths('See ![Board A](branding/a.png "title") and ![](./b.webp)\n![Again](branding/a.png) ![x](<c d.png>)')).toEqual([
      { alt: 'Board A', path: 'branding/a.png' },
      { alt: '', path: 'b.webp' },
    ]);
  });

  it('skips web addresses, data URIs and app routes', () => {
    expect(postedImagePaths('![a](https://x.dev/a.png) ![b](//cdn/b.png) ![c](data:image/png;base64,AA) ![d](/api/x) ![e](#top) ![f](mailto:a@b)')).toEqual([]);
  });

  it('keeps an absolute path for the server to confine, and caps the count', () => {
    expect(postedImagePaths('![abs](/Users/me/project/a.png)')).toEqual([{ alt: 'abs', path: '/Users/me/project/a.png' }]);
    const many = Array.from({ length: 10 }, (_, index) => `![${index}](img-${index}.png)`).join(' ');
    expect(postedImagePaths(many)).toHaveLength(MAX_POSTED_IMAGES);
  });
});
