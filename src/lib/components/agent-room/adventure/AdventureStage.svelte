<script lang="ts">
  import { onMount } from 'svelte';
  import { MONSTERS, stageOf, WAVES_PER_STAGE, levelFromXp, type BiomeId, type HeroClassId, type MonsterId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import {
    completeQuest,
    createAdventure,
    HERO_SPACING,
    progressOf,
    stepAdventure,
    type AdventureEvent,
    type AdventureProgress,
    type AdventureState,
    type PartyMember,
  } from '$lib/modules/agent-room/domain/adventure/simulation.js';
  import { animationFrame, drawFrame, loadAtlas, type Atlas } from './atlas.js';
  import { playSound, type AdventureSoundLevel } from './adventure-audio.js';
  import * as m from '$lib/paraglide/messages.js';

  type HeroLabel = { id: string; title: string; classId: HeroClassId; asks: number };
  type HitBox = { id: string; left: number; top: number; width: number; height: number };

  let {
    party,
    labels,
    progress,
    soundLevel = 'alerts',
    height = 150,
    onProgress,
    onSelect,
    onHover,
  }: {
    party: PartyMember[];
    /** Names and pending requests of each hero, for tags and the "!" balloon. */
    labels: Record<string, HeroLabel>;
    progress: AdventureProgress;
    soundLevel?: AdventureSoundLevel;
    /** Height of the playing field, in CSS pixels. */
    height?: number;
    onProgress?: (progress: AdventureProgress, reason: 'tick' | 'stage') => void;
    onSelect?: (heroId: string, box: { left: number; top: number; width: number; height: number }) => void;
    onHover?: (heroId: string | null) => void;
  } = $props();

  const TICK_MS = 50;
  // Atlases are drawn at half size: 2x art for crisp Retina pixels.
  const ART_SCALE = 0.5;
  const GROUND = 26;

  let host = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let width = $state(0);
  // svelte-ignore state_referenced_locally
  const world: AdventureState = createAdventure(progress, Date.now() & 0xffff);
  let hud = $state(progressOf(world));
  let mode = $state<AdventureState['mode']>('camp');
  let banners = $state<Array<{ id: number; tone: 'gold' | 'danger' | 'info'; text: string }>>([]);
  let boss = $state<{ name: string; hp: number; max: number } | null>(null);
  let hovered = $state<string | null>(null);
  let hitBoxes: HitBox[] = [];

  const atlases = new Map<string, Atlas | null>();
  type Effect = { kind: 'number' | 'spark' | 'slash' | 'coin' | 'gem' | 'pillar' | 'chest' | 'portal' | 'puff'; x: number; y: number; t: number; life: number; text?: string; critical?: boolean; vx?: number; vy?: number };
  let effects: Effect[] = [];
  let bannerId = 0;
  let lastSave = 0;

  const level = $derived(levelFromXp(hud.xp));
  const place = $derived(stageOf(hud.stageIndex));

  function atlas(id: string): Atlas | null {
    if (!atlases.has(id)) {
      atlases.set(id, null);
      void loadAtlas(id).then((loaded) => atlases.set(id, loaded));
    }
    return atlases.get(id) ?? null;
  }

  function monsterName(id: MonsterId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.monster_${id.replace(/-/g, '_')}`]?.() ?? id;
  }

  function biomeName(id: BiomeId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.biome_${id.replace(/-/g, '_')}`]?.() ?? id;
  }

  function banner(text: string, tone: 'gold' | 'danger' | 'info' = 'info') {
    const id = ++bannerId;
    banners = [...banners.slice(-2), { id, tone, text }];
    setTimeout(() => { banners = banners.filter((entry) => entry.id !== id); }, 3_600);
  }

  /** What the world tells the screen: effects, sounds and the save. */
  function react(events: AdventureEvent[]) {
    for (const event of events) {
      switch (event.type) {
        case 'hit': {
          // Spread so a burst of hits stays readable instead of stacking digits.
          effects.push({ kind: 'number', x: event.x, y: Math.random() * 14, t: 0, life: 800, text: String(event.amount), critical: event.critical, vx: (Math.random() - 0.5) * 48 });
          effects.push({ kind: 'spark', x: event.x, y: 0, t: 0, life: 220 });
          playSound('hit', soundLevel);
          break;
        }
        case 'attack':
          if (event.attack === 'melee') {
            const target = world.enemies.find((enemy) => enemy.id === event.targetId);
            if (target) effects.push({ kind: 'slash', x: target.x - 6, y: 0, t: 0, life: 200 });
            playSound('slash', soundLevel);
          }
          break;
        case 'special':
          playSound('special', soundLevel);
          break;
        case 'kill': {
          for (let index = 0; index < Math.min(6, 1 + Math.floor(event.gold / 3)); index += 1) {
            effects.push({ kind: 'coin', x: event.x, y: 0, t: 0, life: 900, vx: (Math.random() - 0.3) * 60, vy: -60 - Math.random() * 50 });
          }
          effects.push({ kind: 'gem', x: event.x, y: 0, t: 0, life: 700 });
          playSound(event.boss ? 'quest' : 'kill', soundLevel);
          if (event.boss) banner(m['adventure.boss_down']({ name: monsterName(event.monsterId) }), 'gold');
          break;
        }
        case 'wave':
          if (event.boss) {
            const bossEnemy = world.enemies.find((enemy) => enemy.boss);
            if (bossEnemy) banner(m['adventure.boss_appears']({ name: monsterName(bossEnemy.monsterId) }), 'danger');
            playSound('boss', soundLevel);
          }
          break;
        case 'stage-clear':
          effects.push({ kind: 'portal', x: world.frontX + 120, y: 0, t: 0, life: 2_400 });
          banner(event.chapterClear ? m['adventure.chapter_clear']({ place: biomeName(stageOf(event.stageIndex).biome.id) }) : m['adventure.stage_clear']({ stage: stageLabel(event.stageIndex) }), 'gold');
          onProgress?.(progressOf(world), 'stage');
          break;
        case 'level-up':
          effects.push({ kind: 'pillar', x: world.frontX - HERO_SPACING, y: 0, t: 0, life: 1_400 });
          banner(m['adventure.level_up']({ level: event.level }), 'gold');
          playSound('level-up', soundLevel);
          break;
        case 'quest':
          effects.push({ kind: 'chest', x: world.frontX + 30, y: 0, t: 0, life: 2_600 });
          banner(event.title ? m['adventure.quest_named']({ title: event.title.slice(0, 60) }) : m['adventure.quest'](), 'gold');
          playSound('quest', soundLevel);
          break;
        case 'join': {
          const label = labels[event.heroId];
          if (label && world.timeMs > 500) { banner(m['adventure.joined']({ name: label.title }), 'info'); playSound('join', soundLevel); }
          break;
        }
        case 'leave':
          effects.push({ kind: 'puff', x: event.x, y: 0, t: 0, life: 500 });
          break;
      }
    }
  }

  function stageLabel(stageIndex: number): string {
    const { chapter, stage, lap } = stageOf(stageIndex);
    return `${lap ? `${lap + 1}·` : ''}${chapter}-${stage}`;
  }

  /** A finished task, from the page: the quest pays and strikes every monster. */
  export function quest(title: string | null) {
    react(completeQuest(world, title));
    hud = progressOf(world);
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
      for (let slot = Math.floor(backOffset / backSlot) - 2; slot <= Math.floor((backOffset + width) / backSlot) + 2; slot += 1) {
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
      for (let slot = Math.floor(cameraX / frontSlot) - 2; slot <= Math.floor((cameraX + width) / frontSlot) + 2; slot += 1) {
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
      context.fillRect(0, groundY, width, GROUND + 4);
      return;
    }
    const tileWidth = frame.w * ART_SCALE;
    const tileHeight = frame.h * ART_SCALE;
    const top = groundY - Math.round(tileHeight * 0.18);
    for (let x = -((cameraX % tileWidth) + tileWidth) % tileWidth; x < width; x += tileWidth) {
      context.drawImage(ground.image, frame.x, frame.y, frame.w, frame.h, Math.floor(x), top, Math.ceil(tileWidth) + 1, tileHeight);
    }
  }

  const HERO_ANIMATION: Record<string, string> = { walk: 'walk', idle: 'idle', attack: 'attack', special: 'special', hurt: 'hurt', rest: 'rest', alert: 'alert', victory: 'victory', stunned: 'stunned' };

  function render(context: CanvasRenderingContext2D, now: number) {
    const groundY = height - GROUND;
    const anchor = Math.round(width * 0.36);
    const cameraX = world.frontX - anchor;
    const toScreen = (x: number) => x - cameraX;
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    const biome = stageOf(world.stageIndex).biome.id;
    drawScenery(context, cameraX, groundY, biome);

    const fx = atlas('fx-effects');
    const camp = atlas('fx-camp');

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

    // Characters, back to front.
    hitBoxes = [];
    const heroes = [...world.heroes].sort((a, b) => a.x - b.x);
    for (const hero of heroes) {
      const sprite = atlas(`hero-${hero.classId}`);
      const x = toScreen(hero.x);
      const bob = hero.pose === 'idle' || hero.pose === 'alert' ? Math.round(Math.sin(now / 320 + hero.x) * 0.8) : 0;
      const joining = Math.min(1, (world.timeMs - hero.joinedMs) / 400);
      context.globalAlpha = (hero.activity === 'offline' ? 0.6 : 1) * joining;
      let box: { left: number; top: number; width: number; height: number };
      if (sprite) {
        box = drawFrame(context, sprite, animationFrame(sprite, HERO_ANIMATION[hero.pose] ?? 'idle', hero.pose === 'walk' || hero.pose === 'idle' ? now : hero.poseMs), x, groundY + 2 + bob, ART_SCALE);
      } else {
        context.fillStyle = '#e8b84b';
        context.fillRect(x - 10, groundY - 50, 20, 50);
        box = { left: x - 10, top: groundY - 50, width: 20, height: 50 };
      }
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
      const label = labels[hero.id];
      // A hero with something for the owner raises a "!" balloon.
      if ((hero.activity === 'attention' || (label?.asks ?? 0) > 0) && camp) {
        drawFrame(context, camp, 6, x + 4, box.top + 2 + Math.round(Math.sin(now / 200) * 2), ART_SCALE * 0.45);
      } else if (hero.pose === 'rest' && camp) {
        context.globalAlpha = 0.5 + 0.5 * Math.sin(now / 600 + hero.x);
        drawFrame(context, camp, 7, x + 10, box.top + 4, ART_SCALE * 0.32);
        context.globalAlpha = 1;
      }
      hitBoxes.push({ id: hero.id, ...box });
      if (hovered === hero.id && label) {
        context.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        const text = label.title;
        const textWidth = context.measureText(text).width + 10;
        context.fillStyle = 'rgba(23, 20, 15, 0.86)';
        context.beginPath();
        context.roundRect(x - textWidth / 2, box.top - 18, textWidth, 14, 4);
        context.fill();
        context.fillStyle = '#f4ead2';
        context.textAlign = 'center';
        context.fillText(text, x, box.top - 8);
      }
    }

    const enemies = [...world.enemies].sort((a, b) => b.x - a.x);
    for (const enemy of enemies) {
      const sprite = atlas(`monster-${enemy.monsterId}`);
      const x = toScreen(enemy.x);
      if (x < -120 || x > width + 160) continue;
      const pose = enemy.stunMs > 0 ? 'hurt' : enemy.pose;
      context.globalAlpha = enemy.pose === 'dying' ? Math.max(0, 1 - enemy.poseMs / 600) : 1;
      let top = groundY - 30;
      if (sprite) {
        const box = drawFrame(context, sprite, animationFrame(sprite, pose, pose === 'move' ? now + enemy.x * 13 : enemy.poseMs, 'move'), x, groundY + 2, ART_SCALE);
        top = box.top;
      } else {
        context.fillStyle = enemy.boss ? '#c2413b' : '#b44fd8';
        const size = enemy.boss ? 60 : 24;
        context.fillRect(x - size / 2, groundY - size, size, size);
        top = groundY - size;
      }
      context.globalAlpha = 1;
      if (!enemy.boss && enemy.hp < enemy.maxHp && enemy.pose !== 'dying') {
        context.fillStyle = 'rgba(0, 0, 0, 0.55)';
        context.fillRect(x - 12, top - 6, 24, 3);
        context.fillStyle = '#e8574b';
        context.fillRect(x - 12, top - 6, 24 * (enemy.hp / enemy.maxHp), 3);
      }
    }

    // Projectiles fly in a slight arc to their target.
    for (const projectile of world.projectiles) {
      const target = world.enemies.find((enemy) => enemy.id === projectile.targetId);
      if (!target || !fx) continue;
      const fromX = toScreen(projectile.fromX);
      const toX = toScreen(target.x);
      const t = Math.min(1, projectile.progress);
      const x = fromX + (toX - fromX) * t;
      const arc = projectile.kind === 'arrow' || projectile.kind === 'note' ? Math.sin(t * Math.PI) * 14 : 4;
      const frame = { note: 0, bolt: 1, arrow: 2, cog: 3, smite: 4, turret: 3, melee: 6 }[projectile.kind] ?? 6;
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
          context.fillStyle = effect.critical ? '#ffd166' : '#fff6e0';
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
        case 'gem':
          if (fx) { context.globalAlpha = 1 - life; drawFrame(context, fx, 9, x, groundY - 30 - life * 40, ART_SCALE * 0.28); context.globalAlpha = 1; }
          break;
        case 'pillar':
          if (camp) { context.globalAlpha = Math.sin(life * Math.PI); drawFrame(context, camp, 8, x, groundY + 2, ART_SCALE * 0.75); context.globalAlpha = 1; }
          break;
        case 'portal':
          if (camp) { context.globalAlpha = Math.sin(life * Math.PI); drawFrame(context, camp, 9, x, groundY + 2, ART_SCALE * 0.7); context.globalAlpha = 1; }
          break;
        case 'chest':
          if (fx) {
            const drop = Math.min(1, effect.t / 300);
            drawFrame(context, fx, effect.t < 700 ? 10 : 11, x, groundY + 2 - (1 - drop) * 40, ART_SCALE * 0.45);
          }
          break;
        case 'puff':
          context.fillStyle = `rgba(244, 234, 210, ${0.5 * (1 - life)})`;
          context.beginPath();
          context.arc(x, groundY - 20, 8 + life * 14, 0, Math.PI * 2);
          context.fill();
          break;
      }
    }
  }

  function pointer(event: PointerEvent) {
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = [...hitBoxes].reverse().find((box) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height);
    const id = hit?.id ?? null;
    if (id !== hovered) {
      hovered = id;
      onHover?.(id);
    }
    if (event.type === 'pointerdown' && hit) {
      onSelect?.(hit.id, { left: hit.left + rect.left, top: hit.top + rect.top, width: hit.width, height: hit.height });
    }
  }

  function leave() {
    if (hovered) { hovered = null; onHover?.(null); }
  }

  onMount(() => {
    const context = canvas?.getContext('2d');
    if (!context || !canvas || !host) return;
    for (const id of ['fx-effects', 'fx-camp']) atlas(id);
    const resize = () => {
      if (!canvas || !host) return;
      const ratio = window.devicePixelRatio || 1;
      width = host.clientWidth;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    const loop = (now: number) => {
      carry += Math.min(1_000, now - last);
      last = now;
      while (carry >= TICK_MS) {
        carry -= TICK_MS;
        react(stepAdventure(world, party, TICK_MS));
      }
      // Preload what the party and the road will need.
      for (const hero of world.heroes) atlas(`hero-${hero.classId}`);
      for (const enemy of world.enemies) atlas(`monster-${enemy.monsterId}`);
      const biome = stageOf(world.stageIndex).biome.id;
      atlas(`biome-${biome}-props`);
      atlas(`biome-${biome}-ground`);
      render(context, now);
      mode = world.mode;
      const bossEnemy = world.enemies.find((enemy) => enemy.boss && enemy.pose !== 'dying');
      boss = bossEnemy ? { name: monsterName(bossEnemy.monsterId), hp: bossEnemy.hp, max: bossEnemy.maxHp } : null;
      if (now - lastSave > 1_000) {
        hud = progressOf(world);
        if (now - lastSave > 15_000) { lastSave = now; onProgress?.(hud, 'tick'); }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      onProgress?.(progressOf(world), 'tick');
    };
  });
</script>

<div class="stage" bind:this={host} style:height={`${height}px`} data-mode={mode} data-testid="adventure-stage">
  <canvas bind:this={canvas} onpointermove={pointer} onpointerdown={pointer} onpointerleave={leave} class:pointing={hovered !== null}></canvas>
  <div class="hud" data-adventure-interactive>
    <span class="place">{biomeName(place.biome.id)} · {stageLabel(hud.stageIndex)}</span>
    <span class="wave">{m['adventure.wave']({ wave: Math.min(hud.wave + 1, WAVES_PER_STAGE), total: WAVES_PER_STAGE })}</span>
    <span class="level" title={m['adventure.xp']({ into: level.into, next: level.next })}>
      <b>{m['adventure.level']({ level: level.level })}</b>
      <span class="bar"><span style:width={`${Math.round((level.into / level.next) * 100)}%`}></span></span>
    </span>
    <span class="gold" title={m['adventure.gold']()}><span class="coin" aria-hidden="true"></span>{hud.gold}</span>
    {#if mode === 'camp'}<span class="camp">{m['adventure.camping']()}</span>{/if}
  </div>
  {#if boss}
    <div class="boss" role="status">
      <span>{boss.name}</span>
      <span class="boss-bar"><span style:width={`${Math.max(0, Math.round((boss.hp / boss.max) * 100))}%`}></span></span>
    </div>
  {/if}
  <div class="banners" aria-live="polite">
    {#each banners as entry (entry.id)}<div class={`banner ${entry.tone}`}>{entry.text}</div>{/each}
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
    padding: 3px 10px;
    border-radius: 999px;
    background: rgba(23, 20, 15, 0.78);
    box-shadow: 0 0 0 1px rgba(232, 184, 75, 0.35);
    color: #f4ead2;
    font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .place {
    color: #e8b84b;
  }

  .wave,
  .camp {
    color: rgba(244, 234, 210, 0.7);
    font-weight: 500;
  }

  .level {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .bar,
  .boss-bar {
    position: relative;
    display: inline-block;
    width: 48px;
    height: 4px;
    border-radius: 2px;
    background: rgba(244, 234, 210, 0.18);
    overflow: hidden;
  }

  .bar > span,
  .boss-bar > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, #b98a2e, #e8b84b);
    transition: width 300ms ease-out;
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
    width: 120px;
  }

  .boss-bar > span {
    background: linear-gradient(90deg, #a1291f, #e8574b);
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

  @keyframes banner-in {
    from { opacity: 0; transform: translateY(6px) scale(0.96); }
  }

  @media (prefers-reduced-motion: reduce) {
    .banner { animation: none; }
  }
</style>
