import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WhatsAppBotService } from '$lib/modules/agent-room/application/services/WhatsAppBotService.js';
import { nativeNotificationService } from '$lib/modules/agent-room/application/services/NativeNotificationService.js';
import { settingsService } from '$lib/modules/agent-room/application/services/SettingsService.js';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';
import { attentionRepository } from '$lib/modules/agent-room/infrastructure/repositories/AttentionRepository.js';
import { botConnectionRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotConnectionRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { desktopSecretService } from '$lib/modules/agent-room/infrastructure/secrets/DesktopSecretService.js';

describe('WhatsApp connection loss reaches the owner without waking models', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];
  beforeEach(() => {
    vi.spyOn(nativeNotificationService, 'send').mockResolvedValue({ notified: true });
    vi.spyOn(settingsService, 'get').mockResolvedValue('en');
  });
  afterEach(async () => {
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-wa-notices-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Notice workspace', workingDir: root });
    const connection = await botConnectionRepository.create(workspace.id, 'Support account');
    const service = new WhatsAppBotService();
    // Exercise the actual close handler without a real WhatsApp connection.
    vi.spyOn(service as any, 'reconnect').mockImplementation(() => {});
    const link: any = { connection, state: 'connected', stopped: false, socket: {}, qr: null, error: null,
      epoch: 1, retry: null, drainRetry: null, disconnectTimer: null, saveTail: Promise.resolve(), auth: { forget: vi.fn() } };
    const close = (code = 408) => (service as any).connectionClosed(link, code, { loggedOut: 401, connectionReplaced: 440 });
    const items = () => attentionRepository.list({ workspaceId: workspace.id, includeResolved: true });
    return { service, link, close, workspace, connection, items };
  }

  it.each([401, 440])('persists one relink alert and one native notice for a revoked session (%s)', async code => {
    const f = await fixture(); f.close(code); f.close(code);
    await vi.waitFor(() => expect(nativeNotificationService.send).toHaveBeenCalledTimes(1));
    expect(await botConnectionRepository.find(f.workspace.id, f.connection.id)).toMatchObject({ enabled: false });
    expect(f.link.connection.enabled).toBe(false);
    const items = await attentionService.list({ workspaceId: f.workspace.id });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sourceType: 'whatsapp_connection', sourceId: f.connection.id,
      actionAvailable: true, action: { target: 'bots' } });
    expect(items[0].body).toContain('QR');
    await attentionRepository.updateStatus(items[0].id, f.workspace.id, 'resolved');
    const restored = new WhatsAppBotService();
    await restored.restore();
    await Promise.all([...(restored as any).notices.values()]);
    await vi.waitFor(async () => expect(await f.items()).toHaveLength(1));
    expect(nativeNotificationService.send).toHaveBeenCalledTimes(1);
  });

  it('does not alert for a short outage that reconnects before one minute', async () => {
    const f = await fixture(); vi.useFakeTimers(); f.close();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(nativeNotificationService.send).not.toHaveBeenCalled();
    f.link.state = 'connected';
    await (f.service as any).resolveConnectionNotice(f.connection, f.link);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await f.items()).toEqual([]);
    expect(nativeNotificationService.send).not.toHaveBeenCalled();
  });

  it('alerts once for a prolonged outage, closes it on recovery, and alerts for a new outage', async () => {
    const f = await fixture(); vi.useFakeTimers(); f.close();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(nativeNotificationService.send).toHaveBeenCalledTimes(1));
    f.close(); await vi.advanceTimersByTimeAsync(120_000);
    await vi.waitFor(async () => expect(await f.items()).toHaveLength(1));
    expect(nativeNotificationService.send).toHaveBeenCalledTimes(1);
    f.link.state = 'connected';
    await (f.service as any).resolveConnectionNotice(f.connection, f.link);
    expect((await f.items())[0].status).toBe('resolved');
    f.close(); await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(nativeNotificationService.send).toHaveBeenCalledTimes(2));
  });

  it('does not notify after an intentional disconnect and removes the pending timer', async () => {
    const f = await fixture(); vi.useFakeTimers(); f.close();
    (f.service as any).links.set(f.connection.id, f.link);
    vi.spyOn(desktopSecretService, 'delete').mockResolvedValue(undefined);
    await f.service.disconnect(f.workspace.id, f.connection.id);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await f.items()).toEqual([]);
    expect(nativeNotificationService.send).not.toHaveBeenCalled();
  });

  it('notifies when restoring a saved connection fails instead of silently leaving bots offline', async () => {
    const f = await fixture();
    vi.spyOn(f.service as any, 'open').mockRejectedValue(new Error('fake storage failure'));
    await f.service.restore();
    await Promise.all([...(f.service as any).notices.values()]);
    await vi.waitFor(() => expect(nativeNotificationService.send).toHaveBeenCalledTimes(1));
    expect(await f.items()).toHaveLength(1);
    await f.service.restore();
    await Promise.all([...(f.service as any).notices.values()]);
    await vi.waitFor(async () => expect(await f.items()).toHaveLength(1));
    expect(nativeNotificationService.send).toHaveBeenCalledTimes(1);
  });
});
