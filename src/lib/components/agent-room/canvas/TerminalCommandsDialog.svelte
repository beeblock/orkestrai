<script lang="ts">
  import { Globe2, History, Play, Plus, Save, Search, ShieldAlert, SquareTerminal, Trash2 } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { SavedTerminalCommand } from '$lib/modules/agent-room/domain/terminal-commands.js';
  import * as m from '$lib/paraglide/messages.js';

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
  <Dialog.Content class="grid h-[min(680px,calc(100vh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-3xl" data-testid="terminal-commands-dialog">
    <Dialog.Header class="border-b border-border px-5 py-4 pr-12">
      <Dialog.Title>{m['term.commands_title']({ terminal: terminalTitle })}</Dialog.Title>
      <Dialog.Description>{m['term.commands_description']()}</Dialog.Description>
    </Dialog.Header>

    <Tabs.Root value={scope} onValueChange={changeScope} class="contents">
      <div class="flex min-w-0 items-center gap-3 border-b border-border px-5 py-3">
        <Tabs.List class="shrink-0 border border-border bg-muted/60">
          <Tabs.Trigger value="terminal" class="data-active:border-primary data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm"><SquareTerminal size={13} />{m['term.commands_scope_terminal']()}</Tabs.Trigger>
          <Tabs.Trigger value="global" class="data-active:border-primary data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm"><Globe2 size={13} />{m['term.commands_scope_global']()}</Tabs.Trigger>
        </Tabs.List>
        <label class="relative min-w-0 flex-1">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input bind:value={search} class="h-8 pl-8" aria-label={m['term.commands_search']()} placeholder={m['term.commands_search']()} />
        </label>
        <Button size="sm" variant="outline" onclick={() => selectCommand(null)}><Plus />{m['term.commands_new']()}</Button>
      </div>

      <div class="grid min-h-0 grid-cols-[minmax(190px,0.72fr)_minmax(0,1.28fr)] max-[640px]:grid-cols-1 max-[640px]:grid-rows-[190px_minmax(0,1fr)]">
        <div class="min-h-0 overflow-y-auto border-r border-border p-2 max-[640px]:border-b max-[640px]:border-r-0">
          {#each filteredCommands as command (command.id)}
            <button
              type="button"
              class="mb-1 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              class:bg-muted={selectedId === command.id}
              aria-pressed={selectedId === command.id}
              onclick={() => selectCommand(command)}
            >
              <span class="min-w-0"><strong class="block truncate text-xs font-medium">{command.name}</strong><code class="mt-0.5 block truncate text-ui-xs text-muted-foreground">{command.command}</code></span>
              {#if command.runOnResume}<History size={13} class="text-[var(--app-accent)]" aria-label={m['term.commands_resume']()} />{/if}
            </button>
          {:else}
            <p class="px-3 py-8 text-center text-xs leading-5 text-muted-foreground">{search.trim() ? m['term.commands_empty_search']() : m['term.commands_empty']()}</p>
          {/each}
        </div>

        <form class="min-h-0 overflow-y-auto px-5 py-4" onsubmit={(event) => { event.preventDefault(); void save(); }}>
          <div class="space-y-4">
            <label class="block space-y-1.5" for="terminal-command-name">
              <span class="text-xs font-medium">{m['term.commands_name']()}</span>
              <Input id="terminal-command-name" bind:value={draftName} maxlength="80" autocomplete="off" placeholder={m['term.commands_name_placeholder']()} />
            </label>
            <label class="block space-y-1.5" for="terminal-command-value">
              <span class="text-xs font-medium">{m['term.commands_command']()}</span>
              <Textarea id="terminal-command-value" bind:value={draftCommand} maxlength="4000" rows={7} class="resize-y font-mono text-xs" spellcheck="false" placeholder={m['term.commands_command_placeholder']()} />
            </label>
            <label class="flex items-start justify-between gap-4 border-y border-border py-3">
              <span class="min-w-0"><span class="block text-xs font-medium">{m['term.commands_resume']()}</span><span class="mt-1 block text-ui-sm leading-4 text-muted-foreground">{pureShell ? m['term.commands_resume_hint']() : m['term.commands_resume_agent_hint']()}</span></span>
              <Switch checked={draftRunOnResume} disabled={!pureShell} onCheckedChange={(checked: boolean) => (draftRunOnResume = checked)} aria-label={m['term.commands_resume']()} />
            </label>
            <p class="flex items-start gap-2 text-ui-sm leading-4 text-muted-foreground"><ShieldAlert size={14} class="mt-0.5 shrink-0" aria-hidden="true" />{m['term.commands_plaintext_warning']()}</p>
            {#if errorMessage}<p class="text-xs text-destructive" role="alert">{errorMessage}</p>{/if}
          </div>

          <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={!selectedId || busy} onclick={() => void remove()}><Trash2 />{m['term.commands_delete']()}</Button>
            <div class="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy || !draftCommand.trim()} onclick={() => void run()}><Play />{m['term.commands_run']()}</Button>
              <Button type="submit" size="sm" disabled={busy}><Save />{m['term.commands_save']()}</Button>
            </div>
          </div>
        </form>
      </div>
    </Tabs.Root>
  </Dialog.Content>
</Dialog.Root>
