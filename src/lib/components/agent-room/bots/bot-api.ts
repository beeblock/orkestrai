import { getCsrfToken } from '@beeblock/svelar/http';

export async function botApi<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const csrf = getCsrfToken();
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ?? AbortSignal.timeout(30_000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'PERSONAL_BOT_FAILED');
  return result.data as T;
}

export type BotProviderOption = { id: string; displayName: string; transportName?: string };
