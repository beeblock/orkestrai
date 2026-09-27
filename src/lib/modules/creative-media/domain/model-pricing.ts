import type { CreativeConfig } from '../contracts/schemas/creative-media.schema.js';
import type { FalModelContract } from './model-contract.js';
import { concreteSchema, isAudioCategory } from './model-contract.js';

function durationFor(config: CreativeConfig, contract?: FalModelContract) {
  if (!contract) return config.duration;
  if (isAudioCategory(contract.category)) {
    const plan = config.parameters.composition_plan as { sections?: Array<{ duration_ms?: number }> } | undefined;
    if (Array.isArray(plan?.sections) && plan.sections.length && plan.sections.every(item => item && typeof item.duration_ms === 'number' && Number.isFinite(item.duration_ms) && item.duration_ms > 0)) return plan.sections.reduce((sum, item) => sum + item.duration_ms!, 0) / 1000;
    for (const [key, scale] of [['music_length_ms', 1000], ['duration_ms', 1000], ['duration_seconds', 1], ['seconds_total', 1], ['duration', 1], ['audio_length', 1]] as const) {
      const value = config.parameters[key] ?? concreteSchema(contract.schema.properties?.[key] ?? {}).default;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value / scale;
    }
    return null;
  }
  const raw = config.parameters.duration ?? config.parameters.video_length;
  const numeric = typeof raw === 'string' ? Number(raw.replace(/s$/, '')) : Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (raw !== 'auto') return null;
  const schema = concreteSchema(contract.schema.properties?.duration ?? {});
  const maximum = schema.maximum ?? Math.max(0, ...(schema.enum ?? []).map(Number).filter(Number.isFinite));
  return maximum > 0 ? maximum : null;
}

export function falBillingQuantity(config: CreativeConfig, unit: string, contract?: FalModelContract): number | null {
  const duration = durationFor(config, contract);
  const normalized = unit.toLowerCase().replace(/[ _-]/g, '');
  const outputs = Math.max(1, Number(config.parameters.num_videos ?? config.parameters.num_outputs ?? config.parameters.num_samples ?? 1));
  let quantity: number | null = null;
  if (['second', 'seconds', 's', 'videosecond', 'videoseconds', 'audiosecond', 'audioseconds'].includes(normalized)) quantity = duration === null ? null : duration * outputs;
  else if (['minute', 'minutes', 'audiominute', 'audiominutes', 'outputaudiominute'].includes(normalized)) quantity = duration === null ? null : Math.ceil(duration / 60) * outputs;
  else if (['character', 'characters', '1000characters', '1000character', '1kcharacters'].includes(normalized)) {
    const texts = typeof config.parameters.text === 'string' ? [config.parameters.text] : Array.isArray(config.parameters.inputs) ? config.parameters.inputs.map(item => item && typeof item === 'object' ? (item as { text?: unknown }).text : undefined) : [];
    if (texts.length && texts.every(text => typeof text === 'string')) quantity = texts.reduce<number>((sum, text) => sum + (text as string).length, 0) * outputs / (normalized.startsWith('1000') || normalized.startsWith('1k') ? 1000 : 1);
  }
  else if (['video', 'videos', 'request', 'requests', 'generation', 'generations', 'audio', 'audios', 'song', 'songs'].includes(normalized)) quantity = outputs;
  else if (['frame', 'frames'].includes(normalized)) {
    const count = Number(config.parameters.num_frames ?? config.parameters.frames);
    const fps = Number(config.parameters.fps);
    quantity = count > 0 ? count * outputs : duration && fps > 0 ? duration * fps * outputs : null;
  } else if (/^bytedance\/seedance-2\.5\//.test(config.modelId) && duration) {
    // Seedance 2.5 documents area * seconds * 24 / 1024 video tokens.
    // Reference-video billing additionally uses input duration; do not guess it.
    const scales: Record<string, number> = { token: 1, tokens: 1, videotoken: 1, videotokens: 1, '1000tokens': 1000, '1ktokens': 1000, '1000videotokens': 1000, '1kvideotokens': 1000, 'milliontokens': 1000000, '1mtokens': 1000000 };
    const sizes: Record<string, Record<string, [number, number]>> = {
      '480p': { '21:9': [992,432], '16:9': [864,496], '4:3': [752,560], '1:1': [640,640], '3:4': [560,752], '9:16': [496,864] },
      '720p': { '21:9': [1470,630], '16:9': [1280,720], '4:3': [1112,834], '1:1': [960,960], '3:4': [834,1112], '9:16': [720,1280] },
    };
    const resolution = sizes[String(config.parameters.resolution ?? '720p')];
    const ratio = String(config.parameters.aspect_ratio ?? 'auto');
    const dimensions = resolution && (ratio === 'auto' ? Object.values(resolution).sort((a,b) => b[0] * b[1] - a[0] * a[1])[0] : resolution[ratio]);
    const hasVideo = config.mediaBindings.some(binding => /video/i.test(binding.pointer)) || Object.entries(config.parameters).some(([key, value]) => /video.*url/i.test(key) && Boolean(value) && (!Array.isArray(value) || value.length > 0));
    if (scales[normalized] && dimensions && !hasVideo) quantity = dimensions[0] * dimensions[1] * duration * 24 / 1024 / scales[normalized];
  }
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) quantity = null;
  if (config.billingUnits !== null) quantity = Math.max(quantity ?? 0, config.billingUnits);
  return quantity;
}
