/** Only the trusted app frame owns visual leases; detaching never grants control. */
function createPortalSurfaceHandler({ getMainWindow, getExecutor, requestFor }) {
  return async (event, input) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed?.() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('Portal surface requires the trusted app window.');
    for (const id of [input?.workspaceId, input?.nodeId]) {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid Portal identity.');
    }
    if (['attach', 'detach'].includes(input?.method) && (typeof input.lease !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.lease))) throw new Error('Invalid Portal surface lease.');
    const executor = getExecutor();
    // The node may already have been deleted, or the Core may be offline.
    // Release only an existing matching lease; never fetch, open or recreate it.
    if (input.method === 'detach') return executor?.detach(input.workspaceId, input.nodeId, input.lease);
    if (!executor) throw new Error('Portal runtime is unavailable.');
    const request = await requestFor(event, input);
    // Core authorization is asynchronous. Its result cannot outlive the exact
    // app window/frame that requested it, including same-WebContents navigation.
    if (getMainWindow() !== window || window.isDestroyed?.() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('Portal surface requires the current trusted app frame.');
    if (input.method === 'attach') return executor.surface(request, window, input.lease);
    if (!['navigate', 'inspectScript', 'capture', 'preview', 'state', 'close', 'activate', 'pause', 'resume', 'devtools'].includes(input.method)) throw new Error('Unsupported Portal surface method.');
    if (JSON.stringify(input.args || {}).length > 500000) throw new Error('Portal surface input is too large.');
    return executor.userCommand(request, input.method, input.args || {});
  };
}

module.exports = { createPortalSurfaceHandler };
