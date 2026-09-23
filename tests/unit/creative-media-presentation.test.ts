import { describe, expect, it } from 'vitest';
import { mediaSlotKind, mediaSlotLabel, matchingMediaInputs, mediaInputThumbnail, mediaBindingInput, mediaFileKind } from '$lib/components/agent-room/creative-media-presentation.js';
import { modelMediaSlots } from '$lib/modules/creative-media/domain/model-contract.js';

describe('video reference presentation', () => {
  it('presents standalone file references without creating or rebinding canvas nodes', () => {
    const binding = { pointer: '/image_url', path: 'generated/images/v14-b2-frame-276.png' };
    const source = mediaBindingInput(binding, []);
    expect(source).toMatchObject({ title: 'v14-b2-frame-276.png', path: binding.path, type: 'image' });
    expect(mediaInputThumbnail('workspace', source!)).toContain('generated%2Fimages%2Fv14-b2-frame-276.png');
    const existing = { id: 'image-id', type: 'image', title: 'Approved beach scene', path: binding.path };
    expect(mediaBindingInput(binding, [existing])?.title).toBe('Approved beach scene');
    expect(mediaBindingInput(binding, [existing])?.id).not.toBe(existing.id);
    expect(binding).toEqual({ pointer: '/image_url', path: 'generated/images/v14-b2-frame-276.png' });
    expect(mediaBindingInput({ nodeId: 'deleted', path: binding.path }, [existing])).toBeUndefined();
    expect(mediaBindingInput({ path: 'refs\\identity.PNG' }, [])?.title).toBe('identity.PNG');
    expect(mediaFileKind('voice.MP3')).toBe('audio');
    expect(mediaFileKind('shot.MP4')).toBe('video');
    expect(mediaFileKind('page.html')).toBe('file');
  });
  it('uses human numbering while retaining distinct nested model destinations', () => {
    expect(mediaSlotLabel('/reference_image_urls/4/1')).toMatch(/5 \/ 2$/);
    expect(mediaSlotLabel('/reference_image_urls/0')).toMatch(/1$/);
    expect(mediaSlotLabel('/start_image_url')).not.toContain('_');
    expect(mediaSlotLabel('/start_image_url')).not.toEqual(mediaSlotLabel('/end_image_url'));
    expect(mediaSlotKind('/audio_urls/0')).toBe('audio');
    expect(mediaSlotKind('/reference_video_urls/0')).toBe('video');
  });
  it('only offers matching sources and never constructs external thumbnail URLs', () => {
    const inputs = [
      { id: 'i', type: 'image', title: 'Identity', path: 'refs/identity.png' },
      { id: 'v', type: 'video', title: 'Shot', mimeType: 'video/mp4' },
      { id: 'a', type: 'video', title: 'Voice', mimeType: 'audio/wav' },
      { id: 'n', type: 'note', title: 'Direction' },
    ];
    expect(matchingMediaInputs(inputs, '/image_url').map(input => input.id)).toEqual(['i']);
    expect(matchingMediaInputs(inputs, '/audio_urls/0').map(input => input.id)).toEqual(['a']);
    expect(matchingMediaInputs(inputs, '/video_url').map(input => input.id)).toEqual(['v']);
    expect(mediaInputThumbnail('workspace', inputs[0])).toBe('/api/agent-room/workspaces/workspace/fs/raw?path=refs%2Fidentity.png');
    expect(mediaInputThumbnail('workspace', { ...inputs[0], path: 'https://untrusted.example/image.png' })).toMatch(/^\/api\//);
    expect(mediaInputThumbnail('workspace', inputs[1])).toBeUndefined();
  });
  it('retains model bounds and assigned array slots without rewriting the contract', () => {
    const schema = { type: 'object', properties: { reference_image_urls: { type: 'array', maxItems: 3, items: { type: 'string' } } } };
    const slots = modelMediaSlots(schema, ['/reference_image_urls/0']);
    expect(slots).toEqual(['/reference_image_urls/0', '/reference_image_urls/1']);
    expect(slots.map(mediaSlotLabel).every(label => !label.includes('urls'))).toBe(true);
  });
});
