// Builds the camp's illustrations from their ImageGen masters in
// .orkestrai/adventure/raw/camp (the newest file of each prefix wins):
// - image: one picture scaled to a width;
// - split: a sheet of side-by-side pieces, each cut to its own picture.
// The WebP files go to src/lib/assets/adventure/art, where the app
// fingerprints them (see camp-art.ts).
//
// usage: node scripts/adventure/build-art.mjs
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, '.orkestrai', 'adventure', 'raw', 'camp');
const OUT = join(ROOT, 'src', 'lib', 'assets', 'adventure', 'art');

const ENTRIES = [
  { mode: 'image', prefix: 'camp-banner', id: 'camp-banner', width: 1800, quality: 86 },
  { mode: 'image', prefix: 'world-map', id: 'world-map', width: 1600, quality: 88 },
  { mode: 'image', prefix: 'cube-art', id: 'cube', width: 640, quality: 90 },
  { mode: 'split', prefix: 'ui-ornaments', pieces: [{ id: 'corner', width: 96 }, { id: 'pedestal', width: 380 }, { id: 'divider', width: 260 }], quality: 92 },
];

function master(prefix) {
  const files = readdirSync(RAW).filter((name) => name.startsWith(prefix) && name.endsWith('.png'));
  if (!files.length) throw new Error(`no master for ${prefix}`);
  return join(RAW, files.sort((a, b) => statSync(join(RAW, b)).mtimeMs - statSync(join(RAW, a)).mtimeMs)[0]);
}

function scaled(source, x, y, width, height, targetWidth) {
  const scale = Math.min(1, targetWidth / width);
  const canvas = createCanvas(Math.round(width * scale), Math.round(height * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The box of opaque pixels inside a column of the sheet. */
function opaqueBox(image, left, right) {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let top = image.height, bottom = -1, first = right, last = left - 1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (data[(y * image.width + x) * 4 + 3] <= 24) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      first = Math.min(first, x); last = Math.max(last, x);
    }
  }
  if (bottom < 0) throw new Error('empty piece');
  return { x: first, y: top, width: last - first + 1, height: bottom - top + 1 };
}

mkdirSync(OUT, { recursive: true });
for (const entry of ENTRIES) {
  const image = await loadImage(master(entry.prefix));
  if (entry.mode === 'image') {
    const canvas = scaled(image, 0, 0, image.width, image.height, entry.width);
    writeFileSync(join(OUT, `${entry.id}.webp`), canvas.toBuffer('image/webp', entry.quality));
    console.log(entry.id, `${canvas.width}x${canvas.height}`);
    continue;
  }
  const column = image.width / entry.pieces.length;
  entry.pieces.forEach((piece, index) => {
    const box = opaqueBox(image, Math.round(index * column), Math.round((index + 1) * column));
    const canvas = scaled(image, box.x, box.y, box.width, box.height, piece.width);
    writeFileSync(join(OUT, `${piece.id}.webp`), canvas.toBuffer('image/webp', entry.quality));
    console.log(piece.id, `${canvas.width}x${canvas.height}`);
  });
}
