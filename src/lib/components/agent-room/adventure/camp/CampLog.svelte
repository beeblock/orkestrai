<script lang="ts">
  import { fill, type AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import type { JournalEntry } from '$lib/modules/agent-room/domain/adventure/account.js';
  import type { MonsterId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureSnapshot } from '../adventure-client.js';
  import { formatNumber, itemName, rarityInk } from '../adventure-text.js';
  import { itemIcon } from '$lib/modules/agent-room/domain/adventure/items.js';
  import ItemIcon from './ItemIcon.svelte';

  let { snapshot, catalog }: { snapshot: AdventureSnapshot; catalog: AdventureCatalog } = $props();

  const names = $derived(Object.fromEntries(snapshot.heroes.map((hero) => [hero.id, hero.name])));
  const monsterName = (id: MonsterId) => (m as unknown as Record<string, () => string>)[`adventure.monster_${id.replace(/-/g, '_')}`]?.() ?? id;
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const CHEST_FRAMES: Record<string, number> = { white: 0, blue: 1, red: 2, quest: 3 };

  type Icon = { atlas: string; frame: number };

  /** A picture for each kind of line: the item itself, a chest, a skull, a banner… */
  function iconOf(entry: JournalEntry): Icon {
    switch (entry.kind) {
      case 'item':
      case 'equip': {
        const item = snapshot.items.find((candidate) => candidate.id === entry.itemId);
        if (item) return itemIcon(item);
        return entry.kind === 'item' && entry.source in CHEST_FRAMES ? { atlas: 'icons-misc', frame: CHEST_FRAMES[entry.source] } : { atlas: 'icons-misc', frame: 7 };
      }
      case 'level': return entry.paragon ? { atlas: 'icons-skills-stats', frame: 17 } : { atlas: 'icons-skills-stats', frame: 14 };
      case 'stage': return entry.result === 'clear' ? { atlas: 'icons-camp-tabs', frame: 5 } : { atlas: 'icons-skills-stats', frame: 11 };
      case 'boss': return { atlas: 'icons-skills-stats', frame: 8 };
      case 'pet': return { atlas: 'icons-camp-tabs', frame: 4 };
      case 'quest': return { atlas: 'icons-misc', frame: 3 };
      case 'recruit': return { atlas: 'icons-camp-tabs', frame: 0 };
      case 'offline': return { atlas: 'icons-camp-tabs', frame: 7 };
      case 'salvage': return { atlas: 'icons-misc', frame: 6 };
    }
  }

  function line(entry: JournalEntry): { text: string; color?: string } {
    switch (entry.kind) {
      case 'item': {
        const item = snapshot.items.find((candidate) => candidate.id === entry.itemId);
        const name = item ? itemName(catalog, item) : catalog.rarities[entry.rarity];
        return { text: fill(catalog.journal.item, { item: `${name} (${catalog.rarities[entry.rarity]})`, source: catalog.itemSources[entry.source] }), color: rarityInk(entry.rarity) };
      }
      case 'level': return entry.paragon
        ? { text: fill(catalog.journal.paragon, { hero: names[entry.heroId] ?? '—', level: entry.paragon }), color: 'var(--adventure-ink-paragon)' }
        : { text: fill(catalog.journal.level, { hero: names[entry.heroId] ?? '—', level: entry.level }) };
      case 'recruit': return { text: fill(entry.inherited ? catalog.journal.inherited : catalog.journal.recruit, { hero: names[entry.heroId] ?? '—', agent: entry.agentTitle }), color: 'var(--app-secondary)' };
      case 'stage': return { text: fill(entry.result === 'clear' ? catalog.journal.stageClear : catalog.journal.stageFail, { stage: `${catalog.difficulties[entry.difficulty]} ${entry.act}-${entry.stage}` }) };
      case 'boss': return { text: fill(catalog.journal.boss, { monster: monsterName(entry.monsterId) }), color: 'var(--adventure-ink-boss)' };
      case 'pet': return { text: fill(catalog.journal.pet, { pet: catalog.pets[entry.petId] }), color: 'var(--app-success)' };
      case 'quest': return { text: fill(catalog.journal.quest, { title: entry.title }), color: 'var(--app-accent)' };
      case 'offline': return { text: fill(catalog.journal.offline, { minutes: entry.minutes, gold: formatNumber(entry.gold) }) };
      case 'equip': {
        const item = snapshot.items.find((candidate) => candidate.id === entry.itemId);
        return { text: fill(catalog.journal.equip, { hero: names[entry.heroId] ?? '—', item: item ? itemName(catalog, item) : catalog.rarities[entry.rarity] }), color: rarityInk(entry.rarity) };
      }
      case 'salvage': return { text: fill(catalog.journal.salvage, { count: entry.count, gold: formatNumber(entry.gold) }) };
    }
  }

  /** The journal by day, newest first. */
  const days = $derived.by(() => {
    const groups: Array<{ key: string; label: string; entries: JournalEntry[] }> = [];
    for (const entry of snapshot.account.journal) {
      const date = new Date(entry.at);
      const key = date.toDateString();
      const last = groups.at(-1);
      if (last?.key === key) last.entries.push(entry);
      else groups.push({ key, label: day.format(date), entries: [entry] });
    }
    return groups;
  });

  // Totals, each with its picture: a sword, a horned skull, a quest chest.
  const stats = $derived([
    [m['adventure.camp_log_kills'](), formatNumber(snapshot.account.kills), ['icons-skills-stats', 0]],
    [m['adventure.camp_log_bosses'](), formatNumber(snapshot.account.bosses), ['icons-skills-stats', 8]],
    [m['adventure.camp_log_quests'](), formatNumber(snapshot.account.quests), ['icons-misc', 3]],
  ] as Array<[string, string, [string, number]]>);
</script>

<div class="log">
  <dl class="totals">
    {#each stats as [label, value, frame] (label)}<div class="camp-panel"><ItemIcon atlasId={frame[0]} frame={frame[1]} size={34} /><span><dt>{label}</dt><dd>{value}</dd></span></div>{/each}
  </dl>
  <section class="chronicle camp-panel ornate" aria-label={m['adventure.camp_tab_log']()}>
    {#if days.length}
      {#each days as group (group.key)}
        <h3 class="camp-heading">{group.label}</h3>
        <ol>
          {#each group.entries as entry, index (`${entry.at}-${index}`)}
            {@const shown = line(entry)}
            {@const icon = iconOf(entry)}
            <li><ItemIcon atlasId={icon.atlas} frame={icon.frame} size={24} /><time datetime={entry.at}>{time.format(new Date(entry.at))}</time><span style:color={shown.color}>{shown.text}</span></li>
          {/each}
        </ol>
      {/each}
    {:else}
      <p class="empty camp-muted">{m['adventure.camp_log_empty']()}</p>
    {/if}
  </section>
</div>

<style>
  .log {
    display: grid;
    gap: 14px;
    max-width: 860px;
  }

  .totals {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin: 0;
  }

  .totals div {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
  }

  .totals span {
    display: grid;
  }

  dt {
    color: var(--camp-ink-muted);
    font-size: 11.5px;
  }

  dd {
    margin: 0;
    color: var(--camp-gold-strong);
    font-family: var(--camp-title-font);
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* The chronicle: a page per day, a line per deed. */
  .chronicle {
    display: grid;
    gap: 8px;
    padding: 14px 16px 16px;
  }

  .chronicle h3 {
    margin-top: 6px;
    text-transform: none;
    letter-spacing: 0.03em;
  }

  ol {
    display: grid;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 24px auto minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 12.5px;
  }

  li:nth-child(odd) {
    background: color-mix(in srgb, var(--camp-inset) 55%, transparent);
  }

  time {
    min-width: 64px;
    color: var(--camp-ink-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .empty {
    margin: 0;
    font-size: 12.5px;
  }
</style>
