// Builds the Adventure's sprite atlases from the masters the image workflows made.
//
// Each master is a sheet on a transparent background. Three layouts:
// - grid (animation sheets): an even grid of frames. Every frame is cropped
//   (keeping detached effects such as a slash arc, an arrow or stars with
//   their frame), the whole sheet is scaled once so the character keeps its
//   proportions from frame to frame, and every frame is anchored at the feet;
// - props (scenery): every separate object becomes a frame, in reading order,
//   scaled once so the tallest one has the given height;
// - ground: the opaque band of a ground strip, cropped and mirrored into one
//   tile that repeats without a seam.
// One WebP plus one JSON per sheet go to src/lib/assets/adventure/sprites, where the
// app bundles the frames and fingerprints the images (cached for good once loaded).
//
// usage: node scripts/adventure/build-atlas.mjs [id ...]   (all entries by default)
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, '.orkestrai', 'adventure', 'raw');
const OUT = join(ROOT, 'src', 'lib', 'assets', 'adventure', 'sprites');
const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'atlas-manifest.json'), 'utf8'));
const only = new Set(process.argv.slice(2));

/** The newest master whose name starts with `prefix` in `folder`. */
function master(folder, prefix) {
  const dir = join(RAW, folder);
  // Names end in a content hash, so the newest is found by modification time.
  const files = readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.png'))
    .map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs })).sort((a, b) => a.time - b.time);
  if (!files.length) throw new Error(`No master for ${prefix} in ${dir}`);
  return join(dir, files.at(-1).name);
}

function pixels(image) {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  // ImageData exposes its fields as getters, which a spread would drop.
  const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
  return { canvas, data, width, height };
}

/**
 * Which frame owns each pixel. The sheet is an even grid of `rows` x `cols`
 * cells. In each cell the largest blob of opaque pixels is the character's
 * body; every smaller blob (a slash arc, an arrow in flight, stars, a note)
 * joins the body nearest to it, even across a cell border, so effects stay
 * with their own frame. A blob larger than a cell (two frames drawn touching)
 * is split by growing each frame from the middle of its cell through it. Faint edge pixels follow the cell they sit in.
 */
function owners({ data, width, height }, rows, cols) {
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const cellOf = (x, y) => Math.min(rows - 1, Math.floor(y / cellHeight)) * cols + Math.min(cols - 1, Math.floor(x / cellWidth));
  const owner = new Int16Array(width * height).fill(-1);
  const seen = new Uint8Array(width * height);
  const stack = [];
  const blobs = [];
  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || data[start * 4 + 3] <= 96) continue;
    const members = [];
    seen[start] = 1;
    stack.push(start);
    let left = width, right = 0, top = height, bottom = 0, sumX = 0, sumY = 0;
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = (index - x) / width;
      members.push(index);
      sumX += x; sumY += y;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width];
      for (const next of neighbours) {
        if (next < 0 || next >= width * height || seen[next] || data[next * 4 + 3] <= 96) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    const cx = sumX / members.length;
    const cy = sumY / members.length;
    blobs.push({ members, left, right, top, bottom, cx, cy, cell: cellOf(cx, cy), fits: right - left + 1 <= cellWidth * 1.7 && bottom - top + 1 <= cellHeight * 1.4 });
  }
  // The body of each cell: its largest blob that fits in a cell.
  const bodies = new Map();
  for (const blob of blobs) {
    if (!blob.fits) continue;
    const current = bodies.get(blob.cell);
    if (!current || blob.members.length > current.members.length) bodies.set(blob.cell, blob);
  }
  const gap = (blob, body) => Math.hypot(Math.max(0, body.left - blob.right, blob.left - body.right), Math.max(0, body.top - blob.bottom, blob.top - body.bottom));
  for (const blob of blobs) {
    if (!blob.fits) {
      // Grow every frame from the middle of its own cell through the blob:
      // each pixel joins the frame that reaches it first, so a flame or a
      // lunge stays with the body it comes out of.
      const label = new Map();
      const queue = [];
      for (const index of blob.members) {
        const x = index % width;
        const offset = x / cellWidth - Math.floor(x / cellWidth);
        if (offset < 0.25 || offset > 0.75) continue;
        label.set(index, cellOf(x, (index - x) / width));
        queue.push(index);
      }
      const inBlob = new Set(blob.members);
      for (let head = 0; head < queue.length; head += 1) {
        const index = queue[head];
        const x = index % width;
        for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
          if (next < 0 || !inBlob.has(next) || label.has(next)) continue;
          label.set(next, label.get(index));
          queue.push(next);
        }
      }
      for (const index of blob.members) { const x = index % width; owner[index] = label.get(index) ?? cellOf(x, (index - x) / width); }
      continue;
    }
    let home = blob.cell;
    if (bodies.get(blob.cell) !== blob) {
      let best = Infinity;
      for (const [cell, body] of bodies) {
        if (Math.floor(cell / cols) !== Math.floor(blob.cell / cols)) continue;
        // Nearest body by edge gap, then by centre distance.
        const score = gap(blob, body) * 1000 + Math.hypot(blob.cx - body.cx, blob.cy - body.cy);
        if (score < best) { best = score; home = cell; }
      }
    }
    for (const index of blob.members) owner[index] = home;
  }
  for (let index = 0; index < width * height; index += 1) {
    if (owner[index] >= 0 || data[index * 4 + 3] === 0) continue;
    const x = index % width;
    owner[index] = cellOf(x, (index - x) / width);
  }
  return owner;
}

/** Separate objects of a props sheet: big blobs, each with the small bits next to it. */
function propOwners({ data, width, height }) {
  const owner = new Int16Array(width * height).fill(-1);
  const seen = new Uint8Array(width * height);
  const stack = [];
  const blobs = [];
  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || data[start * 4 + 3] <= 96) continue;
    const members = [];
    seen[start] = 1;
    stack.push(start);
    let left = width, right = 0, top = height, bottom = 0;
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = (index - x) / width;
      members.push(index);
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
        if (next < 0 || next >= width * height || seen[next] || data[next * 4 + 3] <= 96) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    blobs.push({ members, left, right, top, bottom });
  }
  const largest = Math.max(...blobs.map((blob) => blob.members.length));
  const objects = blobs.filter((blob) => blob.members.length >= largest * 0.02);
  // Reading order: rows by the objects' bottoms, then left to right.
  const rowOf = (blob) => Math.round(blob.bottom / (height / 4));
  objects.sort((a, b) => rowOf(a) - rowOf(b) || a.left - b.left);
  const gap = (blob, body) => Math.hypot(Math.max(0, body.left - blob.right, blob.left - body.right), Math.max(0, body.top - blob.bottom, blob.top - body.bottom));
  for (const blob of blobs) {
    let home = objects.indexOf(blob);
    if (home < 0) {
      let best = Infinity;
      objects.forEach((body, index) => { const score = gap(blob, body); if (score < best) { best = score; home = index; } });
      if (best > 24) continue;
    }
    for (const index of blob.members) owner[index] = home;
  }
  return { owner, count: objects.length };
}

/** Opaque box of one frame and the x of the character's feet (centre of mass of its lowest fifth). */
function frameBox({ data, width, height }, owner, frame) {
  let left = Infinity, right = -1, top = Infinity, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (owner[index] !== frame || data[index * 4 + 3] <= 96) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const footTop = bottom - Math.max(4, Math.round((bottom - top) * 0.2));
  let sum = 0, count = 0;
  for (let y = footTop; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const index = y * width + x;
      if (owner[index] === frame && data[index * 4 + 3] > 128) { sum += x; count += 1; }
    }
  }
  return { left, right, top, bottom, footX: count ? sum / count : (left + right) / 2 };
}

/** A canvas holding only one frame's pixels, cropped to its box. */
function frameCanvas(source, owner, frame, box) {
  const width = box.right - box.left + 1;
  const height = box.bottom - box.top + 1;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (box.top + y) * source.width + box.left + x;
      if (owner[index] !== frame) continue;
      image.data.set(source.data.subarray(index * 4, index * 4 + 4), (y * width + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Cuts alpha fringes so scaled sprites keep a clean edge on any background. */
function hardenAlpha(context, width, height) {
  const image = context.getImageData(0, 0, width, height);
  for (let index = 3; index < image.data.length; index += 4) {
    const alpha = image.data[index];
    image.data[index] = alpha < 48 ? 0 : alpha > 200 ? 255 : alpha;
  }
  context.putImageData(image, 0, 0);
}

/** The ground band, cropped and mirrored so its right edge meets the next tile's left edge. */
async function buildGround(entry) {
  const source = pixels(await loadImage(master(entry.folder, entry.prefix)));
  const { data, width, height } = source;
  // The band starts at the first row that is mostly opaque (grass tips above it stay).
  const opaqueShare = (y) => { let count = 0; for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3] > 96) count += 1; return count / width; };
  let top = 0;
  while (top < height && opaqueShare(top) < 0.02) top += 1;
  let bottom = height - 1;
  while (bottom > top && opaqueShare(bottom) < 0.5) bottom -= 1;
  // The last rows of a generated strip are often a soft edge: leave them out.
  bottom -= Math.round((bottom - top) * 0.03);
  const inset = Math.round(width * 0.02);
  const cropWidth = width - inset * 2;
  const scale = entry.height / (bottom - top + 1);
  const tileWidth = Math.round(cropWidth * scale);
  const tile = createCanvas(tileWidth * 2, entry.height);
  const context = tile.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source.canvas, inset, top, cropWidth, bottom - top + 1, 0, 0, tileWidth, entry.height);
  context.save();
  context.translate(tileWidth * 2, 0);
  context.scale(-1, 1);
  context.drawImage(source.canvas, inset, top, cropWidth, bottom - top + 1, 0, 0, tileWidth, entry.height);
  context.restore();
  hardenAlpha(context, tile.width, tile.height);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${entry.id}.webp`), tile.toBuffer('image/webp', 92));
  const json = { id: entry.id, height: entry.height, frames: [{ x: 0, y: 0, w: tile.width, h: tile.height, ax: 0, ay: tile.height }], animations: {} };
  writeFileSync(join(OUT, `${entry.id}.json`), `${JSON.stringify(json)}\n`);
  return { id: entry.id, frames: 1, size: `${tile.width}x${tile.height}`, scale: scale.toFixed(3) };
}

async function buildSheet(entry) {
  if (entry.mode === 'ground') return buildGround(entry);
  const source = pixels(await loadImage(master(entry.folder, entry.prefix)));
  let owner, frameCount;
  if (entry.mode === 'props') ({ owner, count: frameCount } = propOwners(source));
  // `count`: a grid whose last cells are left empty on purpose.
  else { owner = owners(source, entry.rows, entry.cols); frameCount = entry.count ?? entry.rows * entry.cols; }
  const boxes = Array.from({ length: frameCount }, (_, frame) => frameBox(source, owner, frame));
  const heights = (entry.mode === 'props' ? boxes.map((_, index) => index) : entry.scaleFrames ?? [0, 1, 2, 3, 4, 5])
    .map((index) => boxes[index]).filter(Boolean).map((box) => box.bottom - box.top + 1).sort((a, b) => a - b);
  // One scale per sheet, so proportions hold across animations (grid: the median
  // of the reference frames; props: the tallest object).
  const scale = entry.height / (entry.mode === 'props' ? heights.at(-1) : heights[Math.floor(heights.length / 2)]);
  const frames = boxes.map((box, index) => {
    if (!box) throw new Error(`${entry.id}: frame ${index} is empty`);
    const width = Math.max(1, Math.round((box.right - box.left + 1) * scale));
    const height = Math.max(1, Math.round((box.bottom - box.top + 1) * scale));
    return { box, width, height, anchorX: Math.round((box.footX - box.left) * scale), anchorY: height };
  });
  // Pack frames in rows of the sheet's own order.
  const padding = 2;
  const sheetWidth = Math.min(4096, frames.reduce((sum, frame) => sum + frame.width + padding, 0));
  let x = 0, y = 0, rowHeight = 0, totalHeight = 0;
  const placed = frames.map((frame) => {
    if (x + frame.width > sheetWidth) { x = 0; y += rowHeight + padding; rowHeight = 0; }
    const spot = { x, y };
    x += frame.width + padding;
    rowHeight = Math.max(rowHeight, frame.height);
    totalHeight = Math.max(totalHeight, y + rowHeight);
    return spot;
  });
  const atlas = createCanvas(sheetWidth, totalHeight);
  const context = atlas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  frames.forEach((frame, index) => {
    context.drawImage(frameCanvas(source, owner, index, frame.box), placed[index].x, placed[index].y, frame.width, frame.height);
  });
  hardenAlpha(context, atlas.width, atlas.height);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${entry.id}.webp`), atlas.toBuffer('image/webp', 92));
  const json = {
    id: entry.id,
    height: entry.height,
    frames: frames.map((frame, index) => ({ x: placed[index].x, y: placed[index].y, w: frame.width, h: frame.height, ax: frame.anchorX, ay: frame.anchorY })),
    animations: entry.animations ?? {},
  };
  writeFileSync(join(OUT, `${entry.id}.json`), `${JSON.stringify(json)}\n`);
  return { id: entry.id, frames: frames.length, size: `${atlas.width}x${atlas.height}`, scale: scale.toFixed(3) };
}

const report = [];
for (const entry of manifest.sheets) {
  if (only.size && !only.has(entry.id)) continue;
  try {
    report.push(await buildSheet(entry));
  } catch (error) {
    report.push({ id: entry.id, error: error.message });
  }
}
console.table(report);
if (!existsSync(OUT)) process.exit(1);
