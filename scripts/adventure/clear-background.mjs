// Makes a generated sheet's backdrop transparent when the image model painted
// one (a dark gradient or a glow) instead of leaving alpha. A flood fill grows
// from the image border through neighbouring pixels of nearly the same colour;
// the dark pixel-art outline of every object stops it, so objects keep their
// pixels and only the connected backdrop is cleared.
//
// usage: node scripts/adventure/clear-background.mjs <in.png> <out.png> [tolerance]
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

const [input, output, toleranceArg] = process.argv.slice(2);
const tolerance = Number(toleranceArg ?? 14);
const image = await loadImage(input);
const canvas = createCanvas(image.width, image.height);
const context = canvas.getContext('2d');
context.drawImage(image, 0, 0);
const pixels = context.getImageData(0, 0, image.width, image.height);
const { data, width, height } = pixels;
const cleared = new Uint8Array(width * height);
const stack = [];
const close = (a, b) => Math.max(Math.abs(data[a * 4] - data[b * 4]), Math.abs(data[a * 4 + 1] - data[b * 4 + 1]), Math.abs(data[a * 4 + 2] - data[b * 4 + 2])) <= tolerance;
for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
for (let y = 0; y < height; y += 1) stack.push(y * width, y * width + width - 1);
for (const index of stack) cleared[index] = 1;
while (stack.length) {
  const index = stack.pop();
  const x = index % width;
  for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
    if (next < 0 || next >= width * height || cleared[next] || !close(index, next)) continue;
    cleared[next] = 1;
    stack.push(next);
  }
}
let count = 0;
for (let index = 0; index < width * height; index += 1) if (cleared[index]) { data[index * 4 + 3] = 0; count += 1; }
context.putImageData(pixels, 0, 0);
writeFileSync(output, canvas.toBuffer('image/png'));
console.log(`${input}: cleared ${(count / (width * height) * 100).toFixed(1)}% of the pixels`);
