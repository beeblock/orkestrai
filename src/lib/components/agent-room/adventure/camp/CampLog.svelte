<script lang="ts">
  import { fill, type AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import type { JournalEntry } from '$lib/modules/agent-room/domain/adventure/account.js';
  import type { MonsterId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureSnapshot } from '../adventure-client.js';
  import { formatNumber, itemName, rarityInk } from '../adventure-text.js';

  let { snapshot, catalog }: { snapshot: AdventureSnapshot; catalog: AdventureCatalog } = $props();

  const names = $derived(Object.fromEntries(snapshot.heroes.map((hero) => [hero.id, hero.name])));
  const monsterName = (id: MonsterId) => (m as unknown as Record<string, () => string>)[`adventure.monster_${id.replace(/-/g, '_')}`]?.() ?? id;
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

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

  const stats = $derived([
    [m['adventure.camp_log_kills'](), formatNumber(snapshot.account.kills)],
    [m['adventure.camp_log_bosses'](), formatNumber(snapshot.account.bosses)],
    [m['adventure.camp_log_quests'](), formatNumber(snapshot.account.quests)],
  ]);
</script>

<div class="log">
  <dl class="totals">
    {#each stats as [label, value] (label)}<div><dt>{label}</dt><dd>{value}</dd></div>{/each}
  </dl>
  {#if snapshot.account.journal.length}
    <ol>
      {#each snapshot.account.journal as entry, index (`${entry.at}-${index}`)}
        {@const shown = line(entry)}
        <li><time datetime={entry.at}>{time.format(new Date(entry.at))}</time><span style:color={shown.color}>{shown.text}</span></li>
      {/each}
    </ol>
  {:else}
    <p class="empty">{m['adventure.camp_log_empty']()}</p>
  {/if}
</div>

<style>
  .log {
    display: grid;
    gap: 12px;
    max-width: 760px;
  }

  .totals {
    display: flex;
    gap: 24px;
    margin: 0;
  }

  .totals div {
    display: grid;
  }

  dt {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  dd {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  ol {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 10px;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 12.5px;
  }

  li:nth-child(odd) {
    background: var(--app-hover);
  }

  time {
    color: var(--app-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    color: var(--app-text-muted);
    font-size: 12px;
  }
</style>
