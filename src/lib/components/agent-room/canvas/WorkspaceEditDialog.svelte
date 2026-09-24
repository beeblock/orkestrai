<script lang="ts">
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { z } from 'zod';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Form from '$lib/components/ui/form';
  import { Input } from '$lib/components/ui/input';
  import * as InputGroup from '$lib/components/ui/input-group';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';
  import { CircleAlert, CircleCheck, FolderGit2, FolderOpen, LoaderCircle, Plus, Trash2, Waypoints } from '@lucide/svelte';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import { onMount } from 'svelte';
  import McpIcon from '../McpIcon.svelte';
  import { isLegacyEmojiIcon, WORKSPACE_ICONS } from '../workspace-icons.js';
  import type { CodeIntelligenceMode, Workspace, WorkspaceRepositoryRoot } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type Props = {
    workspace: Workspace;
    onSave: (changes: {
      name: string;
      workingDir: string;
      icon: string | null;
      instructions: string | null;
      syncAgentInstructionFiles: boolean;
      runtimeKind: 'native' | 'wsl';
      wslDistribution: string | null;
      wslWorkingDir: string | null;
      repositoryRoots: WorkspaceRepositoryRoot[];
      codeIntelligenceMode: CodeIntelligenceMode;
    }) => Promise<void>;
    onClose: () => void;
  };

  type EditWorkspaceFormData = {
    name: string;
    workingDir: string;
    icon: string | null;
    instructions: string | null;
    syncAgentInstructionFiles: boolean;
  };

  let { workspace, onSave, onClose }: Props = $props();

  let submitError = $state('');
  let presetState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let presetMessage = $state('');
  let runtimeKind = $state<'native' | 'wsl'>(workspace.runtimeKind);
  let wslDistribution = $state(workspace.wslDistribution ?? '');
  let wslWorkingDir = $state(workspace.wslWorkingDir ?? '');
  let repositoryRoots = $state<WorkspaceRepositoryRoot[]>(
    (workspace.repositoryRoots ?? []).map((repository) => ({ ...repository })),
  );
  let codeIntelligenceMode = $state<CodeIntelligenceMode>(workspace.codeIntelligenceMode);
  let wsl = $state<{ supported: boolean; distributions: Array<{ name: string }>; inferred: { distribution: string; linuxWorkingDir: string } | null; error: string | null }>({
    supported: false,
    distributions: [],
    inferred: null,
    error: null,
  });

  // -- Servidores MCP do workspace (.mcp.json) ---------------------------------
  type McpServer = { name: string; command: string; args: string[]; builtin: boolean };
  let mcps = $state<McpServer[]>([]);
  let mcpName = $state('');
  let mcpCommand = $state('');
  let mcpArgs = $state('');
  let mcpError = $state('');

  function mutationHeaders(json = false): Record<string, string> {
    const token = getCsrfToken();
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'X-CSRF-Token': token } : {}),
    };
  }

  async function loadMcps() {
    try {
      const response = await fetch(`/api/agent-room/workspaces/${workspace.id}/mcps`);
      mcps = (await response.json()).data ?? [];
    } catch {
      mcps = [];
    }
  }

  async function addMcp() {
    mcpError = '';
    const response = await fetch(`/api/agent-room/workspaces/${workspace.id}/mcps`, {
      method: 'POST',
      headers: mutationHeaders(true),
      body: JSON.stringify({ name: mcpName, command: mcpCommand, args: mcpArgs }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      mcpError = payload.error || m['dlg.edit_mcp_add_error']();
      return;
    }
    mcps = payload.data;
    mcpName = '';
    mcpCommand = '';
    mcpArgs = '';
  }

  async function removeMcp(name: string) {
    const response = await fetch(`/api/agent-room/workspaces/${workspace.id}/mcps?name=${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: mutationHeaders(),
    });
    const payload = await response.json();
    if (payload.data) mcps = payload.data;
  }

  /** Snapshot do workspace atual como preset reutilizavel (time, layout, roles...). */
  async function saveAsPreset() {
    presetState = 'saving';
    presetMessage = '';
    try {
      const response = await fetch('/api/agent-room/presets', {
        method: 'POST',
        headers: mutationHeaders(true),
        body: JSON.stringify({ workspaceId: workspace.id, name: workspace.name, icon: workspace.icon }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || m['dlg.preset_save_error']());
      presetState = 'saved';
      presetMessage = m['dlg.preset_saved']({ name: payload.data.name });
    } catch (error) {
      presetState = 'error';
      presetMessage = error instanceof Error ? error.message : m['dlg.preset_save_error']();
    }
  }

  const desktop = typeof window !== 'undefined'
    ? (window as unknown as { orkestraiDesktop?: { pickDirectory: () => Promise<string | null> } }).orkestraiDesktop
    : undefined;

  // Variante do schema compartilhado com todos os campos presentes (o form
  // sempre envia o estado completo do workspace).
  const editWorkspaceFormSchema = z.object({
    name: z.string().trim().min(1, m['dlg.ws_name_required']()),
    workingDir: z.string().trim().min(1, m['dlg.ws_dir_required']()),
    icon: z.string().trim().nullable(),
    instructions: z.string().trim().nullable(),
    syncAgentInstructionFiles: z.boolean(),
  });
  // Cast por causa do zod aninhado do superforms (4.x) vs zod 3.25 do app.
  const schema = editWorkspaceFormSchema as unknown as Parameters<typeof zod>[0];

  const form = superForm(
    defaults(
      {
        name: workspace.name,
        workingDir: workspace.workingDir,
        icon: workspace.icon ?? null,
        instructions: workspace.instructions ?? null,
        syncAgentInstructionFiles: workspace.syncAgentInstructionFiles,
      },
      zod(schema)
    ),
    {
      SPA: true,
      validators: zod(schema),
      async onUpdate({ form: f }) {
        if (!f.valid) return;
        submitError = '';
        try {
          const normalizedRepositories = repositoryRoots.map((repository) => ({
            alias: repository.alias.trim().toLowerCase(),
            path: repository.path.trim(),
          }));
          const aliases = new Set(normalizedRepositories.map((repository) => repository.alias));
          if (
            normalizedRepositories.some((repository) => !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(repository.alias) || !repository.path)
            || aliases.size !== normalizedRepositories.length
          ) {
            submitError = m['dlg.repository_roots_invalid']();
            return;
          }
          const data = f.data as unknown as EditWorkspaceFormData;
          await onSave({
            name: data.name,
            workingDir: data.workingDir,
            icon: data.icon?.trim() || null,
            instructions: data.instructions?.trim() || null,
            syncAgentInstructionFiles: data.syncAgentInstructionFiles,
            runtimeKind,
            wslDistribution: wslDistribution.trim() || null,
            wslWorkingDir: wslWorkingDir.trim() || null,
            repositoryRoots: normalizedRepositories,
            codeIntelligenceMode,
          });
          onClose();
        } catch (error) {
          submitError = error instanceof Error ? error.message : m['dlg.ws_save_error']();
        }
      },
    }
  );

  const { form: formData, enhance } = form;

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

  onMount(() => {
    void loadMcps();
    void loadWslAvailability(workspace.workingDir);
  });

  async function loadWslAvailability(path = '') {
    try {
      const response = await fetch(`/api/agent-room/runtimes/wsl${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      wsl = (await response.json()).data ?? wsl;
      if (wsl.inferred) {
        runtimeKind = 'wsl';
        wslDistribution ||= wsl.inferred.distribution;
        wslWorkingDir ||= wsl.inferred.linuxWorkingDir;
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
      if (wsl.inferred) {
        runtimeKind = 'wsl';
        wslDistribution = wsl.inferred.distribution;
        wslWorkingDir = wsl.inferred.linuxWorkingDir;
      }
    }
  }

  function repositoryAlias(path: string): string {
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'repository';
    const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'repository';
    let alias = base.slice(0, 48);
    let suffix = 2;
    while (repositoryRoots.some((repository) => repository.alias === alias)) {
      const marker = `-${suffix++}`;
      alias = `${base.slice(0, 48 - marker.length)}${marker}`;
    }
    return alias;
  }

  function appendRepository(path = '') {
    repositoryRoots = [...repositoryRoots, { alias: repositoryAlias(path), path }];
  }

  async function addRepository() {
    if (!desktop) {
      appendRepository();
      return;
    }
    const path = await desktop.pickDirectory();
    if (path) appendRepository(path);
  }

  async function pickRepository(index: number) {
    if (!desktop) return;
    const path = await desktop.pickDirectory();
    if (!path) return;
    repositoryRoots[index].path = path;
    if (!repositoryRoots[index].alias.trim()) repositoryRoots[index].alias = repositoryAlias(path);
  }

  function removeRepository(index: number) {
    repositoryRoots = repositoryRoots.filter((_, candidate) => candidate !== index);
  }
</script>

{#snippet fieldError({ errors, errorProps }: { errors: string[]; errorProps: Record<string, unknown> })}
  {#each errors as error (error)}
    <p {...errorProps} class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{error}</p>
  {/each}
{/snippet}

<Dialog.Root open onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="flex max-h-[min(90dvh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
    <Dialog.Header class="shrink-0 border-b border-border/70 px-5 pt-5 pb-4 pr-12">
      <Dialog.Title>{m['dlg.edit_ws_title']()}</Dialog.Title>
      <Dialog.Description>{m['dlg.edit_ws_desc']()}</Dialog.Description>
    </Dialog.Header>

    <form method="POST" use:enhance class="flex min-h-0 flex-1 flex-col">
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-6 overflow-y-auto overscroll-contain px-5 py-5">
        <!-- Geral: nome, diretorio e icone. -->
        <section class="grid gap-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <Form.Field {form} name="name" class="min-w-0 space-y-1.5">
              <Form.Control>
                {#snippet children({ props })}
                  <Form.Label class="text-[13px]">{m['dlg.name']()}</Form.Label>
                  <Input {...props} bind:value={$formData.name} autocomplete="off" />
                {/snippet}
              </Form.Control>
              <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
            </Form.Field>

            <Form.Field {form} name="workingDir" class="min-w-0 space-y-1.5">
              <Form.Control>
                {#snippet children({ props })}
                  <Form.Label class="text-[13px]">{m['dlg.working_dir']()}</Form.Label>
                  <div class="flex min-w-0 gap-2">
                    <Input {...props} bind:value={$formData.workingDir} autocomplete="off" spellcheck={false} class="min-w-0 flex-1 font-mono text-[12px]" title={$formData.workingDir} readonly={runtimeKind === 'wsl'} />
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
              <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
            </Form.Field>
          </div>

          <div class="grid gap-1.5">
            <span class="text-ui-lg font-medium" id="workspace-icon-label">{m['dlg.ws_icon']()}</span>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5" role="radiogroup" aria-labelledby="workspace-icon-label">
              {#each WORKSPACE_ICONS as option (option.name)}
                {@const OptionIcon = option.component}
                <button
                  type="button"
                  class="icon-choice"
                  role="radio"
                  aria-checked={($formData.icon ?? null) === option.name}
                  aria-label={option.name}
                  title={option.name}
                  onclick={() => ($formData.icon = ($formData.icon ?? null) === option.name ? null : option.name)}
                >
                  <OptionIcon size={15} aria-hidden="true" />
                </button>
              {/each}
            </div>
            {#if isLegacyEmojiIcon(typeof $formData.icon === 'string' ? $formData.icon : null)}
              <p class="m-0 text-ui-md text-muted-foreground">{m['dlg.icon_legacy_hint']({ icon: $formData.icon ?? '' })}</p>
            {/if}
          </div>
        </section>

        {#if wsl.supported}
          <section class="grid gap-3 border-t border-border/70 pt-5">
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
              <p class="text-ui-md text-muted-foreground text-pretty">{m['dlg.runtime_change_hint']()}</p>
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
                  <label class="text-ui-lg font-medium" for="wsl-working-dir">{m['dlg.wsl_working_dir']()}</label>
                  <Input id="wsl-working-dir" bind:value={wslWorkingDir} placeholder="/home/user/project" autocomplete="off" spellcheck={false} class="font-mono text-[12px]" />
                </div>
                <p class="text-ui-md text-muted-foreground text-pretty sm:col-span-2">{m['dlg.wsl_working_dir_hint']()}</p>
              </div>
              {#if !wsl.distributions.length}
                <p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{wsl.error || m['dlg.wsl_unavailable']()}</span></p>
              {/if}
            {/if}
          </section>
        {/if}

        <!-- Instrucoes que viram AGENTS.md/CLAUDE.md. -->
        <section class="grid gap-3 border-t border-border/70 pt-5">
          <Form.Field {form} name="instructions" class="space-y-1.5">
            <Form.Control>
              {#snippet children({ props })}
                <Form.Label class="text-[13px]">{m['dlg.agent_instructions']()}</Form.Label>
                <Textarea {...props} bind:value={$formData.instructions} rows={5} autocomplete="off" placeholder={m['ph.ws_instructions']()} class="min-h-28 resize-y" />
              {/snippet}
            </Form.Control>
            <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
          </Form.Field>

          <Form.Field {form} name="syncAgentInstructionFiles" class="space-y-1">
            <Form.Control>
              {#snippet children({ props })}
                <div class="flex items-center gap-2.5">
                  <Checkbox {...props} checked={$formData.syncAgentInstructionFiles} onCheckedChange={(value: boolean | 'indeterminate') => ($formData.syncAgentInstructionFiles = value === true)} />
                  <Form.Label class="cursor-pointer text-[13px] font-normal">{m['dlg.sync_instruction_files']()}</Form.Label>
                </div>
              {/snippet}
            </Form.Control>
            <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
          </Form.Field>
        </section>

        <section class="grid gap-3 border-t border-border/70 pt-5" data-testid="workspace-repository-roots">
          <div class="flex items-start justify-between gap-4">
            <div class="grid min-w-0 gap-1">
              <h3 class="flex items-center gap-2 text-ui-lg font-medium">
                <FolderGit2 size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['dlg.repository_roots_title']()}
              </h3>
              <p class="max-w-xl text-ui-md text-pretty text-muted-foreground">{m['dlg.repository_roots_desc']()}</p>
            </div>
            <Button type="button" variant="outline" size="sm" class="shrink-0" onclick={addRepository}>
              <Plus aria-hidden="true" />{m['dlg.repository_roots_add']()}
            </Button>
          </div>

          {#if repositoryRoots.length}
            <div class="grid gap-2">
              {#each repositoryRoots as repository, index (index)}
                <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(8rem,0.65fr)_minmax(0,1.35fr)_auto]">
                  <div class="min-w-0">
                    <label class="sr-only" for={`repository-alias-${index}`}>{m['dlg.repository_roots_alias']()}</label>
                    <InputGroup.Root>
                      <InputGroup.Addon>@</InputGroup.Addon>
                      <InputGroup.Input id={`repository-alias-${index}`} bind:value={repository.alias} autocomplete="off" spellcheck={false} placeholder="api-tests" />
                    </InputGroup.Root>
                  </div>
                  <div class="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-auto">
                    <label class="sr-only" for={`repository-path-${index}`}>{m['dlg.repository_roots_path']()}</label>
                    <Input id={`repository-path-${index}`} bind:value={repository.path} autocomplete="off" spellcheck={false} placeholder={m['dlg.repository_roots_path']()} title={repository.path} class="min-w-0 font-mono text-[12px]" />
                  </div>
                  <div class="col-start-2 row-start-1 flex shrink-0 items-center gap-0.5 sm:col-auto sm:row-auto">
                    {#if desktop}
                      <Tooltip.Root>
                        <Tooltip.Trigger>
                          {#snippet child({ props })}
                            <Button {...props} type="button" variant="ghost" size="icon" aria-label={m['dlg.pick_folder']()} onclick={() => pickRepository(index)}>
                              <FolderOpen size={14} aria-hidden="true" />
                            </Button>
                          {/snippet}
                        </Tooltip.Trigger>
                        <Tooltip.Content side="top">{m['dlg.pick_folder']()}</Tooltip.Content>
                      </Tooltip.Root>
                    {/if}
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <Button {...props} type="button" variant="ghost" size="icon" class="text-muted-foreground hover:text-destructive" aria-label={m['dlg.repository_roots_remove']({ alias: repository.alias || String(index + 1) })} onclick={() => removeRepository(index)}>
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content side="top">{m['dlg.repository_roots_remove']({ alias: repository.alias || String(index + 1) })}</Tooltip.Content>
                    </Tooltip.Root>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>

        <section class="grid gap-3 border-t border-border/70 pt-5" data-testid="workspace-code-intelligence-mode">
          <div class="grid gap-1">
            <h3 class="flex items-center gap-2 text-ui-lg font-medium">
              <Waypoints size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['dlg.code_intelligence_title']()}
            </h3>
            <p class="max-w-xl text-ui-md text-pretty text-muted-foreground">{m['dlg.code_intelligence_description']()}</p>
          </div>
          <!-- Tres modos: controle segmentado + explicacao do modo escolhido. -->
          <SegmentedControl
            class="w-fit max-w-full"
            label={m['dlg.code_intelligence_title']()}
            value={codeIntelligenceMode}
            onValueChange={(value) => (codeIntelligenceMode = value)}
            options={[
              { value: 'assisted', label: m['dlg.code_intelligence_assisted']() },
              { value: 'manual', label: m['dlg.code_intelligence_manual']() },
              { value: 'disabled', label: m['dlg.code_intelligence_disabled']() },
            ]}
          />
          <p class="rounded-lg bg-[var(--app-hover)] px-3 py-2.5 text-ui-md leading-relaxed text-pretty text-[var(--app-text-soft)]" aria-live="polite">
            {codeIntelligenceMode === 'assisted'
              ? m['dlg.code_intelligence_assisted_description']()
              : codeIntelligenceMode === 'manual'
                ? m['dlg.code_intelligence_manual_description']()
                : m['dlg.code_intelligence_disabled_description']()}
          </p>
        </section>

        <section class="grid gap-3 border-t border-border/70 pt-5">
          <div class="grid gap-1">
            <h3 class="flex items-center gap-2 text-ui-lg font-medium">
              <McpIcon size={13} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['dlg.mcp_title']()}
            </h3>
            <p class="text-ui-md text-pretty text-muted-foreground">{m['dlg.mcp_desc']()}</p>
          </div>
          {#if mcps.length}
            <ul class="grid gap-1">
              {#each mcps as server (server.name)}
                <li class="flex min-h-9 min-w-0 items-center gap-2.5 rounded-lg bg-[var(--app-hover)] py-1 pr-1 pl-3">
                  <span class="shrink-0 text-ui-lg font-medium">{server.name}</span>
                  <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={`${server.command} ${server.args.join(' ')}`}>{server.command} {server.args.join(' ')}</span>
                  {#if server.builtin}
                    <span class="mr-2 shrink-0 rounded-full bg-[var(--app-hover)] px-2 py-0.5 text-ui-xs text-[var(--app-text-soft)]">{m['dlg.mcp_builtin']()}</span>
                  {:else}
                    <Button type="button" variant="ghost" size="icon-sm" class="shrink-0 text-muted-foreground hover:text-destructive" aria-label={m['dlg.mcp_remove']({ name: server.name })} title={m['dlg.mcp_remove']({ name: server.name })} onclick={() => removeMcp(server.name)}>
                      <Trash2 size={13} aria-hidden="true" />
                    </Button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          <div class="grid gap-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <Input name="mcp-name" aria-label={m['ph.mcp_name']()} bind:value={mcpName} autocomplete="off" spellcheck={false} placeholder={m['ph.mcp_name']()} class="h-8 min-w-0 text-[13px]" />
            <Input name="mcp-command" aria-label={m['ph.mcp_command']()} bind:value={mcpCommand} autocomplete="off" spellcheck={false} placeholder={m['ph.mcp_command']()} class="h-8 min-w-0 text-[13px]" />
            <div class="flex min-w-0 gap-2 sm:col-span-2">
              <Input name="mcp-args" aria-label={m['ph.mcp_args']()} bind:value={mcpArgs} autocomplete="off" spellcheck={false} placeholder={m['ph.mcp_args']()} class="h-8 min-w-0 flex-1 text-[13px]" />
              <Button type="button" variant="outline" class="shrink-0" disabled={!mcpName.trim() || !mcpCommand.trim()} onclick={addMcp}>
                <Plus aria-hidden="true" />{m['dlg.add']()}
              </Button>
            </div>
          </div>
          {#if mcpError}
            <p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{mcpError}</span></p>
          {/if}
        </section>

        <section class="grid gap-2 border-t border-border/70 pt-5">
          <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-ui-md text-pretty text-muted-foreground">{m['dlg.preset_hint']()}</p>
            <Button type="button" variant="outline" size="sm" class="shrink-0" disabled={presetState === 'saving'} onclick={saveAsPreset}>
              {#if presetState === 'saving'}<LoaderCircle class="animate-spin" aria-hidden="true" />{/if}
              {presetState === 'saving' ? m['dlg.saving']() : m['dlg.save_as_preset']()}
            </Button>
          </div>
          {#if presetMessage}
            {#if presetState === 'error'}
              <p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{presetMessage}</span></p>
            {:else}
              <p class="flex items-center gap-2 text-ui-md text-[var(--app-success)]" role="status"><CircleCheck size={14} class="shrink-0" aria-hidden="true" /><span>{presetMessage}</span></p>
            {/if}
          {/if}
        </section>

        {#if submitError}
          <p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{submitError}</span></p>
        {/if}
      </div>

      <Dialog.Footer class="m-0 shrink-0">
        <Button type="button" variant="outline" onclick={onClose}>{m['dlg.cancel']()}</Button>
        <Button type="submit">{m['dlg.save']()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* Grade de icones: selecionado usa acento suave (a cor forte fica no botao primario). */
  .icon-choice {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-height: 36px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    box-shadow: var(--app-shadow-border);
    color: var(--app-text-muted);
    cursor: pointer;
    transition:
      background-color var(--duration-quick) ease-out,
      color var(--duration-quick) ease-out,
      box-shadow var(--duration-quick) ease-out;
  }

  .icon-choice:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .icon-choice[aria-checked='true'] {
    background: var(--app-accent-soft);
    box-shadow: inset 0 0 0 1px var(--app-accent);
    color: var(--app-accent);
  }

  .icon-choice:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .icon-choice:active {
    scale: 0.96;
  }
</style>
