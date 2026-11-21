import type { ChannelBinding } from './channels.js';

type Route = Pick<ChannelBinding, 'allowedSenders' | 'replyPrefixes'>;

/** Use the same platform identities as incoming WhatsApp messages, not names. */
export function normalizeWhatsAppRouteSenders(senders: readonly string[]): string[] {
  return [...new Set(senders.map(value => {
    const id = value.trim().replace(/^\+/, '').toLowerCase();
    return /^\d+$/.test(id) ? `${id}@s.whatsapp.net` : id;
  }))];
}

export function validatedWhatsAppRouteSenders(senders: readonly string[]): string[] {
  const values = normalizeWhatsAppRouteSenders(senders);
  if (values.some(value => !/^\d{5,22}@(?:s\.whatsapp\.net|lid)$/.test(value))) throw new Error('BOT_SENDER_INVALID');
  return values;
}

/** Whether one incoming message could satisfy both routes. Prefixes are literal. */
export function whatsAppRoutesOverlap(left: Route, right: Route): boolean {
  const a = normalizeWhatsAppRouteSenders(left.allowedSenders).map(value => value.replace(/^@/, ''));
  const b = normalizeWhatsAppRouteSenders(right.allowedSenders).map(value => value.replace(/^@/, ''));
  const sameSender = !a.length || !b.length || a.some(value => b.includes(value));
  const x = left.replyPrefixes ?? [], y = right.replyPrefixes ?? [];
  const samePrefix = !x.length || !y.length || x.some(first => y.some(second => first.startsWith(second) || second.startsWith(first)));
  return sameSender && samePrefix;
}
