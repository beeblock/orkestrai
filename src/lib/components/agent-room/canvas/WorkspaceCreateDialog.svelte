<script lang="ts">
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Form from '$lib/components/ui/form';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { CircleAlert, FolderOpen } from '@lucide/svelte';
  import { SegmentedControl } from '$lib/components/ui/segmented';
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

{#snippet fieldError({ errors, errorProps }: { errors: string[]; errorProps: Record<string, unknown> })}
  {#each errors as error (error)}
    <p {...errorProps} class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{error}</p>
  {/each}
{/snippet}

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-[560px]">
    <Dialog.Header>
      <Dialog.Title>{m['dlg.new_ws_title']()}</Dialog.Title>
      <Dialog.Description>{m['dlg.new_ws_desc']()}</Dialog.Description>
    </Dialog.Header>

    <form method="POST" use:enhance class="grid gap-5">
      <!-- Grupo 1: identidade (nome e pasta da barra lateral). -->
      <div class="grid gap-3" class:sm:grid-cols-2={groupOptions.length > 0}>
        <Form.Field {form} name="name" class="min-w-0 space-y-1.5">
          <Form.Control>
            {#snippet children({ props })}
              <Form.Label class="text-[13px]">{m['dlg.name']()}</Form.Label>
              <Input {...props} bind:value={$formData.name} placeholder={m['ph.ws_name']()} autocomplete="off" />
            {/snippet}
          </Form.Control>
          <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
        </Form.Field>

        {#if groupOptions.length}
          <Form.Field {form} name="groupId" class="min-w-0 space-y-1.5">
            <Form.Control>
              {#snippet children({ props })}
                <Form.Label class="text-[13px]">{m['dlg.ws_folder_label']()}</Form.Label>
                <Select.Root type="single" value={$formData.groupId || '__root__'} onValueChange={(value: string) => ($formData.groupId = value === '__root__' ? null : value)}>
                  <Select.Trigger {...props} class="w-full">
                    <span class="truncate">{$formData.groupId ? groupOptions.find((option) => option.id === $formData.groupId)?.name : m['dlg.ws_folder_root']()}</span>
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
            <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
          </Form.Field>
        {/if}
      </div>

      <!-- Grupo 2: onde os agentes trabalham (ambiente + diretorio). -->
      <div class="grid gap-3">
        {#if wsl.supported}
          <div class="grid gap-1.5">
            <span class="text-ui-lg font-medium">{m['dlg.runtime_label']()}</span>
            <SegmentedControl
              class="w-fit max-w-full"
              label={m['dlg.runtime_label']()}
              value={runtimeKind}
              onValueChange={(value) => (runtimeKind = value === 'wsl' ? 'wsl' : 'native')}
              options={[
                { value: 'native', label: m['dlg.runtime_native']() },
                { value: 'wsl', label: m['dlg.runtime_wsl']() },
              ]}
            />
            <p class="text-ui-md text-muted-foreground text-pretty">{m['dlg.runtime_hint']()}</p>
          </div>

          {#if runtimeKind === 'wsl'}
            <div class="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div class="grid min-w-0 content-start gap-1.5">
                <span class="text-ui-lg font-medium">{m['dlg.wsl_distribution']()}</span>
                <Select.Root type="single" value={wslDistribution} onValueChange={(value: string) => (wslDistribution = value)}>
                  <Select.Trigger class="w-full" aria-label={m['dlg.wsl_distribution']()}>
                    <span class="truncate">{wslDistribution || m['dlg.wsl_distribution_placeholder']()}</span>
                  </Select.Trigger>
                  <Select.Content>
                    {#each wsl.distributions as distribution (distribution.name)}
                      <Select.Item value={distribution.name}>{distribution.name}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div class="grid min-w-0 content-start gap-1.5">
                <label class="text-ui-lg font-medium" for="new-wsl-working-dir">{m['dlg.wsl_working_dir']()}</label>
                <Input id="new-wsl-working-dir" bind:value={wslWorkingDir} placeholder="/home/user/project" autocomplete="off" spellcheck={false} class="font-mono text-[13px]" />
              </div>
              <p class="text-ui-md text-muted-foreground text-pretty sm:col-span-2">{m['dlg.wsl_working_dir_hint']()}</p>
            </div>
            {#if !wsl.distributions.length}
              <p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{wsl.error || m['dlg.wsl_unavailable']()}</span></p>
            {/if}
          {/if}
        {/if}

        <Form.Field {form} name="workingDir" class="space-y-1.5">
          <Form.Control>
            {#snippet children({ props })}
              <Form.Label class="text-[13px]">{m['dlg.working_dir']()}</Form.Label>
              <div class="flex gap-2">
                <Input {...props} bind:value={$formData.workingDir} placeholder={m['ph.ws_dir']()} class="min-w-0 flex-1" readonly={runtimeKind === 'wsl'} autocomplete="off" spellcheck={false} />
                {#if desktop && runtimeKind !== 'wsl'}
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button {...props} type="button" variant="outline" size="icon" aria-label={m['dlg.pick_folder']()} onclick={pickDirectory}>
                          <FolderOpen size={15} aria-hidden="true" />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content side="top">{m['dlg.pick_folder']()}</Tooltip.Content>
                  </Tooltip.Root>
                {/if}
              </div>
            {/snippet}
          </Form.Control>
          <Form.Description class="text-[12px] text-pretty">{m['dlg.new_ws_dir_hint']()}</Form.Description>
          <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
        </Form.Field>
      </div>

      {#if presets.length}
        <!-- Grupo 3: ponto de partida opcional. -->
        <div class="grid gap-1.5 border-t border-[var(--app-border)] pt-4">
          <span class="text-ui-lg font-medium">{m['dlg.preset_start_label']()}</span>
          <Select.Root type="single" value={presetId} onValueChange={(value: string) => (presetId = value === '__none' ? '' : value)}>
            <Select.Trigger data-slot="select-trigger" class="w-full" aria-label={m['dlg.preset_start_label']()}>
              {#if presetId}
                {@const preset = presets.find((item) => item.id === presetId)}
                <span class="preset-option min-w-0">
                  <WorkspaceIcon name={preset?.icon} size={13} />
                  <span class="truncate">{preset?.name}</span>
                  <span class="shrink-0 text-muted-foreground">{m['dlg.preset_agents']({ count: String(preset?.agents ?? 0) })}</span>
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
          <p class="text-ui-md text-muted-foreground text-pretty">{m['dlg.preset_apply_hint']()}</p>
        </div>
      {/if}

      {#if submitError}
        <p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{submitError}</span></p>
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
