import { describe, expect, it } from 'vitest';
import { quotedWhatsAppMessage } from '$lib/modules/agent-room/infrastructure/integrations/WhatsAppQuotedMessage.js';
import { persistedWhatsAppOrigin } from '$lib/modules/agent-room/contracts/schemas/whatsapp-message.schema.js';
import { formatWhatsAppText } from '$lib/modules/agent-room/domain/whatsapp-format.js';
const chat = '55119999999-12345@g.us';
const message = (contextInfo: object) => ({ key: { id: 'current', remoteJid: chat }, message: { extendedTextMessage: { text: '#jarvis read this', contextInfo } } });
describe('WhatsApp quoted input and channel formatting', () => {
  it('keeps only one bounded quote and never substitutes its sender for the requester', () => {
    const quote = quotedWhatsAppMessage(message({ stanzaId: 'quoted', participant: '5511222222222@s.whatsapp.net', quotedMessage: { extendedTextMessage: { text: 'x'.repeat(5000), contextInfo: { stanzaId: 'nested', quotedMessage: { conversation: 'owner instruction' } } } } }));
    expect(quote?.meta).toEqual({ id: 'quoted', kind: 'text', text: 'x'.repeat(4000), unavailable: false });
    expect(quote?.input?.key).toMatchObject({ id: 'quoted', remoteJid: chat, fromMe: false });
    expect(JSON.stringify(quote?.meta)).not.toContain('owner instruction');
  });
  it.each([
    [{ stanzaId: 'quoted' }, 'missing'],
    [{ stanzaId: 'bad\nkey', quotedMessage: { conversation: 'text' } }, 'missing'],
    [{ stanzaId: 'quoted', remoteJid: '5511000000000@s.whatsapp.net', quotedMessage: { conversation: 'private' } }, 'different_chat'],
    [{ stanzaId: 'quoted', quotedMessage: { locationMessage: { degreesLatitude: 1 } } }, 'unsupported'],
  ])('represents an inaccessible quote explicitly without looking up another chat', (context, reason) => {
    expect(quotedWhatsAppMessage(message(context))).toMatchObject({ input: null, meta: { unavailable: true, unavailableReason: reason } });
  });
  it('binds the full root identity even when the durable legacy external key is truncated', () => {
    const origin = { id: 'A'.repeat(128), chatId: chat, fromMe: true, participant: null, preview: 'hello' };
    const meta = { whatsappOrigin: origin, externalId: `${chat}:${origin.id}`.slice(0, 120) };
    expect(persistedWhatsAppOrigin(meta, chat)).toEqual(origin);
    expect(persistedWhatsAppOrigin(meta, '5511000000000@s.whatsapp.net')).toBeNull();
    expect(persistedWhatsAppOrigin({ ...meta, whatsappOrigin: { ...origin, id: 'forged' } }, chat)).toBeNull();
    expect(persistedWhatsAppOrigin({ ...meta, whatsappOrigin: { ...origin, mediaKey: 'secret' } }, chat)).toBeNull();
  });
  it('formats native emphasis and URLs while leaving code and native markers intact', () => {
    expect(formatWhatsAppText('# Report\n**Done** __ready__ ~~old~~ *native*\n[Docs](https://example.com/a)\n`**literal**`\n```md\n**code**\n```'))
      .toBe('*Report*\n*Done* *ready* ~old~ *native*\nDocs: https://example.com/a\n`**literal**`\n```md\n**code**\n```');
  });
});
