import { describe, expect, it } from 'vitest';
import { isTerminalCopyShortcut, isWindowsTerminalPasteShortcut, shouldSuppressNativeSingleClickSelection, terminalCellAtPoint, terminalSelectionRange } from '$lib/components/agent-room/terminal-selection.js';

describe('terminal selection geometry', () => {
  it('mapeia coordenadas pelo retangulo visual escalado', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(terminalCellAtPoint({ clientX: 300, clientY: 150 }, rect, 80, 20, 40)).toEqual({ column: 40, row: 50 });
  });

  it('normaliza selecao reversa em varias linhas', () => {
    expect(terminalSelectionRange({ column: 10, row: 8 }, { column: 5, row: 6 }, 80)).toEqual({
      column: 5,
      row: 6,
      length: 166,
    });
  });

  it('so suprime a selecao nativa do xterm no clique unico, fora de modo de rastreamento de mouse', () => {
    const leftSingleClick = { button: 0, detail: 1, shiftKey: false };
    expect(shouldSuppressNativeSingleClickSelection(leftSingleClick, 'none')).toBe(true);
    // Duplo/triplo clique (selecao de palavra/linha) continuam nativos do xterm.
    expect(shouldSuppressNativeSingleClickSelection({ ...leftSingleClick, detail: 2 }, 'none')).toBe(false);
    expect(shouldSuppressNativeSingleClickSelection({ ...leftSingleClick, detail: 3 }, 'none')).toBe(false);
    // So o botao esquerdo.
    expect(shouldSuppressNativeSingleClickSelection({ ...leftSingleClick, button: 2 }, 'none')).toBe(false);
    // TUI com mouse tracking: xterm deve reportar o clique ao programa, exceto com Shift.
    expect(shouldSuppressNativeSingleClickSelection(leftSingleClick, 'x10')).toBe(false);
    expect(shouldSuppressNativeSingleClickSelection({ ...leftSingleClick, shiftKey: true }, 'x10')).toBe(true);
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
