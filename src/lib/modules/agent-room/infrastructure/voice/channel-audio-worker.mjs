import decodeAudio from 'audio-decode';
import { parseBuffer } from 'music-metadata';

process.on('disconnect', () => process.exit(0));
let used = false;
process.on('message', async message => {
  if (used) return; used = true;
  try {
    const bytes = message?.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error();
    const metadata = await parseBuffer(Buffer.from(bytes), undefined, { duration: true, skipCovers: true });
    const duration = metadata.format.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 300) throw new Error();
    // audio-decode must receive an exact-sized ArrayBuffer, not a Buffer pool.
    const decoded = await decodeAudio(new Uint8Array(bytes).buffer);
    const rate = decoded.sampleRate, channels = decoded.numberOfChannels;
    if (!Number.isFinite(rate) || rate < 8_000 || rate > 96_000 || channels < 1 || channels > 4 || decoded.length / rate > 300) throw new Error();
    const count = Math.ceil(decoded.length * 16_000 / rate);
    if (!count || count > 16_000 * 300) throw new Error();
    const wav = Buffer.alloc(44 + count * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
    const data = Array.from({ length: channels }, (_, i) => decoded.getChannelData(i));
    for (let i = 0; i < count; i++) {
      const position = i * rate / 16_000, lo = Math.floor(position), hi = Math.min(lo + 1, decoded.length - 1), mix = position - lo;
      let sample = 0;
      for (const channel of data) sample += (channel[lo] || 0) * (1 - mix) + (channel[hi] || 0) * mix;
      sample = Math.max(-1, Math.min(1, sample / channels));
      wav.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), 44 + i * 2);
    }
    process.send?.({ ok: true, wav }, () => process.exit(0));
  } catch { process.send?.({ ok: false }, () => process.exit(0)); }
});
