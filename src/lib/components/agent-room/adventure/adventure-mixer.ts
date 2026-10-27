/**
 * The Adventure's sound mixer, as Settings stores it (`adventureMixer`, a
 * JSON string): a master switch and volume, and a switch and volume per
 * channel. Before the mixer there was one level (`adventureSound`: off,
 * alerts or all); a mixer never saved starts from it.
 */
export type MixerChannel = 'music' | 'combat' | 'spells' | 'loot' | 'alerts';
export const MIXER_CHANNELS: MixerChannel[] = ['music', 'combat', 'spells', 'loot', 'alerts'];

export type Mixer = {
  enabled: boolean;
  /** 0–100. */
  volume: number;
  channels: Record<MixerChannel, { on: boolean; volume: number }>;
};

export const DEFAULT_MIXER: Mixer = {
  enabled: true,
  volume: 70,
  channels: {
    music: { on: false, volume: 45 },
    combat: { on: false, volume: 55 },
    spells: { on: false, volume: 60 },
    loot: { on: true, volume: 70 },
    alerts: { on: true, volume: 80 },
  },
};

function volumeOf(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0, Math.min(100, number))) : fallback;
}

/** The mixer from Settings, every field checked; an absent one follows the old single level. */
export function readMixer(raw: string | undefined | null, legacy?: string | null): Mixer {
  let stored: Partial<Mixer> | null = null;
  try {
    stored = raw ? (JSON.parse(raw) as Partial<Mixer>) : null;
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== 'object') {
    const all = legacy === 'all';
    return {
      ...DEFAULT_MIXER,
      enabled: legacy !== 'off',
      channels: { ...DEFAULT_MIXER.channels, combat: { ...DEFAULT_MIXER.channels.combat, on: all }, spells: { ...DEFAULT_MIXER.channels.spells, on: all } },
    };
  }
  const channels = Object.fromEntries(MIXER_CHANNELS.map((channel) => {
    const entry = (stored!.channels as Partial<Mixer['channels']> | undefined)?.[channel];
    const base = DEFAULT_MIXER.channels[channel];
    return [channel, { on: typeof entry?.on === 'boolean' ? entry.on : base.on, volume: volumeOf(entry?.volume, base.volume) }];
  })) as Mixer['channels'];
  return { enabled: typeof stored.enabled === 'boolean' ? stored.enabled : true, volume: volumeOf(stored.volume, DEFAULT_MIXER.volume), channels };
}

export function writeMixer(mixer: Mixer): string {
  return JSON.stringify(mixer);
}

/** How loud a channel plays, 0–1, with the master switch and volume applied. */
export function channelGain(mixer: Mixer, channel: MixerChannel): number {
  if (!mixer.enabled || !mixer.channels[channel].on) return 0;
  return (mixer.volume / 100) * (mixer.channels[channel].volume / 100);
}
