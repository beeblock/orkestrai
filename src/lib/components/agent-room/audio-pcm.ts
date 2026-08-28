/** Converts browser audio into the mono PCM16 16 kHz expected by local STT. */

import {
  DICTATION_SAMPLE_RATE,
  analyzeAudioSignal,
  normalizeSpeechAudio,
  resampleAudio,
  type AudioSignalStats,
} from '$lib/modules/agent-room/domain/voice-audio.js';

export type PcmRecording = {
  wav: Blob;
  stats: AudioSignalStats;
};

const TARGET_RATE = DICTATION_SAMPLE_RATE;

export async function blobToWav16k(blob: Blob): Promise<Blob> {
  if (blob.size === 0) throw new Error('Nenhum audio foi gravado.');
  const audioContext = new AudioContext({ sampleRate: TARGET_RATE });
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const offline = new OfflineAudioContext(1, frameCount, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return pcmToWavBlob(rendered.getChannelData(0), TARGET_RATE);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

export function pcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Records the selected device as raw PCM. MediaRecorder containers have been
 * unreliable across Electron/macOS input devices even when the live meter has
 * a healthy signal, so dictation deliberately shares the Web Audio path.
 */
export class PcmAudioRecorder {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private mutedOutput: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = TARGET_RATE;
  private stopped = false;
  private flushResolver: (() => void) | null = null;

  constructor(private readonly stream: MediaStream) {}

  async start(): Promise<void> {
    const context = new AudioContext({ sampleRate: TARGET_RATE });
    this.context = context;
    this.sampleRate = context.sampleRate;
    try {
      await context.audioWorklet.addModule('/audio/pcm-capture-worklet.js');
      this.source = context.createMediaStreamSource(this.stream);
      this.processor = new AudioWorkletNode(context, 'orkestrai-pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      this.processor.port.onmessage = (event: MessageEvent<{ type?: string; samples?: Float32Array }>) => {
        if (event.data?.type === 'samples' && event.data.samples instanceof Float32Array) {
          this.chunks.push(event.data.samples);
        } else if (event.data?.type === 'flushed') {
          this.flushResolver?.();
        }
      };
      this.mutedOutput = context.createGain();
      this.mutedOutput.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(this.mutedOutput);
      this.mutedOutput.connect(context.destination);
      if (context.state === 'suspended') await context.resume();
    } catch (error) {
      await this.disposeGraph();
      throw error;
    }
  }

  async stop(): Promise<PcmRecording> {
    if (this.stopped) return { wav: pcmToWavBlob(new Float32Array(), TARGET_RATE), stats: analyzeAudioSignal(new Float32Array()) };
    this.stopped = true;
    await this.flushProcessor();
    const totalLength = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const captured = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      captured.set(chunk, offset);
      offset += chunk.length;
    }
    const samples = resampleAudio(captured, this.sampleRate, TARGET_RATE);
    const stats = analyzeAudioSignal(samples, TARGET_RATE);
    const wav = pcmToWavBlob(normalizeSpeechAudio(samples), TARGET_RATE);
    await this.disposeGraph();
    return { wav, stats };
  }

  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    void this.disposeGraph();
  }

  private async disposeGraph(): Promise<void> {
    this.flushResolver?.();
    this.flushResolver = null;
    if (this.processor) this.processor.port.onmessage = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.mutedOutput?.disconnect();
    this.source = null;
    this.processor = null;
    this.mutedOutput = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }

  private async flushProcessor(): Promise<void> {
    const processor = this.processor;
    if (!processor) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.flushResolver === finish) this.flushResolver = null;
        resolve();
      };
      const timer = setTimeout(finish, 500);
      this.flushResolver = finish;
      processor.port.postMessage({ type: 'flush' });
    });
  }
}
