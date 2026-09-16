import { uuidv7 } from '@beeblock/svelar/support';

type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const state = globalThis as typeof globalThis & {
  __orkestraiFolderPending?: Map<string, Pending>;
  __orkestraiFolderListening?: boolean;
};
const pending = state.__orkestraiFolderPending ??= new Map<string, Pending>();

function settle(id: string, error?: string) {
  const request = pending.get(id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(id);
  if (error) request.reject(new Error(error));
  else request.resolve();
}

if (!state.__orkestraiFolderListening) {
  process.on('message', (message: unknown) => {
    const response = message as { type?: string; requestId?: string; opened?: boolean; error?: string } | null;
    if (response?.type !== 'orkestrai:folder:result' || typeof response.requestId !== 'string') return;
    settle(response.requestId, response.opened === true ? undefined : 'The system file manager could not open the approved folder.');
  });
  process.on('disconnect', () => {
    for (const id of pending.keys()) settle(id, 'Desktop connection closed before folder opening was confirmed.');
  });
  state.__orkestraiFolderListening = true;
}

/** A desktop shell integration, not screen observation or computer input. */
export async function openDesktopFolder(root: string, path: string): Promise<void> {
  if (typeof process.send !== 'function' || !process.connected) {
    throw new Error('Opening folders requires the installed desktop app, not Computer permissions.');
  }
  if (pending.size >= 16) throw new Error('Too many pending folder requests.');
  const requestId = uuidv7();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => settle(requestId, 'Folder opening was not confirmed; do not assume it opened.'), 10000);
    timer.unref?.();
    pending.set(requestId, { resolve, reject, timer });
    try {
      process.send!({ type: 'orkestrai:folder:open', requestId, root, path }, error => {
        if (error) settle(requestId, 'Could not reach the desktop folder opener.');
      });
    } catch {
      settle(requestId, 'Could not reach the desktop folder opener.');
    }
  });
}
