import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { observeCoreRequest } from '../../scripts/core-http-diagnostics.mjs';

afterEach(() => vi.useRealTimers());

it('logs a failed UI module without persisting its URL, query, body or headers', () => {
  const response = Object.assign(new EventEmitter(), { statusCode: 500 });
  const warn = vi.fn();
  observeCoreRequest({ url: '/_app/immutable/nodes/secret-name.js?token=secret-value', headers: { authorization: 'secret-token' }, body: 'private-body' }, response, { warn });
  response.emit('finish'); response.emit('close');
  expect(warn).toHaveBeenCalledTimes(1);
  const record = JSON.parse(warn.mock.calls[0][0].split('] ')[1]);
  expect(record).toMatchObject({ kind: 'ui-module', status: 500, phase: 'finished' });
  expect(warn.mock.calls[0][0]).not.toMatch(/secret|private|token|headers|body/);
});

it('records the pending operation class before a slow asynchronous request finishes', () => {
  vi.useFakeTimers();
  const response = Object.assign(new EventEmitter(), { statusCode: 200 });
  const warn = vi.fn();
  observeCoreRequest({ url: '/api/agent-room/workspaces/private-id/fs/list?path=private-path' }, response, { warn, slowMs: 100, now: () => Date.now() });
  vi.advanceTimersByTime(100);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toContain('"kind":"workspace-files"');
  expect(warn.mock.calls[0][0]).toContain('"phase":"waiting"');
  response.emit('finish');
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls[1][0]).toContain('"active":{}');
  vi.advanceTimersByTime(500);
  expect(warn).toHaveBeenCalledTimes(2);
});

it('does not label a healthy streaming transfer as a stalled request', () => {
  vi.useFakeTimers();
  const response = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: true });
  const warn = vi.fn();
  observeCoreRequest({ url: '/api/agent-room/workspaces/id/fs/raw?path=asset.bin' }, response, { warn, slowMs: 100, now: () => Date.now() });
  vi.advanceTimersByTime(1_000);
  response.emit('finish');
  expect(warn).not.toHaveBeenCalled();
});
