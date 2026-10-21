import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '@beeblock/svelar/database';
import { SQLITE_BUSY_WAIT_MS } from '$lib/database/sqlite-transactions.js';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

function later<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('SQLite transactions', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => vi.useRealTimers());

  const post = (workspaceId: string, body: string) => channelRepository.save({ workspaceId, channel: 'team', authorKind: 'owner', body });

  it('keep other statements out of an open transaction, so its rollback takes only its own writes', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'isolation', workingDir: '/tmp' });
    const inside = later<string>();
    const fail = later();
    const rolledBack = Connection.transaction(async () => {
      inside.resolve((await post(workspace.id, 'inside the transaction')).id);
      await fail.promise;
      throw new Error('rolled back');
    }).catch((error: Error) => error.message);
    const insideId = await inside.promise;

    // Started while the transaction is open: they wait for it instead of joining it.
    let settled = false;
    const outside = post(workspace.id, 'outside').then((message) => { settled = true; return message; });
    const read = channelRepository.find(workspace.id, insideId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);

    fail.resolve();
    expect(await rolledBack).toBe('rolled back');
    const kept = await outside;
    // The outside read never saw the uncommitted row.
    expect(await read).toBeNull();
    expect(await channelRepository.find(workspace.id, kept.id)).not.toBeNull();
    expect(await channelRepository.find(workspace.id, insideId)).toBeNull();
  });

  it('run one at a time, keep a burst of other writes, and let a nested transaction join the open one', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'burst', workingDir: '/tmp' });
    const order: string[] = [];
    const first = Connection.transaction(async () => {
      order.push('first:start');
      await post(workspace.id, 'first');
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Nested: part of the same transaction, not a new BEGIN.
      await Connection.transaction(async () => { await post(workspace.id, 'nested'); });
      order.push('first:end');
    });
    const second = Connection.transaction(async () => {
      order.push('second:start');
      await post(workspace.id, 'second');
      throw new Error('second fails');
    }).catch(() => undefined);
    const burst: Array<Promise<{ id: string }>> = [];
    for (let index = 0; index < 50; index += 1) {
      await Promise.resolve();
      burst.push(post(workspace.id, `burst ${index}`));
    }
    await Promise.all([first, second]);
    const accepted = await Promise.all(burst);

    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    const bodies = (await channelRepository.list(workspace.id, 'team', { limit: 200 })).map((message) => message.body);
    expect(bodies).toContain('first');
    expect(bodies).toContain('nested');
    expect(bodies).not.toContain('second');
    const kept = new Set((await channelRepository.list(workspace.id, 'team', { limit: 200 })).map((message) => message.id));
    expect(accepted.every((message) => kept.has(message.id))).toBe(true);
  });

  it('fail a statement that waited too long, so a transaction waiting on it rolls back instead of hanging', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'busy', workingDir: '/tmp' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const began = later();
    const handOver = later<Promise<unknown>>();
    // A transaction that waits for a write another request makes: that write
    // waits for the transaction, so neither could ever finish.
    const stuck = Connection.transaction(async () => {
      await post(workspace.id, 'inside');
      began.resolve();
      await (await handOver.promise);
    }).then(() => 'committed', (error: Error & { code?: string }) => error.code);
    await began.promise;
    const outside = post(workspace.id, 'from another request');
    outside.catch(() => undefined);
    handOver.resolve(outside);
    await vi.advanceTimersByTimeAsync(SQLITE_BUSY_WAIT_MS + 1_000);
    await expect(outside).rejects.toMatchObject({ code: 'SQLITE_BUSY', message: 'database is locked' });
    expect(await stuck).toBe('SQLITE_BUSY');
    vi.useRealTimers();
    // It rolled back, and the database answers again.
    expect((await channelRepository.list(workspace.id, 'team')).map((message) => message.body)).toEqual([]);
    expect((await post(workspace.id, 'after')).body).toBe('after');
  });
});
