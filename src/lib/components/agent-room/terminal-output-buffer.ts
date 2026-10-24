const MAX_PENDING_CHARACTERS = 512 * 1024;
const MAX_PENDING_CHUNKS = 2048;
const PARSER_CHUNK_CHARACTERS = 32 * 1024;

// One shared budget prevents all remounted terminals parsing a history at once.
const renders = new Map<number, () => void>();
let renderId = 0;
let cancelFrame: (() => void) | null = null;
function requestFrame() {
  if (cancelFrame || !renders.size) return;
  const run = () => {
    cancelFrame = null;
    let count = 0;
    for (const [id, render] of renders) {
      renders.delete(id);
      render();
      if (++count === 2) break;
    }
    requestFrame();
  };
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(run);
    cancelFrame = () => cancelAnimationFrame(id);
  } else {
    const id = setTimeout(run, 16);
    cancelFrame = () => clearTimeout(id);
  }
}
function scheduleRender(render: () => void): () => void {
  const id = ++renderId;
  renders.set(id, render);
  requestFrame();
  return () => {
    // Release disposed view closures even while a hidden window suspends RAF.
    renders.delete(id);
    if (!renders.size) { cancelFrame?.(); cancelFrame = null; }
  };
}

type Options = {
  requestSnapshot?: () => boolean;
  onVisibilityChange?: (visible: boolean) => void;
};

/** A bounded viewer queue. The PTY remains authoritative and keeps running. */
export function createTerminalOutputBuffer(write: (data: string, parsed: () => void) => void, options: Options = {}) {
  let visible = false;
  let desiredVisible = false;
  let disposed = false;
  let chunks: string[] = [];
  let head = 0;
  let characters = 0;
  let inFlight = false;
  let needsSnapshot = false;
  let waitingSnapshot = false;
  let refreshAfterSnapshot = false;
  let generation = 0;
  let snapshotRemaining = 0;
  let snapshotParsed: (() => void) | null = null;
  let cancelRender: (() => void) | null = null;
  let revealTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPending() {
    cancelRender?.(); cancelRender = null;
    chunks = []; head = 0; characters = 0;
    generation++;
    snapshotRemaining = 0; snapshotParsed = null;
    needsSnapshot = false; waitingSnapshot = false;
    refreshAfterSnapshot = false;
  }

  function pump() {
    if (disposed || !visible || inFlight || waitingSnapshot || cancelRender) return;
    if (needsSnapshot) {
      waitingSnapshot = true;
      if (options.requestSnapshot?.() !== true) waitingSnapshot = false;
      return;
    }
    if (!characters) return;
    cancelRender = scheduleRender(() => {
      cancelRender = null;
      if (disposed || !visible || inFlight || waitingSnapshot || needsSnapshot) { pump(); return; }
      const parts: string[] = [];
      let length = 0;
      while (head < chunks.length && length < PARSER_CHUNK_CHARACTERS) {
        const chunk = chunks[head];
        let take = Math.min(chunk.length, PARSER_CHUNK_CHARACTERS - length);
        if (take < chunk.length && take > 0 && chunk.charCodeAt(take - 1) >= 0xd800 && chunk.charCodeAt(take - 1) <= 0xdbff) take--;
        if (!take) break;
        parts.push(chunk.slice(0, take));
        if (take === chunk.length) chunks[head++] = '';
        else chunks[head] = chunk.slice(take);
        length += take;
      }
      if (!length) return;
      characters -= length;
      if (head === chunks.length) { chunks = []; head = 0; }
      else if (head >= 1024) { chunks = chunks.slice(head); head = 0; }
      const ticket = generation;
      inFlight = true;
      write(parts.join(''), () => {
        inFlight = false;
        if (disposed) return;
        if (ticket === generation && snapshotRemaining) {
          snapshotRemaining = Math.max(0, snapshotRemaining - length);
          if (!snapshotRemaining) {
            const parsed = snapshotParsed; snapshotParsed = null;
            if (refreshAfterSnapshot) { clearPending(); needsSnapshot = true; }
            parsed?.();
          }
        }
        pump();
      });
    });
  }

  function enqueue(data: string) {
    if (!data || disposed || needsSnapshot || waitingSnapshot || refreshAfterSnapshot) return;
    if (characters + data.length > MAX_PENDING_CHARACTERS || chunks.length - head >= MAX_PENDING_CHUNKS) {
      // Finish the current authoritative replay before replacing live deltas.
      // Constant output must not keep resetting a history before it can paint.
      if (visible && snapshotRemaining && characters + (inFlight ? PARSER_CHUNK_CHARACTERS : 0) > 0) {
        refreshAfterSnapshot = true;
        return;
      }
      // Do not truncate arbitrary ANSI bytes. Replace the stale viewer backlog
      // with a fresh PTY snapshot, including its retained terminal modes.
      clearPending(); needsSnapshot = true;
      pump();
      return;
    }
    chunks.push(data); characters += data.length;
    pump();
  }

  return {
    get isVisible() { return visible; },
    get needsSnapshot() { return needsSnapshot || waitingSnapshot || refreshAfterSnapshot; },
    get pendingCharacters() { return characters; },
    get pendingChunks() { return chunks.length - head; },
    write: enqueue,
    replaceSnapshot(data: string, parsed?: () => void) {
      if (disposed) return;
      clearPending();
      if (data.length > MAX_PENDING_CHARACTERS) { needsSnapshot = true; pump(); return; }
      snapshotRemaining = data.length;
      snapshotParsed = parsed ?? null;
      enqueue(data);
      if (!data.length) { const done = snapshotParsed; snapshotParsed = null; done?.(); }
    },
    setVisible(next: boolean, immediate = false) {
      if (disposed || (desiredVisible === next && !(next && immediate && !visible))) return;
      desiredVisible = next;
      if (revealTimer !== null) clearTimeout(revealTimer);
      revealTimer = null;
      if (!next) {
        const changed = visible;
        visible = false;
        cancelRender?.(); cancelRender = null;
        if (changed) options.onVisibilityChange?.(false);
        return;
      }
      if (visible) return;
      const reveal = () => {
        revealTimer = null;
        if (disposed) return;
        visible = true;
        options.onVisibilityChange?.(true);
        pump();
      };
      if (immediate) reveal();
      else revealTimer = setTimeout(reveal, 200);
    },
    clearPending,
    dispose() {
      disposed = true;
      if (revealTimer !== null) clearTimeout(revealTimer);
      clearPending();
    },
  };
}
