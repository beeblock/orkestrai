import { z } from 'zod/v3';
import * as m from '$lib/paraglide/messages.js';
export const botFailureKindSchema = z.enum(['quota', 'account', 'attachment', 'connection', 'safety', 'failed']);
export type BotFailureKind = z.infer<typeof botFailureKindSchema>;
/** Diagnostic details are classified locally and never become public text. */
export function botFailureKind(code = ''): BotFailureKind {
  if (/usage.limit|rate.limit|quota|insufficient.credits/i.test(code)) return 'quota';
  if (/authentication|unauthorized|credential|login.required|not.authenticated/i.test(code)) return 'account';
  if (/attachment|BOT_AUDIO_/i.test(code)) return 'attachment';
  if (/BOT_PUBLIC_|GRANT_REVOKED/.test(code)) return 'safety';
  if (/APP_SERVER_(?:START_FAILED|UNAVAILABLE|EXITED)|ECONN|ENET|connection|network/i.test(code)) return 'connection';
  return 'failed';
}
export function botFailureText(kind: BotFailureKind, locale?: 'pt-BR' | 'en' | 'es'): string {
  const options = locale ? { locale } : {};
  switch (kind) {
    case 'quota': return m['bots.failure_quota']({}, options);
    case 'account': return m['bots.failure_account']({}, options);
    case 'attachment': return m['bots.failure_attachment']({}, options);
    case 'connection': return m['bots.failure_connection']({}, options);
    case 'safety': return m['bots.failure_safety']({}, options);
    default: return m['bots.failure_generic']({}, options);
  }
}
