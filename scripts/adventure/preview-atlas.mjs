// Draws an atlas for review: every frame on its foot anchor, plus an onion
// skin of each looping animation to spot jitter between frames.
// usage: node scripts/adventure/preview-atlas.mjs <id> <out.png>
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [id, out] = process.argv.slice(2);
const dir = join(process.cwd(), 'static', 'adventure', 'sprites');
const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
const atlas = await loadImage(join(dir, `${id}.webp`));
const scale = 2;
const cell = Math.max(...meta.frames.map((frame) => Math.max(frame.w, frame.h))) + 10;
const loops = Object.entries(meta.animations).filter(([, animation]) => animation.frames.length > 1);
const canvas = createCanvas(cell * scale * Math.max(meta.frames.length, 1) / 2, cell * scale * (2 + 1));
const context = canvas.getContext('2d');
context.imageSmoothingEnabled = false;
context.fillStyle = '#4b5263';
context.fillRect(0, 0, canvas.width, canvas.height);
const perRow = Math.ceil(meta.frames.length / 2);
meta.frames.forEach((frame, index) => {
  const baseX = (index % perRow) * cell * scale + cell * scale / 2;
  const baseY = (Math.floor(index / perRow) + 1) * cell * scale - 8;
  context.drawImage(atlas, frame.x, frame.y, frame.w, frame.h, baseX - frame.ax * scale, baseY - frame.ay * scale, frame.w * scale, frame.h * scale);
  context.fillStyle = '#ff3b6b';
  context.fillRect(baseX - 2, baseY - 1, 4, 2);
});
loops.forEach(([, animation], loop) => {
  const baseX = loop * cell * scale + cell * scale / 2;
  const baseY = 3 * cell * scale - 8;
  context.globalAlpha = 0.35;
  for (const index of animation.frames) {
    const frame = meta.frames[index];
    context.drawImage(atlas, frame.x, frame.y, frame.w, frame.h, baseX - frame.ax * scale, baseY - frame.ay * scale, frame.w * scale, frame.h * scale);
  }
  context.globalAlpha = 1;
});
writeFileSync(out, canvas.toBuffer('image/png'));
