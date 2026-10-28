type Subscriber = { workspaceId: string; change: () => void; status: (connected: boolean) => void; events?: readonly string[] };
const subscribers = new Set<Subscriber>();
let socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined, attempt = 0;
const events = new Set(['workspaceChanged', 'memoryChanged', 'tasksChanged', 'taskBoardChanged', 'controlCenterChanged', 'designChanged', 'codeGraphChanged', 'knowledgeChanged']);
function connect() {
  if (!subscribers.size || socket) return;
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
  socket = connection;
  connection.onopen = () => { attempt = 0; subscribers.forEach(sub => { sub.status(true); sub.change(); }); };
  connection.onmessage = event => {
    try { const frame = JSON.parse(String(event.data)); if (events.has(frame.type)) subscribers.forEach(sub => { if (sub.workspaceId === frame.workspaceId && (!sub.events || sub.events.includes(frame.type))) sub.change(); }); } catch { /* Non-workspace frame. */ }
  };
  connection.onclose = () => {
    if (socket !== connection) return;
    socket = null; subscribers.forEach(sub => sub.status(false));
    if (subscribers.size) retry = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt++));
  };
  connection.onerror = () => connection.close();
}
export function subscribeKnowledge(workspaceId: string, change: () => void, status: (connected: boolean) => void, eventNames?: readonly string[]) {
  const sub = { workspaceId, change, status, events: eventNames }; subscribers.add(sub);
  status(socket?.readyState === WebSocket.OPEN); connect();
  return () => {
    subscribers.delete(sub);
    if (!subscribers.size) { clearTimeout(retry); const old = socket; socket = null; old?.close(); attempt = 0; }
  };
}
