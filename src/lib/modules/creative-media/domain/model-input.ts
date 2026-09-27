import type { CreativeConfig } from '../contracts/schemas/creative-media.schema.js';
import { concreteSchema, modelDefaults, modelPromptField, type FalModelContract } from './model-contract.js';
import { CreativeMediaError } from './types.js';

export function bindModelMedia(input: Record<string, unknown>, pointer: string, value: string) {
  const keys = pointer.slice(1).split('/');
  if (!pointer.startsWith('/') || keys.some(key => !key || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new CreativeMediaError('creative_model_parameters_invalid');
  let current: any = input;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (Array.isArray(current) && (!/^\d+$/.test(key) || Number(key) > 50)) throw new CreativeMediaError('creative_model_parameters_invalid');
    if (!Object.hasOwn(current, key)) current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    current = current[key];
    if (!current || typeof current !== 'object') throw new CreativeMediaError('creative_model_parameters_invalid');
  }
  const last = keys.at(-1)!;
  if (Array.isArray(current) && (!/^\d+$/.test(last) || Number(last) > 50)) throw new CreativeMediaError('creative_model_parameters_invalid');
  current[last] = value;
}

export function genericFalInput(config: CreativeConfig, prompt: string, media: Record<string, string>, contract: FalModelContract) {
  if (contract.id !== config.modelId || contract.status !== 'active') throw new CreativeMediaError('creative_model_not_found');
  const input = structuredClone(config.parameters);
  // Raw PCM/telephony bytes have no self-describing container for playback or reuse.
  // Refuse before billing rather than charging for an unusable output.
  if (config.modality === 'audio') {
    const defaults = modelDefaults(contract.schema);
    const audioSettings = concreteSchema(contract.schema.properties?.audio_setting ?? {});
    const formats = [input.output_format ?? defaults.output_format, input.format ?? defaults.format, (input.audio_setting as { format?: unknown } | undefined)?.format ?? modelDefaults(audioSettings).format];
    if (formats.some(value => typeof value === 'string' && /^(?:pcm|ulaw|alaw|raw)(?:_|$)/i.test(value))) throw new CreativeMediaError('creative_audio_format_unsupported');
  }
  for (const key of ['num_videos', 'num_outputs', 'num_samples']) {
    if (typeof input[key] === 'number' && input[key] > 10) throw new CreativeMediaError('creative_model_parameters_invalid');
  }
  validateMediaUrls(input);
  const promptField = modelPromptField(contract.schema);
  if (promptField && prompt) input[promptField] = prompt;
  else if (prompt && !promptField) throw new CreativeMediaError('creative_unsupported_input');
  for (const binding of config.mediaBindings) {
    const value = media[binding.pointer];
    if (!value) throw new CreativeMediaError('creative_reference_required');
    bindModelMedia(input, binding.pointer, value);
  }
  // Async queue outputs must remain retrievable after app restarts.
  if (contract.schema.properties?.sync_mode) input.sync_mode = false;
  return input;
}

function validateMediaUrls(value: unknown, field = '') {
  if (Array.isArray(value)) { for (const item of value) validateMediaUrls(item, field); return; }
  if (value && typeof value === 'object') { for (const [key, item] of Object.entries(value)) validateMediaUrls(item, key); return; }
  if (typeof value !== 'string' || !value || !/(?:^|_)urls?$/i.test(field)) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new CreativeMediaError('creative_model_parameters_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || !url.hostname.includes('.') || /(?:^[\d.]+$|:|\.(?:localhost|local|internal)$)/i.test(url.hostname)) throw new CreativeMediaError('creative_model_parameters_invalid');
}
