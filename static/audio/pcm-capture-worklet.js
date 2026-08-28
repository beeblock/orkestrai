const CAPTURE_CHUNK_SIZE = 4096;

class OrkestraiPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CAPTURE_CHUNK_SIZE);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'flush') return;
      this.emitSamples();
      this.port.postMessage({ type: 'flushed' });
    };
  }

  emitSamples() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.offset = 0;
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input?.length) {
      let inputOffset = 0;
      while (inputOffset < input.length) {
        const count = Math.min(input.length - inputOffset, CAPTURE_CHUNK_SIZE - this.offset);
        this.buffer.set(input.subarray(inputOffset, inputOffset + count), this.offset);
        this.offset += count;
        inputOffset += count;
        if (this.offset === CAPTURE_CHUNK_SIZE) this.emitSamples();
      }
    }

    for (const output of outputs[0] ?? []) output.fill(0);
    return true;
  }
}

registerProcessor('orkestrai-pcm-capture', OrkestraiPcmCaptureProcessor);
