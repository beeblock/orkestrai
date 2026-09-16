const { PNG } = require('pngjs');

function composeDisplays(items) {
  const minX = Math.min(...items.map(item => item.bounds.x));
  const minY = Math.min(...items.map(item => item.bounds.y));
  const width = Math.ceil(Math.max(...items.map(item => item.bounds.x + item.bounds.width)) - minX);
  const height = Math.ceil(Math.max(...items.map(item => item.bounds.y + item.bounds.height)) - minY);
  if (!items.length || !Number.isSafeInteger(width * height) || width * height > 32_000_000 || width > 32768 || height > 32768 || width <= 0 || height <= 0) throw new Error('Display geometry exceeds capture limits.');
  const png = new PNG({ width, height, fill: true });
  for (const item of items) {
    const image = PNG.sync.read(item.png, { checkCRC: true });
    if (image.width !== item.bounds.width || image.height !== item.bounds.height) throw new Error('Display geometry changed during capture.');
    PNG.bitblt(image, png, 0, 0, image.width, image.height, item.bounds.x - minX, item.bounds.y - minY);
  }
  return { base64: PNG.sync.write(png).toString('base64'), width, height };
}

function createDesktopCapture({ screen, desktopCapturer }) {
  return async input => {
    const displays = screen.getAllDisplays();
    const selected = input.target === 'display' ? displays.filter(display => String(display.id) === input.targetId) : displays;
    if (!selected.length || input.target === 'window') throw new Error('The target display is unavailable.');
    const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false,
      thumbnailSize: { width: Math.max(...selected.map(display => display.size.width)), height: Math.max(...selected.map(display => display.size.height)) } });
    return composeDisplays(selected.map(display => {
      const matches = sources.filter(source => source.display_id === String(display.id));
      if (matches.length !== 1 || matches[0].thumbnail.isEmpty()) throw new Error('Display capture is unavailable.');
      const current = screen.getAllDisplays().find(candidate => candidate.id === display.id);
      if (!current || JSON.stringify(current.bounds) !== JSON.stringify(display.bounds)) throw new Error('Display geometry changed during capture.');
      const image = matches[0].thumbnail.resize({ width: display.bounds.width, height: display.bounds.height, quality: 'best' });
      return { png: image.toPNG(), bounds: display.bounds };
    }));
  };
}

module.exports = { composeDisplays, createDesktopCapture };
