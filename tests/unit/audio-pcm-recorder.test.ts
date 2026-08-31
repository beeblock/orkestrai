import { afterEach, describe, expect, it, vi } from 'vitest';
import { PcmAudioRecorder } from '../../src/lib/components/agent-room/audio-pcm.js';

class FakePort {
  onmessage: ((event: MessageEvent<{ type: string; samples?: Float32Array }>) => void) | null = null;

  postMessage(message: { type?: string }) {
    if (message.type !== 'flush') return;
    this.onmessage?.({ data: { type: 'samples', samples: new Float32Array([0.1, -0.1]) } } as MessageEvent);
    this.onmessage?.({ data: { type: 'flushed' } } as MessageEvent);
  }
}

class FakeAudioWorkletNode {
  static latest: FakeAudioWorkletNode | null = null;
  port = new FakePort();
  connect = vi.fn();
  disconnect = vi.fn();

  constructor(_context: unknown, _name: string, _options: unknown) {
    FakeAudioWorkletNode.latest = this;
  }
}

const addModule = vi.fn(async () => undefined);
const source = { connect: vi.fn(), disconnect: vi.fn() };
const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
const close = vi.fn(async () => undefined);

class FakeAudioContext {
  static latestOptions: AudioContextOptions | undefined;
  sampleRate = 44_100;
  state: AudioContextState = 'running';
  destination = {} as AudioDestinationNode;
  audioWorklet = { addModule };
  createMediaStreamSource = vi.fn(() => source);
  createGain = vi.fn(() => gain);
  close = close;

  constructor(options?: AudioContextOptions) {
    FakeAudioContext.latestOptions = options;
  }
}

describe('PcmAudioRecorder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    FakeAudioWorkletNode.latest = null;
    FakeAudioContext.latestOptions = undefined;
  });

  it('captures and flushes PCM through AudioWorklet without ScriptProcessorNode', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
    const recorder = new PcmAudioRecorder({} as MediaStream);

    await recorder.start();
    const recording = await recorder.stop();

    expect(addModule).toHaveBeenCalledWith('/audio/pcm-capture-worklet.js');
    expect(FakeAudioContext.latestOptions).toBeUndefined();
    expect(FakeAudioWorkletNode.latest).not.toBeNull();
    expect(recording.wav.type).toBe('audio/wav');
    expect(recording.wav.size).toBeGreaterThan(44);
    expect(close).toHaveBeenCalledOnce();
  });
});
