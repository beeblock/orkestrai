import { normalizeMessageContent, type WAMessage } from '@whiskeysockets/baileys';
import { whatsAppQuoteSchema, type WhatsAppQuote } from '../../contracts/schemas/whatsapp-message.schema.js';

export function quotedWhatsAppMessage(message: WAMessage): { meta: WhatsAppQuote; input: WAMessage | null } | null {
  const content = normalizeMessageContent(message.message);
  const context = content?.extendedTextMessage?.contextInfo ?? content?.imageMessage?.contextInfo
    ?? content?.documentMessage?.contextInfo ?? content?.audioMessage?.contextInfo;
  if (!context?.stanzaId && !context?.quotedMessage) return null;
  const parsedId = typeof context.stanzaId === 'string' && /^[^\s\u0000-\u001f]{1,128}$/u.test(context.stanzaId) ? context.stanzaId : null;
  const missing = (reason: WhatsAppQuote['unavailableReason'] = 'missing'): { meta: WhatsAppQuote; input: null } => ({ meta: { id: parsedId, kind: 'unavailable', text: '', unavailable: true, unavailableReason: reason }, input: null });
  // A quote never authorizes fetching a different group's history.
  if (context.remoteJid && context.remoteJid !== message.key.remoteJid) return missing('different_chat');
  if (!parsedId || !context.quotedMessage) return missing();
  const quoted = normalizeMessageContent(context.quotedMessage);
  const kind = quoted?.imageMessage ? 'image' : quoted?.documentMessage ? 'document' : quoted?.audioMessage ? 'audio'
    : quoted?.conversation || quoted?.extendedTextMessage ? 'text' : 'unavailable';
  if (kind === 'unavailable') return missing('unsupported');
  const text = String(quoted?.conversation ?? quoted?.extendedTextMessage?.text ?? quoted?.imageMessage?.caption
    ?? quoted?.documentMessage?.caption ?? quoted?.documentMessage?.fileName ?? '').slice(0, 4000);
  return { meta: whatsAppQuoteSchema.parse({ id: parsedId, kind, text, unavailable: false }),
    input: { key: { id: parsedId, remoteJid: message.key.remoteJid, participant: context.participant ?? undefined, fromMe: false }, message: quoted } };
}
