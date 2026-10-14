import { describe, expect, it } from 'vitest';
import { createMjpegFrameParser, mjpegBoundary } from '../../src/lib/components/agent-room/mjpeg-device-stream.js';

const jpeg = (seed: number, size = 64) => Buffer.from(Array.from({ length: size }, (_, index) => (seed * 31 + index) % 256));

// Same wire format the iOS Simulator helper writes for every frame.
function part(frame: Buffer, withLength = true): Buffer {
  const length = withLength ? `Content-Length: ${frame.length}\r\n` : '';
  return Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\n${length}\r\n`, 'ascii'), frame, Buffer.from('\r\n', 'ascii')]);
}

function feed(bytes: Buffer, chunkSize: number, contentType = 'multipart/x-mixed-replace; boundary=frame') {
  const parser = createMjpegFrameParser(contentType);
  const frames: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    for (const frame of parser.push(bytes.subarray(offset, offset + chunkSize))) frames.push(Buffer.from(frame));
  }
  return frames;
}

describe('MJPEG device stream parser', () => {
  it('reassembles Content-Length frames across every chunk boundary', () => {
    const frames = [jpeg(1), jpeg(2, 300), jpeg(3, 1)];
    const bytes = Buffer.concat(frames.map(frame => part(frame)));
    for (const chunkSize of [1, 2, 3, 7, 64, bytes.length]) {
      expect(feed(bytes, chunkSize)).toEqual(frames);
    }
  });

  it('splits parts without Content-Length at the next boundary', () => {
    const frames = [jpeg(4, 90), jpeg(5, 120)];
    const bytes = Buffer.concat([...frames.map(frame => part(frame, false)), Buffer.from('--frame\r\n', 'ascii')]);
    for (const chunkSize of [1, 5, 33, bytes.length]) {
      expect(feed(bytes, chunkSize)).toEqual(frames);
    }
  });

  it('uses the boundary declared by the response', () => {
    expect(mjpegBoundary('multipart/x-mixed-replace; boundary="--device"')).toBe('device');
    expect(mjpegBoundary('multipart/x-mixed-replace;boundary=sim; charset=binary')).toBe('sim');
    expect(mjpegBoundary(null)).toBe('frame');
    const frame = jpeg(6, 40);
    const bytes = Buffer.concat([Buffer.from('--sim\r\n\r\n', 'ascii'), frame, Buffer.from('\r\n--sim\r\n', 'ascii')]);
    expect(feed(bytes, 4, 'multipart/x-mixed-replace; boundary=sim')).toEqual([frame]);
  });

  it('rejects unbounded headers and frames instead of buffering them', () => {
    const parser = createMjpegFrameParser('multipart/x-mixed-replace; boundary=frame');
    expect(() => parser.push(Buffer.alloc(17 * 1024, 65))).toThrow(/header/);
    const oversized = createMjpegFrameParser('multipart/x-mixed-replace; boundary=frame');
    expect(() => oversized.push(Buffer.from('--frame\r\nContent-Length: 999999999\r\n\r\n', 'ascii'))).toThrow(/size limit/);
    const invalid = createMjpegFrameParser('multipart/x-mixed-replace; boundary=frame');
    expect(() => invalid.push(Buffer.from('--frame\r\nContent-Length: -4\r\n\r\n', 'ascii'))).toThrow(/Content-Length/);
  });
});
