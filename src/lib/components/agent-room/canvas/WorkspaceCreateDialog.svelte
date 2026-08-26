<script lang="ts">
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Form from '$lib/components/ui/form';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { FolderOpen } from '@lucide/svelte';
  import * as Select from '$lib/components/ui/select';
  import WorkspaceIcon from '../WorkspaceIcon.svelte';
  import { createWorkspaceSchema } from '$lib/modules/agent-room/contracts/schemas/workspaceSchemas.js';
  import type { Workspace, WorkspaceGroup } from '$lib/modules/agent-room/domain/types.js';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { getCsrfToken } from '@beeblock/svelar/http';

  type PresetSummary = { id: string; name: string; icon: string | null; description: string | null; agents: number };
  type WslAvailability = {
    supported: boolean;
    distributions: Array<{ name: string }>;
    inferred: { distribution: string; linuxWorkingDir: string } | null;
    error: string | null;
  };

  type Props = {
    open: boolean;
    initialPresetId?: string;
    groups?: WorkspaceGroup[];
    initialGroupId?: string | null;
    onCreated: (workspace: Workspace) => void;
    onClose: () => void;
  };

  let { open, initialPresetId = '', groups = [], initialGroupId = null, onCreated, onClose }: Props = $props();

  let submitError = $state('');
  let presets = $state<PresetSummary[]>([]);
  let presetId = $state('');

  // Lista achatada com indentacao — as pastas tem profundidade ilimitada.
  const groupOptions = $derived.by(() => {
    const byParent = new Map<string | null, WorkspaceGroup[]>();
    for (const group of groups) {
      const list = byParent.get(group.parentId) ?? [];
      list.push(group);
      byParent.set(group.parentId, list);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);
    const result: Array<{ id: string; name: string; depth: number }> = [];
    const visited = new Set<string>();
    const walk = (parentId: string | null, depth: number) => {
      for (const group of byParent.get(parentId) ?? []) {
        if (visited.has(group.id)) continue;
        visited.add(group.id);
        result.push({ id: group.id, name: group.name, depth });
        walk(group.id, depth + 1);
      }
    };
    walk(null, 0);
    return result;
  });
  let runtimeKind = $state<'native' | 'wsl'>('native');
  let wslDistribution = $state('');
  let wslWorkingDir = $state('');
  let wsl = $state<WslAvailability>({ supported: false, distributions: [], inferred: null, error: null });

  function csrfHeaders(extra: Record<string, string> = {}): HeadersInit {
    const token = getCsrfToken();
    return token ? { ...extra, 'X-CSRF-Token': token } : extra;
  }

  onMount(async () => {
    try {
      const response = await fetch(`/api/agent-room/presets?scope=all&locale=${encodeURIComponent(localeState.current)}`);
      presets = (await response.json()).data ?? [];
    } catch {
      presets = [];
    }
    await loadWslAvailability();
  });

  $effect(() => {
    if (open && initialPresetId) presetId = initialPresetId;
  });

  let lastOpen = false;
  $effect(() => {
    if (open && !lastOpen) $formData.groupId = initialGroupId;
    lastOpen = open;
  });

  const desktop = typeof window !== 'undefined'
    ? (window as unknown as { orkestraiDesktop?: { pickDirectory: () => Promise<string | null> } }).orkestraiDesktop
    : undefined;

  // O adapter resolve 'zod/v3' pelo zod aninhado do superforms (4.x compat);
// nosso zod e 3.25 — os tipos divergem minimamente, entao normalizamos aqui.
const schema = createWorkspaceSchema as unknown as Parameters<typeof zod>[0];
const form = superForm(defaults(zod(schema)), {
    SPA: true,
    validators: zod(schema),
    async onUpdate({ form: f }) {
      if (!f.valid) return;
      submitError = '';
      try {
        let workspace: Workspace;
        if (presetId) {
          const applyResponse = await fetch(`/api/agent-room/presets/${presetId}/apply`, {
            method: 'POST',
            headers: csrfHeaders({ 'content-type': 'application/json' }),
            body: JSON.stringify({ ...f.data, runtimeKind, wslDistribution: wslDistribution || null, wslWorkingDir: wslWorkingDir || null, locale: localeState.current }),
          });
          const applyPayload = await applyResponse.json();
          if (!applyResponse.ok || applyPayload.error) throw new Error(applyPayload.error || m['dlg.preset_apply_error']());
          const workspaceResponse = await fetch(`/api/agent-room/workspaces/${applyPayload.data.workspaceId}`);
          const workspacePayload = await workspaceResponse.json();
          if (!workspaceResponse.ok || workspacePayload.error) throw new Error(workspacePayload.error || m['dlg.ws_create_error']());
          workspace = workspacePayload.data as Workspace;
        } else {
          const response = await fetch('/api/agent-room/workspaces', {
            method: 'POST',
            headers: csrfHeaders({ 'content-type': 'application/json' }),
            body: JSON.stringify({ ...f.data, runtimeKind, wslDistribution: wslDistribution || null, wslWorkingDir: wslWorkingDir || null }),
          });
          const payload = await response.json();
          if (!response.ok || payload.error) throw new Error(payload.error || m['dlg.ws_create_error']());
          workspace = payload.data as Workspace;
        }
        onCreated(workspace);
        onClose();
      } catch (error) {
        submitError = error instanceof Error ? error.message : m['dlg.ws_create_error']();
      }
    },
  });

  const { form: formData, enhance, errors } = form;

  function wslHostPath(distribution: string, linuxPath: string): string {
    const tail = linuxPath.replace(/^\/+/, '').split('/').filter(Boolean).join('\\');
    return `\\\\wsl.localhost\\${distribution}${tail ? `\\${tail}` : ''}`;
  }

  // Em WSL o diretório host é derivado do caminho Linux, mantendo os dois
  // sempre em sincronia (o backend recusa um host que não corresponda).
  $effect(() => {
    if (runtimeKind !== 'wsl') return;
    const linux = wslWorkingDir.trim();
    if (wslDistribution && linux.startsWith('/')) {
      $formData.workingDir = wslHostPath(wslDistribution, linux);
    }
  });

  async function loadWslAvailability(path = '') {
    try {
      const response = await fetch(`/api/agent-room/runtimes/wsl${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      wsl = (await response.json()).data ?? wsl;
      if (wsl.inferred) {
        runtimeKind = 'wsl';
        wslDistribution = wsl.inferred.distribution;
        wslWorkingDir = wsl.inferred.linuxWorkingDir;
      }
    } catch {
      wsl = { supported: false, distributions: [], inferred: null, error: null };
    }
  }

  async function pickDirectory() {
    if (!desktop) return;
    const dir = await desktop.pickDirectory();
    if (dir) {
      $formData.workingDir = dir;
      await loadWslAvailability(dir);
    }
  }
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m['dlg.new_ws_title']()}</Dialog.Title>
      <Dialog.Description>{m['dlg.new_ws_desc']()}</Dialog.Description>
    </Dialog.Header>

    <form method="POST" use:enhance class="space-y-4">
      <Form.Field {form} name="name">
        <Form.Control>
          {#snippet children({ props })}
            <Form.Label>{m['dlg.name']()}</Form.Label>
            <Input {...props} bind:value={$formData.name} placeholder={m['ph.ws_name']()} />
          {/snippet}
        </Form.Control>
        <Form.FieldErrors />
      </Form.Field>

      {#if groupOptions.length}
        <Form.Field {form} name="groupId">
          <Form.Control>
            {#snippet children({ props })}
              <Form.Label>{m['dlg.ws_folder_label']()}</Form.Label>
              <Select.Root type="single" value={$formData.groupId || '__root__'} onValueChange={(value: string) => ($formData.groupId = value === '__root__' ? null : value)}>
                <Select.Trigger {...props} class="w-full">
                  {$formData.groupId ? groupOptions.find((option) => option.id === $formData.groupId)?.name : m['dlg.ws_folder_root']()}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="__root__" label={m['dlg.ws_folder_root']()} />
                  {#each groupOptions as option (option.id)}
                    <Select.Item value={option.id} label={option.name}>
                      <span style:padding-left={`${option.depth * 12}px`}>{option.name}</span>
                    </Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            {/snippet}
          </Form.Control>
          <Form.FieldErrors />
        </Form.Field>
      {/if}

      {#if wsl.supported}
        <div class="grid gap-4 rounded-md border border-border/70 bg-muted/20 p-3 sm:grid-cols-2">
          <div class="space-y-2">
            <span class="text-sm font-medium leading-none">{m['dlg.runtime_label']()}</span>
            <Select.Root
              type="single"
              value={runtimeKind}
              onValueChange={(value: string) => (runtimeKind = value === 'wsl' ? 'wsl' : 'native')}
            >
              <Select.Trigger class="w-full">
                {runtimeKind === 'wsl' ? m['dlg.runtime_wsl']() : m['dlg.runtime_native']()}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="native">{m['dlg.runtime_native']()}</Select.Item>
                <Select.Item value="wsl">{m['dlg.runtime_wsl']()}</Select.Item>
              </Select.Content>
            </Select.Root>
            <p class="text-xs text-muted-foreground">{m['dlg.runtime_hint']()}</p>
          </div>

          {#if runtimeKind === 'wsl'}
            <div class="space-y-2">
              <span class="text-sm font-medium leading-none">{m['dlg.wsl_distribution']()}</span>
              <Select.Root type="single" value={wslDistribution} onValueChange={(value: string) => (wslDistribution = value)}>
                <Select.Trigger class="w-full">
                  {wslDistribution || m['dlg.wsl_distribution_placeholder']()}
                </Select.Trigger>
                <Select.Content>
                  {#each wsl.distributions as distribution (distribution.name)}
                    <Select.Item value={distribution.name}>{distribution.name}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>

            <div class="space-y-2 sm:col-span-2">
              <label class="text-sm font-medium leading-none" for="new-wsl-working-dir">{m['dlg.wsl_working_dir']()}</label>
              <Input id="new-wsl-working-dir" bind:value={wslWorkingDir} placeholder="/home/user/project" autocomplete="off" />
              <p class="text-xs text-muted-foreground">{m['dlg.wsl_working_dir_hint']()}</p>
            </div>
            {#if !wsl.distributions.length}
              <p class="text-xs text-destructive sm:col-span-2" role="alert">{wsl.error || m['dlg.wsl_unavailable']()}</p>
            {/if}
          {/if}
        </div>
      {/if}

      <Form.Field {form} name="workingDir">
        <Form.Control>
          {#snippet children({ props })}
            <Form.Label>{m['dlg.working_dir']()}</Form.Label>
            <div class="flex gap-2">
              <Input {...props} bind:value={$formData.workingDir} placeholder={m['ph.ws_dir']()} class="flex-1" readonly={runtimeKind === 'wsl'} />
              {#if desktop && runtimeKind !== 'wsl'}
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button {...props} type="button" variant="outline" size="icon" aria-label={m['dlg.pick_folder']()} onclick={pickDirectory}>
                        <FolderOpen size={15} />
                      </Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content side="top">{m['dlg.pick_folder']()}</Tooltip.Content>
                </Tooltip.Root>
              {/if}
            </div>
          {/snippet}
        </Form.Control>
        <Form.Description>{m['dlg.new_ws_dir_hint']()}</Form.Description>
        <Form.FieldErrors />
      </Form.Field>

      {#if presets.length}
        <div class="space-y-2">
          <span class="text-sm font-medium leading-none">{m['dlg.preset_start_label']()}</span>
          <Select.Root type="single" value={presetId} onValueChange={(value: string) => (presetId = value === '__none' ? '' : value)}>
            <Select.Trigger data-slot="select-trigger" class="w-full">
              {#if presetId}
                {@const preset = presets.find((item) => item.id === presetId)}
                <span class="preset-option">
                  <WorkspaceIcon name={preset?.icon} size={13} />
                  {preset?.name} ({m['dlg.preset_agents']({ count: String(preset?.agents ?? 0) })})
                </span>
              {:else}
                {m['dlg.preset_blank']()}
              {/if}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="__none">{m['dlg.preset_blank']()}</Select.Item>
              {#each presets as preset (preset.id)}
                <Select.Item value={preset.id}>
                  <span class="preset-option">
                    <WorkspaceIcon name={preset.icon} size={13} />
                    {preset.name} — {m['dlg.preset_agents']({ count: String(preset.agents) })}{preset.description ? ` · ${preset.description}` : ''}
                  </span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
          <p class="text-xs text-muted-foreground">{m['dlg.preset_apply_hint']()}</p>
        </div>
      {/if}

      {#if submitError}
        <p class="text-sm text-destructive">{submitError}</p>
      {/if}

      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={onClose}>{m['dlg.cancel']()}</Button>
        <Button type="submit">{m['dlg.create']()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .preset-option {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
</style>
