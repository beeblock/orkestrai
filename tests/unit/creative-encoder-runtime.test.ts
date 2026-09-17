import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SequenceEncoderRuntime, SEQUENCE_ENCODERS, encoderProcess } from '$lib/modules/creative-media/infrastructure/SequenceEncoderRuntime.js';
import { sequenceCaption, sequenceFilter } from '$lib/modules/creative-media/infrastructure/SequenceEncoder.js';
import { sequenceDocumentSchema, sequenceClipSchema } from '$lib/modules/creative-media/contracts/schemas/creative-sequence.schema.js';
import { uuidv7 } from '@beeblock/svelar/support';
describe('managed sequence encoder', () => {
  it('reaps the encoder before acknowledging cancellation', async () => {
    const controller = new AbortController();
    const processRun = encoderProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
    controller.abort();
    await expect(processRun).rejects.toThrow('creative_sequence_cancelled');
  });
  it('pins all supported desktop architectures and rejects escaped manifests', async () => {
    expect(Object.keys(SEQUENCE_ENCODERS).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
    for (const archives of Object.values(SEQUENCE_ENCODERS)) for (const archive of archives) { expect(archive.sha256).toMatch(/^[a-f0-9]{64}$/); expect(archive.url).toMatch(/^https:\/\/(github.com|ffmpeg.martin-riedl.de)\//); }
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-encoder-manifest-'));
    try { await writeFile(join(root, 'installed.json'), JSON.stringify({ platform: 'darwin-arm64', ffmpeg: { path: '../ffmpeg', hash: 'a'.repeat(64) } })); expect(await new SequenceEncoderRuntime(root, 'darwin-arm64').binaries(true)).toBeNull(); expect((await new SequenceEncoderRuntime(root, 'freebsd-x64').status()).supported).toBe(false); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  it('keeps untrusted captions out of filter syntax and preserves aspect ratio', () => {
    const document = sequenceDocumentSchema.parse({ title: 'Test', width: 1080, height: 1920 });
    const clip = sequenceClipSchema.parse({ id: uuidv7(), nodeId: uuidv7(), title: 'Clip', path: 'clip.mp4', sha256: 'a'.repeat(64), sourceDuration: 1, out: 1, width: 640, height: 360, hasAudio: false, caption: '{\\pos(1,2)}; movie=/etc/passwd\nHello' });
    expect(sequenceFilter(document, clip)).not.toContain('passwd');
    expect(sequenceFilter(document, clip)).toContain('force_original_aspect_ratio=decrease');
    expect(sequenceCaption(clip.caption, 1080, 1920)).not.toContain('{\\pos');
    expect(sequenceCaption(clip.caption, 1080, 1920)).toContain('\\NHello');
  });
  it.skipIf(process.env.ORKESTRAI_TEST_ENCODER_DOWNLOAD !== '1')('downloads, verifies and executes the exact shipped runtime', async () => {
    const root = join(tmpdir(), 'orkestrai-managed-encoder-acceptance');
    const runtime = new SequenceEncoderRuntime(root);
    await runtime.install();
    const paths = await runtime.require();
    expect(await encoderProcess(paths.ffmpeg, ['-version'])).toContain('9.0.1');
    expect(await encoderProcess(paths.ffprobe, ['-version'])).toContain('9.0.1');
    expect((await runtime.status()).installed).toBe(true);
    await mkdir(join(root, 'acceptance'), { recursive: true });
    await encoderProcess(paths.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x240:r=24', '-t', '0.3', '-c:v', 'libx264', '-y', join(root, 'acceptance/smoke.mp4')]);
  }, 600000);
});
