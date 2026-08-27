export type TerminalCell = { column: number; row: number };

export function terminalCellAtPoint(
  point: { clientX: number; clientY: number },
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  cols: number,
  rows: number,
  viewportY: number
): TerminalCell {
  const column = Math.max(0, Math.min(cols - 1, Math.floor(((point.clientX - rect.left) / rect.width) * cols)));
  const visibleRow = Math.max(0, Math.min(rows - 1, Math.floor(((point.clientY - rect.top) / rect.height) * rows)));
  return { column, row: viewportY + visibleRow };
}

export function terminalSelectionRange(start: TerminalCell, end: TerminalCell, cols: number) {
  const startOffset = start.row * cols + start.column;
  const endOffset = end.row * cols + end.column;
  const first = Math.min(startOffset, endOffset);
  const last = Math.max(startOffset, endOffset);
  return {
    column: first % cols,
    row: Math.floor(first / cols),
    length: last - first + 1,
  };
}

/**
 * O xterm tem seu proprio SelectionService escutando "mousedown" nativo, que
 * recalcula a faixa com metricas de fonte nao escaladas (alheias ao
 * transform:scale() do canvas) e sobrescreve visualmente a selecao correta
 * do overlay baseado em pointerdown/pointermove. So bloqueamos o clique
 * unico (detail===1) na mesma condicao em que o overlay assume a selecao;
 * duplo/triplo clique (palavra/linha) continuam nativos do xterm, que le
 * event.detail do proprio navegador — nao depende de ver o mousedown
 * anterior, entao bloquear so o clique 1 nao quebra a contagem.
 */
export function shouldSuppressNativeSingleClickSelection(
  event: Pick<MouseEvent, 'button' | 'detail' | 'shiftKey'>,
  mouseTrackingMode: string
): boolean {
  if (event.button !== 0 || event.detail !== 1) return false;
  return mouseTrackingMode === 'none' || event.shiftKey;
}

export function isTerminalCopyShortcut(event: Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, hasSelection: boolean) {
  return event.type === 'keydown'
    && hasSelection
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === 'c';
}

export function isWindowsTerminalPasteShortcut(
  event: Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  platform: string
) {
  return platform.toLowerCase().startsWith('win')
    && event.type === 'keydown'
    && event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === 'v';
}
