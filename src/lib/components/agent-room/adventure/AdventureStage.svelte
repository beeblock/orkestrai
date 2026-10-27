<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowDownToLine, GripVertical } from '@lucide/svelte';
  import type { BiomeId, HeroClassId, MonsterId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import { RARITY_RULES, rarityIndex, type Rarity } from '$lib/modules/agent-room/domain/adventure/items.js';
  import type { ChestTier } from '$lib/modules/agent-room/domain/adventure/loot.js';
  import { PETS_BY_ID, type PetId } from '$lib/modules/agent-room/domain/adventure/pets.js';
  import type { ActiveAction } from '$lib/modules/agent-room/domain/adventure/skills.js';
  import {
    completeQuest,
    configureAdventure,
    createAdventure,
    drainReport,
    HERO_SPACING,
    stepAdventure,
    type AdventureEvent,
    type AdventureState,
    type PartyMember,
    type PendingReport,
    type SimRules,
    type Supporter,
  } from '$lib/modules/agent-room/domain/adventure/simulation.js';
  import { biomeOf, regionLevel, WAVES_PER_STAGE, type Difficulty, type StagePosition } from '$lib/modules/agent-room/domain/adventure/world.js';
  import { adventureCatalog } from '$lib/i18n/adventure/index.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { animationFrame, drawFrame, loadAtlas, type Atlas } from './atlas.js';
  import { playAttack, playSound, playSpell, setMusic, type MusicMood } from './adventure-audio.js';
  import { heroLevelText } from './adventure-text.js';
  import * as m from '$lib/paraglide/messages.js';

  /** What the stage shows about a hero besides what the battle knows. */
  export type HeroLabel = {
    id: string;
    name: string;
    /** The agent playing the hero, or null while it rests in the guild. */
    agentTitle: string | null;
    classId: HeroClassId;
    level: number;
    paragon: number;
    asks: number;
    visualTier: 1 | 2 | 3 | 4;
    weaponRarity: Rarity | null;
  };
  type HitBox = { id: string; left: number; top: number; width: number; height: number };

  let {
    party,
    teamActive = undefined,
    supporters = [],
    labels,
    position,
    wave = 0,
    rules,
    activePet = null,
    gold = 0,
    chests = 0,
    difficultyName = '',
    height = 150,
    scale = 1,
    scenery = 'full',
    hudMode = 'always',
    draggable = false,
    moved = false,
    onResetPosition,
    onSelect,
    onHover,
    onOpenCamp,
  }: {
    party: PartyMember[];
    /** Whether any agent of the team works (the battle only moves then); defaults to the formation's own agents. */
    teamActive?: boolean;
    /** Heroes outside the formation whose agents work: they learn at a reduced rate. */
    supporters?: Supporter[];
    labels: Record<string, HeroLabel>;
    position: StagePosition;
    wave?: number;
    rules: Partial<SimRules>;
    activePet?: PetId | null;
    gold?: number;
    /** Unopened chests on the server. */
    chests?: number;
    difficultyName?: string;
    /** Height of the playing field, in CSS pixels. */
    height?: number;
    /** Drawing scale (the strip's size): the world is drawn this much larger, crisp at any size. */
    scale?: number;
    /** `minimal` keeps the party and the monsters on a thin line, without the landscape. */
    scenery?: 'full' | 'minimal';
    /** `hover` hides the panel until the pointer comes near. */
    hudMode?: 'always' | 'hover';
    /** The desktop strip shows a grip to drag it around... */
    draggable?: boolean;
    /** ...and, once moved, a way back to the Dock. */
    moved?: boolean;
    onResetPosition?: () => void;
    onSelect?: (heroId: string, box: { left: number; top: number; width: number; height: number }) => void;
    onHover?: (heroId: string | null) => void;
    onOpenCamp?: () => void;
  } = $props();

  const TICK_MS = 50;
  // Atlases are drawn at half size: 2x art for crisp Retina pixels.
  const ART_SCALE = 0.5;
  const GROUND = 26;

  let host = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let width = $state(0);
  // svelte-ignore state_referenced_locally
  const world: AdventureState = createAdventure({ position, wave, rules }, Date.now() & 0xffff);
  let hud = $state({ position: { ...world.position }, wave: world.wave });
  let mode = $state<AdventureState['mode']>('camp');
  // What the soundtrack plays now.
  let musicMood: MusicMood | null = null;
  let pendingChests = $state(0);
  let pendingGold = $state(0);
  let banners = $state<Array<{ id: number; tone: 'gold' | 'danger' | 'info' | 'loot'; text: string; color?: string }>>([]);
  let boss = $state<{ name: string; hp: number; max: number } | null>(null);
  let hovered = $state<string | null>(null);
  // The world's own size: the canvas's CSS size divided by the drawing scale.
  let viewWidth = 0;
  let viewHeight = 0;
  let resizeCanvas: (() => void) | null = null;
  // The panel peeks in while the pointer moves over the strip (hudMode = hover).
  let peek = $state(false);
  let peekTimer: ReturnType<typeof setTimeout> | null = null;
  // Heroes already announced this session.
  const greeted = new Set<string>();
  let hitBoxes: HitBox[] = [];

  const atlases = new Map<string, Atlas | null>();
  type Effect = {
    kind: 'number' | 'spark' | 'slash' | 'coin' | 'chest' | 'portal' | 'puff' | 'ring' | 'beam' | 'spell';
    x: number; y: number; t: number; life: number;
    text?: string; critical?: boolean; vx?: number; vy?: number; color?: string; frame?: number; heroId?: string;
    /** Spells: the VFX sheet, its row of six frames, the drawing scale, a flight's end and a tint. */
    sheet?: string; row?: number; scale?: number; toX?: number; filter?: string; alpha?: number;
  };

  /**
   * How each active skill looks: a row of six frames from a VFX sheet, played
   * where the spell lands — on the monsters it hits (one burst per monster or
   * one over the whole pack), on the allies it heals, shields or hastens, over
   * the party, around the caster, or flying from the caster to its target.
   */
  type SpellPlace = 'enemies' | 'enemy' | 'pack' | 'allies' | 'party' | 'caster' | 'flight';
  type SpellLook = { sheet: string; row: number; place: SpellPlace; scale: number; life: number; max?: number; filter?: string; color?: string; alpha?: number };
  const SPELLS: Partial<Record<ActiveAction, SpellLook>> = {
    meteor: { sheet: 'vfx-1', row: 0, place: 'enemies', scale: 0.62, life: 950, max: 3, color: '#ff9b4a' },
    'frost-nova': { sheet: 'vfx-1', row: 1, place: 'enemies', scale: 0.55, life: 850, max: 4, color: '#8fd8ff' },
    'arcane-storm': { sheet: 'vfx-1', row: 2, place: 'enemies', scale: 0.55, life: 900, max: 4 },
    heal: { sheet: 'vfx-2', row: 0, place: 'allies', scale: 0.48, life: 950 },
    sanctuary: { sheet: 'vfx-2', row: 1, place: 'allies', scale: 0.5, life: 1_050, alpha: 0.85 },
    judgment: { sheet: 'vfx-2', row: 2, place: 'enemies', scale: 0.6, life: 950, max: 4, color: '#fff1a6' },
    'arrow-rain': { sheet: 'vfx-3', row: 0, place: 'pack', scale: 0.72, life: 950, color: '#b6f07a' },
    pierce: { sheet: 'vfx-3', row: 1, place: 'flight', scale: 0.5, life: 420 },
    volley: { sheet: 'vfx-3', row: 1, place: 'flight', scale: 0.3, life: 360 },
    whirlwind: { sheet: 'vfx-3', row: 2, place: 'caster', scale: 0.55, life: 700 },
    earthshatter: { sheet: 'vfx-4', row: 0, place: 'enemies', scale: 0.6, life: 850, max: 4, color: '#e8b84b' },
    // Wards stay see-through so the party shows inside them.
    bulwark: { sheet: 'vfx-4', row: 1, place: 'party', scale: 0.9, life: 1_150, alpha: 0.75 },
    overclock: { sheet: 'vfx-5', row: 0, place: 'allies', scale: 0.4, life: 1_000 },
    anthem: { sheet: 'vfx-5', row: 1, place: 'allies', scale: 0.42, life: 1_100 },
    // The same song in a crimson key: might instead of haste.
    crescendo: { sheet: 'vfx-5', row: 1, place: 'allies', scale: 0.42, life: 1_100, filter: 'hue-rotate(-45deg) saturate(1.4)' },
    finale: { sheet: 'vfx-5', row: 2, place: 'pack', scale: 0.85, life: 1_250, color: '#ffd166' },
    bash: { sheet: 'vfx-6', row: 0, place: 'enemy', scale: 0.5, life: 450 },
  };
  const VFX_SHEETS = ['vfx-1', 'vfx-2', 'vfx-3', 'vfx-4', 'vfx-5', 'vfx-6'];
  // Rockets in flight, by projectile id, with where they are headed: each bursts when it lands.
  const rockets = new Map<string, number>();
  let effects: Effect[] = [];
  let bannerId = 0;

  // When each sheet arrived: heroes and monsters fade in instead of popping up.
  const loadedAt = new Map<string, number>();
  const FADE_MS = 220;

  function atlas(id: string): Atlas | null {
    if (!atlases.has(id)) {
      atlases.set(id, null);
      void loadAtlas(id).then((loaded) => {
        atlases.set(id, loaded);
        loadedAt.set(id, performance.now());
      });
    }
    return atlases.get(id) ?? null;
  }

  function fadeIn(sheet: Atlas, now: number): number {
    const at = loadedAt.get(sheet.id);
    return at === undefined ? 1 : Math.max(0, Math.min(1, (now - at) / FADE_MS));
  }

  /** The hero's outfit for its gear tier, falling back to the adept look while it loads. */
  function heroAtlas(classId: HeroClassId, tier: number): Atlas | null {
    const base = atlas(`hero-${classId}`);
    if (tier === 2) return base;
    return atlas(`hero-${classId}-t${tier}`) ?? base;
  }

  function monsterName(id: MonsterId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.monster_${id.replace(/-/g, '_')}`]?.() ?? id;
  }

  function biomeName(id: BiomeId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.biome_${id.replace(/-/g, '_')}`]?.() ?? id;
  }

  function difficultyLabel(difficulty: Difficulty): string {
    return adventureCatalog(localeState.current).difficulties[difficulty];
  }

  function stageLabel(target: StagePosition): string {
    return `${target.act}-${target.stage}`;
  }

  /** Shows a short line over the strip; the page uses it too (loot, levels, pets). */
  export function announce(text: string, tone: 'gold' | 'danger' | 'info' | 'loot' = 'info', color?: string) {
    const id = ++bannerId;
    banners = [...banners.slice(-3), { id, tone, text, color }];
    setTimeout(() => { banners = banners.filter((entry) => entry.id !== id); }, tone === 'loot' ? 4_800 : 3_600);
  }

  function heroX(heroId: string): number | null {
    return world.heroes.find((hero) => hero.id === heroId)?.x ?? null;
  }

  function spell(sheet: string, row: number, x: number, scale: number, life: number, extra: Partial<Effect> = {}) {
    effects.push({ kind: 'spell', sheet, row, x, y: 0, t: 0, life, scale, ...extra });
  }

  /** Plays an active skill's look where it lands. */
  function castLook(action: ActiveAction, casterX: number) {
    const look = SPELLS[action];
    if (!look) return;
    // The spell resolved before the screen hears of it: monsters it just felled still count.
    const foes = world.enemies.filter((enemy) => enemy.pose !== 'dying' || enemy.poseMs < 120).sort((a, b) => a.x - b.x);
    const allies = world.heroes.filter((hero) => hero.fallenMs <= 0);
    const extra: Partial<Effect> = { filter: look.filter, alpha: look.alpha };
    const middle = (xs: number[], fallback: number) => (xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : fallback);
    switch (look.place) {
      case 'enemies':
        // A burst on each monster, a beat apart.
        foes.slice(0, look.max ?? 4).forEach((enemy, index) => spell(look.sheet, look.row, enemy.x, look.scale * (enemy.boss ? 1.25 : 1), look.life, { ...extra, t: -index * 90 }));
        break;
      case 'enemy':
        if (foes[0]) spell(look.sheet, look.row, foes[0].x - 8, look.scale, look.life, extra);
        break;
      case 'pack':
        spell(look.sheet, look.row, middle(foes.map((enemy) => enemy.x), casterX + 90), look.scale, look.life, extra);
        break;
      case 'allies':
        allies.forEach((hero, index) => spell(look.sheet, look.row, hero.x, look.scale, look.life, { ...extra, t: -index * 60 }));
        break;
      case 'party':
        spell(look.sheet, look.row, middle(allies.map((hero) => hero.x), casterX), look.scale, look.life, extra);
        break;
      case 'caster':
        spell(look.sheet, look.row, casterX, look.scale, look.life, extra);
        break;
      case 'flight': {
        const targets = action === 'volley' ? foes.slice(0, 3) : foes.slice(0, 1);
        targets.forEach((enemy, index) => spell(look.sheet, look.row, casterX + 10, look.scale, look.life, { ...extra, toX: enemy.x, y: index * 7, t: -index * 70 }));
        break;
      }
    }
    // Spells that strike the whole field also send a shockwave along the ground.
    if (look.color) effects.push({ kind: 'ring', x: middle(foes.map((enemy) => enemy.x), casterX + 90), y: 0, t: 0, life: 700, color: look.color });
  }

  /** What the world tells the screen: effects and sounds. */
  function react(events: AdventureEvent[]) {
    for (const event of events) {
      switch (event.type) {
        case 'hit': {
          // Spread so a burst of hits stays readable instead of stacking digits.
          effects.push({ kind: 'number', x: event.x, y: Math.random() * 14, t: 0, life: 800, text: compact(event.amount), critical: event.critical, vx: (Math.random() - 0.5) * 48, color: event.skill ? '#9fe3ff' : undefined });
          effects.push({ kind: 'spark', x: event.x, y: 0, t: 0, life: 220 });
          playSound(event.critical ? 'critical' : 'hit');
          break;
        }
        case 'attack':
          if (event.attack === 'melee') {
            const target = world.enemies.find((enemy) => enemy.id === event.targetId);
            if (target) effects.push({ kind: 'slash', x: target.x - 6, y: 0, t: 0, life: 200 });
          }
          playAttack(event.attack);
          break;
        case 'special':
          playSpell(event.action);
          castLook(event.action, event.x);
          break;
        case 'heal':
          // Healing shows as rising green numbers over each ally it reaches.
          if (event.amount >= 1) {
            const x = heroX(event.heroId);
            if (x !== null) effects.push({ kind: 'number', x, y: Math.random() * 10, t: 0, life: 900, text: `+${compact(event.amount)}`, color: '#7ef08a', vx: 0 });
          }
          break;
        case 'hero-up': {
          const x = heroX(event.heroId);
          if (x !== null) spell('vfx-6', 2, x, 0.5, 1_000);
          playSound('revive');
          break;
        }
        case 'power':
          playSound('power');
          // Item powers, smaller than the skills they echo.
          switch (event.power) {
            case 'starfall': spell('vfx-1', 0, event.x, 0.36, 750); break;
            case 'frostbite': spell('vfx-1', 1, event.x, 0.28, 600); break;
            case 'cleave': effects.push({ kind: 'slash', x: event.x + 12, y: 0, t: 0, life: 220 }); break;
            case 'chain':
            case 'thorns': effects.push({ kind: 'spark', x: event.x, y: 0, t: 0, life: 260 }); break;
            case 'aegis': spell('vfx-4', 1, event.x, 0.32, 700, { alpha: 0.7 }); break;
            case 'arcane-surge': spell('vfx-1', 2, event.x, 0.24, 500); break;
            case 'dawn': spell('vfx-6', 1, event.x, 0.4, 900); break;
          }
          break;
        case 'kill': {
          for (let index = 0; index < Math.min(6, 1 + Math.floor(Math.log2(event.gold + 1))); index += 1) {
            effects.push({ kind: 'coin', x: event.x, y: 0, t: 0, life: 900, vx: (Math.random() - 0.3) * 60, vy: -60 - Math.random() * 50 });
          }
          pendingGold += event.gold;
          playSound(event.boss ? 'quest' : 'kill');
          if (event.boss) announce(m['adventure.boss_down']({ name: monsterName(event.monsterId) }), 'gold');
          break;
        }
        case 'chest':
          pendingChests += 1;
          effects.push({ kind: 'chest', x: event.x, y: 0, t: 0, life: 1_900, frame: CHEST_FRAME[event.tier] });
          playSound('chest');
          break;
        case 'wave':
          if (event.boss) {
            const bossEnemy = world.enemies.find((enemy) => enemy.boss);
            if (bossEnemy) announce(m['adventure.boss_appears']({ name: monsterName(bossEnemy.monsterId) }), 'danger');
            playSound('boss');
          }
          break;
        case 'stage-clear':
          effects.push({ kind: 'portal', x: world.frontX + 120, y: 0, t: 0, life: 2_400 });
          announce(event.actClear ? m['adventure.chapter_clear']({ place: biomeName(biomeOf(event.position).id) }) : m['adventure.stage_clear']({ stage: stageLabel(event.position) }), 'gold');
          break;
        case 'difficulty-open': {
          const difficulty = difficultyLabel(event.difficulty);
          announce(event.travelling ? m['adventure.difficulty_onward']({ difficulty }) : m['adventure.difficulty_open']({ difficulty }), 'gold');
          break;
        }
        case 'stage-fail':
          announce(m['adventure.stage_failed']({ stage: stageLabel(event.position) }), 'danger');
          playSound('fail');
          break;
        case 'hero-down': {
          effects.push({ kind: 'puff', x: event.x, y: 0, t: 0, life: 500 });
          playSound('down');
          break;
        }
        case 'quest':
          effects.push({ kind: 'chest', x: world.frontX + 30, y: 0, t: 0, life: 2_600, frame: CHEST_FRAME.quest });
          announce(event.title ? m['adventure.quest_named']({ title: event.title.slice(0, 60) }) : m['adventure.quest'](), 'gold');
          playSound('quest');
          break;
        case 'join': {
          // A guild hero swapping back into the formation is not news; its first entrance is.
          const label = labels[event.heroId];
          const fresh = !greeted.has(event.heroId);
          greeted.add(event.heroId);
          if (label && fresh && world.timeMs > 500) { announce(m['adventure.joined']({ name: label.name }), 'info'); playSound('join'); }
          break;
        }
        case 'leave':
          effects.push({ kind: 'puff', x: event.x, y: 0, t: 0, life: 500 });
          break;
      }
    }
  }

  const CHEST_FRAME: Record<ChestTier, number> = { white: 0, blue: 1, red: 2, quest: 3 };

  function compact(value: number): string {
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
    return String(value);
  }

  /** A finished task, from the page: a strike from above on every monster. */
  export function quest(title: string | null) {
    react(completeQuest(world, title));
  }

  /** Hands the battle's results to the page for the server, and forgets them locally. */
  export function drain(): PendingReport & { position: StagePosition; wave: number } {
    const report = drainReport(world);
    pendingChests = 0;
    pendingGold = 0;
    return { ...report, position: { ...world.position }, wave: world.wave };
  }

  /** New rules from the server, or a trip through the portal. */
  export function configure(next: Partial<SimRules>, travelTo?: StagePosition) {
    configureAdventure(world, next, travelTo);
    hud = { position: { ...world.position }, wave: world.wave };
  }

  /** A hero levelled up (the server said so). */
  export function levelUp(heroId: string) {
    const x = heroX(heroId);
    if (x === null) return;
    spell('vfx-6', 1, x, 0.55, 1_300);
    playSound('level-up');
  }

  /** Items arrived (auto-opened chests, quests): a beam of their rarity's color. */
  export function loot(rarities: Rarity[]) {
    const best = [...rarities].sort((a, b) => rarityIndex(b) - rarityIndex(a))[0];
    if (!best || rarityIndex(best) < 2) return;
    effects.push({ kind: 'beam', x: world.frontX + 20, y: 0, t: 0, life: 2_200, color: RARITY_RULES[best].color });
    playSound('loot');
  }

  // Scenery: props placed by a seeded hash of each slot of road, per biome.
  function slotHash(slot: number, salt: number): number {
    let value = Math.imul(slot ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }

  function drawScenery(context: CanvasRenderingContext2D, cameraX: number, groundY: number, biome: BiomeId) {
    const props = atlas(`biome-${biome}-props`);
    if (props?.frames.length) {
      const big = props.frames.map((frame, index) => ({ index, h: frame.h })).sort((a, b) => b.h - a.h);
      const tall = big.slice(0, Math.ceil(big.length / 2)).map((entry) => entry.index);
      const small = big.slice(Math.ceil(big.length / 2)).map((entry) => entry.index);
      // Back layer: tall props, slower, a little hazed.
      const backOffset = cameraX * 0.6;
      const backSlot = 150;
      context.save();
      context.globalAlpha = 0.85;
      context.filter = 'brightness(0.78) saturate(0.85)';
      for (let slot = Math.floor(backOffset / backSlot) - 2; slot <= Math.floor((backOffset + viewWidth) / backSlot) + 2; slot += 1) {
        if (slotHash(slot, 11) < 0.35) continue;
        const frame = tall[Math.floor(slotHash(slot, 23) * tall.length)];
        const x = slot * backSlot - backOffset + slotHash(slot, 37) * 60;
        drawFrame(context, props, frame, x, groundY + 2, ART_SCALE * 0.9, slotHash(slot, 41) < 0.5);
      }
      context.restore();
      context.filter = 'none';
      drawGround(context, cameraX, groundY, biome);
      // Front layer: small props at the party's pace.
      const frontSlot = 96;
      for (let slot = Math.floor(cameraX / frontSlot) - 2; slot <= Math.floor((cameraX + viewWidth) / frontSlot) + 2; slot += 1) {
        if (slotHash(slot, 53) < 0.45) continue;
        const frame = small[Math.floor(slotHash(slot, 67) * small.length)];
        const x = slot * frontSlot - cameraX + slotHash(slot, 71) * 40;
        drawFrame(context, props, frame, x, groundY + 3, ART_SCALE * 0.8, slotHash(slot, 79) < 0.5);
      }
    } else {
      drawGround(context, cameraX, groundY, biome);
    }
  }

  function drawGround(context: CanvasRenderingContext2D, cameraX: number, groundY: number, biome: BiomeId) {
    const ground = atlas(`biome-${biome}-ground`);
    const frame = ground?.frames[0];
    if (!ground || !frame) {
      context.fillStyle = '#2d2a20';
      context.fillRect(0, groundY, viewWidth, GROUND + 4);
      return;
    }
    const tileWidth = frame.w * ART_SCALE;
    const tileHeight = frame.h * ART_SCALE;
    const top = groundY - Math.round(tileHeight * 0.18);
    for (let x = -((cameraX % tileWidth) + tileWidth) % tileWidth; x < viewWidth; x += tileWidth) {
      context.drawImage(ground.image, frame.x, frame.y, frame.w, frame.h, Math.floor(x), top, Math.ceil(tileWidth) + 1, tileHeight);
    }
  }

  const HERO_ANIMATION: Record<string, string> = { walk: 'walk', idle: 'idle', attack: 'attack', special: 'special', hurt: 'hurt', rest: 'rest', alert: 'alert', victory: 'victory', stunned: 'stunned', fallen: 'rest' };

  function drawBar(context: CanvasRenderingContext2D, x: number, y: number, width: number, ratio: number, color: string) {
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.fillRect(x - width / 2, y, width, 3);
    context.fillStyle = color;
    context.fillRect(x - width / 2, y, width * Math.max(0, Math.min(1, ratio)), 3);
  }

  function render(context: CanvasRenderingContext2D, now: number) {
    const groundY = viewHeight - GROUND;
    const anchor = Math.round(viewWidth * 0.36);
    const cameraX = world.frontX - anchor;
    const toScreen = (x: number) => x - cameraX;
    context.clearRect(0, 0, viewWidth, viewHeight);
    context.imageSmoothingEnabled = true;
    const biome = biomeOf(world.position).id;
    if (scenery === 'full') drawScenery(context, cameraX, groundY, biome);
    else {
      // Minimal: a thin gilded line to stand on, the desktop showing through.
      context.fillStyle = 'rgba(23, 20, 15, 0.35)';
      context.fillRect(0, groundY + 1, viewWidth, 3);
      context.fillStyle = 'rgba(232, 184, 75, 0.6)';
      context.fillRect(0, groundY, viewWidth, 1);
    }

    const fx = atlas('fx-effects');
    const camp = atlas('fx-camp');
    const misc = atlas('icons-misc');

    // Camp: the party gathers around a fire when nobody is working.
    if (world.mode === 'camp' && world.heroes.length) {
      const fireX = toScreen(world.frontX - (world.heroes.length * HERO_SPACING) / 2 + 10);
      if (camp) {
        // The tent behind the last hero, the fire in the middle of the party.
        drawFrame(context, camp, 4, toScreen(world.frontX - world.heroes.length * HERO_SPACING - 6), groundY + 2, ART_SCALE * 0.85);
        drawFrame(context, camp, Math.floor(now / 140) % 4, fireX, groundY + 2, ART_SCALE * 0.7);
      }
    }
    for (const turret of world.turrets) if (fx) drawFrame(context, fx, 5, toScreen(turret.x), groundY + 1, ART_SCALE * 0.75);

    // The active pet trots behind the last hero.
    if (activePet && world.heroes.length) {
      const pet = PETS_BY_ID[activePet];
      const sheet = atlas(pet.sprite.atlas);
      if (sheet) {
        const last = Math.min(...world.heroes.map((hero) => hero.x));
        const moving = world.mode === 'march';
        const frame = pet.sprite.row * 6 + (moving ? Math.floor(now / 110) % 6 : Math.floor(now / 400) % 2);
        drawFrame(context, sheet, frame, toScreen(last - 30), groundY + 2 + (moving ? 0 : Math.round(Math.sin(now / 300))), ART_SCALE);
      }
    }

    // Characters, back to front.
    hitBoxes = [];
    const heroes = [...world.heroes].sort((a, b) => a.x - b.x);
    for (const hero of heroes) {
      const label = labels[hero.id];
      const sprite = heroAtlas(hero.classId, label?.visualTier ?? 2);
      const x = toScreen(hero.x);
      const fallen = hero.fallenMs > 0;
      const bob = hero.pose === 'idle' || hero.pose === 'alert' ? Math.round(Math.sin(now / 320 + hero.x) * 0.8) : 0;
      const joining = Math.min(1, (world.timeMs - hero.joinedMs) / 400);
      // The weapon's rarity shows as a glow around the hero (rare and above).
      const glow = label?.weaponRarity && rarityIndex(label.weaponRarity) >= 2 && !fallen ? RARITY_RULES[label.weaponRarity].color : null;
      if (glow) {
        const pulse = 0.18 + 0.08 * Math.sin(now / 420 + hero.x) + rarityIndex(label!.weaponRarity!) * 0.02;
        const gradient = context.createRadialGradient(x, groundY - 28, 2, x, groundY - 28, 30);
        gradient.addColorStop(0, `${glow}${Math.round(pulse * 255).toString(16).padStart(2, '0')}`);
        gradient.addColorStop(1, `${glow}00`);
        context.fillStyle = gradient;
        context.fillRect(x - 32, groundY - 60, 64, 64);
      }
      context.globalAlpha = (hero.activity === 'offline' ? 0.6 : 1) * joining * (fallen ? 0.75 : 1);
      if (fallen) context.filter = 'grayscale(1) brightness(0.75)';
      let box: { left: number; top: number; width: number; height: number };
      if (sprite) {
        context.globalAlpha *= fadeIn(sprite, now);
        box = drawFrame(context, sprite, animationFrame(sprite, HERO_ANIMATION[hero.pose] ?? 'idle', hero.pose === 'walk' || hero.pose === 'idle' ? now : hero.poseMs), x, groundY + 2 + bob, ART_SCALE);
      } else {
        // Its sheet is still on the way: nothing to draw yet, but the hero can be pointed at.
        box = { left: x - 10, top: groundY - 50, width: 20, height: 50 };
      }
      context.filter = 'none';
      context.globalAlpha = 1;
      if (hero.shield > 0) {
        // A faint, breathing ward: visible without boxing the hero in.
        context.strokeStyle = `rgba(255, 220, 120, ${0.22 + Math.sin(now / 260) * 0.08})`;
        context.fillStyle = 'rgba(255, 220, 120, 0.06)';
        context.lineWidth = 1;
        context.beginPath();
        context.ellipse(x, box.top + box.height * 0.55, box.width * 0.42, box.height * 0.58, 0, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
      if (fallen) {
        // How long until it gets back up.
        const share = 1 - hero.fallenMs / Math.max(1, world.rules.reviveMs);
        context.strokeStyle = 'rgba(244, 234, 210, 0.85)';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, box.top - 6, 5, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
        context.stroke();
      } else if (hero.hp < hero.profile.maxHp && world.mode !== 'camp') {
        drawBar(context, x, box.top - 5, 22, hero.hp / hero.profile.maxHp, hero.hp / hero.profile.maxHp > 0.35 ? '#62d26f' : '#e8574b');
      }
      // A hero whose agent is at work fights inspired: golden motes rise around it.
      if (hero.activity === 'working' && world.mode !== 'camp' && !fallen) {
        context.fillStyle = '#ffd877';
        for (let mote = 0; mote < 3; mote += 1) {
          const cycle = ((now / 900 + mote / 3 + hero.x * 0.013) % 1 + 1) % 1;
          context.globalAlpha = Math.sin(cycle * Math.PI) * 0.85;
          context.fillRect(Math.round(x - 9 + mote * 9 + Math.sin(now / 400 + mote) * 2), Math.round(box.top + box.height * 0.8 - cycle * box.height * 0.9), 2, 2);
        }
        context.globalAlpha = 1;
      }
      // A hero with something for the owner raises a "!" balloon.
      if ((hero.activity === 'attention' || (label?.asks ?? 0) > 0) && camp && !fallen) {
        drawFrame(context, camp, 6, x + 4, box.top + 2 + Math.round(Math.sin(now / 200) * 2), ART_SCALE * 0.45);
      } else if (hero.pose === 'rest' && camp) {
        context.globalAlpha = 0.5 + 0.5 * Math.sin(now / 600 + hero.x);
        drawFrame(context, camp, 7, x + 10, box.top + 4, ART_SCALE * 0.32);
        context.globalAlpha = 1;
      }
      hitBoxes.push({ id: hero.id, ...box });
      if (hovered === hero.id && label) {
        context.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        const text = `${label.agentTitle ? `${label.name} (${label.agentTitle})` : label.name} · ${heroLevelText(label.level, label.paragon)}`;
        const textWidth = context.measureText(text).width + 10;
        context.fillStyle = 'rgba(23, 20, 15, 0.86)';
        context.beginPath();
        context.roundRect(x - textWidth / 2, box.top - 22, textWidth, 14, 4);
        context.fill();
        context.fillStyle = '#f4ead2';
        context.textAlign = 'center';
        context.fillText(text, x, box.top - 12);
      }
    }

    const enemies = [...world.enemies].sort((a, b) => b.x - a.x);
    for (const enemy of enemies) {
      const sprite = atlas(`monster-${enemy.monsterId}`);
      const x = toScreen(enemy.x);
      if (x < -120 || x > viewWidth + 160) continue;
      const pose = enemy.stunMs > 0 ? 'hurt' : enemy.pose;
      context.globalAlpha = enemy.pose === 'dying' ? Math.max(0, 1 - enemy.poseMs / 600) : 1;
      // Elites are bigger and tinted; frozen monsters turn blue.
      const scale = ART_SCALE * (enemy.elite ? 1.3 : 1);
      if (enemy.elite) context.filter = 'saturate(1.6) hue-rotate(-20deg) drop-shadow(0 0 3px rgba(255, 120, 60, 0.8))';
      if (enemy.stunMs > 0 && enemy.pose !== 'dying') context.filter = 'hue-rotate(180deg) saturate(0.7) brightness(1.15)';
      let top = groundY - 30;
      if (sprite) {
        context.globalAlpha *= fadeIn(sprite, now);
        const box = drawFrame(context, sprite, animationFrame(sprite, pose, pose === 'move' ? now + enemy.x * 13 : enemy.poseMs, 'move'), x, groundY + 2, scale);
        top = box.top;
      } else {
        top = groundY - (enemy.boss ? 60 : 24);
      }
      context.filter = 'none';
      context.globalAlpha = 1;
      if (!enemy.boss && enemy.hp < enemy.maxHp && enemy.pose !== 'dying') drawBar(context, x, top - 6, enemy.elite ? 36 : 24, enemy.hp / enemy.maxHp, '#e8574b');
    }

    // Rockets that landed since the last frame burst where they were headed.
    const vfxRockets = atlas('vfx-4');
    for (const [rocketId, targetX] of rockets) {
      if (world.projectiles.some((projectile) => projectile.id === rocketId)) continue;
      rockets.delete(rocketId);
      effects.push({ kind: 'spell', sheet: 'vfx-4', row: 2, x: targetX, y: 0, t: 0, life: 420, scale: 0.42, frame: 3 });
    }

    // Projectiles fly in a slight arc to their target.
    for (const projectile of world.projectiles) {
      const target = world.enemies.find((enemy) => enemy.id === projectile.targetId);
      if (!target || !fx || projectile.progress < 0) continue;
      const fromX = toScreen(projectile.fromX);
      const toX = toScreen(target.x);
      const t = Math.min(1, projectile.progress);
      const x = fromX + (toX - fromX) * t;
      const arc = projectile.kind === 'arrow' || projectile.kind === 'note' || projectile.kind === 'rocket' ? Math.sin(t * Math.PI) * (projectile.kind === 'rocket' ? 34 : 14) : 4;
      if (projectile.kind === 'rocket' && vfxRockets) {
        rockets.set(projectile.id, target.x);
        drawFrame(context, vfxRockets, 12 + (Math.floor(now / 90) % 3), x, groundY - 20 - arc, 0.26);
        continue;
      }
      const frame = { note: 0, bolt: 1, arrow: 2, cog: 3, smite: 4, turret: 3, rocket: 3, melee: 6 }[projectile.kind] ?? 6;
      drawFrame(context, fx, frame, x, groundY - 26 - arc, ART_SCALE * (projectile.kind === 'turret' ? 0.35 : 0.5));
    }

    // Transient effects.
    const dt = 16;
    effects = effects.filter((effect) => effect.t < effect.life);
    for (const effect of effects) {
      effect.t += dt;
      const x = toScreen(effect.x);
      const life = effect.t / effect.life;
      switch (effect.kind) {
        case 'number': {
          context.font = `${effect.critical ? 800 : 700} ${effect.critical ? 13 : 10}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          context.textAlign = 'center';
          context.lineWidth = 3;
          context.strokeStyle = 'rgba(23, 20, 15, 0.9)';
          context.fillStyle = effect.critical ? '#ffd166' : effect.color ?? '#fff6e0';
          const y = groundY - 44 - effect.y - life * 26;
          context.globalAlpha = 1 - Math.max(0, life - 0.6) / 0.4;
          context.strokeText(effect.text ?? '', x + (effect.vx ?? 0) * life, y);
          context.fillText(effect.text ?? '', x + (effect.vx ?? 0) * life, y);
          context.globalAlpha = 1;
          break;
        }
        case 'spark':
          if (fx) { context.globalAlpha = 1 - life; drawFrame(context, fx, 6, x, groundY - 14, ART_SCALE * 0.45); context.globalAlpha = 1; }
          break;
        case 'slash':
          if (fx) { context.globalAlpha = 1 - life; drawFrame(context, fx, 7, x, groundY - 8, ART_SCALE * 0.5); context.globalAlpha = 1; }
          break;
        case 'coin': {
          const seconds = effect.t / 1000;
          const cx = x + (effect.vx ?? 0) * seconds;
          const cy = Math.min(groundY, groundY - 20 + (effect.vy ?? -60) * seconds + 220 * seconds * seconds);
          if (fx) { context.globalAlpha = 1 - Math.max(0, life - 0.7) / 0.3; drawFrame(context, fx, 8, cx, cy, ART_SCALE * 0.25); context.globalAlpha = 1; }
          break;
        }
        case 'spell': {
          // Waiting its turn in a staggered burst.
          if (effect.t < 0) break;
          const sheet = atlas(effect.sheet ?? '');
          if (!sheet) break;
          // Six frames over the effect's life; `frame` starts a row part-way (a rocket's burst).
          const first = effect.frame ?? 0;
          const frame = (effect.row ?? 0) * 6 + Math.min(5, first + Math.floor(life * (6 - first)));
          const flyX = effect.toX === undefined ? x : x + (toScreen(effect.toX) - x) * Math.min(1, life * 1.2);
          context.globalAlpha = (effect.alpha ?? 1) * (1 - Math.max(0, life - 0.85) / 0.15);
          if (effect.filter) context.filter = effect.filter;
          drawFrame(context, sheet, frame, flyX, groundY + 4 - (effect.toX === undefined ? 0 : 14 + effect.y), effect.scale ?? 0.5);
          context.filter = 'none';
          context.globalAlpha = 1;
          break;
        }
        case 'portal':
          if (camp) { context.globalAlpha = Math.sin(life * Math.PI); drawFrame(context, camp, 9, x, groundY + 2, ART_SCALE * 0.7); context.globalAlpha = 1; }
          break;
        case 'ring': {
          context.strokeStyle = effect.color ?? '#ffffff';
          context.globalAlpha = 0.8 * (1 - life);
          context.lineWidth = 3 * (1 - life) + 1;
          context.beginPath();
          context.ellipse(x, groundY - 10, 20 + life * 90, 6 + life * 22, 0, 0, Math.PI * 2);
          context.stroke();
          context.globalAlpha = 1;
          break;
        }
        case 'beam': {
          // A pillar of the loot's rarity color where the drop landed.
          const alpha = Math.sin(Math.min(1, life * 1.4) * Math.PI);
          const gradient = context.createLinearGradient(0, 0, 0, groundY);
          gradient.addColorStop(0, `${effect.color}00`);
          gradient.addColorStop(1, `${effect.color}cc`);
          context.globalAlpha = alpha;
          context.fillStyle = gradient;
          context.fillRect(x - 5, 0, 10, groundY);
          context.globalAlpha = 1;
          break;
        }
        case 'chest': {
          const icon = misc;
          const drop = Math.min(1, effect.t / 350);
          const bounce = drop < 1 ? (1 - drop) * 40 : Math.abs(Math.sin((effect.t - 350) / 90)) * Math.max(0, 6 - (effect.t - 350) / 60);
          context.globalAlpha = 1 - Math.max(0, life - 0.75) / 0.25;
          if (icon) drawFrame(context, icon, effect.frame ?? 0, x, groundY + 2 - bounce, ART_SCALE * 0.42);
          else if (fx) drawFrame(context, fx, 10, x, groundY + 2 - bounce, ART_SCALE * 0.45);
          context.globalAlpha = 1;
          break;
        }
        case 'puff':
          context.fillStyle = `rgba(244, 234, 210, ${0.5 * (1 - life)})`;
          context.beginPath();
          context.arc(x, groundY - 20, 8 + life * 14, 0, Math.PI * 2);
          context.fill();
          break;
      }
    }
  }

  /** Share native cursor samples and DOM movement without manufacturing a click. */
  export function hoverAt(point: { x: number; y: number } | null): HitBox | null {
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !point || point.x < rect.left || point.x >= rect.right || point.y < rect.top || point.y >= rect.bottom) {
      leave();
      return null;
    }
    if (hudMode === 'hover') {
      peek = true;
      if (peekTimer) clearTimeout(peekTimer);
      peekTimer = setTimeout(() => (peek = false), 2_500);
    }
    // Hit boxes live in the world's coordinates; the pointer comes in CSS pixels.
    const x = (point.x - rect.left) / scale;
    const y = (point.y - rect.top) / scale;
    const hit = [...hitBoxes].reverse().find((box) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height);
    const id = hit?.id ?? null;
    if (id !== hovered) {
      hovered = id;
      onHover?.(id);
    }
    return hit ?? null;
  }

  function pointer(event: PointerEvent) {
    const hit = hoverAt({ x: event.clientX, y: event.clientY });
    const rect = canvas?.getBoundingClientRect();
    if (event.type === 'pointerdown' && hit && rect) {
      onSelect?.(hit.id, { left: hit.left * scale + rect.left, top: hit.top * scale + rect.top, width: hit.width * scale, height: hit.height * scale });
    }
  }

  function leave() {
    if (hovered) { hovered = null; onHover?.(null); }
  }

  onMount(() => {
    const context = canvas?.getContext('2d');
    if (!context || !canvas || !host) return;
    for (const id of ['fx-effects', 'fx-camp', 'icons-misc', ...VFX_SHEETS]) atlas(id);
    const resize = () => {
      if (!canvas || !host) return;
      const ratio = window.devicePixelRatio || 1;
      width = host.clientWidth;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Drawn at the device's resolution times the strip's size: larger, never blurrier.
      context.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
      viewWidth = width / scale;
      viewHeight = height / scale;
    };
    resizeCanvas = resize;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    let lastHud = 0;
    const loop = (now: number) => {
      carry += Math.min(1_000, now - last);
      last = now;
      while (carry >= TICK_MS) {
        carry -= TICK_MS;
        react(stepAdventure(world, party, TICK_MS, { teamActive, supporters }));
      }
      // Preload what the party and the road will need.
      for (const hero of world.heroes) heroAtlas(hero.classId, labels[hero.id]?.visualTier ?? 2);
      for (const enemy of world.enemies) atlas(`monster-${enemy.monsterId}`);
      if (activePet) atlas(PETS_BY_ID[activePet].sprite.atlas);
      const biome = biomeOf(world.position).id;
      atlas(`biome-${biome}-props`);
      atlas(`biome-${biome}-ground`);
      render(context, now);
      mode = world.mode;
      const bossEnemy = world.enemies.find((enemy) => enemy.boss && enemy.pose !== 'dying');
      // The soundtrack follows the party: by the fire, on the road, against an elite wave or a boss.
      const mood: MusicMood = world.mode === 'camp' ? 'camp' : bossEnemy ? 'boss' : world.enemies.some((enemy) => enemy.elite && enemy.pose !== 'dying') ? 'battle' : 'march';
      if (mood !== musicMood) { musicMood = mood; setMusic(mood); }
      boss = bossEnemy ? { name: monsterName(bossEnemy.monsterId), hp: bossEnemy.hp, max: bossEnemy.maxHp } : null;
      if (now - lastHud > 500) {
        lastHud = now;
        hud = { position: { ...world.position }, wave: world.wave };
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      setMusic(null);
    };
  });

  // A new size: the canvas follows.
  $effect(() => {
    void height;
    void scale;
    resizeCanvas?.();
  });

  const place = $derived(biomeOf(hud.position));
  const region = $derived(regionLevel(hud.position));
  const shownGold = $derived(gold + pendingGold);
  const shownChests = $derived(chests + pendingChests);
</script>

<div class="stage" bind:this={host} style:height={`${height}px`} data-mode={mode} data-hud={hudMode} class:peek data-testid="adventure-stage">
  <canvas bind:this={canvas} onpointermove={pointer} onpointerdown={pointer} onpointerleave={leave} class:pointing={hovered !== null}></canvas>
  <div class="hud" data-adventure-interactive>
    {#if draggable}
      <span class="grip" title={m['adventure.drag_strip']()} aria-label={m['adventure.drag_strip']()} role="img"><GripVertical size={13} aria-hidden="true" /></span>
    {/if}
    <span class="place">{biomeName(place.id)} · {stageLabel(hud.position)}</span>
    {#if difficultyName && hud.position.difficulty !== 'normal'}<span class="difficulty">{difficultyName}</span>{/if}
    <span class="wave">{m['adventure.wave']({ wave: Math.min(hud.wave + 1, WAVES_PER_STAGE), total: WAVES_PER_STAGE })}</span>
    <span class="region" title={m['adventure.region_level_hint']()}>{m['adventure.region_level']({ level: region })}</span>
    <span class="gold" title={m['adventure.gold']()}><span class="coin" aria-hidden="true"></span>{compact(shownGold)}</span>
    {#if onOpenCamp}
      <button type="button" class="camp-button" onclick={onOpenCamp} title={m['adventure.open_camp']()} aria-label={m['adventure.open_camp']()} data-testid="adventure-open-camp">
        <span class="chest-icon" aria-hidden="true"></span>
        {#if shownChests > 0}<span class="badge">{shownChests}</span>{/if}
        <span>{m['adventure.camp_short']()}</span>
      </button>
    {/if}
    {#if supporters.length && mode !== 'camp'}<span class="support" title={m['adventure.supporters_hint']()}>{m['adventure.supporters']({ count: supporters.length })}</span>{/if}
    {#if mode === 'camp'}<span class="camp">{m['adventure.camping']()}</span>{/if}
    {#if moved && onResetPosition}
      <button type="button" class="dock-button" onclick={onResetPosition} title={m['adventure.back_to_dock']()} aria-label={m['adventure.back_to_dock']()} data-testid="adventure-back-to-dock">
        <ArrowDownToLine size={13} aria-hidden="true" />
      </button>
    {/if}
  </div>
  {#if boss}
    <div class="boss" role="status">
      <span>{boss.name}</span>
      <span class="boss-bar"><span style:width={`${Math.max(0, Math.round((boss.hp / boss.max) * 100))}%`}></span></span>
    </div>
  {/if}
  <div class="banners" aria-live="polite">
    {#each banners as entry (entry.id)}<div class={`banner ${entry.tone}`} style:--loot={entry.color}>{entry.text}</div>{/each}
  </div>
</div>

<style>
  .stage {
    position: relative;
    width: 100%;
    overflow: visible;
    user-select: none;
  }

  canvas {
    position: absolute;
    left: 0;
    bottom: 0;
    image-rendering: auto;
  }

  canvas.pointing {
    cursor: pointer;
  }

  .hud {
    position: absolute;
    left: 12px;
    bottom: calc(100% - 22px);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 4px 3px 10px;
    border-radius: 999px;
    background: rgba(23, 20, 15, 0.78);
    box-shadow: 0 0 0 1px rgba(232, 184, 75, 0.35);
    color: #f4ead2;
    font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    transition: opacity 180ms ease-out;
  }

  /* Panel on hover: out of the way (and out of reach) until the pointer comes near. */
  .stage[data-hud='hover']:not(.peek) .hud {
    opacity: 0;
    pointer-events: none;
  }

  /* The grip drags the whole strip window (desktop only). */
  .grip {
    display: inline-flex;
    margin-left: -4px;
    color: rgba(244, 234, 210, 0.6);
    cursor: grab;
    -webkit-app-region: drag;
  }

  .dock-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: rgba(244, 234, 210, 0.1);
    color: #f4ead2;
    cursor: pointer;
  }

  .dock-button:hover {
    background: rgba(244, 234, 210, 0.22);
  }

  .dock-button:focus-visible {
    outline: 2px solid #e8b84b;
    outline-offset: 1px;
  }

  .place {
    color: #e8b84b;
  }

  .difficulty {
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(232, 87, 75, 0.25);
    color: #ffb3a8;
  }

  .wave,
  .region,
  .camp {
    color: rgba(244, 234, 210, 0.7);
    font-weight: 500;
  }

  .support {
    color: #ffd877;
    font-weight: 500;
  }

  .gold {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .coin {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #fff2b0, #e8b84b 55%, #8a6418);
    box-shadow: 0 0 0 1px #5e4410;
  }

  .camp-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px 2px 6px;
    border: 0;
    border-radius: 999px;
    background: rgba(232, 184, 75, 0.18);
    color: #ffe9b3;
    font: inherit;
    cursor: pointer;
  }

  .camp-button:hover {
    background: rgba(232, 184, 75, 0.32);
  }

  .camp-button:focus-visible {
    outline: 2px solid #e8b84b;
    outline-offset: 2px;
  }

  .chest-icon {
    width: 11px;
    height: 9px;
    border-radius: 2px 2px 1px 1px;
    background: linear-gradient(180deg, #c98b3c 0 45%, #8a5a22 45% 100%);
    box-shadow: inset 0 0 0 1px #4a2f10;
  }

  .badge {
    position: absolute;
    top: -6px;
    left: 10px;
    min-width: 14px;
    padding: 0 4px;
    border-radius: 999px;
    background: #e8574b;
    color: #fff;
    font-size: 11px;
    line-height: 14px;
    text-align: center;
  }

  .boss {
    position: absolute;
    left: 50%;
    bottom: calc(100% - 22px);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    border-radius: 999px;
    background: rgba(40, 10, 10, 0.82);
    box-shadow: 0 0 0 1px rgba(232, 87, 75, 0.5);
    color: #ffd9d3;
    font: 700 11px/1.2 ui-sans-serif, system-ui, sans-serif;
  }

  .boss-bar {
    position: relative;
    display: inline-block;
    width: 120px;
    height: 4px;
    border-radius: 2px;
    background: rgba(244, 234, 210, 0.18);
    overflow: hidden;
  }

  .boss-bar > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, #a1291f, #e8574b);
    transition: width 300ms ease-out;
  }

  .banners {
    position: absolute;
    right: 16px;
    bottom: calc(100% + 4px);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    pointer-events: none;
  }

  .banner {
    padding: 5px 12px;
    border-radius: 8px;
    background: rgba(23, 20, 15, 0.86);
    color: #f4ead2;
    font: 600 12px/1.3 ui-sans-serif, system-ui, sans-serif;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(244, 234, 210, 0.12);
    animation: banner-in 260ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }

  .banner.gold {
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(232, 184, 75, 0.6);
    color: #ffe9b3;
  }

  .banner.danger {
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(232, 87, 75, 0.6);
    color: #ffd2cc;
  }

  .banner.loot {
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--loot, #e8b84b);
    color: var(--loot, #ffe9b3);
  }

  @keyframes banner-in {
    from { opacity: 0; transform: translateY(6px) scale(0.96); }
  }

  @media (prefers-reduced-motion: reduce) {
    .banner { animation: none; }
  }
</style>
