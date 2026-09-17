import { describe, expect, it } from 'vitest';
import { isTerminalCopyShortcut, isWindowsTerminalPasteShortcut, unscaleTerminalPoint } from '$lib/components/agent-room/terminal-selection.js';

describe('terminal selection geometry', () => {
  it.each([0.35, 0.67, 1, 1.25, 1.5, 2])('normalizes every native mouse gesture at scale %s', (scale) => {
    const width = 601.5;
    const height = 301.25;
    const rect = { left: 180, top: 90, width: width * scale, height: height * scale };
    const point = unscaleTerminalPoint({ clientX: 180 + 125 * scale, clientY: 90 + 80 * scale }, rect, width, height);
    expect(point.clientX).toBeCloseTo(305);
    expect(point.clientY).toBeCloseTo(170);
  });
  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])('preserves the point while layout dimensions are invalid (%s)', (width) => {
    const point = { clientX: 12, clientY: 24 };
    expect(unscaleTerminalPoint(point, { left: 0, top: 0, width: 100, height: 100 }, width, 100)).toBe(point);
  });

  it('copia com Ctrl/Cmd+C somente quando ha selecao e preserva SIGINT sem selecao', () => {
    const event = { type: 'keydown', key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(isTerminalCopyShortcut(event, true)).toBe(true);
    expect(isTerminalCopyShortcut(event, false)).toBe(false);
    expect(isTerminalCopyShortcut({ ...event, key: 'x' }, true)).toBe(false);
    expect(isTerminalCopyShortcut({ ...event, type: 'keyup' }, true)).toBe(false);
  });

  it('intercepta somente Ctrl+V simples no Windows para colar texto', () => {
    const event = { type: 'keydown', key: 'v', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(isWindowsTerminalPasteShortcut(event, 'win32')).toBe(true);
    expect(isWindowsTerminalPasteShortcut(event, 'Win64')).toBe(true);
    expect(isWindowsTerminalPasteShortcut(event, 'darwin')).toBe(false);
    expect(isWindowsTerminalPasteShortcut({ ...event, shiftKey: true }, 'win32')).toBe(false);
    expect(isWindowsTerminalPasteShortcut({ ...event, type: 'keyup' }, 'win32')).toBe(false);
  });
});
