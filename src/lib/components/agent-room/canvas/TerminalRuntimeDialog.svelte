<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import { CircleAlert, LoaderCircle, RotateCcw } from '@lucide/svelte';
  import type { WorkspaceExecutionRuntime } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type WslAvailability = {
    supported: boolean;
    distributions: Array<{ name: string }>;
    inferred: { distribution: string; linuxWorkingDir: string } | null;
    error: string | null;
  };

  type RuntimeSelection = {
    mode: 'default' | 'native' | 'wsl';
    wslDistribution: string | null;
    wslWorkingDir: string | null;
  };

  let {
    open,
    workspaceRoot,
    workspaceRuntime,
    override,
    onSave,
    onClose,
  }: {
    open: boolean;
    workspaceRoot: string;
    workspaceRuntime: WorkspaceExecutionRuntime;
    override: WorkspaceExecutionRuntime | null;
    onSave: (selection: RuntimeSelection) => Promise<void>;
    onClose: () => void;
  } = $props();

  let mode = $state<'default' | 'native' | 'wsl'>('default');
  let distribution = $state('');
  let linuxWorkingDir = $state('');
  let availability = $state<WslAvailability>({ supported: false, distributions: [], inferred: null, error: null });
  let busy = $state(false);
  let errorMessage = $state('');
  let wasOpen = false;

  const workspaceRuntimeLabel = $derived(
    workspaceRuntime.kind === 'wsl'
      ? `WSL · ${workspaceRuntime.distribution}`
      : m['dlg.runtime_native'](),
  );

  $effect(() => {
    if (open && !wasOpen) {
      mode = override?.kind ?? 'default';
      distribution = override?.kind === 'wsl'
        ? override.distribution
        : workspaceRuntime.kind === 'wsl'
          ? workspaceRuntime.distribution
          : '';
      linuxWorkingDir = override?.kind === 'wsl'
        ? override.linuxWorkingDir
        : workspaceRuntime.kind === 'wsl'
          ? workspaceRuntime.linuxWorkingDir
          : '';
      errorMessage = '';
      void loadAvailability();
    }
    wasOpen = open;
  });

  async function loadAvailability() {
    try {
      const response = await fetch(`/api/agent-room/runtimes/wsl?path=${encodeURIComponent(workspaceRoot)}`);
      availability = (await response.json()).data ?? availability;
      if (!distribution && availability.inferred) distribution = availability.inferred.distribution;
      if (!linuxWorkingDir && availability.inferred) linuxWorkingDir = availability.inferred.linuxWorkingDir;
    } catch {
      availability = { supported: false, distributions: [], inferred: null, error: null };
    }
  }

  async function save() {
    if (busy || (mode === 'wsl' && !distribution)) return;
    busy = true;
    errorMessage = '';
    try {
      await onSave({
        mode,
        wslDistribution: mode === 'wsl' ? distribution : null,
        wslWorkingDir: mode === 'wsl' ? linuxWorkingDir.trim() || null : null,
      });
      onClose();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['term.runtime_change_error']();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>{m['term.runtime_title']()}</Dialog.Title>
      <Dialog.Description>{m['term.runtime_description']()}</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-4">
      <div class="grid gap-1.5">
        <span class="text-ui-lg font-medium">{m['dlg.runtime_label']()}</span>
        <!-- Poucas opcoes mutuamente exclusivas: controle segmentado. -->
        <SegmentedControl
          class="w-fit max-w-full"
          label={m['dlg.runtime_label']()}
          value={mode}
          onValueChange={(value) => (mode = value)}
          options={[
            { value: 'default', label: m['term.runtime_default_option']({ runtime: workspaceRuntimeLabel }) },
            { value: 'native', label: m['dlg.runtime_native']() },
            ...(availability.supported ? [{ value: 'wsl' as const, label: m['dlg.runtime_wsl']() }] : []),
          ]}
        />
        <p class="flex items-start gap-1.5 text-ui-md leading-snug text-pretty text-muted-foreground"><RotateCcw size={13} class="mt-0.5 shrink-0" aria-hidden="true" />{m['term.runtime_restart_hint']()}</p>
      </div>

      {#if mode === 'wsl'}
        <div class="grid gap-3 border-t border-[var(--app-border)] pt-4">
          <div class="grid gap-1.5">
            <label class="text-ui-lg font-medium" for="terminal-wsl-distribution">{m['dlg.wsl_distribution']()}</label>
            <Select.Root type="single" value={distribution} onValueChange={(value: string) => (distribution = value)}>
              <Select.Trigger id="terminal-wsl-distribution" class="w-full">
                <span class="truncate">{distribution || m['dlg.wsl_distribution_placeholder']()}</span>
              </Select.Trigger>
              <Select.Content>
                {#each availability.distributions as item (item.name)}
                  <Select.Item value={item.name}>{item.name}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>

          <div class="grid gap-1.5">
            <label class="text-ui-lg font-medium" for="terminal-wsl-path">{m['dlg.wsl_working_dir']()}</label>
            <Input id="terminal-wsl-path" bind:value={linuxWorkingDir} placeholder="/home/user/project" autocomplete="off" spellcheck={false} class="font-mono text-[12px]" />
            <p class="text-ui-md text-pretty text-muted-foreground">{m['term.runtime_path_hint']()}</p>
          </div>

          {#if !availability.distributions.length}
            <p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{availability.error || m['dlg.wsl_unavailable']()}</span></p>
          {/if}
        </div>
      {/if}

      {#if errorMessage}<p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{errorMessage}</span></p>{/if}
    </div>

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={onClose}>{m['dlg.cancel']()}</Button>
      <Button type="button" disabled={busy || (mode === 'wsl' && !distribution)} onclick={save}>
        {#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{/if}
        {busy ? m['term.runtime_saving']() : m['dlg.save']()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
