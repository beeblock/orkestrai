import { z } from 'zod';
import type { FalModelContract, ModelSchema } from './model-contract.js';
import { concreteSchema } from './model-contract.js';
import { CreativeMediaError } from './types.js';

export const shotDirectionSchema = z.object({
  framing: z.enum(['custom', 'wide', 'full', 'medium', 'close_up', 'detail']).default('custom'),
  angle: z.enum(['eye_level', 'low', 'high', 'overhead']).default('eye_level'),
  motion: z.enum(['none', 'static', 'push_in', 'pull_out', 'pan_left', 'pan_right', 'orbit', 'tracking']).default('none'),
  pace: z.enum(['gentle', 'normal', 'energetic']).default('gentle'),
}).strict();
export type ShotDirection = z.infer<typeof shotDirectionSchema>;
export function shotDirectionPrompt(shot: ShotDirection | undefined, still = false) {
  if (!shot || (shot.framing === 'custom' && shot.angle === 'eye_level' && (still || shot.motion === 'none'))) return '';
  const framing = { custom: '', wide: 'Wide establishing shot, showing the subject and surroundings.', full: 'Full-body shot with comfortable head and foot room.', medium: 'Medium shot, waist up.', close_up: 'Close-up of the face with comfortable headroom.', detail: 'Detail shot, isolating the requested object or feature.' }[shot.framing];
  const angle = { eye_level: 'Eye-level camera.', low: 'Low camera angle looking up.', high: 'High camera angle looking down.', overhead: 'Overhead camera looking directly down.' }[shot.angle];
  const motion = { none: '', static: 'Keep the camera static.', push_in: 'Slowly move the camera toward the subject.', pull_out: 'Move the camera away from the subject.', pan_left: 'Pan the camera left.', pan_right: 'Pan the camera right.', orbit: 'Orbit around the subject.', tracking: 'Track the moving subject.' }[shot.motion];
  return ['Shot direction (creative intent, not a guaranteed camera trajectory):', framing, angle, still ? '' : motion, !still && motion ? `Movement pace: ${shot.pace}.` : ''].filter(Boolean).join(' ');
}

/** Bind only a declared, unambiguous duration input; never shorten the request. */
export function requestedDurationParameters(parameters: Record<string, unknown>, contract: FalModelContract, seconds: number) {
  const candidates = Object.entries(contract.schema.properties ?? {}).filter(([key]) => ['duration', 'duration_seconds'].includes(key));
  if (candidates.length !== 1) throw new CreativeMediaError('creative_invalid_duration');
  const [key, raw] = candidates[0], field: ModelSchema = concreteSchema(raw);
  const choices = field.enum;
  const numeric = field.type === 'number' || field.type === 'integer';
  const value = choices?.find(item => typeof item === 'number' ? item === seconds : typeof item === 'string' && /^\d+(?:\.\d+)?s?$/.test(item) && Number(item.replace(/s$/, '')) === seconds) ?? (choices ? undefined : numeric ? seconds : undefined);
  if (value === undefined || (field.minimum !== undefined && seconds < field.minimum) || (field.maximum !== undefined && seconds > field.maximum) || (field.type === 'integer' && !Number.isInteger(seconds))) throw new CreativeMediaError('creative_invalid_duration');
  return { ...parameters, [key]: value };
}
