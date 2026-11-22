import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WhatsAppBotService } from '$lib/modules/agent-room/application/services/WhatsAppBotService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { botConnectionRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotConnectionRepository.js';
import { channelBindingRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelBindingRepository.js';
import { desktopSecretService } from '$lib/modules/agent-room/infrastructure/secrets/DesktopSecretService.js';
import { personalBotCommandSchema } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';

const roots: string[] = [];
describe('WhatsApp reconnect is scoped and serialized with connection lifecycle', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'wa-reconnect-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Reconnect', workingDir: root });
    const connection = await botConnectionRepository.create(workspace.id, 'Same account');
    const service = new WhatsAppBotService();
    const link: any = { connection, stopped: false, epoch: 1, retry: null, disconnectTimer: null, drainRetry: null,
      auth: { close: vi.fn().mockResolvedValue(undefined), forget: vi.fn().mockResolvedValue(undefined) },
      socket: { end: vi.fn().mockResolvedValue(undefined) }, state: 'offline', qr: null, error: null, saveTail: Promise.resolve() };
    (service as any).links.set(connection.id, link);
    return { service, link, workspace, connection };
  }
  it('reuses the account identity and preserves bindings while draining the previous Signal writer', async () => {
    const f = await fixture();
    const before = await channelBindingRepository.list(f.workspace.id);
    let finish!: () => void;
    f.link.socket.end.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const open = vi.spyOn(f.service as any, 'openOnce').mockResolvedValue({ state: 'qr', qr: null, error: null });
    const retry = f.service.retry(f.workspace.id, f.connection.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(open).not.toHaveBeenCalled(); expect(f.link.stopped).toBe(true);
    finish(); await retry;
    expect(f.link.auth.close).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: f.connection.id }), true);
    expect(await botConnectionRepository.list(f.workspace.id)).toHaveLength(1);
    expect(await channelBindingRepository.list(f.workspace.id)).toEqual(before);
  });
  it('waits for reconnect before a status poll and never opens over a draining writer', async () => {
    const f = await fixture(); let finish!: () => void;
    f.link.socket.end.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const open = vi.spyOn(f.service as any, 'openOnce').mockResolvedValue({ state: 'qr', qr: null, error: null });
    const retry = f.service.retry(f.workspace.id, f.connection.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const polling = f.service.status(f.workspace.id, f.connection.id);
    await new Promise(resolve => setTimeout(resolve, 10)); expect(open).not.toHaveBeenCalled();
    finish(); await retry;
    expect(await polling).toMatchObject({ state: 'qr' });
    expect(open).toHaveBeenCalledTimes(2);
  });
  it('removes only after reconnect completes and rejects a late poll after deletion', async () => {
    const f = await fixture();
    vi.spyOn(desktopSecretService, 'delete').mockResolvedValue(undefined);
    let finish!: () => void;
    f.link.socket.end.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.spyOn(f.service as any, 'openOnce').mockResolvedValue({ state: 'qr', qr: null, error: null });
    const retry = f.service.retry(f.workspace.id, f.connection.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const disconnect = f.service.disconnect(f.workspace.id, f.connection.id);
    expect(await botConnectionRepository.find(f.workspace.id, f.connection.id)).toBeTruthy();
    finish(); await retry; await disconnect;
    expect(await botConnectionRepository.find(f.workspace.id, f.connection.id)).toBeNull();
    await expect(f.service.status(f.workspace.id, f.connection.id)).rejects.toThrow('BOT_CONNECTION_UNAVAILABLE');
  });
  it('rejects a foreign workspace and validates the reconnect command', async () => {
    const f = await fixture();
    await expect(f.service.retry('00000000-0000-7000-8000-000000000001', f.connection.id)).rejects.toThrow('BOT_CONNECTION_UNAVAILABLE');
    expect(f.link.socket.end).not.toHaveBeenCalled();
    expect(personalBotCommandSchema.parse({ command: 'whatsapp_reconnect', connectionId: f.connection.id })).toMatchObject({ connectionId: f.connection.id });
    expect(personalBotCommandSchema.safeParse({ command: 'whatsapp_reconnect', connectionId: '../other' }).success).toBe(false);
  });
  it('logs only safe event metadata, without keys, QR data, contacts or message text', async () => {
    const f = await fixture(), info = vi.spyOn(console, 'info').mockImplementation(() => {});
    Object.assign(f.link, { qr: 'PRIVATE_QR', pending: ['PRIVATE_MESSAGE'], auth: { engine: 'zapo', key: 'PRIVATE_KEY' } });
    (f.service as any).linkEvent(f.link, 'close', 515);
    (f.service as any).linkEvent(f.link, 'PRIVATE_EVENT', 'PRIVATE_CODE');
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toBe('[whatsapp-link]');
    expect(JSON.parse(info.mock.calls[0][1] as string)).toEqual({ connectionId: f.connection.id, engine: 'zapo', event: 'close', code: 515 });
  });

});
