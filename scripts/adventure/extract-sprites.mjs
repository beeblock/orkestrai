// Extracts the sprites of a transparent sheet by connected components.
//
// The `expected` largest opaque blobs become sprites; every smaller blob (a
// floating note, a drone, a spark) joins the sprite whose box is nearest.
// Sprites are ordered in reading order: rows top to bottom, then left to right.
//
// usage: node scripts/adventure/extract-sprites.mjs <sheet.png> <outDir> <expected> [name,name,...] [--rows N]
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const rowsIndex = args.indexOf('--rows');
const rows = rowsIndex >= 0 ? Number(args.splice(rowsIndex, 2)[1]) : 0;
const [sheetPath, outDir, expectedArg, namesArg] = args;
const expected = Number(expectedArg);
const names = namesArg ? namesArg.split(',') : [];

const image = await loadImage(sheetPath);
const canvas = createCanvas(image.width, image.height);
const context = canvas.getContext('2d');
context.drawImage(image, 0, 0);
const { data, width, height } = context.getImageData(0, 0, image.width, image.height);

// Label 4-connected opaque pixels.
const labels = new Int32Array(width * height).fill(-1);
const blobs = [];
const stack = [];
for (let start = 0; start < width * height; start += 1) {
  if (labels[start] >= 0 || data[start * 4 + 3] <= 96) continue;
  const blob = { left: width, right: 0, top: height, bottom: 0, area: 0, id: blobs.length };
  labels[start] = blob.id;
  stack.push(start);
  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = (index - x) / width;
    blob.area += 1;
    if (x < blob.left) blob.left = x;
    if (x > blob.right) blob.right = x;
    if (y < blob.top) blob.top = y;
    if (y > blob.bottom) blob.bottom = y;
    for (const next of [index - 1, index + 1, index - width, index + width]) {
      if (next < 0 || next >= width * height) continue;
      if ((next === index - 1 && x === 0) || (next === index + 1 && x === width - 1)) continue;
      if (labels[next] >= 0 || data[next * 4 + 3] <= 96) continue;
      labels[next] = blob.id;
      stack.push(next);
    }
  }
  blobs.push(blob);
}

const ranked = [...blobs].sort((a, b) => b.area - a.area);
const anchors = ranked.slice(0, expected).map((blob) => ({ ...blob, members: [blob.id] }));
const distance = (a, b) => {
  const dx = Math.max(0, a.left - b.right, b.left - a.right);
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  return Math.hypot(dx, dy);
};
for (const blob of ranked.slice(expected)) {
  if (blob.area < 6) continue;
  const owner = anchors.reduce((best, anchor) => (distance(blob, anchor) < distance(blob, best) ? anchor : best), anchors[0]);
  owner.members.push(blob.id);
  owner.left = Math.min(owner.left, blob.left);
  owner.right = Math.max(owner.right, blob.right);
  owner.top = Math.min(owner.top, blob.top);
  owner.bottom = Math.max(owner.bottom, blob.bottom);
}

// Reading order: cluster into rows by vertical centre, then left to right.
let ordered = [...anchors].sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
if (rows > 1) {
  const byRow = [];
  const perRow = Math.ceil(ordered.length / rows);
  for (let row = 0; row < rows; row += 1) byRow.push(...ordered.slice(row * perRow, (row + 1) * perRow).sort((a, b) => a.left - b.left));
  ordered = byRow;
} else {
  ordered.sort((a, b) => a.left - b.left);
}

mkdirSync(outDir, { recursive: true });
const report = [];
ordered.forEach((sprite, index) => {
  const members = new Set(sprite.members);
  const crop = createCanvas(sprite.right - sprite.left + 1, sprite.bottom - sprite.top + 1);
  const target = crop.getContext('2d');
  const pixels = target.createImageData(crop.width, crop.height);
  for (let y = sprite.top; y <= sprite.bottom; y += 1) {
    for (let x = sprite.left; x <= sprite.right; x += 1) {
      const source = y * width + x;
      // Keep this sprite's own pixels and the soft edge around them, nothing of a neighbour.
      const label = labels[source];
      if (label >= 0 && !members.has(label)) continue;
      if (label < 0 && data[source * 4 + 3] === 0) continue;
      const out = ((y - sprite.top) * crop.width + (x - sprite.left)) * 4;
      pixels.data.set(data.subarray(source * 4, source * 4 + 4), out);
    }
  }
  target.putImageData(pixels, 0, 0);
  const name = names[index] ?? `sprite-${String(index + 1).padStart(2, '0')}`;
  writeFileSync(join(outDir, `${name}.png`), crop.toBuffer('image/png'));
  report.push({ name, x: sprite.left, y: sprite.top, width: crop.width, height: crop.height });
});
console.log(JSON.stringify(report));
