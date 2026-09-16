const { createHash } = require('node:crypto');

// Only formats Electron can restore together in one write. File promises and
// application-private formats are not flattened into text to speed up input.
const supported = new Set(['text/plain', 'text/html', 'text/rtf', 'image/png', 'image/bmp', 'image/tiff',
  'public.utf8-plain-text', 'public.utf16-plain-text', 'public.html', 'public.rtf', 'public.png', 'public.tiff',
  'NSStringPboardType', 'NSHTMLPboardType', 'NSRTFPboardType', 'NSTIFFPboardType']);

function createComputerClipboard(clipboard) {
  let busy = false;
  const fingerprint = () => {
    const hash = createHash('sha256'), formats = clipboard.availableFormats().sort();
    let size = 0;
    for (const format of formats) {
      const bytes = clipboard.readBuffer(format);
      size += bytes.length;
      if (size > 16 * 1024 * 1024) throw new Error('Clipboard exceeds the restoration limit.');
      hash.update(JSON.stringify(format)).update(bytes);
    }
    return hash.digest('hex');
  };
  return async (text, deliver) => {
    if (busy) return { used: false };
    const formats = clipboard.availableFormats();
    if (formats.some(format => !supported.has(format))) return { used: false };
    let before, saved;
    try {
      before = fingerprint();
      saved = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF() };
      const image = clipboard.readImage();
      if (!image.isEmpty()) saved.image = image;
      if (fingerprint() !== before) return { used: false };
    } catch { return { used: false }; }
    busy = true;
    let inserted;
    try {
      clipboard.writeText(text);
      inserted = fingerprint();
      if (clipboard.readText() !== text) throw new Error('Clipboard text was not confirmed.');
      // The callback must verify the complete native draft before returning.
      return { used: true, result: await deliver() };
    } finally {
      try {
        if (inserted && fingerprint() === inserted) {
          if (formats.length) clipboard.write(saved);
          else clipboard.clear();
        }
      } finally { busy = false; }
    }
  };
}

module.exports = { createComputerClipboard };
