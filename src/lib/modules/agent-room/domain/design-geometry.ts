import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Polygon, Ring } from 'polygon-clipping';
import type { DesignElement, DesignPathPoint } from '../contracts/schemas/designSchemas.js';

export type DesignBooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude';

function estimatedGlyphWidth(character: string, fontSize: number, fontWeight: number): number {
  const weightAdjustment = Math.max(0, fontWeight - 400) / 10_000;
  if (/\s/.test(character)) return fontSize * 0.28;
  if (/[ilI1.,'`!|:;]/.test(character)) return fontSize * (0.28 + weightAdjustment);
  if (/[MW@#%&]/.test(character)) return fontSize * (0.84 + weightAdjustment);
  if (/[A-Z]/.test(character)) return fontSize * (0.64 + weightAdjustment);
  return fontSize * (0.52 + weightAdjustment);
}

export function designTextWidth(value: string, fontSize: number, fontWeight = 400, letterSpacing = 0): number {
  const characters = Array.from(value);
  return characters.reduce((width, character) => width + estimatedGlyphWidth(character, fontSize, fontWeight), 0)
    + Math.max(0, characters.length - 1) * letterSpacing;
}

export function designTextLines(value: string, width: number, fontSize: number, fontWeight = 400, letterSpacing = 0): string[] {
  const availableWidth = Math.max(fontSize, width);
  return value.split('\n').flatMap((paragraph) => {
    if (!paragraph) return [''];
    const lines: string[] = [];
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (designTextWidth(candidate, fontSize, fontWeight, letterSpacing) <= availableWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (designTextWidth(word, fontSize, fontWeight, letterSpacing) <= availableWidth) {
        current = word;
        continue;
      }
      let chunk = '';
      for (const character of Array.from(word)) {
        if (chunk && designTextWidth(chunk + character, fontSize, fontWeight, letterSpacing) > availableWidth) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      current = chunk;
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  });
}

export function designTextHeight(value: string, width: number, fontSize: number, fontWeight = 400, lineHeight: number | null = null, letterSpacing = 0, paragraphSpacing = 0): number {
  const resolvedLineHeight = lineHeight ?? fontSize * 1.2;
  const lines = designTextLayoutLines(value, width, fontSize, fontWeight, lineHeight, letterSpacing, paragraphSpacing);
  return Math.max(resolvedLineHeight, (lines.at(-1)?.offsetY ?? 0) + resolvedLineHeight);
}

export function designTextLayoutLines(value: string, width: number, fontSize: number, fontWeight = 400, lineHeight: number | null = null, letterSpacing = 0, paragraphSpacing = 0): Array<{ text: string; offsetY: number }> {
  const resolvedLineHeight = lineHeight ?? fontSize * 1.2;
  const result: Array<{ text: string; offsetY: number }> = [];
  let offsetY = 0;
  value.split('\n').forEach((paragraph, paragraphIndex, paragraphs) => {
    for (const text of designTextLines(paragraph, width, fontSize, fontWeight, letterSpacing)) {
      result.push({ text, offsetY });
      offsetY += resolvedLineHeight;
    }
    if (paragraphIndex < paragraphs.length - 1) offsetY += paragraphSpacing;
  });
  return result.length ? result : [{ text: '', offsetY: 0 }];
}

function rotatePoint(point: [number, number], element: DesignElement): [number, number] {
  if (!element.rotation) return point;
  const radians = element.rotation * Math.PI / 180;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const dx = point[0] - centerX;
  const dy = point[1] - centerY;
  return [
    centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
    centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
  ];
}

function closeRing(ring: Ring): Ring {
  if (!ring.length) return ring;
  const first = ring[0];
  const last = ring.at(-1)!;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [...first] as [number, number]];
}

export function elementPolygon(element: DesignElement): Polygon | null {
  let ring: Ring;
  if (element.type === 'rectangle' || element.type === 'frame' || element.type === 'image' || element.type === 'text') {
    ring = [
      [element.x, element.y],
      [element.x + element.width, element.y],
      [element.x + element.width, element.y + element.height],
      [element.x, element.y + element.height],
    ];
  } else if (element.type === 'ellipse') {
    const count = 48;
    ring = Array.from({ length: count }, (_, index) => {
      const angle = index / count * Math.PI * 2;
      return [
        element.x + element.width / 2 + Math.cos(angle) * element.width / 2,
        element.y + element.height / 2 + Math.sin(angle) * element.height / 2,
      ] as [number, number];
    });
  } else if (element.type === 'path') {
    const source = element.pathSubpaths[0] ?? element.pathPoints;
    if (source.length < 3 || !element.pathClosed) return null;
    ring = source.map((point) => [element.x + point.x, element.y + point.y]);
  } else {
    return null;
  }
  return [closeRing(ring.map((point) => rotatePoint(point, element)))];
}

export function combineDesignElements(
  elements: DesignElement[],
  operation: DesignBooleanOperation,
): { x: number; y: number; width: number; height: number; subpaths: DesignPathPoint[][] } {
  const polygons = elements.map(elementPolygon);
  if (polygons.some((polygon) => !polygon)) throw new Error('Only closed vector layers can be combined.');
  const [first, ...rest] = polygons as Polygon[];
  let result: MultiPolygon;
  if (operation === 'union') result = polygonClipping.union(first, ...rest);
  else if (operation === 'subtract') result = polygonClipping.difference(first, ...rest);
  else if (operation === 'intersect') result = polygonClipping.intersection(first, ...rest);
  else result = polygonClipping.xor(first, ...rest);
  const rings = result.flatMap((polygon) => polygon).filter((ring) => ring.length >= 4);
  if (!rings.length) throw new Error('The boolean operation produced an empty path.');
  const xs = rings.flatMap((ring) => ring.map((point) => point[0]));
  const ys = rings.flatMap((ring) => ring.map((point) => point[1]));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - x);
  const height = Math.max(1, Math.max(...ys) - y);
  return {
    x,
    y,
    width,
    height,
    subpaths: rings.map((ring) => ring.slice(0, -1).map(([pointX, pointY]) => ({
      x: pointX - x,
      y: pointY - y,
      inX: null,
      inY: null,
      outX: null,
      outY: null,
      mode: 'corner',
    }))),
  };
}

export function designPathData(element: DesignElement): string {
  const paths = element.pathSubpaths.length ? element.pathSubpaths : element.pathPoints.length ? [element.pathPoints] : [];
  return paths.map((points) => {
    if (!points.length) return '';
    const commands = [`M ${element.x + points[0].x} ${element.y + points[0].y}`];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      commands.push(designPathSegmentData(previous, point, element.x, element.y));
    }
    if (element.pathClosed && points.length > 1) {
      const last = points.at(-1)!;
      const first = points[0];
      commands.push(designPathSegmentData(last, first, element.x, element.y));
      commands.push('Z');
    }
    return commands.join(' ');
  }).filter(Boolean).join(' ');
}

type Point = { x: number; y: number };

function lerpPoint(from: Point, to: Point, amount: number): Point {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  };
}

function pathControls(from: DesignPathPoint, to: DesignPathPoint): { first: Point; second: Point; curved: boolean } {
  const hasFirst = from.outX !== null && from.outY !== null;
  const hasSecond = to.inX !== null && to.inY !== null;
  return {
    first: hasFirst ? { x: from.outX!, y: from.outY! } : { x: from.x, y: from.y },
    second: hasSecond ? { x: to.inX!, y: to.inY! } : { x: to.x, y: to.y },
    curved: hasFirst || hasSecond,
  };
}

export function designPathSegmentData(from: DesignPathPoint, to: DesignPathPoint, offsetX = 0, offsetY = 0): string {
  const controls = pathControls(from, to);
  if (!controls.curved) return `L ${offsetX + to.x} ${offsetY + to.y}`;
  return `C ${offsetX + controls.first.x} ${offsetY + controls.first.y} ${offsetX + controls.second.x} ${offsetY + controls.second.y} ${offsetX + to.x} ${offsetY + to.y}`;
}

export function designPathSegmentPoint(from: DesignPathPoint, to: DesignPathPoint, amount: number): Point {
  const t = Math.max(0, Math.min(1, amount));
  const controls = pathControls(from, to);
  if (!controls.curved) return lerpPoint(from, to, t);
  const p01 = lerpPoint(from, controls.first, t);
  const p12 = lerpPoint(controls.first, controls.second, t);
  const p23 = lerpPoint(controls.second, to, t);
  return lerpPoint(lerpPoint(p01, p12, t), lerpPoint(p12, p23, t), t);
}

export function splitDesignPathSegment(
  points: DesignPathPoint[],
  segmentStartIndex: number,
  amount: number,
  closed: boolean,
): DesignPathPoint[] {
  if (points.length < 2 || segmentStartIndex < 0 || segmentStartIndex >= points.length) return points;
  const nextIndex = (segmentStartIndex + 1) % points.length;
  if (!closed && nextIndex === 0) return points;
  const t = Math.max(0.01, Math.min(0.99, amount));
  const from = points[segmentStartIndex];
  const to = points[nextIndex];
  const controls = pathControls(from, to);
  const next = points.map((point) => ({ ...point }));
  let inserted: DesignPathPoint;
  if (controls.curved) {
    const p01 = lerpPoint(from, controls.first, t);
    const p12 = lerpPoint(controls.first, controls.second, t);
    const p23 = lerpPoint(controls.second, to, t);
    const p012 = lerpPoint(p01, p12, t);
    const p123 = lerpPoint(p12, p23, t);
    const point = lerpPoint(p012, p123, t);
    next[segmentStartIndex].outX = p01.x;
    next[segmentStartIndex].outY = p01.y;
    next[nextIndex].inX = p23.x;
    next[nextIndex].inY = p23.y;
    inserted = { ...point, inX: p012.x, inY: p012.y, outX: p123.x, outY: p123.y, mode: 'mirrored' };
  } else {
    inserted = { ...lerpPoint(from, to, t), inX: null, inY: null, outX: null, outY: null, mode: 'corner' };
  }
  if (nextIndex === 0) next.push(inserted);
  else next.splice(nextIndex, 0, inserted);
  return next;
}

export function cornerDesignPathPoint(points: DesignPathPoint[], index: number): DesignPathPoint[] {
  return points.map((point, pointIndex) => pointIndex === index
    ? { ...point, inX: null, inY: null, outX: null, outY: null, mode: 'corner' as const }
    : point);
}

export function convertDesignPathPointMode(
  points: DesignPathPoint[],
  index: number,
  mode: DesignPathPoint['mode'],
  closed: boolean,
): DesignPathPoint[] {
  if (mode === 'corner') return cornerDesignPathPoint(points, index);
  const point = points[index];
  if (!point || points.length < 2) return points;
  const previous = index > 0 ? points[index - 1] : closed ? points.at(-1)! : point;
  const following = index < points.length - 1 ? points[index + 1] : closed ? points[0] : point;
  const dx = following.x - previous.x;
  const dy = following.y - previous.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  const unitX = dx / magnitude;
  const unitY = dy / magnitude;
  const incomingLength = previous === point ? Math.hypot(following.x - point.x, following.y - point.y) / 3 : Math.hypot(point.x - previous.x, point.y - previous.y) / 3;
  const outgoingLength = following === point ? Math.hypot(point.x - previous.x, point.y - previous.y) / 3 : Math.hypot(following.x - point.x, following.y - point.y) / 3;
  const currentIncoming = point.inX === null || point.inY === null ? 0 : Math.hypot(point.inX - point.x, point.inY - point.y);
  const currentOutgoing = point.outX === null || point.outY === null ? 0 : Math.hypot(point.outX - point.x, point.outY - point.y);
  const mirroredLength = currentIncoming && currentOutgoing
    ? (currentIncoming + currentOutgoing) / 2
    : currentIncoming || currentOutgoing || (incomingLength + outgoingLength) / 2;
  const nextIncomingLength = mode === 'mirrored' ? mirroredLength : currentIncoming || incomingLength;
  const nextOutgoingLength = mode === 'mirrored' ? mirroredLength : currentOutgoing || outgoingLength;
  return points.map((candidate, pointIndex) => pointIndex === index ? {
    ...candidate,
    inX: candidate.x - unitX * nextIncomingLength,
    inY: candidate.y - unitY * nextIncomingLength,
    outX: candidate.x + unitX * nextOutgoingLength,
    outY: candidate.y + unitY * nextOutgoingLength,
    mode,
  } : candidate);
}

export function smoothDesignPathPoint(points: DesignPathPoint[], index: number, closed: boolean): DesignPathPoint[] {
  return convertDesignPathPointMode(points, index, 'mirrored', closed);
}

function cubicAt(start: number, first: number, second: number, end: number, amount: number): number {
  const inverse = 1 - amount;
  return inverse ** 3 * start + 3 * inverse ** 2 * amount * first + 3 * inverse * amount ** 2 * second + amount ** 3 * end;
}

function cubicExtrema(start: number, first: number, second: number, end: number): number[] {
  const a = -start + 3 * first - 3 * second + end;
  const b = 2 * (start - 2 * first + second);
  const c = first - start;
  if (Math.abs(a) < 1e-9) return Math.abs(b) < 1e-9 ? [] : [-c / b].filter((value) => value > 0 && value < 1);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter((value) => value > 0 && value < 1);
}

export function designPathBounds(subpaths: DesignPathPoint[][], closed: boolean): { x: number; y: number; width: number; height: number } | null {
  const values: Point[] = [];
  for (const points of subpaths) {
    if (!points.length) continue;
    values.push(...points.map((point) => ({ x: point.x, y: point.y })));
    const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
    for (let index = 0; index < segmentCount; index += 1) {
      const from = points[index];
      const to = points[(index + 1) % points.length];
      const controls = pathControls(from, to);
      if (!controls.curved) continue;
      const extrema = new Set([
        ...cubicExtrema(from.x, controls.first.x, controls.second.x, to.x),
        ...cubicExtrema(from.y, controls.first.y, controls.second.y, to.y),
      ]);
      for (const amount of extrema) values.push({
        x: cubicAt(from.x, controls.first.x, controls.second.x, to.x, amount),
        y: cubicAt(from.y, controls.first.y, controls.second.y, to.y, amount),
      });
    }
  }
  if (!values.length) return null;
  const minX = Math.min(...values.map((point) => point.x));
  const minY = Math.min(...values.map((point) => point.y));
  const maxX = Math.max(...values.map((point) => point.x));
  const maxY = Math.max(...values.map((point) => point.y));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function scaleDesignPathSubpaths(subpaths: DesignPathPoint[][], scaleX: number, scaleY: number): DesignPathPoint[][] {
  return subpaths.map((points) => points.map((point) => ({
    ...point,
    x: point.x * scaleX,
    y: point.y * scaleY,
    inX: point.inX === null ? null : point.inX * scaleX,
    inY: point.inY === null ? null : point.inY * scaleY,
    outX: point.outX === null ? null : point.outX * scaleX,
    outY: point.outY === null ? null : point.outY * scaleY,
  })));
}

export function bendDesignPathSegment(
  points: DesignPathPoint[],
  segmentStartIndex: number,
  amount: number,
  deltaX: number,
  deltaY: number,
  closed: boolean,
): DesignPathPoint[] {
  if (points.length < 2 || segmentStartIndex < 0 || segmentStartIndex >= points.length) return points;
  const nextIndex = (segmentStartIndex + 1) % points.length;
  if (!closed && nextIndex === 0) return points;
  const t = Math.max(0.05, Math.min(0.95, amount));
  const influence = 3 * (1 - t) * t;
  const from = points[segmentStartIndex];
  const to = points[nextIndex];
  const controls = pathControls(from, to);
  const offsetX = deltaX / influence;
  const offsetY = deltaY / influence;
  return points.map((point, index) => {
    if (index === segmentStartIndex) return { ...point, outX: controls.first.x + offsetX, outY: controls.first.y + offsetY, mode: 'disconnected' };
    if (index === nextIndex) return { ...point, inX: controls.second.x + offsetX, inY: controls.second.y + offsetY, mode: 'disconnected' };
    return point;
  });
}

export function autoLayoutChanges(frame: DesignElement, children: DesignElement[]): Map<string, Partial<DesignElement>> {
  const changes = new Map<string, Partial<DesignElement>>();
  const ordered = [...children].filter((child) => !child.layoutItemAbsolute).sort((a, b) => a.order - b.order);
  if (frame.layoutMode === 'none' || !ordered.length) return changes;
  const bounded = (value: number, min: number | null, max: number | null) => Math.max(min ?? 1, Math.min(max ?? 100_000, value));
  const preferredWidth = (child: DesignElement) => bounded(child.width, child.minWidth, child.maxWidth);
  const preferredHeight = (child: DesignElement) => bounded(child.height, child.minHeight, child.maxHeight);
  const columnCount = frame.layoutMode === 'grid' ? Math.max(1, Math.min(frame.layoutGridColumns, ordered.length)) : 1;
  const rowCount = Math.ceil(ordered.length / columnCount);
  const contentWidth = frame.layoutMode === 'horizontal'
    ? ordered.reduce((total, child) => total + preferredWidth(child), 0) + frame.layoutGap * Math.max(0, ordered.length - 1)
    : frame.layoutMode === 'grid'
      ? Math.max(...Array.from({ length: columnCount }, (_, column) => Math.max(...ordered.filter((_, index) => index % columnCount === column).map(preferredWidth)))) * columnCount + frame.layoutColumnGap * Math.max(0, columnCount - 1)
      : Math.max(...ordered.map(preferredWidth));
  const contentHeight = frame.layoutMode === 'vertical'
    ? ordered.reduce((total, child) => total + preferredHeight(child), 0) + frame.layoutGap * Math.max(0, ordered.length - 1)
    : frame.layoutMode === 'grid'
      ? Array.from({ length: rowCount }, (_, row) => Math.max(...ordered.slice(row * columnCount, (row + 1) * columnCount).map(preferredHeight))).reduce((total, height) => total + height, 0) + frame.layoutRowGap * Math.max(0, rowCount - 1)
      : Math.max(...ordered.map(preferredHeight));
  const frameWidth = frame.widthSizing === 'hug'
    ? bounded(contentWidth + frame.layoutPaddingLeft + frame.layoutPaddingRight, frame.minWidth, frame.maxWidth)
    : bounded(frame.width, frame.minWidth, frame.maxWidth);
  const frameHeight = frame.heightSizing === 'hug'
    ? bounded(contentHeight + frame.layoutPaddingTop + frame.layoutPaddingBottom, frame.minHeight, frame.maxHeight)
    : bounded(frame.height, frame.minHeight, frame.maxHeight);
  if (frameWidth !== frame.width || frameHeight !== frame.height) changes.set(frame.id, { width: frameWidth, height: frameHeight });
  const left = frame.x + frame.layoutPaddingLeft;
  const top = frame.y + frame.layoutPaddingTop;
  const availableWidth = Math.max(1, frameWidth - frame.layoutPaddingLeft - frame.layoutPaddingRight);
  const availableHeight = Math.max(1, frameHeight - frame.layoutPaddingTop - frame.layoutPaddingBottom);
  const crossOffset = (available: number, size: number) => frame.layoutCrossAlign === 'center'
    ? (available - size) / 2
    : frame.layoutCrossAlign === 'end' ? available - size : 0;
  if (frame.layoutMode === 'grid') {
    const columns = columnCount;
    const cellWidth = Math.max(1, (availableWidth - frame.layoutColumnGap * (columns - 1)) / columns);
    let rowY = top;
    for (let index = 0; index < ordered.length; index += columns) {
      const row = ordered.slice(index, index + columns);
      const rowHeight = Math.max(...row.map(preferredHeight));
      row.forEach((child, column) => {
        const width = child.widthSizing === 'fill' || frame.layoutCrossAlign === 'stretch' ? bounded(cellWidth, child.minWidth, child.maxWidth) : Math.min(cellWidth, preferredWidth(child));
        const height = child.heightSizing === 'fill' ? bounded(rowHeight, child.minHeight, child.maxHeight) : preferredHeight(child);
        changes.set(child.id, { x: left + column * (cellWidth + frame.layoutColumnGap) + crossOffset(cellWidth, width), y: rowY, width, height });
      });
      rowY += rowHeight + frame.layoutRowGap;
    }
    return changes;
  }
  if (frame.layoutMode === 'vertical') {
    const fixedHeight = ordered.filter((child) => child.heightSizing !== 'fill').reduce((total, child) => total + preferredHeight(child), 0);
    const fillChildren = ordered.filter((child) => child.heightSizing === 'fill');
    const gap = frame.layoutAlign === 'space-between' && !fillChildren.length && ordered.length > 1
      ? Math.max(frame.layoutGap, (availableHeight - fixedHeight) / (ordered.length - 1))
      : frame.layoutGap;
    const remaining = Math.max(1, availableHeight - fixedHeight - gap * Math.max(0, ordered.length - 1));
    const totalHeight = fixedHeight + fillChildren.length * (remaining / Math.max(1, fillChildren.length)) + gap * Math.max(0, ordered.length - 1);
    let y = top + (frame.layoutAlign === 'center' ? (availableHeight - totalHeight) / 2 : frame.layoutAlign === 'end' ? availableHeight - totalHeight : 0);
    for (const child of ordered) {
      const width = child.widthSizing === 'fill' || frame.layoutCrossAlign === 'stretch' ? bounded(availableWidth, child.minWidth, child.maxWidth) : preferredWidth(child);
      const height = child.heightSizing === 'fill' ? bounded(remaining / Math.max(1, fillChildren.length), child.minHeight, child.maxHeight) : preferredHeight(child);
      changes.set(child.id, { x: left + crossOffset(availableWidth, width), y, width, height });
      y += height + gap;
    }
    return changes;
  }
  if (!frame.layoutWrap) {
    const fixedWidth = ordered.filter((child) => child.widthSizing !== 'fill').reduce((total, child) => total + preferredWidth(child), 0);
    const fillChildren = ordered.filter((child) => child.widthSizing === 'fill');
    const gap = frame.layoutAlign === 'space-between' && !fillChildren.length && ordered.length > 1
      ? Math.max(frame.layoutGap, (availableWidth - fixedWidth) / (ordered.length - 1))
      : frame.layoutGap;
    const remaining = Math.max(1, availableWidth - fixedWidth - gap * Math.max(0, ordered.length - 1));
    const totalWidth = fixedWidth + fillChildren.length * (remaining / Math.max(1, fillChildren.length)) + gap * Math.max(0, ordered.length - 1);
    let x = left + (frame.layoutAlign === 'center' ? (availableWidth - totalWidth) / 2 : frame.layoutAlign === 'end' ? availableWidth - totalWidth : 0);
    for (const child of ordered) {
      const width = child.widthSizing === 'fill' ? bounded(remaining / Math.max(1, fillChildren.length), child.minWidth, child.maxWidth) : preferredWidth(child);
      const height = child.heightSizing === 'fill' || frame.layoutCrossAlign === 'stretch' ? bounded(availableHeight, child.minHeight, child.maxHeight) : preferredHeight(child);
      changes.set(child.id, { x, y: top + crossOffset(availableHeight, height), width, height });
      x += width + gap;
    }
    return changes;
  }
  let x = left;
  let y = top;
  let rowHeight = 0;
  for (const child of ordered) {
    const width = preferredWidth(child);
    const height = preferredHeight(child);
    if (x > left && x + width > left + availableWidth) {
      x = left;
      y += rowHeight + frame.layoutRowGap;
      rowHeight = 0;
    }
    changes.set(child.id, { x, y, width, height });
    x += width + frame.layoutGap;
    rowHeight = Math.max(rowHeight, height);
  }
  return changes;
}

export function constrainedChildChanges(
  child: DesignElement,
  frame: DesignElement,
  nextFrame: Pick<DesignElement, 'x' | 'y' | 'width' | 'height'>,
): Partial<DesignElement> {
  const widthRatio = nextFrame.width / frame.width;
  const heightRatio = nextFrame.height / frame.height;
  const left = child.x - frame.x;
  const right = frame.width - left - child.width;
  const top = child.y - frame.y;
  const bottom = frame.height - top - child.height;
  const changes: Partial<DesignElement> = {};
  if (child.constraintHorizontal === 'right') changes.x = nextFrame.x + nextFrame.width - right - child.width;
  else if (child.constraintHorizontal === 'left-right') {
    changes.x = nextFrame.x + left;
    changes.width = Math.max(1, nextFrame.width - left - right);
  } else if (child.constraintHorizontal === 'center') changes.x = nextFrame.x + nextFrame.width / 2 - (frame.width / 2 - left);
  else if (child.constraintHorizontal === 'scale') {
    changes.x = nextFrame.x + left * widthRatio;
    changes.width = Math.max(1, child.width * widthRatio);
  } else changes.x = nextFrame.x + left;
  if (child.constraintVertical === 'bottom') changes.y = nextFrame.y + nextFrame.height - bottom - child.height;
  else if (child.constraintVertical === 'top-bottom') {
    changes.y = nextFrame.y + top;
    changes.height = Math.max(1, nextFrame.height - top - bottom);
  } else if (child.constraintVertical === 'center') changes.y = nextFrame.y + nextFrame.height / 2 - (frame.height / 2 - top);
  else if (child.constraintVertical === 'scale') {
    changes.y = nextFrame.y + top * heightRatio;
    changes.height = Math.max(1, child.height * heightRatio);
  } else changes.y = nextFrame.y + top;
  return changes;
}
