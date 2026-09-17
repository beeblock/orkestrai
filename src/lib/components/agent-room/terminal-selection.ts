type Point = { clientX: number; clientY: number };
type MouseService = {
  getCoords(event: Point, element: HTMLElement, cols: number, rows: number, selection?: boolean): [number, number] | undefined;
  getMouseReportCoords(event: Point, element: HTMLElement): { col: number; row: number; x: number; y: number } | undefined;
};

export function unscaleTerminalPoint(point: Point, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, width: number, height: number): Point {
  if (![rect.width, rect.height, width, height].every((value) => Number.isFinite(value) && value > 0)) return point;
  return {
    clientX: rect.left + (point.clientX - rect.left) * width / rect.width,
    clientY: rect.top + (point.clientY - rect.top) * height / rect.height,
  };
}

/** xterm has no public coordinate hook. Keep this shape-checked adapter at the
 * mouse boundary so native word/line/wide-character selection stays intact. */
export function installScaledTerminalMouse(terminal: unknown): () => void {
  const core = (terminal as { _core?: { _mouseService?: MouseService } })._core;
  const mouse = core?._mouseService;
  if (!mouse?.getCoords || !mouse.getMouseReportCoords) throw new Error('Unsupported xterm mouse service.');
  const getCoords = mouse.getCoords;
  const getMouseReportCoords = mouse.getMouseReportCoords;
  const point = (event: Point, element: HTMLElement) => {
    const style = getComputedStyle(element);
    return unscaleTerminalPoint(event, element.getBoundingClientRect(), parseFloat(style.width), parseFloat(style.height));
  };
  mouse.getCoords = function (event, element, cols, rows, selection) {
    return getCoords.call(this, point(event, element), element, cols, rows, selection);
  };
  mouse.getMouseReportCoords = function (event, element) {
    return getMouseReportCoords.call(this, point(event, element), element);
  };
  return () => {
    mouse.getCoords = getCoords;
    mouse.getMouseReportCoords = getMouseReportCoords;
  };
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
