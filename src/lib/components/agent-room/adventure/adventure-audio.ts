/**
 * Chiptune sound effects synthesized with the Web Audio API: no audio files.
 * `alerts` plays only what asks for the owner's eyes (a hero waiting, a quest
 * done, a boss); `all` adds the battle; `off` is silent.
 */
export type AdventureSoundLevel = 'off' | 'alerts' | 'all';
export type AdventureSound = 'hit' | 'slash' | 'coin' | 'kill' | 'level-up' | 'alert' | 'quest' | 'boss' | 'join' | 'special' | 'chest' | 'loot' | 'down' | 'fail';

const ALERT_SOUNDS = new Set<AdventureSound>(['alert', 'quest', 'boss', 'level-up', 'join', 'loot', 'fail']);

let context: AudioContext | null = null;
const lastPlayed = new Map<AdventureSound, number>();

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

/** One square/triangle note with a short envelope. */
function tone(ctx: AudioContext, start: number, frequency: number, duration: number, type: OscillatorType, volume: number, slideTo?: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** A burst of filtered noise, for impacts. */
function noise(ctx: AudioContext, start: number, duration: number, volume: number): void {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
}

export function playSound(sound: AdventureSound, level: AdventureSoundLevel): void {
  if (level === 'off' || (level === 'alerts' && !ALERT_SOUNDS.has(sound))) return;
  const now = performance.now();
  // A crowded battle would stack the same blip dozens of times a second.
  if (now - (lastPlayed.get(sound) ?? 0) < (sound === 'hit' || sound === 'coin' ? 90 : 160)) return;
  lastPlayed.set(sound, now);
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  switch (sound) {
    case 'hit': noise(ctx, t, 0.06, 0.05); tone(ctx, t, 220, 0.06, 'square', 0.03, 110); break;
    case 'slash': noise(ctx, t, 0.09, 0.06); tone(ctx, t, 880, 0.08, 'triangle', 0.03, 330); break;
    case 'special': [523, 659, 784].forEach((note, index) => tone(ctx, t + index * 0.05, note, 0.12, 'square', 0.035)); break;
    case 'coin': tone(ctx, t, 988, 0.06, 'square', 0.03); tone(ctx, t + 0.06, 1319, 0.12, 'square', 0.03); break;
    case 'kill': tone(ctx, t, 392, 0.1, 'square', 0.035, 98); break;
    case 'level-up': [523, 659, 784, 1047].forEach((note, index) => tone(ctx, t + index * 0.08, note, 0.16, 'square', 0.04)); break;
    case 'alert': tone(ctx, t, 1175, 0.12, 'triangle', 0.06); tone(ctx, t + 0.14, 1568, 0.2, 'triangle', 0.06); break;
    case 'quest': [784, 988, 1175, 1568].forEach((note, index) => tone(ctx, t + index * 0.09, note, 0.2, 'square', 0.045)); tone(ctx, t + 0.36, 392, 0.4, 'triangle', 0.05); break;
    case 'boss': tone(ctx, t, 110, 0.5, 'sawtooth', 0.04, 82); tone(ctx, t + 0.25, 147, 0.5, 'sawtooth', 0.035, 98); break;
    case 'join': tone(ctx, t, 659, 0.1, 'triangle', 0.05); tone(ctx, t + 0.1, 988, 0.18, 'triangle', 0.05); break;
    case 'chest': tone(ctx, t, 523, 0.07, 'square', 0.03); tone(ctx, t + 0.07, 659, 0.07, 'square', 0.03); tone(ctx, t + 0.14, 784, 0.12, 'square', 0.03); break;
    case 'loot': [1047, 1319, 1568, 2093].forEach((note, index) => tone(ctx, t + index * 0.07, note, 0.22, 'triangle', 0.045)); break;
    case 'down': tone(ctx, t, 330, 0.25, 'triangle', 0.04, 110); break;
    case 'fail': tone(ctx, t, 262, 0.25, 'sawtooth', 0.03, 196); tone(ctx, t + 0.22, 196, 0.4, 'sawtooth', 0.03, 131); break;
  }
}
