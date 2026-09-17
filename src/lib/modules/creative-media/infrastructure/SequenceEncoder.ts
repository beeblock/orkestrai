import { constants } from 'node:fs';
import { open, mkdir, writeFile, statfs, stat, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname, dirname } from 'node:path';
import type { CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import type { SequenceDocument, SequenceClip } from '../contracts/schemas/creative-sequence.schema.js';
import { sequenceDuration } from '../domain/sequence.js';
import { CreativeMediaError } from '../domain/types.js';
import { encoderProcess, hashFile, SequenceEncoderRuntime, sequenceEncoderRuntime, encoderRoot } from './SequenceEncoderRuntime.js';

export function sequenceFilter(document: SequenceDocument, clip: SequenceClip) {
  const { width, height, fps } = document;
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p${clip.caption ? ",subtitles=caption.ass" : ''}`;
}
export function sequenceCaption(text: string, width: number, height: number) {
  // ASS control syntax is never taken from the caption. Keep text in a title-safe region.
  const safe = text.replace(/\\/g, '\uff3c').replace(/[{}]/g, value => value === '{' ? '\uff5b' : '\uff5d').replace(/[\r\n]+/g, '\\N');
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${Math.round(Math.min(width, height) * 0.038)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,${Math.round(width * 0.1)},${Math.round(width * 0.1)},${Math.round(height * 0.1)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:10:01.00,Default,,0,0,0,,${safe}\n`;
}
export class SequenceEncoder {
  constructor(readonly workspace: CreativeWorkspaceGateway, readonly runtime: SequenceEncoderRuntime = sequenceEncoderRuntime) {}
  async probe(path: string, signal?: AbortSignal) {
    const { ffprobe } = await this.runtime.require();
    const format = extname(path).toLowerCase() === '.mp4' ? 'mov' : 'matroska';
    const result = JSON.parse(await encoderProcess(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-f', format, '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', path], { signal }));
    const video = result.streams?.find((stream: { codec_type: string }) => stream.codec_type === 'video');
    const duration = Number(result.format?.duration ?? video?.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 600 || !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width > 7680 || video.height > 7680 || video.width * video.height > 33_177_600) throw new CreativeMediaError('creative_sequence_source_invalid');
    return { duration, width: video.width as number, height: video.height as number, hasAudio: result.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio') };
  }
  async copySource(workspaceId: string, clip: Pick<SequenceClip, 'nodeId' | 'path' | 'sha256'>, destination: string, signal?: AbortSignal) {
    const node = await this.workspace.node(workspaceId, clip.nodeId);
    if (node?.type !== 'video' || (node.payload as { path?: string }).path !== clip.path || !['.mp4', '.webm', '.mkv'].includes(extname(clip.path).toLowerCase())) throw new CreativeMediaError('creative_reference_unavailable');
    const source = await open(await this.workspace.existingPath(workspaceId, clip.path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const target = await open(destination, 'wx', 0o600).catch(async error => { await source.close(); throw error; });
    try {
      const info = await source.stat();
      if (!info.isFile() || info.size > 512 * 1024 ** 2 || info.size < 32) throw new CreativeMediaError('creative_reference_size');
      const hash = createHash('sha256'); let size = 0;
      for await (const chunk of source.createReadStream({ autoClose: false })) { signal?.throwIfAborted(); size += chunk.length; if (size > info.size) throw new CreativeMediaError('creative_reference_changed'); hash.update(chunk); await target.writeFile(chunk); }
      if (size !== info.size || hash.digest('hex') !== clip.sha256) throw new CreativeMediaError('creative_reference_changed');
    } finally { await source.close(); await target.close(); }
  }
  async render(workspaceId: string, document: SequenceDocument, jobId: string, signal: AbortSignal, progress: (value: number) => Promise<void>, authorize: (path: string, permission: 'read' | 'create') => Promise<void>) {
    const { ffmpeg } = await this.runtime.require();
    const temporary = join(encoderRoot(), '..', 'jobs', jobId); await mkdir(temporary, { recursive: true, mode: 0o700 });
    try {
      const disk = await statfs(temporary); if (disk.bavail * disk.bsize < 3 * 1024 ** 3) throw new CreativeMediaError('creative_sequence_disk_full');
      let encodedBytes = 0;
      for (const [index, clip] of document.clips.entries()) {
        signal.throwIfAborted();
        const available = await statfs(temporary); if (available.bavail * available.bsize < 1536 * 1024 ** 2) throw new CreativeMediaError('creative_sequence_disk_full');
        const source = join(temporary, `source-${index}${extname(clip.path).toLowerCase()}`);
        await authorize(clip.path, 'read');
        await this.copySource(workspaceId, clip, source, signal);
        const actual = await this.probe(source, signal);
        if (clip.out > actual.duration + 0.05) throw new CreativeMediaError('creative_sequence_trim_invalid');
        const duration = clip.out - clip.in;
        await writeFile(join(temporary, 'caption.ass'), sequenceCaption(clip.caption, document.width, document.height), { mode: 0o600 });
        const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-filter_threads', '2', '-protocol_whitelist', 'file', '-f', extname(source) === '.mp4' ? 'mov' : 'matroska', '-ss', String(clip.in), '-i', source];
        if (!actual.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
        args.push('-t', String(duration), '-map', '0:v:0', '-map', actual.hasAudio ? '0:a:0' : '1:a:0', '-vf', sequenceFilter(document, clip), '-af', `aresample=48000,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${clip.volume}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-map_metadata', '-1', '-movflags', '+faststart', '-fs', String(1024 ** 3), '-y', `part-${index}.mp4`);
        await encoderProcess(ffmpeg, args, { cwd: temporary, signal, timeout: 15 * 60 * 1000 });
        encodedBytes += (await stat(join(temporary, `part-${index}.mp4`))).size;
        if (encodedBytes > 1024 ** 3) throw new CreativeMediaError('creative_sequence_limit');
        await rm(source); await progress(Math.round((index + 1) / (document.clips.length + 1) * 100));
      }
      await writeFile(join(temporary, 'concat.txt'), document.clips.map((_, index) => `file 'part-${index}.mp4'`).join('\n'));
      await encoderProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file', '-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-c', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', '-fs', String(1024 ** 3), '-y', 'export.mp4'], { cwd: temporary, signal, timeout: 180000 });
      const output = join(temporary, 'export.mp4'), metadata = await this.probe(output, signal);
      if (Math.abs(metadata.duration - sequenceDuration(document)) > 0.2 || metadata.width !== document.width || metadata.height !== document.height) throw new CreativeMediaError('creative_sequence_output_invalid');
      signal.throwIfAborted();
      const path = `generated/videos/sequences/${jobId}.mp4`;
      await authorize(path, 'create');
      const destination = await this.workspace.writablePath(workspaceId, path); await mkdir(dirname(destination), { recursive: true });
      if (await this.workspace.writablePath(workspaceId, path) !== destination) throw new CreativeMediaError('creative_reference_changed');
      await copyFile(output, destination, constants.COPYFILE_EXCL);
      return { path, sha256: await hashFile(destination), size: (await stat(destination)).size, ...metadata, fps: document.fps, mimeType: 'video/mp4' as const };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
