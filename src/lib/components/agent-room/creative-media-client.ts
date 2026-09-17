import { getCsrfToken } from '@beeblock/svelar/http';
import * as m from '$lib/paraglide/messages.js';
import type { CreativeRunStatus } from '$lib/modules/creative-media/domain/catalog.js';

export async function creativeApi<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const csrf = getCsrfToken();
  const response = await fetch(url, { method, signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error ?? 'creative_request_failed');
  return result.data;
}
export function creativeStatus(status: CreativeRunStatus) {
  const labels = { queued: m['creative.queued'], submitting: m['creative.submitting'], submission_uncertain: m['creative.submission_uncertain'], provider_running: m['creative.provider_running'], downloading: m['creative.downloading'], download_failed: m['creative.download_failed'], cancel_requested: m['creative.cancel_requested'], cancelled: m['creative.cancelled'], completed: m['creative.completed'], failed: m['creative.failed'] };
  if (status === 'closed_unconfirmed') return m['creative.closed_unconfirmed']();
  return labels[status]?.() ?? m['creative.error']();
}
export function creativeError(code: string) {
  if (code === 'creative_submission_uncertain') return m['creative.submission_uncertain']();
  if (code === 'creative_approval_required') return m['creative.error_approval']();
  if (/budget|concurrency/.test(code)) return m['creative.error_budget']();
  if (/vault|credential/.test(code)) return m['creative.error_credential']();
  if (/profile_required|profile_disabled|workspace_disabled|owner_required|agent_required|policy_denied|halted|suspended/.test(code)) return m['creative.error_access']();
  if (/changed|revision|preview_expired|conflict|busy/.test(code)) return m['creative.error_conflict']();
  if (/reference/.test(code)) return m['creative.error_reference']();
  if (/provider|estimate_unavailable|rate_limit|download/.test(code)) return m['creative.error_provider']();
  if (/invalid|prompt|unsupported|path/.test(code)) return m['creative.error_invalid']();
  return m['creative.error']();
}
