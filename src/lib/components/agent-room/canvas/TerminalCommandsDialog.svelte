<script lang="ts">
  import { CircleAlert, Globe2, History, Play, Plus, Save, Search, ShieldAlert, SquareTerminal, Trash2 } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { SavedTerminalCommand } from '$lib/modules/agent-room/domain/terminal-commands.js';
  import * as m from '$lib/paraglide/messages.js';
  import NodeEmptyState from './NodeEmptyState.svelte';

  type Scope = 'terminal' | 'global';

  let {
    open,
    terminalTitle,
    pureShell,
    terminalCommands,
    globalCommands,
    onSaveTerminal,
    onSaveGlobal,
    onRun,
    onClose,
  }: {
    open: boolean;
    terminalTitle: string;
    pureShell: boolean;
    terminalCommands: SavedTerminalCommand[];
    globalCommands: SavedTerminalCommand[];
    onSaveTerminal: (commands: SavedTerminalCommand[]) => void | Promise<void>;
    onSaveGlobal: (commands: SavedTerminalCommand[]) => void | Promise<void>;
    onRun: (command: SavedTerminalCommand) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  let scope = $state<Scope>('terminal');
  let search = $state('');
  let selectedId = $state<string | null>(null);
  let draftName = $state('');
  let draftCommand = $state('');
  let draftRunOnResume = $state(false);
  let busy = $state(false);
  let errorMessage = $state('');
  let wasOpen = false;

  // Abas de escopo com o visual do SegmentedControl (trilho neutro, pilula elevada).
  const segmentList = 'h-8 shrink-0 rounded-lg bg-[var(--app-hover)] p-0.5';
  const segmentTab = 'h-7 gap-1.5 rounded-md px-2.5 text-[12px] data-[state=active]:bg-[var(--app-surface-raised)] data-[state=active]:text-[var(--app-text)] data-[state=active]:shadow-[var(--app-shadow-border)] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[var(--app-surface-raised)] dark:data-[state=active]:text-[var(--app-text)]';

  const commands = $derived(scope === 'terminal' ? terminalCommands : globalCommands);
  const filteredCommands = $derived.by(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return commands;
    return commands.filter((command) => `${command.name} ${command.command}`.toLocaleLowerCase().includes(needle));
  });

  $effect(() => {
    if (open && !wasOpen) {
      scope = 'terminal';
      search = '';
      selectCommand(terminalCommands[0] ?? null);
    }
    wasOpen = open;
  });

  function uuidv7(): string {
    const timestamp = Date.now().toString(16).padStart(12, '0');
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const variant = ((Number.parseInt(random[3], 16) & 0x3) | 0x8).toString(16);
    return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
  }

  function selectCommand(command: SavedTerminalCommand | null) {
    selectedId = command?.id ?? null;
    draftName = command?.name ?? '';
    draftCommand = command?.command ?? '';
    draftRunOnResume = command?.runOnResume ?? false;
    errorMessage = '';
  }

  function changeScope(value: string) {
    scope = value as Scope;
    search = '';
    const next = scope === 'terminal' ? terminalCommands : globalCommands;
    selectCommand(next[0] ?? null);
  }

  function updatedCommands(command: SavedTerminalCommand): SavedTerminalCommand[] {
    const current = scope === 'terminal' ? terminalCommands : globalCommands;
    const index = current.findIndex((item) => item.id === command.id);
    if (index < 0) return [...current, command];
    return current.map((item) => item.id === command.id ? command : item);
  }

  async function persist(commands: SavedTerminalCommand[]) {
    if (scope === 'terminal') await onSaveTerminal(commands);
    else await onSaveGlobal(commands);
  }

  async function save() {
    const name = draftName.trim();
    const command = draftCommand.trim();
    if (!name || !command) {
      errorMessage = m['term.commands_invalid']();
      return;
    }
    busy = true;
    errorMessage = '';
    const existing = commands.find((item) => item.id === selectedId);
    const saved: SavedTerminalCommand = {
      id: selectedId ?? uuidv7(),
      name,
      command,
      runOnResume: pureShell ? draftRunOnResume : (existing?.runOnResume ?? false),
    };
    try {
      await persist(updatedCommands(saved));
      selectCommand(saved);
      toast.success(m['term.commands_saved']());
    } catch {
      errorMessage = m['term.commands_save_error']();
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!selectedId || busy) return;
    busy = true;
    errorMessage = '';
    try {
      await persist(commands.filter((command) => command.id !== selectedId));
      selectCommand(null);
      toast.success(m['term.commands_deleted']());
    } catch {
      errorMessage = m['term.commands_save_error']();
    } finally {
      busy = false;
    }
  }

  async function run() {
    const name = draftName.trim();
    const command = draftCommand.trim();
    if (!name || !command || busy) {
      if (!name || !command) errorMessage = m['term.commands_invalid']();
      return;
    }
    busy = true;
    errorMessage = '';
    try {
      await onRun({ id: selectedId ?? uuidv7(), name, command, runOnResume: false });
      onClose();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="flex h-[min(640px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]" data-testid="terminal-commands-dialog">
    <Dialog.Header class="shrink-0 px-5 pt-5 pb-4 pr-12">
      <Dialog.Title>{m['term.commands_title']({ terminal: terminalTitle })}</Dialog.Title>
      <Dialog.Description>{m['term.commands_description']()}</Dialog.Description>
    </Dialog.Header>

    <Tabs.Root value={scope} onValueChange={changeScope} class="contents">
      <div class="flex min-w-0 shrink-0 items-center gap-2 border-y border-border/70 px-5 py-2.5">
        <!-- Escopo como controle segmentado (mesmo desenho do SegmentedControl). -->
        <Tabs.List class={segmentList}>
          <Tabs.Trigger value="terminal" class={segmentTab}><SquareTerminal size={13} aria-hidden="true" />{m['term.commands_scope_terminal']()}</Tabs.Trigger>
          <Tabs.Trigger value="global" class={segmentTab}><Globe2 size={13} aria-hidden="true" />{m['term.commands_scope_global']()}</Tabs.Trigger>
        </Tabs.List>
        <label class="relative min-w-0 flex-1">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input bind:value={search} class="h-8 pl-8 text-[13px]" aria-label={m['term.commands_search']()} placeholder={m['term.commands_search']()} />
        </label>
        <Button size="sm" variant="outline" class="h-8" onclick={() => selectCommand(null)}><Plus />{m['term.commands_new']()}</Button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(200px,0.72fr)_minmax(0,1.28fr)] max-[640px]:grid-cols-1 max-[640px]:grid-rows-[180px_minmax(0,1fr)]">
        <div class="flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain border-r border-border/70 bg-[var(--app-surface-subtle)]/40 p-2 max-[640px]:border-b max-[640px]:border-r-0">
          {#each filteredCommands as command (command.id)}
            <button
              type="button"
              class="command-row"
              aria-pressed={selectedId === command.id}
              onclick={() => selectCommand(command)}
            >
              <span class="min-w-0">
                <strong class="block truncate text-ui-lg font-medium" title={command.name}>{command.name}</strong>
                <code class="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground" title={command.command}>{command.command}</code>
              </span>
              {#if command.runOnResume}<History size={13} class="shrink-0 text-[var(--app-accent)]" aria-label={m['term.commands_resume']()} />{/if}
            </button>
          {:else}
            <NodeEmptyState
              compact
              icon={search.trim() ? Search : SquareTerminal}
              title={search.trim() ? m['term.commands_empty_search']() : m['term.commands_empty']()}
              description={search.trim() ? undefined : m['term.commands_empty_hint']()}
            />
          {/each}
        </div>

        <form id="terminal-command-form" class="min-h-0 overflow-y-auto overscroll-contain px-5 py-4" onsubmit={(event) => { event.preventDefault(); void save(); }}>
          <div class="grid gap-4">
            <label class="grid gap-1.5" for="terminal-command-name">
              <span class="text-ui-lg font-medium">{m['term.commands_name']()}</span>
              <Input id="terminal-command-name" bind:value={draftName} maxlength="80" autocomplete="off" placeholder={m['term.commands_name_placeholder']()} />
            </label>
            <label class="grid gap-1.5" for="terminal-command-value">
              <span class="text-ui-lg font-medium">{m['term.commands_command']()}</span>
              <Textarea id="terminal-command-value" bind:value={draftCommand} maxlength="4000" rows={6} class="min-h-32 resize-y font-mono text-[12px] leading-relaxed" spellcheck="false" placeholder={m['term.commands_command_placeholder']()} />
            </label>
            <label class="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 shadow-[var(--app-shadow-border)]" class:opacity-60={!pureShell}>
              <span class="min-w-0"><span class="block text-ui-lg font-medium">{m['term.commands_resume']()}</span><span class="mt-0.5 block text-ui-md leading-snug text-pretty text-muted-foreground">{pureShell ? m['term.commands_resume_hint']() : m['term.commands_resume_agent_hint']()}</span></span>
              <Switch checked={draftRunOnResume} disabled={!pureShell} onCheckedChange={(checked: boolean) => (draftRunOnResume = checked)} aria-label={m['term.commands_resume']()} />
            </label>
            <p class="flex items-start gap-2 text-ui-md leading-snug text-pretty text-muted-foreground"><ShieldAlert size={14} class="mt-px shrink-0" aria-hidden="true" />{m['term.commands_plaintext_warning']()}</p>
            {#if errorMessage}<p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{errorMessage}</span></p>{/if}
          </div>
        </form>
      </div>
    </Tabs.Root>

    <!-- Rodape fixo: excluir a esquerda, executar/salvar a direita. -->
    <Dialog.Footer class="m-0 shrink-0 items-center sm:justify-between">
      <!-- Excluir so existe para um comando salvo selecionado. -->
      {#if selectedId}
        <Button type="button" variant="destructive" disabled={busy} onclick={() => void remove()}><Trash2 />{m['term.commands_delete']()}</Button>
      {:else}
        <span aria-hidden="true"></span>
      {/if}
      <div class="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="outline" disabled={busy || !draftCommand.trim()} onclick={() => void run()}><Play />{m['term.commands_run']()}</Button>
        <Button type="submit" form="terminal-command-form" disabled={busy}><Save />{m['term.commands_save']()}</Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .command-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    padding: 6px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-soft);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .command-row:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .command-row[aria-pressed='true'] {
    background: var(--app-active);
    color: var(--app-text);
  }

  .command-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }
</style>
