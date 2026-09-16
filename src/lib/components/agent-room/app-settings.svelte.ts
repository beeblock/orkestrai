import { getCsrfToken } from '@beeblock/svelar/http';

/**
 * Store reativa das configuracoes globais (/api/agent-room/settings).
 * Os terminais liam settings so no mount e ficavam com valores velhos
 * (o atalho do ditado "nao mudava" por causa disso). Aqui: cache unico,
 * invalidado ao salvar (settings page) e revalidado por TTL/foco.
 */

const TTL_MS = 30_000;

let cache = $state<Record<string, string>>({});
let loadedAt = 0;
let pending: Promise<Record<string, string>> | null = null;

export const appSettingsStore = {
  get values() {
    return cache;
  },
};

export async function getAppSettings(force = false): Promise<Record<string, string>> {
  if (!force && loadedAt && Date.now() - loadedAt < TTL_MS) return cache;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('/api/agent-room/settings', { signal: AbortSignal.timeout(10_000) });
      const payload = await response.json();
      cache = payload.data ?? {};
      loadedAt = Date.now();
    } catch {
      // mantem o cache anterior
    } finally {
      pending = null;
    }
    return cache;
  })();
  return pending;
}

/** Invalida o cache (chamado pela pagina de Configuracoes apos salvar). */
export function invalidateAppSettings() {
  loadedAt = 0;
}

export async function updateAppSettings(values: Record<string, string>): Promise<Record<string, string>> {
  const token = getCsrfToken();
  const response = await fetch('/api/agent-room/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body: JSON.stringify(values),
  });
  if (!response.ok) throw new Error(`Settings update failed (${response.status}).`);
  const payload = await response.json();
  cache = payload.data ?? { ...cache, ...values };
  loadedAt = Date.now();
  return cache;
}

/** Revalida quando a janela volta ao foco (bind trocado em outra aba/app). */
export function refreshAppSettingsOnFocus() {
  if (typeof window === 'undefined') return;
  window.addEventListener('focus', () => {
    void getAppSettings(true);
  });
}
