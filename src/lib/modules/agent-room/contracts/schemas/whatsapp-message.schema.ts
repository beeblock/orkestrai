import { z } from 'zod/v3';

const id = z.string().min(1).max(128).regex(/^[^\s\u0000-\u001f]+$/u);
const jid = z.string().max(80).regex(/^\d{5,22}(?:-\d{1,22})?@(?:s\.whatsapp\.net|g\.us|lid)$/);
/** Only the verified triggering key and a bounded preview; never media keys. */
export const whatsAppOriginSchema = z.object({
  id, chatId: jid, fromMe: z.boolean(), participant: jid.nullable().default(null), preview: z.string().max(512),
}).strict();
export type WhatsAppOrigin = z.infer<typeof whatsAppOriginSchema>;

/** Quoted content is input data and cannot provide caller identity or authority. */
export const whatsAppQuoteSchema = z.object({
  id: id.nullable(), kind: z.enum(['text', 'image', 'document', 'audio', 'unavailable']),
  text: z.string().max(4000), unavailable: z.boolean().default(false),
  unavailableReason: z.enum(['missing', 'different_chat', 'unsupported', 'download_failed', 'audio_not_ready', 'audio_unreadable']).optional(),
}).strict();
export type WhatsAppQuote = z.infer<typeof whatsAppQuoteSchema>;

export function persistedWhatsAppOrigin(meta: Record<string, unknown>, chatId: string): WhatsAppOrigin | null {
  const parsed = whatsAppOriginSchema.safeParse(meta.whatsappOrigin);
  return parsed.success && parsed.data.chatId === chatId && `${chatId}:${parsed.data.id}`.slice(0, 120) === meta.externalId ? parsed.data : null;
}
