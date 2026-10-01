async function waitForInternalServer(url, {
  timeoutMs = 30_000, headers, server, request = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now,
} = {}) {
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
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

module.exports = { waitForInternalServer, showStartupRecovery };
