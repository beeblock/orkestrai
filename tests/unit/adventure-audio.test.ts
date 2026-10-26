import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MIXER, channelGain, readMixer, writeMixer } from '$lib/components/agent-room/adventure/adventure-mixer.js';
import type { ActiveAction } from '$lib/modules/agent-room/domain/adventure/skills.js';
import type { HeroAttack } from '$lib/modules/agent-room/domain/adventure/catalog.js';

/** A Web Audio stand-in that counts the voices a sound starts. */
class FakeParam {
  value = 1;
  setValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
}

let started = 0;

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  ratio = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  connect(next: FakeNode) { return next; }
  disconnect() {}
  start() { started += 1; }
  stop() {}
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = new FakeNode();
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  resume() { return Promise.resolve(); }
}

const ACTIONS: ActiveAction[] = ['bash', 'whirlwind', 'bulwark', 'earthshatter', 'volley', 'pierce', 'arrow-rain', 'meteor', 'frost-nova', 'arcane-storm', 'sanctuary', 'heal', 'judgment', 'turret', 'overclock', 'barrage', 'anthem', 'crescendo', 'finale'];
const ATTACKS: HeroAttack[] = ['melee', 'arrow', 'bolt', 'note', 'cog', 'smite'];

describe('adventure sound mixer', () => {
  it('starts from the old single sound level when no mixer was saved', () => {
    expect(readMixer(undefined, 'off').enabled).toBe(false);
    const alerts = readMixer('', 'alerts');
    expect([alerts.channels.alerts.on, alerts.channels.loot.on, alerts.channels.combat.on, alerts.channels.music.on]).toEqual([true, true, false, false]);
    const all = readMixer(null, 'all');
    expect([all.channels.combat.on, all.channels.spells.on, all.channels.music.on]).toEqual([true, true, false]);
  });

  it('keeps every value in range and every channel present, and mutes a channel that is off', () => {
    const mixer = readMixer(JSON.stringify({ enabled: true, volume: 250, channels: { music: { on: true, volume: -3 }, combat: { on: 'yes' } } }));
    expect(mixer.volume).toBe(100);
    expect(mixer.channels.music).toEqual({ on: true, volume: 0 });
    expect(mixer.channels.combat).toEqual(DEFAULT_MIXER.channels.combat);
    expect(readMixer('{broken')).toEqual(readMixer(undefined));
    const saved = readMixer(writeMixer({ ...DEFAULT_MIXER, volume: 50 }));
    expect(channelGain(saved, 'alerts')).toBeCloseTo(0.5 * 0.8);
    expect(channelGain(saved, 'music')).toBe(0);
    expect(channelGain({ ...saved, enabled: false }, 'alerts')).toBe(0);
  });
});

describe('adventure sound', () => {
  let audio: typeof import('$lib/components/agent-room/adventure/adventure-audio.js');

  beforeAll(async () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    audio = await import('$lib/components/agent-room/adventure/adventure-audio.js');
    const everything = readMixer(JSON.stringify({ enabled: true, volume: 80, channels: Object.fromEntries(['music', 'combat', 'spells', 'loot', 'alerts'].map((channel) => [channel, { on: true, volume: 60 }])) }));
    audio.configureSound(everything);
  });

  afterEach(() => {
    audio.setMusic(null);
    vi.useRealTimers();
  });

  it('gives every active skill and every weapon a voice of its own', () => {
    for (const action of ACTIONS) {
      started = 0;
      audio.playSpell(action);
      expect(started, action).toBeGreaterThan(0);
    }
    for (const attack of ATTACKS) {
      started = 0;
      audio.playAttack(attack);
      expect(started, attack).toBeGreaterThan(0);
    }
  });

  it('stays silent on a channel that is off', () => {
    audio.configureSound({ ...readMixer(undefined, 'alerts') });
    started = 0;
    audio.playSpell('meteor');
    audio.playAttack('arrow');
    expect(started).toBe(0);
    audio.playSound('quest');
    expect(started).toBeGreaterThan(0);
  });

  it('plays the soundtrack only with its channel on and stops it on request', () => {
    vi.useFakeTimers();
    audio.configureSound(readMixer(JSON.stringify({ enabled: true, volume: 80, channels: { music: { on: true, volume: 50 } } })));
    started = 0;
    audio.setMusic('battle');
    expect(started).toBeGreaterThan(0);
    audio.setMusic(null);
    started = 0;
    vi.advanceTimersByTime(500);
    expect(started).toBe(0);
    audio.configureSound(readMixer(undefined, 'alerts'));
    audio.setMusic('boss');
    vi.advanceTimersByTime(200);
    expect(started).toBe(0);
  });
});
