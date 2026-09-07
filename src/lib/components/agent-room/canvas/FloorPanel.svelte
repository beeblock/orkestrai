<script lang="ts">
  import HeaderIconButton from './HeaderIconButton.svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import * as Form from '$lib/components/ui/form';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Button } from '$lib/components/ui/button';
  import { CheckCircle2, CircleDot, GitBranch, ListChecks, Plane, Play, Trash2, Users, X, Zap } from '@lucide/svelte';
  import { createFloorSchema } from '$lib/modules/agent-room/contracts/schemas/floorSchemas.js';
  import type { Floor, Workspace, WorkspaceHooks } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';

  type Props = {
    workspace: Workspace;
    visibleFloorId: string | null;
    onSelectFloor: (floorId: string | null) => void;
    onClose: () => void;
    api: <T>(path: string, init?: RequestInit) => Promise<T>;
  };

  let { workspace, visibleFloorId, onSelectFloor, onClose, api }: Props = $props();

  type FloorOverview = {
    floor: Floor | null;
    floorId: string | null;
    agents: Array<{ id: string; title: string; provider: string | null; role: string | null; active: boolean; idle: boolean }>;
    tasks: Array<{ id: string; title: string; status: string; assigneeTitle: string | null }>;
    git: { branch: string; dirty: boolean; changedFiles: number; ahead: number; behind: number; lastCommitAt: string | null; lastCommitTitle: string | null; available: boolean };
  };
  type WorkspaceFloorOverview = { ground: FloorOverview; floors: FloorOverview[] };

  // Cast por causa do zod aninhado do superforms (4.x) vs zod 3.25 do app.
  const schema = createFloorSchema as unknown as Parameters<typeof zod>[0];

  let overview = $state<WorkspaceFloorOverview | null>(null);
  const floors = $derived(overview?.floors ?? []);
  let errorMessage = $state('');
  let landingPreview = $state<{ floor: Floor; from: string; to: string; stat: string; conflicts: string[]; targetDirty: boolean } | null>(null);
  let hooks = $state<WorkspaceHooks>({});
  let showHooks = $state(false);
  let hooksText = $state({ setup: '', run: '', teardown: '' });

  const form = superForm(defaults({ name: '', branch: undefined, existingBranch: false, cloneLayout: false }, zod(schema)), {
    SPA: true,
    validators: zod(schema),
    async onUpdate({ form: f }) {
      if (!f.valid) return;
      errorMessage = '';
      try {
        await api(`/api/agent-room/workspaces/${workspace.id}/floors`, {
          method: 'POST',
          body: JSON.stringify({
            name: f.data.name,
            branch: f.data.branch || undefined,
            existingBranch: f.data.existingBranch,
            cloneLayout: f.data.cloneLayout,
          }),
        });
        $formData.name = '';
        $formData.branch = undefined;
        $formData.cloneLayout = false;
        await refresh();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : m['floor.error_create']();
      }
    },
  });

  const { form: formData, enhance } = form;

  async function refresh() {
    overview = await api<WorkspaceFloorOverview>(`/api/agent-room/workspaces/${workspace.id}/floors/overview`);
  }

  async function loadHooks() {
    hooks = await api<WorkspaceHooks>(`/api/agent-room/workspaces/${workspace.id}/hooks`);
    hooksText = {
      setup: (hooks.setup ?? []).map((hook) => hook.command).join('\n'),
      run: (hooks.run ?? []).map((hook) => hook.command).join('\n'),
      teardown: (hooks.teardown ?? []).map((hook) => hook.command).join('\n'),
    };
  }

  async function removeFloor(floor: Floor, deleteBranch: boolean) {
    await api(`/api/agent-room/workspaces/${workspace.id}/floors/${floor.id}?deleteBranch=${deleteBranch}`, {
      method: 'DELETE',
    });
    if (visibleFloorId === floor.id) onSelectFloor(null);
    await refresh();
  }

  async function previewLanding(floor: Floor) {
    errorMessage = '';
    try {
      const preview = await api<{ from: string; to: string; stat: string; conflicts: string[]; targetDirty: boolean }>(
        `/api/agent-room/workspaces/${workspace.id}/floors/${floor.id}/preview`
      );
      landingPreview = { floor, ...preview };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['floor.error_preview']();
    }
  }

  async function confirmLanding() {
    if (!landingPreview) return;
    errorMessage = '';
    try {
      await api(`/api/agent-room/workspaces/${workspace.id}/floors/${landingPreview.floor.id}/land`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (visibleFloorId === landingPreview.floor.id) onSelectFloor(null);
      landingPreview = null;
      await refresh();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['floor.error_land']();
    }
  }

  async function saveHooks() {
    const parse = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).map((command) => ({ command }));
    await api(`/api/agent-room/workspaces/${workspace.id}/hooks`, {
      method: 'PUT',
      body: JSON.stringify({
        setup: parse(hooksText.setup),
        run: parse(hooksText.run),
        teardown: parse(hooksText.teardown),
        autoRunSetup: hooks.autoRunSetup ?? false,
      }),
    });
    showHooks = false;
  }

  async function runHooksNow(floor: Floor, kind: 'setup' | 'run' | 'teardown') {
    errorMessage = '';
    try {
      const results = await api<Array<{ command: string; ok: boolean }>>(
        `/api/agent-room/workspaces/${workspace.id}/floors/${floor.id}/hooks/run`,
        { method: 'POST', body: JSON.stringify({ kind }) }
      );
      const failed = results.filter((result) => !result.ok);
      if (failed.length) errorMessage = m['floor.error_hooks_failed']({ count: failed.length });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['floor.error_hooks_run']();
    }
  }

  $effect(() => {
    refresh();
    loadHooks();
  });

  function taskStatus(status: string): string {
    if (status === 'doing') return m['floor.task_doing']();
    if (status === 'done') return m['floor.task_done']();
    if (status === 'todo') return m['floor.task_todo']();
    return status;
  }

  function activityLabel(value: string | null): string {
    if (!value) return m['floor.no_commits']();
    return new Intl.DateTimeFormat(localeState.current, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }
</script>

<aside class="side-panel">
  <header class="panel-header">
    <h3>{m['floor.title']()}</h3>
    <div class="panel-header-actions">
      <HeaderIconButton label={m['floor.hooks']()} onclick={() => (showHooks = !showHooks)}><Zap size={14} /></HeaderIconButton>
      <HeaderIconButton label={m['floor.close']()} onclick={onClose}><X size={14} /></HeaderIconButton>
    </div>
  </header>

  {#if overview}
    <article class="rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-3 {visibleFloorId === null ? 'border-[var(--app-secondary)]' : ''}" data-tour="floor-overview">
      <button class="flex w-full items-center justify-between gap-2 border-0 bg-transparent p-0 text-left text-[var(--app-text)]" onclick={() => onSelectFloor(null)}>
        <span class="text-xs font-semibold">{m['floor.ground']()}</span>
        {#if overview.ground.git.available}
          <span class="flex items-center gap-1 text-ui-xs text-[var(--app-text-muted)]"><GitBranch size={10} />{overview.ground.git.branch}</span>
        {/if}
      </button>
      <div class="mt-3 grid grid-cols-2 gap-2 text-ui-xs">
        <div class="rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2">
          <span class="mb-1 flex items-center gap-1 text-[var(--app-text-muted)]"><Users size={11} />{m['floor.agents']({ count: overview.ground.agents.length })}</span>
          <div class="flex flex-wrap gap-1">
            {#each overview.ground.agents.slice(0, 4) as agent (agent.id)}
              <span class="max-w-full truncate rounded bg-[var(--app-surface-raised)] px-1.5 py-0.5 text-[var(--app-text-soft)]"><CircleDot size={8} class={agent.active ? 'text-[var(--app-success)]' : 'text-[var(--app-text-muted)]'} /> {agent.title}</span>
            {:else}<span class="text-[var(--app-text-muted)]">{m['floor.no_agents']()}</span>{/each}
          </div>
        </div>
        <div class="rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2">
          <span class="mb-1 flex items-center gap-1 text-[var(--app-text-muted)]"><ListChecks size={11} />{m['floor.tasks']({ count: overview.ground.tasks.length })}</span>
          <span class="text-[var(--app-text-soft)]">{overview.ground.tasks.filter((task) => task.status === 'doing').length} {m['floor.in_progress']()}</span>
        </div>
      </div>
      {#if overview.ground.tasks.length}
        <div class="mt-2 grid gap-1.5 border-t border-[var(--app-border)] pt-2">
          {#each overview.ground.tasks.slice(0, 4) as task (task.id)}
            <div class="grid min-w-0 grid-cols-[12px_1fr_auto] items-start gap-x-1.5 text-ui-xs">
              {#if task.status === 'done'}<CheckCircle2 size={10} class="mt-0.5 text-[var(--app-success)]" />{:else}<CircleDot size={10} class="mt-0.5 {task.status === 'doing' ? 'text-[var(--app-secondary)]' : 'text-[var(--app-text-muted)]'}" />{/if}
              <span class="min-w-0 truncate text-[var(--app-text-soft)]" title={task.title}>{task.title}</span>
              <span class="shrink-0 text-[var(--app-text-muted)]">{taskStatus(task.status)}</span>
              <span class="col-start-2 col-end-4 truncate text-[var(--app-text-muted)]" title={task.assigneeTitle ?? m['floor.unassigned']()}>
                {m['floor.task_assignee']({ name: task.assigneeTitle ?? m['floor.unassigned']() })}
              </span>
            </div>
          {/each}
          {#if overview.ground.tasks.length > 4}
            <span class="text-ui-xs text-[var(--app-text-muted)]">{m['floor.more_tasks']({ count: overview.ground.tasks.length - 4 })}</span>
          {/if}
        </div>
      {/if}
      {#if overview.ground.git.available}
        <p class="mt-2 mb-0 truncate text-ui-xs text-[var(--app-text-muted)]" title={overview.ground.git.lastCommitTitle ?? ''}>
          {overview.ground.git.dirty ? m['floor.changed_files']({ count: overview.ground.git.changedFiles }) : m['floor.clean_worktree']()} · {activityLabel(overview.ground.git.lastCommitAt)}
        </p>
      {/if}
    </article>

    {#each floors as item (item.floorId)}
      {@const floor = item.floor!}
      <article class="rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-3 {visibleFloorId === floor.id ? 'border-[var(--app-secondary)]' : ''}">
        <div class="flex items-start justify-between gap-2">
          <button class="min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-[var(--app-text)]" onclick={() => onSelectFloor(floor.id)}>
            <strong class="block truncate text-xs">{floor.name}</strong>
            <small class="mt-0.5 flex items-center gap-1 truncate text-ui-xs text-[var(--app-text-muted)]"><GitBranch size={10} />{floor.branch}</small>
          </button>
          <div class="floor-actions">
            <HeaderIconButton label={m['floor.preview_landing']()} onclick={() => previewLanding(floor)}><Plane size={13} /></HeaderIconButton>
            <HeaderIconButton label={m['floor.run_hooks']()} onclick={() => runHooksNow(floor, 'run')}><Play size={13} /></HeaderIconButton>
            <HeaderIconButton label={m['floor.delete_keep_branch']()} onclick={() => removeFloor(floor, false)}><X size={13} /></HeaderIconButton>
            <HeaderIconButton label={m['floor.delete_branch']()} danger onclick={() => removeFloor(floor, true)}><Trash2 size={13} /></HeaderIconButton>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-1">
          {#each item.agents as agent (agent.id)}
            <span class="inline-flex max-w-full items-center gap-1 truncate rounded bg-[var(--app-surface-raised)] px-1.5 py-0.5 text-ui-xs text-[var(--app-text-soft)]" title={agent.role ?? agent.provider ?? ''}>
              <CircleDot size={8} class={agent.active ? 'text-[var(--app-success)]' : 'text-[var(--app-text-muted)]'} />{agent.title}
            </span>
          {:else}
            <span class="text-ui-xs text-[var(--app-text-muted)]">{m['floor.no_agents']()}</span>
          {/each}
        </div>

        {#if item.tasks.length}
          <div class="mt-2 grid gap-1">
            {#each item.tasks.slice(0, 4) as task (task.id)}
              <div class="grid min-w-0 grid-cols-[12px_1fr_auto] items-start gap-x-1.5 text-ui-xs">
                {#if task.status === 'done'}<CheckCircle2 size={10} class="mt-0.5 text-[var(--app-success)]" />{:else}<CircleDot size={10} class="mt-0.5 {task.status === 'doing' ? 'text-[var(--app-secondary)]' : 'text-[var(--app-text-muted)]'}" />{/if}
                <span class="min-w-0 truncate text-[var(--app-text-soft)]" title={task.title}>{task.title}</span>
                <span class="shrink-0 text-[var(--app-text-muted)]">{taskStatus(task.status)}</span>
                <span class="col-start-2 col-end-4 truncate text-[var(--app-text-muted)]" title={task.assigneeTitle ?? m['floor.unassigned']()}>
                  {m['floor.task_assignee']({ name: task.assigneeTitle ?? m['floor.unassigned']() })}
                </span>
              </div>
            {/each}
            {#if item.tasks.length > 4}
              <span class="text-ui-xs text-[var(--app-text-muted)]">{m['floor.more_tasks']({ count: item.tasks.length - 4 })}</span>
            {/if}
          </div>
        {/if}

        <div class="mt-2 flex items-center justify-between gap-2 border-t border-[var(--app-border)] pt-2 text-ui-xs">
          <span class={item.git.dirty ? 'text-amber-300' : 'text-emerald-400'}>
            {item.git.available ? (item.git.dirty ? m['floor.changed_files']({ count: item.git.changedFiles }) : m['floor.ready_to_land']()) : m['floor.git_unavailable']()}
          </span>
          {#if item.git.ahead || item.git.behind}
            <span class="text-[var(--app-text-muted)]">↑{item.git.ahead} ↓{item.git.behind}</span>
          {/if}
        </div>
      </article>
    {/each}
  {/if}

  <form method="POST" use:enhance class="floor-form">
    <Form.Field {form} name="name">
      <Form.Control>
        {#snippet children({ props })}
          <Form.Label>{m['floor.name_label']()}</Form.Label>
          <Input {...props} bind:value={$formData.name} placeholder={m['ph.floor_name']()} />
        {/snippet}
      </Form.Control>
      <Form.FieldErrors />
    </Form.Field>

    <Form.Field {form} name="branch">
      <Form.Control>
        {#snippet children({ props })}
          <Form.Label>{m['floor.branch_label']()}</Form.Label>
          <Input {...props} bind:value={$formData.branch} placeholder={m['floor.branch_ph']()} />
        {/snippet}
      </Form.Control>
      <Form.FieldErrors />
    </Form.Field>

    <Form.Field {form} name="cloneLayout">
      <Form.Control>
        {#snippet children({ props })}
          <div class="flex items-center gap-2">
            <Checkbox {...props} checked={$formData.cloneLayout} onCheckedChange={(value: boolean | 'indeterminate') => ($formData.cloneLayout = value === true)} />
            <Form.Label>{m['floor.clone_layout']()}</Form.Label>
          </div>
        {/snippet}
      </Form.Control>
      <Form.FieldErrors />
    </Form.Field>

    {#if errorMessage}
      <p class="text-sm text-destructive">{errorMessage}</p>
    {/if}

    <Button type="submit" size="sm">{m['floor.create']()}</Button>
  </form>

  {#if landingPreview}
    <div class="landing-preview">
      <h4>{m['floor.land_title']({ name: landingPreview.floor.name })}</h4>
      <p class="preview-route">{landingPreview.from} → {landingPreview.to}</p>
      {#if landingPreview.stat}
        <pre>{landingPreview.stat}</pre>
      {:else}
        <p class="muted">{m['floor.no_diff']()}</p>
      {/if}
      {#if landingPreview.conflicts.length}
        <p class="conflict">{m['floor.conflicts']({ list: landingPreview.conflicts.join(', ') })}</p>
      {/if}
      {#if landingPreview.targetDirty}
        <p class="conflict">{m['floor.dirty_warning']()}</p>
      {/if}
      <div class="preview-actions">
        <Button variant="outline" size="sm" onclick={() => (landingPreview = null)}>{m['settings.cancel']()}</Button>
        <Button size="sm" onclick={confirmLanding} disabled={landingPreview.targetDirty}>{m['floor.land']()}</Button>
      </div>
    </div>
  {/if}

  {#if showHooks}
    <div class="hooks-editor">
      <h4>{m['floor.hooks']()}</h4>
      <label>{m['floor.hook_setup']()}<Textarea bind:value={hooksText.setup} rows={2} /></label>
      <label>{m['floor.hook_run']()}<Textarea bind:value={hooksText.run} rows={2} /></label>
      <label>{m['floor.hook_teardown']()}<Textarea bind:value={hooksText.teardown} rows={2} /></label>
      <div class="flex items-center gap-2">
        <Checkbox checked={hooks.autoRunSetup ?? false} onCheckedChange={(value: boolean | 'indeterminate') => (hooks = { ...hooks, autoRunSetup: value === true })} />
        <span class="text-xs text-muted-foreground">{m['floor.hook_auto']()}</span>
      </div>
      <Button size="sm" onclick={saveHooks}>{m['floor.save_hooks']()}</Button>
    </div>
  {/if}
</aside>

<style>
  .side-panel {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--app-border);
    background: var(--app-sidebar);
    padding: 14px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--app-text-muted);
  }

  .panel-header-actions {
    display: flex;
    gap: 2px;
  }

  .floor-actions {
    display: flex;
  }

  .floor-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 1px solid var(--app-border);
    padding-top: 10px;
  }

  .landing-preview {
    border: 1px solid var(--app-border);
    border-radius: 7px;
    padding: 10px;
    font-size: 11px;
    background: var(--app-surface-subtle);
  }

  .landing-preview h4 {
    margin: 0 0 4px;
  }

  .preview-route {
    color: var(--app-text-muted);
    margin: 0 0 6px;
  }

  .landing-preview pre {
    font-size: 10px;
    overflow-x: auto;
    background: var(--app-canvas);
    padding: 6px;
    border-radius: 6px;
  }

  .conflict {
    color: var(--app-danger);
  }

  .muted {
    color: var(--app-text-muted);
  }

  .preview-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .hooks-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--app-border);
    padding-top: 10px;
  }

  .hooks-editor h4 {
    margin: 0;
    font-size: 12px;
  }

  .hooks-editor label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 10px;
    color: var(--app-text-muted);
  }
</style>
