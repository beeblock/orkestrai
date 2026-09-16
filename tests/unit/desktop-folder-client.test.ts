import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDesktopFolder } from '$lib/modules/agent-room/infrastructure/DesktopFolderClient.js';

const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected');
const send = vi.fn();
beforeEach(() => {
  send.mockReset();
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', { configurable: true, value: send });
});
afterEach(() => {
  process.emit('disconnect');
  for (const [name, descriptor] of [['send', originalSend], ['connected', originalConnected]] as const) {
    if (descriptor) Object.defineProperty(process, name, descriptor);
    else Reflect.deleteProperty(process, name);
  }
  vi.useRealTimers();
});
it('uses dedicated correlated folder IPC without Computer operations', async () => {
  const pending = openDesktopFolder('/work', '/work/images');
  const message = send.mock.calls[0][0];
  expect(message).toMatchObject({ type: 'orkestrai:folder:open', root: '/work', path: '/work/images' });
  process.emit('message', { type: 'orkestrai:folder:result', requestId: 'unrelated', opened: true });
  process.emit('message', { type: 'orkestrai:folder:result', requestId: message.requestId, opened: true });
  await expect(pending).resolves.toBeUndefined();
  expect(send).toHaveBeenCalledOnce();
});
it('does not claim success or retry an unconfirmed opening', async () => {
  vi.useFakeTimers();
  const rejected = expect(openDesktopFolder('/work', '/work/images')).rejects.toThrow('not confirmed');
  await vi.advanceTimersByTimeAsync(10000);
  await rejected;
  expect(send).toHaveBeenCalledOnce();
});
it('rejects a lost connection and never leaks raw parent error details', async () => {
  const rejected = expect(openDesktopFolder('/work', '/work/images')).rejects.toThrow('approved folder');
  process.emit('message', { type: 'orkestrai:folder:result', requestId: send.mock.calls[0][0].requestId, error: 'private OS details' });
  await rejected;
  const disconnected = expect(openDesktopFolder('/work', '/work/images')).rejects.toThrow('connection closed');
  process.emit('disconnect');
  await disconnected;
});
it('requires a desktop parent, not Accessibility or a shell fallback', async () => {
  Object.defineProperty(process, 'connected', { configurable: true, value: false });
  await expect(openDesktopFolder('/work', '/work/images')).rejects.toThrow('installed desktop app');
  expect(send).not.toHaveBeenCalled();
});
it('handles immediate IPC send failure', async () => {
  send.mockImplementation(() => { throw new Error('closed'); });
  await expect(openDesktopFolder('/work', '/work/images')).rejects.toThrow('Could not reach');
});
