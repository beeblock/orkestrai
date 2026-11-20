import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppBotService } from '$lib/modules/agent-room/application/services/WhatsAppBotService.js';

const holder = vi.hoisted(() => ({ socket: null as any, options: null as any }));
vi.mock('@whiskeysockets/baileys', () => ({
  default: (options: unknown) => { holder.options = options; return holder.socket; },
  DisconnectReason: { loggedOut: 401, connectionReplaced: 440 },
  proto: { HistorySync: { HistorySyncType: { PUSH_NAME: 4 } } },
}));

describe('WhatsApp contact discovery', () => {
  it('lists names and groups without importing conversations and ignores stale socket updates', async () => {
    const service = new WhatsAppBotService();
    vi.spyOn(service as any, 'require').mockResolvedValue({});
    vi.spyOn(service as any, 'drain').mockResolvedValue(undefined);
    const ev = new EventEmitter();
    const groupFetchAllParticipating = vi.fn().mockResolvedValue({ group: { id: '55119999999-12345@g.us', subject: 'Support team' } });
    holder.socket = { ev, groupFetchAllParticipating, authState: { creds: {} } };
    const link: any = { connection: { workspaceId: 'workspace', id: 'connection' }, auth: { forSession: () => ({}) }, epoch: 0, stopped: false, chats: new Map() };
    await (service as any).connect(link);
    expect(holder.options.shouldSyncHistoryMessage({ syncType: 4 })).toBe(true);
    expect(holder.options.shouldSyncHistoryMessage({ syncType: 0 })).toBe(false);
    expect(holder.options.syncFullHistory).toBe(false);
    ev.emit('contacts.upsert', [{ id: '5511999999999@s.whatsapp.net', name: 'Ana' }, { id: 'invalid@attacker', name: 'Rejected' }]);
    ev.emit('connection.update', { connection: 'open' });
    await vi.waitFor(() => expect(link.chats.get('55119999999-12345@g.us')).toBe('Support team'));
    expect(link.chats.get('5511999999999@s.whatsapp.net')).toBe('Ana');
    expect(link.chats.size).toBe(2);
    link.epoch++;
    ev.emit('contacts.update', [{ id: '5511999999999@s.whatsapp.net', name: 'Stale name' }]);
    expect(link.chats.get('5511999999999@s.whatsapp.net')).toBe('Ana');
  });
});
