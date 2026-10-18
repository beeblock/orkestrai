<script lang="ts">
  import { GitBranch } from '@lucide/svelte';
  import AgentGlyph from './AgentGlyph.svelte';
  import { agentStatus, statusClock } from './agent-status.svelte.js';
  import { agentTone, elapsedParts } from './agent-identity.js';
  import { agentStateLabel, elapsedLabel } from './agent-status-labels.js';
  import * as m from '$lib/paraglide/messages.js';

  /** Teammates by floor (worktree), each with state, time in it and what it is doing. */
  let { branch = 'main', selectedId = null, onSelect }: { branch?: string | null; selectedId?: string | null; onSelect: (nodeId: string) => void } = $props();

  const floors = $derived.by(() => {
    const byFloor = new Map<string, typeof agents>();
    const agents = Object.values(agentStatus.agents).sort((a, b) => a.title.localeCompare(b.title));
    for (const agent of agents) {
      const key = agent.floorName || branch || 'main';
      if (!byFloor.has(key)) byFloor.set(key, []);
      byFloor.get(key)!.push(agent);
    }
    return [...byFloor.entries()];
  });

  function since(value: string): string {
    const parts = elapsedParts(value, statusClock.now);
    return parts ? elapsedLabel(parts) : '';
  }
</script>

<div class="team" data-testid="focus-team">
  {#each floors as [floor, agents] (floor)}
    <div class="floor"><GitBranch size={12} strokeWidth={1.9} /><span>{floor}</span></div>
    {#each agents as agent (agent.nodeId)}
      {@const state = agent.sessionAlive ? agent.state : 'disconnected'}
      <button type="button" class="agent" aria-current={selectedId === agent.nodeId ? 'true' : undefined} onclick={() => onSelect(agent.nodeId)} title={agentStateLabel(state)}>
        <AgentGlyph tone={agentTone(state)} label={agentStateLabel(state)} />
        <span class="name">{agent.title}</span>
        <span class="time">{since(agent.stateSince)}</span>
        <span class="doing">{agent.lastAction ?? agent.currentTask?.title ?? agentStateLabel(state)}</span>
      </button>
    {/each}
  {:else}
    <p class="none">{m['focus.no_team']()}</p>
  {/each}
</div>

<style>
  .team {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .floor {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .agent {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 8px;
    padding: 5px 10px 5px 22px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    color: var(--app-text);
    transition: background-color var(--duration-quick) ease-out;
  }

  .agent:hover {
    background: var(--app-hover);
  }

  .agent[aria-current='true'] {
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  .agent:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
  }

  .time {
    color: var(--app-text-muted);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .doing {
    grid-column: 2 / 4;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .none {
    margin: 0;
    padding: 6px 10px;
    color: var(--app-text-muted);
    font-size: 12px;
  }
</style>
