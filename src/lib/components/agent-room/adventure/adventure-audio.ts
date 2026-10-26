import type { HeroAttack } from '$lib/modules/agent-room/domain/adventure/catalog.js';
import type { ActiveAction } from '$lib/modules/agent-room/domain/adventure/skills.js';
import { DEFAULT_MIXER, MIXER_CHANNELS, channelGain, type Mixer, type MixerChannel } from './adventure-mixer.js';

/**
 * The Adventure's sound, synthesized with the Web Audio API: no audio files.
 * Every sound plays on one mixer channel (music, combat, spells, loot,
 * alerts) whose switch and volume come from Settings. Each weapon and each
 * active skill has a voice of its own, and the soundtrack is composed here:
 * a camp lullaby, a march, a battle theme and a boss theme, sequenced live
 * and crossfaded as the party's situation changes.
 */
export type AdventureSound =
  | 'hit' | 'critical' | 'kill' | 'down'
  | 'coin' | 'chest' | 'loot' | 'level-up'
  | 'alert' | 'quest' | 'boss' | 'join' | 'fail' | 'revive' | 'power';

export type MusicMood = 'camp' | 'march' | 'battle' | 'boss';

const CHANNEL_OF: Record<AdventureSound, MixerChannel> = {
  hit: 'combat', critical: 'combat', kill: 'combat', down: 'combat',
  power: 'spells',
  coin: 'loot', chest: 'loot', loot: 'loot', 'level-up': 'loot', revive: 'loot',
  alert: 'alerts', quest: 'alerts', boss: 'alerts', join: 'alerts', fail: 'alerts',
};

/** The least time between two plays of the same sound, so a crowded battle stays readable. */
const SPACING_MS: Partial<Record<string, number>> = { hit: 70, critical: 110, coin: 90, kill: 90 };

type Graph = { ctx: AudioContext; channels: Record<MixerChannel, GainNode>; noise: AudioBuffer };

let graph: Graph | null = null;
let mixer: Mixer = DEFAULT_MIXER;
const lastPlayed = new Map<string, number>();

function ensure(): Graph | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!graph) {
      const ctx = new AudioContext();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 4;
      compressor.connect(ctx.destination);
      const channels = Object.fromEntries(MIXER_CHANNELS.map((channel) => {
        const gain = ctx.createGain();
        gain.gain.value = channelGain(mixer, channel);
        gain.connect(compressor);
        return [channel, gain];
      })) as Record<MixerChannel, GainNode>;
      // One second of white noise, shared by every impact and whoosh.
      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      graph = { ctx, channels, noise };
    }
    if (graph.ctx.state === 'suspended') void graph.ctx.resume().catch(() => undefined);
    return graph;
  } catch {
    return null;
  }
}

/** Applies the mixer from Settings; music starts or stops with its channel. */
export function configureSound(next: Mixer): void {
  mixer = next;
  if (!graph) return;
  for (const channel of MIXER_CHANNELS) graph.channels[channel].gain.setTargetAtTime(channelGain(mixer, channel), graph.ctx.currentTime, 0.05);
  if (channelGain(mixer, 'music') === 0) stopMusic();
  else if (wantedMood) startMusic(wantedMood);
}

function audible(channel: MixerChannel): boolean {
  return channelGain(mixer, channel) > 0;
}

// ---------------------------------------------------------------------------
// Building blocks.

type Out = AudioNode;

/** One oscillator note with a short attack and an exponential fall. */
function tone(g: Graph, out: Out, t: number, frequency: number, duration: number, type: OscillatorType, volume: number, options: { slideTo?: number; attack?: number; detune?: number; filter?: number } = {}): void {
  const { ctx } = g;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, t);
  if (options.detune) oscillator.detune.value = options.detune;
  if (options.slideTo) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.slideTo), t + duration);
  const attack = options.attack ?? 0.006;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, duration));
  let head: AudioNode = oscillator;
  if (options.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = options.filter;
    head.connect(filter);
    head = filter;
  }
  head.connect(gain).connect(out);
  oscillator.start(t);
  oscillator.stop(t + duration + 0.05);
}

/** A burst of filtered noise: impacts, whooshes, rumbles, hats. */
function noise(g: Graph, out: Out, t: number, duration: number, volume: number, options: { type?: BiquadFilterType; frequency?: number; sweepTo?: number; q?: number; attack?: number } = {}): void {
  const { ctx } = g;
  const source = ctx.createBufferSource();
  source.buffer = g.noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = options.type ?? 'bandpass';
  filter.frequency.setValueAtTime(options.frequency ?? 1800, t);
  if (options.sweepTo) filter.frequency.exponentialRampToValueAtTime(options.sweepTo, t + duration);
  filter.Q.value = options.q ?? 1;
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.004;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, duration));
  source.connect(filter).connect(gain).connect(out);
  source.start(t, Math.random() * 0.5);
  source.stop(t + duration + 0.05);
}

/** A struck bell or blade: inharmonic partials that ring and fade. */
function bell(g: Graph, out: Out, t: number, base: number, duration: number, volume: number, partials = [1, 2.76, 5.4]): void {
  partials.forEach((ratio, index) => tone(g, out, t, base * ratio, duration / (1 + index * 0.6), 'sine', volume / (1 + index)));
}

/** Notes one after another. */
function run(g: Graph, out: Out, t: number, notes: number[], step: number, duration: number, type: OscillatorType, volume: number): void {
  notes.forEach((frequency, index) => tone(g, out, t + index * step, frequency, duration, type, volume));
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function spaced(key: string): boolean {
  const now = performance.now();
  if (now - (lastPlayed.get(key) ?? -Infinity) < (SPACING_MS[key] ?? 140)) return false;
  lastPlayed.set(key, now);
  return true;
}

// ---------------------------------------------------------------------------
// Sounds.

export function playSound(sound: AdventureSound): void {
  const channel = CHANNEL_OF[sound];
  if (!audible(channel) || !spaced(sound)) return;
  const g = ensure();
  if (!g) return;
  const out = g.channels[channel];
  const t = g.ctx.currentTime + 0.005;
  switch (sound) {
    case 'hit':
      tone(g, out, t, 150, 0.09, 'sine', 0.35, { slideTo: 55 });
      noise(g, out, t, 0.05, 0.18, { type: 'lowpass', frequency: 900 });
      break;
    case 'critical':
      tone(g, out, t, 190, 0.14, 'sine', 0.45, { slideTo: 50 });
      noise(g, out, t, 0.08, 0.3, { type: 'bandpass', frequency: 3200, q: 0.8 });
      bell(g, out, t + 0.01, 1400, 0.12, 0.08);
      break;
    case 'kill':
      noise(g, out, t, 0.12, 0.2, { type: 'bandpass', frequency: 700, sweepTo: 200 });
      tone(g, out, t, 330, 0.16, 'square', 0.05, { slideTo: 90, filter: 1200 });
      break;
    case 'down':
      tone(g, out, t, 330, 0.4, 'triangle', 0.14, { slideTo: 98 });
      break;
    case 'power':
      bell(g, out, t, 880, 0.3, 0.1);
      break;
    case 'coin':
      tone(g, out, t, 1976, 0.06, 'square', 0.05, { filter: 5000 });
      tone(g, out, t + 0.06, 2637, 0.16, 'square', 0.05, { filter: 5000 });
      break;
    case 'chest':
      // The lid creaks open, then a chime.
      noise(g, out, t, 0.22, 0.12, { type: 'bandpass', frequency: 500, sweepTo: 1100, q: 6 });
      run(g, out, t + 0.18, [hz(72), hz(76), hz(79), hz(84)], 0.06, 0.18, 'triangle', 0.09);
      break;
    case 'loot':
      run(g, out, t, [hz(84), hz(88), hz(91), hz(96)], 0.07, 0.3, 'triangle', 0.1);
      bell(g, out, t + 0.28, hz(96), 0.6, 0.06);
      break;
    case 'level-up':
      run(g, out, t, [hz(67), hz(72), hz(76), hz(79)], 0.09, 0.2, 'square', 0.06);
      tone(g, out, t + 0.36, hz(84), 0.6, 'square', 0.07, { filter: 3200 });
      tone(g, out, t + 0.36, hz(72), 0.6, 'triangle', 0.1);
      break;
    case 'revive':
      run(g, out, t, [hz(72), hz(79), hz(84)], 0.1, 0.4, 'sine', 0.12);
      noise(g, out, t, 0.5, 0.05, { type: 'highpass', frequency: 6000, attack: 0.2 });
      break;
    case 'alert':
      bell(g, out, t, hz(86), 0.4, 0.12);
      bell(g, out, t + 0.16, hz(91), 0.6, 0.12);
      break;
    case 'quest':
      run(g, out, t, [hz(79), hz(83), hz(86), hz(91)], 0.09, 0.25, 'square', 0.06);
      tone(g, out, t + 0.36, hz(55), 0.7, 'triangle', 0.16);
      bell(g, out, t + 0.36, hz(91), 0.9, 0.08);
      break;
    case 'boss':
      tone(g, out, t, 82, 1.1, 'sawtooth', 0.12, { slideTo: 61, filter: 500, attack: 0.08 });
      tone(g, out, t + 0.05, 123, 1.0, 'sawtooth', 0.08, { slideTo: 92, filter: 600, attack: 0.08 });
      noise(g, out, t, 0.9, 0.12, { type: 'lowpass', frequency: 180, attack: 0.1 });
      break;
    case 'join':
      run(g, out, t, [hz(76), hz(83)], 0.1, 0.22, 'triangle', 0.12);
      break;
    case 'fail':
      run(g, out, t, [hz(60), hz(55), hz(51)], 0.2, 0.4, 'sawtooth', 0.05);
      break;
  }
}

/** A hero's basic attack: each weapon sounds like itself. */
export function playAttack(kind: HeroAttack): void {
  if (!audible('combat') || !spaced(`attack:${kind}`)) return;
  const g = ensure();
  if (!g) return;
  const out = g.channels.combat;
  const t = g.ctx.currentTime + 0.005;
  switch (kind) {
    case 'melee':
      // A blade cuts the air and rings.
      noise(g, out, t, 0.09, 0.22, { type: 'bandpass', frequency: 3000, sweepTo: 1100, q: 1.4 });
      bell(g, out, t + 0.05, 1250, 0.18, 0.05, [1, 2.4, 3.9]);
      break;
    case 'arrow':
      tone(g, out, t, 220, 0.08, 'triangle', 0.12, { slideTo: 160 });
      noise(g, out, t + 0.02, 0.14, 0.12, { type: 'highpass', frequency: 2800, sweepTo: 6500 });
      break;
    case 'bolt':
      tone(g, out, t, 660, 0.16, 'sine', 0.12, { slideTo: 1760 });
      tone(g, out, t + 0.02, 1320, 0.12, 'triangle', 0.04, { slideTo: 2640 });
      break;
    case 'note': {
      const scale = [72, 74, 76, 79, 81, 84];
      tone(g, out, t, hz(scale[Math.floor(Math.random() * scale.length)]), 0.22, 'triangle', 0.14);
      break;
    }
    case 'cog':
      tone(g, out, t, 1200, 0.02, 'square', 0.06);
      for (let index = 0; index < 3; index += 1) noise(g, out, t + 0.02 + index * 0.03, 0.02, 0.12, { type: 'bandpass', frequency: 2400, q: 4 });
      break;
    case 'smite':
      bell(g, out, t, hz(84), 0.35, 0.1, [1, 1.5, 2.01]);
      break;
  }
}

/** An active skill: every one of the nineteen has its own voice. */
export function playSpell(action: ActiveAction): void {
  if (!audible('spells') || !spaced(`spell:${action}`)) return;
  const g = ensure();
  if (!g) return;
  const out = g.channels.spells;
  const t = g.ctx.currentTime + 0.005;
  switch (action) {
    case 'bash':
      tone(g, out, t, 120, 0.18, 'sine', 0.4, { slideTo: 45 });
      bell(g, out, t, 700, 0.3, 0.08, [1, 2.3, 4.1]);
      break;
    case 'whirlwind':
      for (let index = 0; index < 4; index += 1) noise(g, out, t + index * 0.12, 0.16, 0.16, { type: 'bandpass', frequency: 900, sweepTo: 2600, q: 2 });
      break;
    case 'bulwark':
      [220, 277, 330, 440].forEach((frequency) => tone(g, out, t, frequency, 1.0, 'sine', 0.07, { attack: 0.18 }));
      bell(g, out, t + 0.1, 880, 0.8, 0.05);
      break;
    case 'earthshatter':
      tone(g, out, t, 70, 0.9, 'sine', 0.45, { slideTo: 35 });
      noise(g, out, t, 1.0, 0.3, { type: 'lowpass', frequency: 260, sweepTo: 90 });
      for (let index = 0; index < 4; index += 1) noise(g, out, t + 0.15 + index * 0.09, 0.06, 0.15, { type: 'bandpass', frequency: 1500, q: 2 });
      break;
    case 'volley':
      for (let index = 0; index < 3; index += 1) noise(g, out, t + index * 0.07, 0.14, 0.12, { type: 'highpass', frequency: 3000, sweepTo: 7000 });
      tone(g, out, t, 196, 0.1, 'triangle', 0.12, { slideTo: 150 });
      break;
    case 'pierce':
      noise(g, out, t, 0.2, 0.2, { type: 'highpass', frequency: 2000, sweepTo: 8000 });
      bell(g, out, t + 0.12, 2600, 0.25, 0.05);
      break;
    case 'arrow-rain':
      for (let index = 0; index < 10; index += 1) noise(g, out, t + Math.random() * 0.8, 0.08, 0.08, { type: 'highpass', frequency: 3500 + Math.random() * 2000 });
      break;
    case 'meteor':
      tone(g, out, t, 1400, 0.65, 'sine', 0.08, { slideTo: 260 });
      noise(g, out, t + 0.6, 0.9, 0.42, { type: 'lowpass', frequency: 1200, sweepTo: 120 });
      tone(g, out, t + 0.6, 90, 0.6, 'sine', 0.4, { slideTo: 40 });
      break;
    case 'frost-nova':
      for (let index = 0; index < 7; index += 1) bell(g, out, t + index * 0.035, 1600 + Math.random() * 1800, 0.5, 0.035, [1, 2.1]);
      noise(g, out, t, 0.6, 0.1, { type: 'highpass', frequency: 5000 });
      break;
    case 'arcane-storm':
      for (let index = 0; index < 5; index += 1) tone(g, out, t + index * 0.13, 300 + Math.random() * 500, 0.18, 'sawtooth', 0.05, { slideTo: 1200 + Math.random() * 800, filter: 2200 });
      noise(g, out, t, 0.8, 0.08, { type: 'bandpass', frequency: 600, sweepTo: 2400, q: 3 });
      break;
    case 'sanctuary':
      [hz(60), hz(64), hz(67), hz(72)].forEach((frequency) => tone(g, out, t, frequency, 1.2, 'sine', 0.07, { attack: 0.25 }));
      bell(g, out, t + 0.2, hz(84), 1.0, 0.05);
      break;
    case 'heal':
      run(g, out, t, [hz(84), hz(88), hz(91), hz(96)], 0.06, 0.35, 'sine', 0.09);
      noise(g, out, t, 0.5, 0.04, { type: 'highpass', frequency: 7000, attack: 0.1 });
      break;
    case 'judgment':
      [hz(55), hz(62), hz(67)].forEach((frequency) => tone(g, out, t, frequency, 0.8, 'sawtooth', 0.06, { filter: 2400, attack: 0.02 }));
      bell(g, out, t, hz(91), 1.0, 0.08);
      break;
    case 'turret':
      noise(g, out, t, 0.08, 0.2, { type: 'bandpass', frequency: 900, q: 3 });
      tone(g, out, t + 0.08, 880, 0.06, 'square', 0.05);
      tone(g, out, t + 0.15, 1320, 0.08, 'square', 0.05);
      break;
    case 'overclock':
      tone(g, out, t, 180, 0.6, 'square', 0.06, { slideTo: 1400, filter: 3000 });
      noise(g, out, t + 0.3, 0.4, 0.1, { type: 'highpass', frequency: 3500, attack: 0.05 });
      break;
    case 'barrage':
      for (let index = 0; index < 4; index += 1) {
        tone(g, out, t + index * 0.11, 900, 0.18, 'sine', 0.05, { slideTo: 2400 });
        noise(g, out, t + index * 0.11 + 0.18, 0.14, 0.18, { type: 'lowpass', frequency: 900 });
      }
      break;
    case 'anthem':
      run(g, out, t, [hz(67), hz(72), hz(76), hz(79)], 0.12, 0.3, 'sawtooth', 0.05);
      break;
    case 'crescendo':
      [hz(60), hz(67), hz(72)].forEach((frequency) => tone(g, out, t, frequency, 0.9, 'sawtooth', 0.045, { attack: 0.6, filter: 2600 }));
      break;
    case 'finale':
      for (let index = 0; index < 5; index += 1) {
        noise(g, out, t + index * 0.12, 0.12, 0.2, { type: 'bandpass', frequency: 1500, q: 1.5 });
        bell(g, out, t + index * 0.12 + 0.04, 1800 + index * 300, 0.4, 0.04);
      }
      break;
  }
}

/**
 * What a mixer channel sounds like, for the buttons that try it in Settings:
 * it plays with the mixer on screen (saved or being edited), whatever this
 * window's sound was set to before.
 */
export function previewChannel(channel: MixerChannel, onScreen: Mixer): void {
  configureSound(onScreen);
  // A preview always plays, even right after the same sound.
  lastPlayed.clear();
  switch (channel) {
    case 'music': setMusic('march'); setTimeout(() => setMusic(wantedMood === 'march' ? null : wantedMood), 6_000); break;
    case 'combat': playAttack('melee'); setTimeout(() => playSound('hit'), 120); break;
    case 'spells': playSpell('meteor'); break;
    case 'loot': playSound('loot'); break;
    case 'alerts': playSound('quest'); break;
  }
}

// ---------------------------------------------------------------------------
// The soundtrack.

/**
 * A loop in eighth notes: `lead` and `bass` are tokens per eighth ("E5" a
 * note, "-" holds it, "." rests), `chords` one per bar (MIDI notes) for the
 * pad, and the drums sixteen steps per bar ("x" hits).
 */
type Song = {
  bpm: number;
  lead: string;
  bass: string;
  chords: number[][];
  leadWave: OscillatorType;
  leadFilter: number;
  arpeggio?: boolean;
  drums?: { kick: string; snare: string; hat: string };
};

const SONGS: Record<MusicMood, Song> = {
  // By the fire: a slow A-minor lullaby, plucked.
  camp: {
    bpm: 76,
    lead: 'E5 - - . A4 - C5 . | C5 - - . A4 - F4 . | E4 - G4 - C5 - - . | B4 - - . G4 - D5 .',
    bass: 'A2 - - - E3 - - - | F2 - - - C3 - - - | C3 - - - G2 - - - | G2 - - - D3 - - -',
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    leadWave: 'triangle',
    leadFilter: 2400,
    arpeggio: true,
  },
  // On the road: D major, light-footed.
  march: {
    bpm: 108,
    lead: 'D5 - F#5 - A5 - F#5 - | G5 - - E5 D5 - B4 - | A4 - C#5 - E5 - G5 - | F#5 - D5 - D5 - - .',
    bass: 'D2 . D3 . D2 . D3 . | G2 . G3 . G2 . G3 . | A2 . A3 . A2 . A3 . | D2 . D3 . D2 . A2 .',
    chords: [[62, 66, 69], [55, 59, 62], [57, 61, 64], [62, 66, 69]],
    leadWave: 'square',
    leadFilter: 2600,
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' },
  },
  // Steel meets bugs: E minor, driving.
  battle: {
    bpm: 136,
    lead: 'E5 . G5 . B5 - A5 G5 | E5 . G5 . A5 - G5 F#5 | D5 . F#5 . A5 - G5 F#5 | D#5 - F#5 - B5 - - .',
    bass: 'E2 E2 E3 E2 E2 E2 E3 E2 | C2 C2 C3 C2 C2 C2 C3 C2 | D2 D2 D3 D2 D2 D2 D3 D2 | B1 B1 B2 B1 B1 B1 B2 B1',
    chords: [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]],
    leadWave: 'square',
    leadFilter: 2200,
    drums: { kick: 'x..x..x.x..x..x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  },
  // A boss: C minor, heavy and ominous.
  boss: {
    bpm: 148,
    lead: 'C5 - - Eb5 D5 - C5 - | Ab4 - - C5 Bb4 - Ab4 - | Bb4 - - D5 C5 - Bb4 - | G4 - B4 - D5 - F5 -',
    bass: 'C2 C2 C3 C2 C2 C2 Eb3 C2 | Ab1 Ab1 Ab2 Ab1 Ab1 Ab1 C3 Ab1 | Bb1 Bb1 Bb2 Bb1 Bb1 Bb1 D3 Bb1 | G1 G1 G2 G1 G1 G1 B2 G1',
    chords: [[48, 51, 55], [44, 48, 51], [46, 50, 53], [43, 47, 50]],
    leadWave: 'sawtooth',
    leadFilter: 1800,
    drums: { kick: 'x.x...x.x.x...x.', snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx' },
  },
};

const NOTE = /^([A-G])(#|b)?(-?\d)$/;
const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midi(token: string): number | null {
  const match = NOTE.exec(token);
  if (!match) return null;
  return 12 * (Number(match[3]) + 1) + STEPS[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}

/** A line of tokens as notes with their lengths in eighths. */
function parseLine(line: string): Array<{ step: number; note: number; length: number }> {
  const tokens = line.split(/\s+/).filter((token) => token && token !== '|');
  const notes: Array<{ step: number; note: number; length: number }> = [];
  tokens.forEach((token, step) => {
    const note = midi(token);
    if (note === null) {
      if (token === '-' && notes.length) notes[notes.length - 1].length += 1;
      return;
    }
    notes.push({ step, note, length: 1 });
  });
  return notes;
}

type Playing = { mood: MusicMood; song: Song; gain: GainNode; lead: ReturnType<typeof parseLine>; bass: ReturnType<typeof parseLine>; nextStep: number; nextTime: number; timer: ReturnType<typeof setInterval> };

let playing: Playing | null = null;
let wantedMood: MusicMood | null = null;
const LOOKAHEAD_S = 0.15;

/** Sets what the party is doing; the soundtrack follows when its channel is on. */
export function setMusic(mood: MusicMood | null): void {
  wantedMood = mood;
  if (!mood || !audible('music')) {
    stopMusic();
    return;
  }
  startMusic(mood);
}

function startMusic(mood: MusicMood): void {
  if (playing?.mood === mood) return;
  const g = ensure();
  if (!g) return;
  stopMusic();
  const song = SONGS[mood];
  const gain = g.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, g.ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.5, g.ctx.currentTime + 1.2);
  gain.connect(g.channels.music);
  const state: Playing = { mood, song, gain, lead: parseLine(song.lead), bass: parseLine(song.bass), nextStep: 0, nextTime: g.ctx.currentTime + 0.1, timer: setInterval(() => schedule(g, state), 40) };
  playing = state;
  schedule(g, state);
}

function stopMusic(): void {
  if (!playing || !graph) return;
  const { gain, timer } = playing;
  clearInterval(timer);
  const now = graph.ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
  setTimeout(() => gain.disconnect(), 1_200);
  playing = null;
}

/** Queues the notes due within the lookahead; a loop is four bars of eight eighths. */
function schedule(g: Graph, state: Playing): void {
  if (playing !== state) return;
  const { song } = state;
  const eighth = 60 / song.bpm / 2;
  const loop = 32;
  // The page fell behind the audio clock (a busy or sleeping renderer): the beats that are
  // already past are skipped, not all played at once, and the song carries on in time.
  const behind = g.ctx.currentTime - state.nextTime;
  if (behind > eighth) {
    const missed = Math.ceil(behind / eighth);
    state.nextStep += missed;
    state.nextTime += missed * eighth;
  }
  while (state.nextTime < g.ctx.currentTime + LOOKAHEAD_S) {
    const step = state.nextStep % loop;
    const t = state.nextTime;
    const bar = Math.floor(step / 8);
    for (const note of state.lead) if (note.step === step) tone(g, state.gain, t, hz(note.note), note.length * eighth * 0.95, song.leadWave, 0.05, { filter: song.leadFilter });
    for (const note of state.bass) if (note.step === step) tone(g, state.gain, t, hz(note.note), note.length * eighth * 0.9, 'triangle', 0.16);
    const chord = song.chords[bar];
    if (step % 8 === 0) chord.forEach((note) => tone(g, state.gain, t, hz(note), eighth * 7.6, 'sine', 0.035, { attack: 0.25, detune: 4 }));
    if (song.arpeggio) tone(g, state.gain, t, hz(chord[step % 3] + 12), eighth * 1.6, 'triangle', 0.035);
    if (song.drums) {
      for (const half of [0, 1]) {
        const sixteenth = (step % 8) * 2 + half;
        const at = t + half * eighth / 2;
        if (song.drums.kick[sixteenth] === 'x') tone(g, state.gain, at, 150, 0.16, 'sine', 0.28, { slideTo: 45 });
        if (song.drums.snare[sixteenth] === 'x') noise(g, state.gain, at, 0.12, 0.12, { type: 'bandpass', frequency: 1800, q: 0.7 });
        if (song.drums.hat[sixteenth] === 'x') noise(g, state.gain, at, 0.03, 0.05, { type: 'highpass', frequency: 7000 });
      }
    }
    state.nextStep += 1;
    state.nextTime += eighth;
  }
}
