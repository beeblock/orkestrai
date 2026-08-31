/** Converts browser audio into the mono PCM16 16 kHz expected by local STT. */

import {
  DICTATION_SAMPLE_RATE,
  analyzeAudioSignal,
  audioSignalIsEmpty,
  normalizeSpeechAudio,
  resampleAudio,
  type AudioSignalStats,
} from '$lib/modules/agent-room/domain/voice-audio.js';

export type PcmRecording = {
  wav: Blob;
  stats: AudioSignalStats;
};

const TARGET_RATE = DICTATION_SAMPLE_RATE;

async function blobToRecording16k(blob: Blob): Promise<PcmRecording> {
  if (blob.size === 0) throw new Error('Nenhum audio foi gravado.');
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const source = strongestAudioChannel(decoded);
    const samples = resampleAudio(source, decoded.sampleRate, TARGET_RATE);
    return {
      wav: pcmToWavBlob(normalizeSpeechAudio(samples), TARGET_RATE),
      stats: analyzeAudioSignal(samples, TARGET_RATE),
    };
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

export async function blobToWav16k(blob: Blob): Promise<Blob> {
  return (await blobToRecording16k(blob)).wav;
}

function strongestAudioChannel(buffer: AudioBuffer): Float32Array {
  let strongest = buffer.getChannelData(0);
  let strongestEnergy = -1;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    let energy = 0;
    for (let index = 0; index < channel.length; index += 1) energy += channel[index] * channel[index];
    if (energy > strongestEnergy) {
      strongest = channel;
      strongestEnergy = energy;
    }
  }
  return strongest;
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
  private backupRecorder: MediaRecorder | null = null;
  private backupChunks: Blob[] = [];

  constructor(private readonly stream: MediaStream) {}

  async start(): Promise<void> {
    // Use the hardware rate while capturing. Requesting 16 kHz here can leave
    // Chromium/Electron with an open 44.1/48 kHz track that emits empty blocks.
    const context = new AudioContext();
    this.context = context;
    this.sampleRate = context.sampleRate;
    try {
      await context.audioWorklet.addModule('/audio/pcm-capture-worklet.js');
      this.source = context.createMediaStreamSource(this.stream);
      this.processor = new AudioWorkletNode(context, 'orkestrai-pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCountMode: 'max',
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
      this.startBackupCapture();
    } catch (error) {
      await this.disposeGraph();
      throw error;
    }
  }

  async stop(): Promise<PcmRecording> {
    if (this.stopped) return { wav: pcmToWavBlob(new Float32Array(), TARGET_RATE), stats: analyzeAudioSignal(new Float32Array()) };
    this.stopped = true;
    const backup = this.stopBackupCapture().catch(() => null);
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
    if (!audioSignalIsEmpty(stats)) {
      void backup;
      return { wav, stats };
    }

    const backupBlob = await backup;
    if (backupBlob?.size) {
      try {
        const recovered = await blobToRecording16k(backupBlob);
        if (!audioSignalIsEmpty(recovered.stats)) return recovered;
      } catch {
        // Preserve the primary empty result so callers show the usual guidance.
      }
    }
    return { wav, stats };
  }

  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    void this.stopBackupCapture().catch(() => null);
    void this.disposeGraph();
  }

  private startBackupCapture(): void {
    if (typeof MediaRecorder === 'undefined') return;
    try {
      const recorder = new MediaRecorder(this.stream);
      this.backupRecorder = recorder;
      this.backupChunks = [];
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) this.backupChunks.push(event.data);
      });
      recorder.start(250);
    } catch {
      this.backupRecorder = null;
      this.backupChunks = [];
    }
  }

  private async stopBackupCapture(): Promise<Blob | null> {
    const recorder = this.backupRecorder;
    this.backupRecorder = null;
    if (!recorder) return null;
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, 1_000);
        recorder.addEventListener('stop', finish, { once: true });
        recorder.addEventListener('error', finish, { once: true });
        recorder.stop();
      });
    }
    const chunks = this.backupChunks;
    this.backupChunks = [];
    return chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : null;
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
