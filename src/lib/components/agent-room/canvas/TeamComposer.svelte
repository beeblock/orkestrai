<script lang="ts">
  import { CodeXml, LoaderCircle, Minus, Plus, X } from '@lucide/svelte';
  import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
  import type { AgentProviderInfo } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * Line up a whole team and launch it in one action: a name, a role for
   * everyone, up to twelve slots each with its own CLI. The Canvas creates the
   * agents side by side inside a named group.
   */
  let {
    providers,
    roles = [],
    onCreate,
    onClose,
  }: {
    providers: AgentProviderInfo[];
    roles?: string[];
    onCreate: (team: { name: string; role: string | null; providerIds: string[] }, progress: (done: number) => void) => Promise<boolean>;
    onClose: () => void;
  } = $props();

  const MAX = 12;
  const PRESET_ROLES = $derived([
    m['team_composer.role_general'](),
    m['team_composer.role_frontend'](),
    m['team_composer.role_backend'](),
    m['team_composer.role_tests'](),
    m['team_composer.role_review'](),
    m['team_composer.role_design'](),
    m['team_composer.role_docs'](),
    m['team_composer.role_security'](),
  ]);
  const roleChoices = $derived([...new Set([...PRESET_ROLES, ...roles])].slice(0, 14));

  let name = $state(m['team_composer.default_name']());
  let role = $state<string>(m['team_composer.role_general']());
  let slots = $state<string[]>([]);
  let busy = $state(false);
  let done = $state(0);

  $effect(() => {
    if (!slots.length && providers.length) slots = Array.from({ length: 4 }, () => providers[0].id);
  });

  function cycle(index: number) {
    const current = providers.findIndex((provider) => provider.id === slots[index]);
    const next = providers[(current + 1) % providers.length];
    slots = slots.map((id, slot) => (slot === index ? next.id : id));
  }

  function fill(providerId: string) {
    slots = slots.map(() => providerId);
  }

  function resize(delta: number) {
    const count = Math.min(MAX, Math.max(1, slots.length + delta));
    if (count > slots.length) slots = [...slots, ...Array.from({ length: count - slots.length }, () => slots.at(-1) ?? providers[0]?.id ?? '')];
    else slots = slots.slice(0, count);
  }

  function label(providerId: string): string {
    return providers.find((provider) => provider.id === providerId)?.displayName ?? providerId;
  }

  async function create() {
    if (busy || !slots.length) return;
    busy = true;
    done = 0;
    const ok = await onCreate({ name: name.trim() || m['team_composer.default_name'](), role: role === m['team_composer.role_general']() ? null : role, providerIds: slots }, (value) => (done = value));
    busy = false;
    if (ok) onClose();
  }
</script>

<div class="team-composer" role="dialog" aria-label={m['team_composer.title']()} data-testid="team-composer">
  <header>
    <span class="dot" aria-hidden="true"></span>
    <input class="name" bind:value={name} aria-label={m['team_composer.name']()} maxlength="48" spellcheck="false" />
    <button type="button" class="close" aria-label={m['team_composer.close']()} onclick={onClose}><X size={14} /></button>
  </header>

  {#if !providers.length}
    <p class="empty">{m['team_composer.no_providers']()}</p>
  {:else}
    <div class="roles" role="radiogroup" aria-label={m['team_composer.role']()}>
      {#each roleChoices as choice (choice)}
        <button type="button" role="radio" aria-checked={role === choice} class="role" class:on={role === choice} onclick={() => (role = choice)}>
          <span class="rdot" aria-hidden="true"></span>{choice}
        </button>
      {/each}
    </div>

    <div class="slots" aria-label={m['team_composer.slots']()} title={m['team_composer.slot_hint']()}>
      {#each slots as providerId, index (index)}
        <button type="button" class="slot" onclick={() => cycle(index)} aria-label={`${index + 1}: ${label(providerId)}`}>
          {#if providerIcons[providerId]}<img src={providerIcons[providerId]} width="18" height="18" alt="" class="app-logo-plate" />{:else}<CodeXml size={18} />{/if}
          <span>{label(providerId)}</span>
        </button>
      {/each}
    </div>

    <div class="fill">
      <span>{m['team_composer.fill_all']()}</span>
      {#each providers as provider (provider.id)}
        <button type="button" class="fill-btn" aria-label={`${m['team_composer.fill_all']()} ${provider.displayName}`} title={provider.displayName} onclick={() => fill(provider.id)}>
          {#if providerIcons[provider.id]}<img src={providerIcons[provider.id]} width="14" height="14" alt="" class="app-logo-plate" />{:else}<CodeXml size={14} />{/if}
        </button>
      {/each}
    </div>

    <footer>
      <div class="stepper">
        <button type="button" aria-label={m['team_composer.fewer']()} disabled={busy || slots.length <= 1} onclick={() => resize(-1)}><Minus size={13} /></button>
        <span class="count">{slots.length}</span>
        <button type="button" aria-label={m['team_composer.more']()} disabled={busy || slots.length >= MAX} onclick={() => resize(1)}><Plus size={13} /></button>
      </div>
      <button type="button" class="create" disabled={busy} onclick={create}>
        {#if busy}<LoaderCircle size={14} class="animate-spin" />{m['team_composer.creating']({ done, count: slots.length })}{:else}{m['team_composer.create']({ count: slots.length })}{/if}
      </button>
    </footer>
  {/if}
</div>

<style>
  .team-composer {
    width: min(420px, calc(100vw - 32px));
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-radius: 20px;
    background: var(--app-glass-strong);
    -webkit-backdrop-filter: blur(26px) saturate(170%);
    backdrop-filter: blur(26px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
    animation: composer-in var(--duration-fast) var(--ease-smooth-out);
  }

  @keyframes composer-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 6px 0 12px;
    border-radius: 12px;
    background: var(--app-hover);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--app-accent);
    flex: none;
  }

  .name {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .close {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-muted);
  }

  .close:hover {
    background: var(--app-active);
    color: var(--app-text);
  }

  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .role {
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .role:hover {
    color: var(--app-text);
  }

  .role.on {
    border-color: color-mix(in srgb, var(--app-accent) 50%, transparent);
    background: color-mix(in srgb, var(--app-accent) 10%, transparent);
    color: var(--app-text);
  }

  .rdot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.7;
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .slot {
    height: 58px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 1px solid color-mix(in srgb, var(--app-accent) 26%, var(--app-glass-line));
    border-radius: 12px;
    background: color-mix(in srgb, var(--app-accent) 5%, transparent);
    color: var(--app-text-soft);
    font-size: 11px;
    transition: transform var(--duration-quick) var(--ease-smooth-out), border-color var(--duration-quick) ease-out;
    animation: slot-in var(--duration-fast) var(--ease-smooth-out);
  }

  @keyframes slot-in {
    from { opacity: 0; transform: scale(0.9); }
  }

  .slot:hover {
    border-color: color-mix(in srgb, var(--app-accent) 60%, transparent);
    transform: translateY(-1px);
  }

  .slot span {
    max-width: 100%;
    padding: 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fill {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .fill > span {
    margin-right: 4px;
  }

  .fill-btn {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 1px solid var(--app-glass-line);
    border-radius: 8px;
    background: transparent;
  }

  .fill-btn:hover {
    background: var(--app-hover);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 999px;
    border: 1px solid var(--app-glass-line);
  }

  .stepper button {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--app-text-soft);
  }

  .stepper button:hover:not(:disabled) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .stepper button:disabled {
    opacity: 0.4;
  }

  .count {
    min-width: 24px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  .create {
    height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 6px 18px color-mix(in srgb, var(--app-accent) 28%, transparent);
  }

  .create:disabled {
    opacity: 0.7;
  }

  .empty {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  button:focus-visible,
  .name:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
