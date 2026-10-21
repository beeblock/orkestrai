<script lang="ts" module>
  export type StudioRequest = {
    mode: 'diagram' | 'document';
    kind: string;
    kindLabel: string;
    style: 'ink' | 'color';
    agentId: string;
    notes: string;
  };
</script>

<script lang="ts">
  import { FileText, LoaderCircle, Shapes } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Textarea } from '$lib/components/ui/textarea';
  import AgentAvatar from '../AgentAvatar.svelte';
  import * as m from '$lib/paraglide/messages.js';

  /** Diagram and document studios: pick what to make and which agent makes it. */
  let {
    open = $bindable(false),
    agents,
    defaultAgentId = null,
    onCreate,
  }: {
    open?: boolean;
    agents: Array<{ id: string; title: string }>;
    defaultAgentId?: string | null;
    onCreate: (request: StudioRequest) => Promise<boolean>;
  } = $props();

  const DIAGRAMS = $derived([
    ['architecture', m['studio.d_architecture']()],
    ['user_flow', m['studio.d_user_flow']()],
    ['data_flow', m['studio.d_data_flow']()],
    ['components', m['studio.d_components']()],
    ['request', m['studio.d_request']()],
    ['states', m['studio.d_states']()],
  ] as const);
  const DOCUMENTS = $derived([
    ['overview', m['studio.doc_overview']()],
    ['onboarding', m['studio.doc_onboarding']()],
    ['architecture', m['studio.doc_architecture']()],
    ['readme', m['studio.doc_readme']()],
    ['api', m['studio.doc_api']()],
    ['data', m['studio.doc_data']()],
    ['security', m['studio.doc_security']()],
  ] as const);

  let mode = $state<'diagram' | 'document'>('diagram');
  let kind = $state('architecture');
  let style = $state<'ink' | 'color'>('ink');
  let agentId = $state<string | null>(null);
  let notes = $state('');
  let busy = $state(false);

  $effect(() => {
    if (open && !agentId) agentId = defaultAgentId ?? agents[0]?.id ?? null;
  });

  const kinds = $derived(mode === 'diagram' ? DIAGRAMS : DOCUMENTS);
  const agent = $derived(agents.find((candidate) => candidate.id === agentId) ?? null);

  async function create() {
    if (!agentId || busy) return;
    const label = kinds.find(([value]) => value === kind)?.[1] ?? kind;
    busy = true;
    const ok = await onCreate({ mode, kind, kindLabel: label, style, agentId, notes: notes.trim() });
    busy = false;
    if (ok) {
      notes = '';
      open = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="studio sm:max-w-[520px]" data-testid="studio-dialog">
    <Dialog.Header>
      <Dialog.Title>{m['studio.title']()}</Dialog.Title>
      <Dialog.Description>{m['studio.subtitle']()}</Dialog.Description>
    </Dialog.Header>

    <div class="modes" role="radiogroup" aria-label={m['studio.title']()}>
      <button type="button" role="radio" aria-checked={mode === 'diagram'} class:on={mode === 'diagram'} onclick={() => { mode = 'diagram'; kind = 'architecture'; }}><Shapes size={14} />{m['studio.diagram']()}</button>
      <button type="button" role="radio" aria-checked={mode === 'document'} class:on={mode === 'document'} onclick={() => { mode = 'document'; kind = 'overview'; }}><FileText size={14} />{m['studio.document']()}</button>
    </div>

    <p class="label">{m['studio.kind']()}</p>
    <div class="kinds">
      {#each kinds as [value, label] (value)}
        <button type="button" class="kind" class:on={kind === value} aria-pressed={kind === value} onclick={() => (kind = value)}>{label}</button>
      {/each}
    </div>

    {#if mode === 'diagram'}
      <p class="label">{m['studio.style']()}</p>
      <div class="kinds">
        <button type="button" class="kind" class:on={style === 'ink'} aria-pressed={style === 'ink'} onclick={() => (style = 'ink')}>{m['studio.style_ink']()}</button>
        <button type="button" class="kind" class:on={style === 'color'} aria-pressed={style === 'color'} onclick={() => (style = 'color')}>{m['studio.style_color']()}</button>
      </div>
    {/if}

    <p class="label">{m['studio.agent']()}</p>
    {#if agents.length}
      <Select.Root type="single" value={agentId ?? undefined} onValueChange={(value: string) => (agentId = value)}>
        <Select.Trigger class="w-full">{#if agent}<span class="inline-flex items-center gap-2"><AgentAvatar nodeId={agent.id} title={agent.title} size={18} />{agent.title}</span>{/if}</Select.Trigger>
        <Select.Content>
          {#each agents as candidate (candidate.id)}<Select.Item value={candidate.id}>{candidate.title}</Select.Item>{/each}
        </Select.Content>
      </Select.Root>
    {:else}
      <p class="hint">{m['studio.no_agents']()}</p>
    {/if}

    <Textarea class="min-h-16" bind:value={notes} placeholder={m['studio.notes']()} aria-label={m['studio.notes']()} maxlength={2000} />

    <Dialog.Footer>
      <button type="button" class="create" disabled={!agentId || busy} onclick={() => void create()}>
        {#if busy}<LoaderCircle size={14} class="animate-spin" />{/if}{m['studio.create']()}
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .modes {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 12px;
    background: var(--app-hover);
  }

  .modes button {
    flex: 1;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 13px;
    font-weight: 500;
  }

  .modes button.on {
    background: var(--app-surface);
    color: var(--app-text);
    box-shadow: var(--app-shadow-border);
  }

  .label {
    margin: 4px 0 -4px;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .kind {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--app-border-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12.5px;
  }

  .kind:hover {
    color: var(--app-text);
  }

  .kind.on {
    border-color: var(--app-accent);
    background: color-mix(in srgb, var(--app-accent) 12%, transparent);
    color: var(--app-text);
    font-weight: 600;
  }

  .hint {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  .create {
    height: 34px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-size: 13px;
    font-weight: 600;
  }

  .create:disabled {
    opacity: 0.55;
  }

  button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
