import { getCsrfToken } from '@beeblock/svelar/http';
import * as m from '$lib/paraglide/messages.js';
import type { CreativeRunStatus } from '$lib/modules/creative-media/domain/catalog.js';

export async function creativeApi<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const csrf = getCsrfToken();
  const response = await fetch(url, { method, signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok || result.error) throw Object.assign(new Error(result.error ?? 'creative_request_failed'), { billing: result.billing });
  return result.data;
}
export function creativeStatus(status: CreativeRunStatus) {
  const labels = { queued: m['creative.queued'], submitting: m['creative.submitting'], submission_uncertain: m['creative.submission_uncertain'], provider_running: m['creative.provider_running'], downloading: m['creative.downloading'], download_failed: m['creative.download_failed'], cancel_requested: m['creative.cancel_requested'], cancelled: m['creative.cancelled'], completed: m['creative.completed'], failed: m['creative.failed'] };
  if (status === 'closed_unconfirmed') return m['creative.closed_unconfirmed']();
  return labels[status]?.() ?? m['creative.error']();
}
export function creativeError(code: string) {
  if (code === 'creative_sequence_runtime_required') return m['sequence.error_runtime']();
  if (code === 'creative_sequence_disk_full') return m['sequence.error_disk']();
  if (code === 'creative_sequence_trim_invalid') return m['sequence.error_trim']();
  if (code === 'creative_sequence_interrupted') return m['sequence.error_interrupted']();
  if (code === 'creative_sequence_transfer_sources') return m['sequence.error_transfer']();
  if (code.startsWith('creative_sequence_') && code !== 'creative_sequence_busy') return m['sequence.error']();
  if (code === 'creative_recipe_format_unsupported') return m['creative_recipe.error_format']();
  if (code.startsWith('creative_recipe_')) return m['creative_recipe.error']();
  if (code === 'creative_brand_locked' || code === 'creative_brand_lock_required') return m['creative_brand.error_locked']();
  if (code.startsWith('creative_brand_')) return m['creative_brand.error']();
  if (code === 'creative_model_mapping_required') return m['creative_shot.model_mapping_required']();
  if (code === 'creative_storyboard_reference_limit') return m['storyboard.reference_limit']();
  if (code === 'creative_storyboard_executor_invalid') return m['storyboard.invalid_executor']();
  if (code === 'creative_storyboard_not_found' || code === 'creative_storyboard_scene_missing') return m['storyboard.not_found']();
  if (code === 'creative_character_locked_or_changed' || code === 'creative_character_owner_change_required') return m['creative.character_error_locked']();
  if (code === 'creative_character_model_incompatible' || code === 'creative_character_audio_required') return m['creative.character_error_model']();
  if (code === 'creative_character_auto_binding') return m['creative.reference_binding_error']();
  if (code === 'creative_reference_alias_missing') return m['creative.reference_alias_error']();
  if (code.startsWith('creative_character_')) return m['creative.character_error']();
  if (code === 'creative_model_contract_unavailable') return m['creative.error_contract_unavailable']();
  if (code === 'creative_billing_units_required') return m['creative.billing_units_help']();
  if (/catalog/.test(code)) return m['creative.error_catalog']();
  if (/model_contract|model_parameters|model_not_found/.test(code)) return m['creative.error_contract']();
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
