const STARTUP_PHASES = new Set(['backup', 'migrating', 'compacting', 'prepared']);

/** The preparation step a server stdout line announces (`[orkestrai:startup] {"phase":"backup"}`), or null. */
function parseStartupPhase(line) {
  const match = /\[orkestrai:startup\] (\{.*\})/.exec(String(line));
  if (!match) return null;
  try {
    const phase = JSON.parse(match[1]).phase;
    return STARTUP_PHASES.has(phase) ? phase : null;
  } catch {
    return null;
  }
}

/**
 * Reads a server's stdout as it arrives: splits it into whole lines, keeps
 * the preparation step it announced and hands back every other line.
 */
function createStartupWatcher() {
  let phase = null;
  let partial = '';
  return {
    feed(text) {
      const lines = `${partial}${text}`.split(/\r?\n/);
      partial = lines.pop() ?? '';
      const rest = [];
      for (const line of lines) {
        const next = parseStartupPhase(line);
        if (next) phase = next === 'prepared' ? null : next;
        else rest.push(line);
      }
      return rest;
    },
    preparing: () => phase !== null,
  };
}

/**
 * Waits for the server's health check. A server may take `timeoutMs` to
 * answer; while `preparing()` says it is backing up, migrating or compacting
 * the database, the wait goes on (a large database takes minutes) and the
 * `timeoutMs` count starts again once it is done, up to
 * `preparationTimeoutMs` in all. A server that exits fails at once.
 */
async function waitForInternalServer(url, {
  timeoutMs = 30_000, preparationTimeoutMs = 30 * 60_000, preparing = () => false, headers, server, request = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now,
} = {}) {
  const startedAt = now();
  let readyBy = startedAt + timeoutMs;
  for (;;) {
    const current = now();
    if (preparing()) readyBy = Math.max(readyBy, current + timeoutMs);
    if (current >= readyBy || current - startedAt >= preparationTimeoutMs) break;
    if (server && (typeof server.exitCode === 'number' || server.signalCode)) {
      throw new Error('The internal server exited before startup completed.');
    }
    try {
      const response = await request(url, { headers, signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The child may still be starting; its exit is checked on every poll.
    }
    await pause(250);
  }
  throw new Error(`The internal server did not respond at ${url}`);
}

async function showStartupRecovery({ dialog, copy, retry, openDownload, openLogs, quit, onError, shouldContinue = () => true }) {
  while (shouldContinue()) {
    const { response } = await dialog.showMessageBox({
      type: 'error', title: copy.title, message: copy.message, detail: copy.detail,
      buttons: [copy.download, copy.retry, copy.logs, copy.quit],
      defaultId: 0, cancelId: 3, noLink: true,
    });
    if (!shouldContinue()) return false;
    try {
      if (response === 0) await openDownload();
      else if (response === 1) {
        await retry();
        return true;
      } else if (response === 2) await openLogs();
      else {
        quit();
        return false;
      }
    } catch (error) {
      onError?.(error);
    }
  }
  return false;
}

/**
 * Whether a launch shows windows from the start: anything but a background
 * or login launch (those may stay hidden, which the owner's preference only
 * tells once the server answers). An invitation link always shows.
 */
function isInteractiveLaunch({ backgroundLaunch, loginLaunch, invite }) {
  return Boolean(invite) || (!backgroundLaunch && !loginLaunch);
}

module.exports = { waitForInternalServer, parseStartupPhase, createStartupWatcher, isInteractiveLaunch, showStartupRecovery };
