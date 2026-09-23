import * as m from '$lib/paraglide/messages.js';

export type CreativeMediaInput = { id: string; type: string; title: string; path?: string; mimeType?: string };

export function mediaFileKind(path: string): 'image' | 'video' | 'audio' | 'file' {
  if (/\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i.test(path)) return 'image';
  if (/\.(mp4|webm|mov|m4v|mkv)$/i.test(path)) return 'video';
  if (/\.(wav|mp3|m4a|aac|ogg|flac|opus)$/i.test(path)) return 'audio';
  return 'file';
}

export function fileMediaInput(path: string, inputs: CreativeMediaInput[] = []): CreativeMediaInput {
  const existing = inputs.find(input => input.path === path && ['image', 'video'].includes(input.type));
  const kind = mediaFileKind(path);
  return {
    id: `workspace-file:${path}`, path,
    title: existing?.title || path.replace(/\\/g, '/').split('/').at(-1) || path,
    type: existing?.type ?? (kind === 'audio' ? 'video' : kind),
    mimeType: existing?.mimeType ?? (kind === 'audio' ? 'audio/*' : undefined),
  };
}

export function mediaBindingInput(binding: { nodeId?: string; path?: string }, inputs: CreativeMediaInput[]): CreativeMediaInput | undefined {
  // A path binding remains a path binding, even if a canvas node uses the same file.
  if (binding.nodeId) return inputs.find(input => input.id === binding.nodeId);
  return binding.path ? fileMediaInput(binding.path, inputs) : undefined;
}

export function mediaInputUrl(workspaceId: string, path: string): string {
  return `/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/fs/raw?path=${encodeURIComponent(path)}`;
}

export function mediaSlotKind(pointer: string): 'image' | 'video' | 'audio' | 'file' {
  if (/audio|voice/i.test(pointer)) return 'audio';
  if (/video/i.test(pointer)) return 'video';
  if (/image|frame|mask|reference/i.test(pointer)) return 'image';
  return 'file';
}

export function mediaSlotLabel(pointer: string): string {
  const parts = pointer.split('/').filter(Boolean);
  const indices = parts.filter(part => /^\d+$/.test(part)).map(part => Number(part) + 1);
  const key = parts.filter(part => !/^\d+$/.test(part)).join('_');
  let label: string;
  if (/(?:start|first).*?(?:image|frame)|(?:image|frame).*?(?:start|first)/i.test(key) || /^(?:image|image_url)$/.test(key)) label = m['creative.start_image']();
  else if (/(?:end|last).*?(?:image|frame)|(?:image|frame).*?(?:end|last)/i.test(key)) label = m['creative.end_image']();
  else if (/mask/i.test(key)) label = m['creative.media_mask']();
  else if (mediaSlotKind(pointer) === 'image') label = m['creative.reference_images']();
  else if (mediaSlotKind(pointer) === 'audio') label = m['creative.reference_audio']();
  else if (mediaSlotKind(pointer) === 'video') label = m['creative.reference_videos']();
  else label = key.replace(/_?urls?$/i, '').replace(/_/g, ' ') || m['creative.media_source']();
  return indices.length ? `${label} ${indices.join(' / ')}` : label;
}

export function matchingMediaInputs(inputs: CreativeMediaInput[], pointer: string): CreativeMediaInput[] {
  const kind = mediaSlotKind(pointer);
  return inputs.filter(input => {
    if (!['image', 'video'].includes(input.type)) return false;
    if (kind === 'file') return true;
    if (kind === 'image') return input.type === 'image';
    if (kind === 'audio') return input.type === 'video' && (input.mimeType?.startsWith('audio/') ?? false);
    return input.type === 'video' && !input.mimeType?.startsWith('audio/');
  });
}

// Only workspace URLs are used for thumbnails. Never auto-fetch arbitrary provider URLs.
export function mediaInputThumbnail(workspaceId: string, input: CreativeMediaInput): string | undefined {
  return input.type === 'image' && input.path
    ? mediaInputUrl(workspaceId, input.path)
    : undefined;
}
