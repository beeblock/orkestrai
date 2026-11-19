import { createHash } from 'node:crypto';

const OUTPUT_PREFIX = '3E4B0A';
export const validWhatsAppJid = (value: string) => /^\d{5,22}(?:-\d{1,22})?@(?:s\.whatsapp\.net|g\.us|lid)$/.test(value);

/** Stable output IDs distinguish the bot from human messages sent by the linked phone. */
export function whatsAppOutputId(bindingId: string, messageId: string, part: string): string {
  return OUTPUT_PREFIX + createHash('sha256').update(`${bindingId}:${messageId}:${part}`).digest('hex').slice(0, 26).toUpperCase();
}

export function whatsAppInboundSender(key: { fromMe?: boolean | null; id?: string | null; participant?: string | null; remoteJid?: string | null }, ownJid?: string | null): string | null {
  if (!key.id || key.id.length > 128 || !validWhatsAppJid(key.remoteJid ?? '')) return null;
  if (key.fromMe && key.id.startsWith(OUTPUT_PREFIX)) return null;
  const sender = key.fromMe ? (ownJid ?? '').replace(/:\d+@/, '@') : key.participant ?? key.remoteJid ?? '';
  return validWhatsAppJid(sender) ? sender : null;
}
