export const VIDEO_FORMATS = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'video/x-matroska': 'mkv', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/flac': 'flac',
} as const;
export type VideoMime = keyof typeof VIDEO_FORMATS;

export function videoMimeFromPath(path: string): VideoMime {
  const extension = path.split('?')[0].split('.').at(-1)?.toLowerCase();
  return (Object.entries(VIDEO_FORMATS).find(([, value]) => value === extension)?.[0] ?? 'video/mp4') as VideoMime;
}

export function matchesVideoHeader(bytes: Uint8Array, mime: VideoMime): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (mime === 'audio/mpeg') return ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mime === 'audio/wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
  if (mime === 'audio/ogg') return ascii(0, 4) === 'OggS';
  if (mime === 'audio/flac') return ascii(0, 4) === 'fLaC';
  if (mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'audio/mp4') return ascii(4, 8) === 'ftyp';
  if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return false;
  const header = ascii(0, Math.min(bytes.length, 1024));
  return header.includes(mime === 'video/webm' ? 'webm' : 'matroska');
}
// Imported files must also fit the existing provider-reference reader.
export const MAX_IMPORTED_VIDEO_BYTES = 64 * 1024 * 1024;
export function importedVideoMime(name: string): VideoMime | null {
  const extension = name.split('.').pop()?.toLowerCase();
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' } as Record<string, VideoMime>)[extension ?? ''] ?? null;
}
export function isVideoDrop(file: { name: string; type: string }): boolean {
  return file.type.startsWith('video/') || importedVideoMime(file.name) !== null || /\.(avi|wmv|flv|mpeg|mpg|ogv|3gp|mts|m2ts)$/i.test(file.name);
}
