import * as m from '../paraglide/messages.js';

// Built as a standalone CommonJS entry for Electron. Recovery must not depend
// on a working HTTP server, but uses the same Paraglide catalogs as the app.
export function startupRecoveryCopy(locale: 'pt-BR' | 'en' | 'es') {
  const options = { locale };
  return {
    title: m['startup.recovery_title']({}, options),
    message: m['startup.recovery_message']({}, options),
    detail: m['startup.recovery_detail']({}, options),
    download: m['startup.recovery_download']({}, options),
    retry: m['startup.recovery_retry']({}, options),
    logs: m['startup.recovery_logs']({}, options),
    quit: m['startup.recovery_quit']({}, options),
  };
}
