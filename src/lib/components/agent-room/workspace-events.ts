export type WorkspaceEvent = { type: 'workspaceChanged' | 'portalCommand' | 'deviceChanged' | 'connected'; workspaceId: string; nodeId?: string };
const channels = new Map<string, { listeners: Set<(event: WorkspaceEvent) => void>; close: () => void }>();

/** One metadata-only connection per workspace, shared by boards and Portals. */
export function subscribeWorkspaceEvents(workspaceId: string, listener: (event: WorkspaceEvent) => void): () => void {
  let channel = channels.get(workspaceId);
  if (!channel) {
    const listeners = new Set<(event: WorkspaceEvent) => void>();
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const emit = (event: WorkspaceEvent) => { for (const fn of listeners) { try { fn(event); } catch { /* Isolate subscribers. */ } } };
    const connect = () => {
      if (closed) return;
      try {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'subscribe', workspaceId, events: ['workspaceChanged', 'portalCommand', 'deviceChanged'] }));
        emit({ type: 'connected', workspaceId });
      };
      socket.onmessage = event => {
        if (typeof event.data !== 'string' || event.data.length > 4096) return;
        try {
          const message = JSON.parse(event.data);
          if (message.workspaceId !== workspaceId || !['workspaceChanged', 'portalCommand', 'deviceChanged'].includes(message.type)) return;
          emit({ type: message.type, workspaceId, ...(typeof message.nodeId === 'string' && message.nodeId.length <= 128 ? { nodeId: message.nodeId } : {}) });
        } catch { /* Malformed metadata cannot interrupt the channel. */ }
      };
      socket.onerror = () => {}; // close/reconcile recover transient startup failures.
      socket.onclose = () => { if (!closed) retry = setTimeout(connect, 3000); };
      } catch { if (!closed) retry = setTimeout(connect, 3000); }
    };
    channel = { listeners, close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (socket) { socket.onclose = null; socket.onmessage = null; socket.onopen = null; socket.close(); }
    } };
    channels.set(workspaceId, channel);
    connect();
  }
  channel.listeners.add(listener);
  return () => {
    channel!.listeners.delete(listener);
    if (!channel!.listeners.size) { channel!.close(); channels.delete(workspaceId); }
  };
}
