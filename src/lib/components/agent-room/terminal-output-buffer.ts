/** Buffer TUI redraws when their DOM cannot be painted, without stopping PTYs. */
export function createTerminalOutputBuffer(write: (data: string) => void) {
  let visible = true;
  let desiredVisible = true;
  let disposed = false;
  let chunks: string[] = [];
  let characters = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let revealTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    if (disposed || !chunks.length) return;
    const data = chunks.join('');
    chunks = [];
    characters = 0;
    write(data);
  };

  return {
    write(data: string) {
      if (disposed) return;
      if (visible) { write(data); return; }
      chunks.push(data);
      characters += data.length;
      // UTF-16 character limit, matching the existing background backlog bound.
      if (characters > 1_000_000) flush();
      else flushTimer ??= setTimeout(flush, 15_000);
    },
    setVisible(next: boolean, immediate = false) {
      if (disposed || (desiredVisible === next && !(next && immediate && !visible))) return;
      desiredVisible = next;
      if (revealTimer !== null) clearTimeout(revealTimer);
      revealTimer = null;
      if (!next) { visible = false; return; }
      if (visible) return;
      const reveal = () => { revealTimer = null; visible = true; flush(); };
      if (immediate) reveal();
      else revealTimer = setTimeout(reveal, 200);
    },
    clearPending() {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = null;
      chunks = [];
      characters = 0;
    },
    dispose() {
      disposed = true;
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (revealTimer !== null) clearTimeout(revealTimer);
      chunks = [];
      characters = 0;
    },
  };
}
