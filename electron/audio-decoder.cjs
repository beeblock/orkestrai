const MAX_INPUT = 10 * 1024 * 1024;
const MAX_OUTPUT = 44 + 600 * 16000 * 2;

/** Runs in a dedicated isolated world of the existing trusted app renderer.
 * @param {string} base64
 */
async function decodeInRenderer(base64) {
  const raw = atob(base64);
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  const context = new OfflineAudioContext(1, 1, 16000);
  const decoded = await context.decodeAudioData(bytes.buffer);
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 600 || decoded.numberOfChannels < 1 || decoded.numberOfChannels > 2 || decoded.sampleRate !== 16000) throw new Error('Unsupported recording duration or channels.');
  let samples = decoded.getChannelData(0), strongest = -1;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const current = decoded.getChannelData(channel);
    let energy = 0;
    for (let i = 0; i < current.length; i++) energy += current[i] * current[i];
    if (energy > strongest) { strongest = energy; samples = current; }
  }
  const output = new Uint8Array(44 + samples.length * 2), view = new DataView(output.buffer);
  /** @param {number} offset @param {string} value */
  const ascii = (offset, value) => { for (let i = 0; i < value.length; i++) output[offset + i] = value.charCodeAt(i); };
  ascii(0, 'RIFF'); view.setUint32(4, output.length - 8, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  let binary = '';
  for (let offset = 0; offset < output.length; offset += 8192) binary += String.fromCharCode(...output.subarray(offset, offset + 8192));
  return btoa(binary);
}

function createAudioDecoder() {
  let busy = false;
  /**
   * @param {import('electron').WebContents | null | undefined} contents
   * @param {string} expectedOrigin
   * @param {{ base64: unknown }} request
   */
  const decode = async (contents, expectedOrigin, request) => {
    if (busy) throw new Error('An audio decode is already running.');
    if (!contents || contents.isDestroyed() || new URL(contents.getURL()).origin !== expectedOrigin) throw new Error('The trusted app renderer is unavailable for audio decoding.');
    if (typeof request.base64 !== 'string' || request.base64.length > Math.ceil(MAX_INPUT / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.base64)) throw new Error('Audio input exceeds the decoder limit.');
    const input = Buffer.from(request.base64, 'base64');
    if (!input.length || input.length > MAX_INPUT || input.toString('base64') !== request.base64) throw new Error('Invalid audio input.');
    busy = true;
    try {
      const result = await contents.executeJavaScriptInIsolatedWorld(1002, [{ code: `(${decodeInRenderer.toString()})(${JSON.stringify(request.base64)})` }], false);
      if (typeof result !== 'string' || result.length > Math.ceil(MAX_OUTPUT / 3) * 4) throw new Error('Decoded audio exceeds the output limit.');
      const wav = Buffer.from(result, 'base64');
      if (wav.length < 46 || wav.length > MAX_OUTPUT || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' || wav.readUInt32LE(4) + 8 !== wav.length || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000 || wav.readUInt16LE(34) !== 16 || wav.readUInt32LE(40) + 44 !== wav.length) throw new Error('Decoder returned an invalid PCM recording.');
      return result;
    } finally { busy = false; }
  };
  return decode;
}

module.exports = { createAudioDecoder, decodeInRenderer };
