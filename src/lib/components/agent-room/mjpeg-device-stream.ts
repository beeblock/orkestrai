/**
 * Splits a multipart/x-mixed-replace JPEG stream (MJPEG) into frames.
 *
 * Device screens are not shown through an <img>: Chromium reports every byte an
 * image resource receives to V8 as external memory until that resource is
 * destroyed. An endless MJPEG stream therefore grows the counter for as long as
 * the simulator is open and, after a few hours, keeps the renderer in
 * back-to-back full garbage collections.
 */

const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const EMPTY: Uint8Array = new Uint8Array(0);

export type MjpegFrameParser = {
  /** Consumes the next network chunk and returns every frame it completed. */
  push(chunk: Uint8Array): Uint8Array[];
};

export function mjpegBoundary(contentType: string | null | undefined): string {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  const value = (match?.[1] ?? match?.[2] ?? 'frame').replace(/^--/, '');
  return value || 'frame';
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (!left.length) return right;
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let index = Math.max(0, from); index + needle.length <= haystack.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, character => character.charCodeAt(0) & 0xff);
}

export function createMjpegFrameParser(contentType?: string | null): MjpegFrameParser {
  const headerEnd = ascii('\r\n\r\n');
  const delimiter = ascii(`\r\n--${mjpegBoundary(contentType)}`);
  let header: Uint8Array = EMPTY;
  // Known part length: the frame is filled in place with a single copy.
  let body: Uint8Array | null = null;
  let filled = 0;
  // Parts without Content-Length end at the next boundary delimiter.
  let scanned: Uint8Array | null = null;

  return {
    push(input) {
      const frames: Uint8Array[] = [];
      let chunk = input;
      let offset = 0;
      while (offset < chunk.length) {
        if (body) {
          const take = Math.min(body.length - filled, chunk.length - offset);
          body.set(chunk.subarray(offset, offset + take), filled);
          filled += take;
          offset += take;
          if (filled === body.length) {
            frames.push(body);
            body = null;
          }
          continue;
        }

        if (scanned) {
          const searchFrom = Math.max(0, scanned.length - delimiter.length + 1);
          scanned = concat(scanned, chunk.subarray(offset));
          offset = chunk.length;
          const end = indexOf(scanned, delimiter, searchFrom);
          if (end < 0) {
            if (scanned.length > MAX_FRAME_BYTES) throw new Error('MJPEG frame exceeds the size limit.');
            continue;
          }
          if (end > 0) frames.push(scanned.slice(0, end));
          // Continue at the delimiter's "--boundary" line.
          chunk = scanned.subarray(end + 2);
          offset = 0;
          scanned = null;
          continue;
        }

        // Header mode. The CRLF that closes the previous part is not a header.
        if (!header.length) {
          while (offset < chunk.length && (chunk[offset] === 13 || chunk[offset] === 10)) offset += 1;
          if (offset === chunk.length) break;
        }
        const piece = chunk.subarray(offset, offset + MAX_HEADER_BYTES - header.length);
        const joined = concat(header, piece);
        const end = indexOf(joined, headerEnd, header.length - headerEnd.length + 1);
        if (end < 0) {
          if (joined.length >= MAX_HEADER_BYTES) throw new Error('MJPEG part header exceeds the size limit.');
          header = joined === piece ? piece.slice() : joined;
          offset += piece.length;
          continue;
        }
        offset += end + headerEnd.length - header.length;
        header = EMPTY;
        const lines = String.fromCharCode(...joined.subarray(0, end)).split('\r\n');
        const lengthLine = lines.find(line => /^content-length\s*:/i.test(line));
        if (lengthLine === undefined) {
          scanned = EMPTY;
          continue;
        }
        const length = Number(lengthLine.slice(lengthLine.indexOf(':') + 1).trim());
        if (!Number.isSafeInteger(length) || length < 0) throw new Error('MJPEG part has an invalid Content-Length.');
        if (length > MAX_FRAME_BYTES) throw new Error('MJPEG frame exceeds the size limit.');
        if (length === 0) continue;
        body = new Uint8Array(length);
        filled = 0;
      }
      return frames;
    },
  };
}
