<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { Archive, Beaker, Braces, CheckCircle2, Code2, History, LoaderCircle, Pencil, Play, Plus, RotateCcw, Save, Send, Wrench } from '@lucide/svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { workspaceToolEditorSchema, workspaceToolManifestSchema, type WorkspaceToolEditorInput, type WorkspaceToolManifest } from '$lib/modules/agent-room/contracts/schemas/agent-workspace-tool.schema.js';
  import type { WorkspaceToolRecord, WorkspaceToolRevisionRecord, WorkspaceToolRunRecord } from '$lib/modules/agent-room/infrastructure/repositories/AgentWorkspaceToolRepository.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, compact = false }: { workspaceId: string; compact?: boolean } = $props();

  const objectSchema = JSON.stringify({ type: 'object', properties: {}, additionalProperties: true }, null, 2);
  const templates: Record<WorkspaceToolEditorInput['executorKind'], Record<string, unknown>> = {
    http: { method: 'GET', urlTemplate: 'https://api.example.com/items/{{id}}', headers: [], bodyTemplate: null },
    integration: { integrationId: '00000000-0000-0000-0000-000000000000', action: 'replace.with.granted_action', inputTemplate: {} },
    transform: { operations: [{ kind: 'set', path: 'result', value: '{{value}}' }] },
    workspace_command: { executable: 'npm', args: ['test'], cwd: '.', stdinSecretRef: null },
  };
  const emptyForm: WorkspaceToolEditorInput = {
    name: '', slug: '', description: '', executorKind: 'transform',
    executorConfig: JSON.stringify(templates.transform, null, 2), inputSchema: objectSchema,
    outputSchema: objectSchema, fixtures: '[]', timeoutMs: 30_000,
    maxOutputBytes: 1_048_576, changeSummary: '',
  };
  const schema = workspaceToolEditorSchema as unknown as Parameters<typeof zod>[0];
  const form = superForm<WorkspaceToolEditorInput>(defaults(emptyForm, zod(schema)) as never, {
    SPA: true, validators: zod(schema) as never,
    async onUpdate({ form: result }) { if (result.valid) await save(result.data as WorkspaceToolEditorInput); },
  });
  const { form: formData, enhance } = form;

  let tools = $state<WorkspaceToolRecord[]>([]);
  let runs = $state<WorkspaceToolRunRecord[]>([]);
  let revisions = $state<WorkspaceToolRevisionRecord[]>([]);
  let selectedId = $state<string | null>(null);
  let editing = $state(false);
  let busy = $state(false);
  let loading = $state(true);
  let activeTab = $state('definition');
  let runInput = $state('{}');
  const selected = $derived(tools.find((tool) => tool.id === selectedId) ?? null);
  const selectedRuns = $derived(runs.filter((run) => !selectedId || run.toolId === selectedId));

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) } });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok || payload.error) throw new Error(payload.error || m['tool_workshop.error']());
    return payload.data as T;
  }

  async function refresh(): Promise<void> {
    loading = true;
    try {
      const [loadedTools, loadedRuns] = await Promise.all([
        api<WorkspaceToolRecord[]>(`/api/agent-room/workspaces/${workspaceId}/tools`),
        api<WorkspaceToolRunRecord[]>(`/api/agent-room/workspaces/${workspaceId}/tools/runs`),
      ]);
      tools = Array.isArray(loadedTools) ? loadedTools : [];
      runs = Array.isArray(loadedRuns) ? loadedRuns : [];
      if (selectedId && !tools.some((tool) => tool.id === selectedId)) selectedId = null;
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); }
    finally { loading = false; }
  }

  function capabilities(kind: WorkspaceToolEditorInput['executorKind']): WorkspaceToolManifest['capabilities'] {
    return kind === 'http' ? ['tool', 'network'] : kind === 'integration' ? ['tool', 'integration'] : kind === 'workspace_command' ? ['tool', 'filesystem'] : ['tool'];
  }

  function manifest(input: WorkspaceToolEditorInput): WorkspaceToolManifest {
    const executor = { kind: input.executorKind, ...JSON.parse(input.executorConfig) } as WorkspaceToolManifest['executor'];
    const secretRefs = [
      executor.kind === 'workspace_command' ? executor.stdinSecretRef : null,
      ...(executor.kind === 'http' ? executor.headers.map((header) => header.secretRef) : []),
    ].filter((value): value is string => Boolean(value));
    return workspaceToolManifestSchema.parse({
      schemaVersion: 1, executor, inputSchema: JSON.parse(input.inputSchema), outputSchema: JSON.parse(input.outputSchema),
      capabilities: capabilities(input.executorKind), secretRefs, timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes, fixtures: JSON.parse(input.fixtures),
    });
  }

  async function save(input: WorkspaceToolEditorInput): Promise<void> {
    busy = true;
    try {
      const body = { name: input.name, description: input.description, manifest: manifest(input), changeSummary: input.changeSummary || null };
      const saved = selectedId
        ? await api<WorkspaceToolRecord>(`/api/agent-room/workspaces/${workspaceId}/tools/${selectedId}`, { method: 'PUT', body: JSON.stringify(body) })
        : await api<WorkspaceToolRecord>(`/api/agent-room/workspaces/${workspaceId}/tools`, { method: 'POST', body: JSON.stringify({ ...body, slug: input.slug, nodeId: null }) });
      selectedId = saved.id; editing = false;
      toast.success(m['tool_workshop.saved']());
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); }
    finally { busy = false; }
  }

  function newTool(): void {
    selectedId = null; editing = true; activeTab = 'definition';
    $formData = structuredClone(emptyForm);
  }

  async function selectTool(tool: WorkspaceToolRecord): Promise<void> {
    selectedId = tool.id; editing = false; activeTab = 'definition';
    revisions = await api<WorkspaceToolRevisionRecord[]>(`/api/agent-room/workspaces/${workspaceId}/tools/${tool.id}/revisions`).catch(() => []);
  }

  function editTool(tool: WorkspaceToolRecord): void {
    const { kind, ...executorConfig } = tool.manifest.executor;
    selectedId = tool.id; editing = true; activeTab = 'definition';
    $formData = {
      name: tool.name, slug: tool.slug, description: tool.description, executorKind: kind,
      executorConfig: JSON.stringify(executorConfig, null, 2), inputSchema: JSON.stringify(tool.manifest.inputSchema, null, 2),
      outputSchema: JSON.stringify(tool.manifest.outputSchema, null, 2), fixtures: JSON.stringify(tool.manifest.fixtures, null, 2),
      timeoutMs: tool.manifest.timeoutMs, maxOutputBytes: tool.manifest.maxOutputBytes, changeSummary: '',
    };
  }

  function changeExecutor(kind: WorkspaceToolEditorInput['executorKind']): void {
    $formData.executorKind = kind;
    $formData.executorConfig = JSON.stringify(templates[kind], null, 2);
  }

  async function publish(): Promise<void> {
    if (!selected) return;
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/tools/${selected.id}/publish`, { method: 'POST', body: '{}' });
      toast.success(m['tool_workshop.published']()); await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); }
    finally { busy = false; }
  }

  async function execute(dryRun: boolean): Promise<void> {
    if (!selected) return;
    busy = true;
    try {
      const input = JSON.parse(runInput);
      await api(`/api/agent-room/workspaces/${workspaceId}/tools/${selected.id}/execute`, { method: 'POST', body: JSON.stringify({ input, idempotencyKey: `${dryRun ? 'dry' : 'manual'}:${crypto.randomUUID()}`, dryRun }) });
      toast.success(dryRun ? m['tool_workshop.dry_run_complete']() : m['tool_workshop.run_complete']());
      await refresh(); activeTab = 'runs';
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); }
    finally { busy = false; }
  }

  async function rollback(revision: WorkspaceToolRevisionRecord): Promise<void> {
    if (!selected) return;
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/tools/${selected.id}/rollback`, { method: 'POST', body: JSON.stringify({ revision: revision.revision }) });
      toast.success(m['tool_workshop.rolled_back']({ revision: revision.revision })); await refresh();
      const updated = tools.find((tool) => tool.id === selected.id); if (updated) editTool(updated);
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); }
    finally { busy = false; }
  }

  async function archive(): Promise<void> {
    if (!selected) return;
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/tools/${selected.id}`, { method: 'DELETE' });
      toast.success(m['tool_workshop.archived']());
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); }
    finally { busy = false; }
  }

  function statusLabel(tool: WorkspaceToolRecord): string {
    if (tool.status === 'archived') return m['tool_workshop.status_archived']();
    if (tool.publishedRevision != null && tool.publishedRevision !== tool.currentRevision) return m['tool_workshop.status_pending']();
    return tool.publishedRevision != null ? m['tool_workshop.status_published']() : m['tool_workshop.status_draft']();
  }

  function executorLabel(kind: WorkspaceToolEditorInput['executorKind']): string {
    return kind === 'http' ? m['tool_workshop.executor_http']()
      : kind === 'integration' ? m['tool_workshop.executor_integration']()
        : kind === 'workspace_command' ? m['tool_workshop.executor_workspace_command']()
          : m['tool_workshop.executor_transform']();
  }

  function runStatusLabel(status: WorkspaceToolRunRecord['status']): string {
    if (status === 'running') return m['tool_workshop.run_status_running']();
    if (status === 'succeeded') return m['tool_workshop.run_status_succeeded']();
    if (status === 'failed') return m['tool_workshop.run_status_failed']();
    return m['tool_workshop.run_status_dry_run']();
  }

  function loadFixture(input: Record<string, unknown>): void {
    runInput = JSON.stringify(input, null, 2);
  }

  $effect(() => { workspaceId; void refresh(); });
</script>

<section class="grid h-full min-h-0 grid-cols-[minmax(170px,0.34fr)_minmax(0,1fr)] bg-[var(--app-sidebar)] text-[var(--app-text)]" data-testid="tool-workshop">
  <aside class="flex min-h-0 flex-col border-r border-[var(--app-border)]">
    <div class="flex h-11 shrink-0 items-center justify-between border-b border-[var(--app-border)] px-3">
      <div class="flex items-center gap-2"><Wrench size={14} class="text-[var(--app-accent)]" /><span class="text-xs font-semibold">{m['tool_workshop.title']()}</span></div>
      <Button size="icon-sm" variant="ghost" aria-label={m['tool_workshop.new']()} onclick={newTool}><Plus size={14} /></Button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      {#if loading}<div class="grid min-h-28 place-items-center"><LoaderCircle class="animate-spin text-[var(--app-accent)]" size={18} /></div>
      {:else if tools.length === 0}<button class="w-full border border-dashed border-[var(--app-border)] p-4 text-left" onclick={newTool}><span class="block text-xs font-medium">{m['tool_workshop.empty']()}</span><span class="mt-1 block text-ui-xs text-[var(--app-text-muted)]">{m['tool_workshop.empty_hint']()}</span></button>
      {:else}{#each tools as tool (tool.id)}<button class={`mb-1 w-full border-l-2 px-2 py-2 text-left transition-colors ${selectedId === tool.id ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)]' : 'border-transparent hover:bg-[var(--app-surface-hover)]'}`} onclick={() => void selectTool(tool)}><span class="block truncate text-xs font-medium">{tool.name}</span><span class="mt-1 flex items-center gap-1.5 text-ui-xs text-[var(--app-text-muted)]"><span>{tool.manifest.executor.kind}</span><span>r{tool.currentRevision}</span><span>{statusLabel(tool)}</span></span></button>{/each}{/if}
    </div>
  </aside>

  <div class="flex min-h-0 min-w-0 flex-col">
    {#if editing}
      <form method="POST" use:enhance class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">{selected ? m['tool_workshop.edit']() : m['tool_workshop.new']()}</h2><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{m['tool_workshop.draft_help']()}</p></div><Button type="submit" size="sm" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{:else}<Save size={14} />{/if}{m['tool_workshop.save_draft']()}</Button></div>
        <div class={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.name']()}</span><Input bind:value={$formData.name} /></label>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.slug']()}</span><Input bind:value={$formData.slug} disabled={Boolean(selected)} /></label>
          <label class={compact ? '' : 'col-span-2'}><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.description_field']()}</span><Textarea class="min-h-16 resize-y" bind:value={$formData.description} /></label>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.executor']()}</span><Select.Root type="single" value={$formData.executorKind} onValueChange={(value) => changeExecutor(value as WorkspaceToolEditorInput['executorKind'])}><Select.Trigger class="w-full">{executorLabel($formData.executorKind)}</Select.Trigger><Select.Content>{#each ['transform','http','integration','workspace_command'] as kind}<Select.Item value={kind}>{executorLabel(kind as WorkspaceToolEditorInput['executorKind'])}</Select.Item>{/each}</Select.Content></Select.Root></label>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.timeout']()}</span><Input type="number" min="100" max="300000" bind:value={$formData.timeoutMs} /></label>
          <label class={compact ? '' : 'col-span-2'}><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.executor_config']()}</span><Textarea class="min-h-44 resize-y font-mono text-ui-xs" spellcheck={false} bind:value={$formData.executorConfig} /></label>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.input_schema']()}</span><Textarea class="min-h-40 resize-y font-mono text-ui-xs" spellcheck={false} bind:value={$formData.inputSchema} /></label>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.output_schema']()}</span><Textarea class="min-h-40 resize-y font-mono text-ui-xs" spellcheck={false} bind:value={$formData.outputSchema} /></label>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.fixtures']()}</span><Textarea class="min-h-28 resize-y font-mono text-ui-xs" spellcheck={false} bind:value={$formData.fixtures} /></label>
          <div class="grid content-start gap-3"><label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.max_output']()}</span><Input type="number" min="1024" max="10485760" bind:value={$formData.maxOutputBytes} /></label><label><span class="mb-1 block text-ui-xs font-medium">{m['tool_workshop.change_summary']()}</span><Input bind:value={$formData.changeSummary} /></label></div>
        </div>
      </form>
    {:else if selected}
      <header class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] px-4"><div class="min-w-0"><div class="flex items-center gap-2"><h2 class="truncate text-sm font-semibold">{selected.name}</h2><Badge variant="outline">{statusLabel(selected)}</Badge></div><p class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]">{selected.description || selected.slug}</p></div><div class="flex shrink-0 items-center gap-1">{#if selected.status !== 'archived'}<Button variant="ghost" size="sm" onclick={() => editTool(selected)}><Pencil size={13} />{m['tool_workshop.edit']()}</Button><Button variant="ghost" size="icon-sm" aria-label={m['tool_workshop.archive']()} disabled={busy} onclick={() => void archive()}><Archive size={13} /></Button>{/if}{#if selected.status !== 'archived' && selected.publishedRevision !== selected.currentRevision}<Button size="sm" disabled={busy} onclick={() => void publish()}><Send size={13} />{m['tool_workshop.publish']()}</Button>{/if}</div></header>
      <Tabs.Root bind:value={activeTab} class="grid min-h-0 flex-1 grid-rows-[38px_minmax(0,1fr)]"><Tabs.List class="h-[38px] w-full justify-start rounded-none border-b border-[var(--app-border)] bg-transparent px-2"><Tabs.Trigger value="definition" class="h-7 text-ui-xs"><Code2 size={12} />{m['tool_workshop.definition']()}</Tabs.Trigger><Tabs.Trigger value="runs" class="h-7 text-ui-xs"><History size={12} />{m['tool_workshop.runs']()}</Tabs.Trigger><Tabs.Trigger value="revisions" class="h-7 text-ui-xs"><RotateCcw size={12} />{m['tool_workshop.revisions']()}</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="definition" class="m-0 min-h-0 overflow-y-auto p-4"><div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)]"><div><h3 class="text-xs font-semibold">{m['tool_workshop.manifest']()}</h3><pre class="mt-2 max-h-[440px] overflow-auto border border-[var(--app-border)] bg-[var(--app-canvas)] p-3 text-ui-xs">{JSON.stringify(selected.manifest, null, 2)}</pre></div><div><h3 class="text-xs font-semibold">{m['tool_workshop.try']()}</h3><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{m['tool_workshop.try_help']()}</p>{#if selected.manifest.fixtures.length}<div class="mt-3"><p class="text-ui-xs font-medium text-[var(--app-text-soft)]">{m['tool_workshop.fixtures']()}</p><div class="mt-1.5 flex flex-wrap gap-1.5">{#each selected.manifest.fixtures as fixture (fixture.name)}<Button type="button" variant="outline" size="xs" onclick={() => loadFixture(fixture.input)}>{fixture.name}</Button>{/each}</div></div>{/if}<Textarea class="mt-3 min-h-40 resize-y font-mono text-ui-xs" bind:value={runInput} spellcheck={false} /><div class="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onclick={() => void execute(true)}><Beaker size={13} />{m['tool_workshop.dry_run']()}</Button><Button size="sm" disabled={busy || selected.status === 'archived' || selected.publishedRevision == null} onclick={() => void execute(false)}><Play size={13} />{m['tool_workshop.run']()}</Button></div></div></div></Tabs.Content>
        <Tabs.Content value="runs" class="m-0 min-h-0 overflow-y-auto p-4">{#if selectedRuns.length === 0}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['tool_workshop.no_runs']()}</p>{:else}<div class="space-y-2">{#each selectedRuns as run (run.id)}<details class="group border border-[var(--app-border)] bg-[var(--app-surface)]"><summary class="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3 py-3 hover:bg-[var(--app-surface-hover)]">{#if run.status === 'succeeded' || run.status === 'dry_run'}<CheckCircle2 size={14} class="mt-0.5 text-[var(--app-success)]" />{:else if run.status === 'running'}<LoaderCircle size={14} class="mt-0.5 animate-spin text-[var(--app-accent)]" />{:else}<Archive size={14} class="mt-0.5 text-[var(--app-danger)]" />{/if}<div class="min-w-0"><p class="text-xs font-medium">{runStatusLabel(run.status)} · {run.actor.type}</p><p class="mt-1 truncate font-mono text-ui-xs text-[var(--app-text-muted)]">{run.error ?? run.outputDigest ?? run.requestDigest}</p></div><span class="text-ui-xs text-[var(--app-text-muted)]">{run.durationMs == null ? '—' : `${run.durationMs} ms`}</span></summary><div class="border-t border-[var(--app-border)] px-3 py-3"><dl class="grid gap-2 text-ui-xs sm:grid-cols-3"><div><dt class="text-[var(--app-text-muted)]">{m['tool_workshop.revision']()}</dt><dd class="mt-0.5 font-mono">r{run.revision}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['tool_workshop.actor']()}</dt><dd class="mt-0.5 truncate font-mono">{run.actor.id ?? run.actor.type}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['tool_workshop.idempotency']()}</dt><dd class="mt-0.5 truncate font-mono" title={run.idempotencyKey}>{run.idempotencyKey}</dd></div></dl><div class="mt-3 grid gap-3 lg:grid-cols-2"><div><p class="mb-1 text-ui-xs font-medium">{m['tool_workshop.input']()}</p><pre class="max-h-52 overflow-auto bg-[var(--app-canvas)] p-2 font-mono text-ui-xs">{JSON.stringify(run.input, null, 2)}</pre></div><div><p class="mb-1 text-ui-xs font-medium">{run.error ? m['tool_workshop.run_error']() : m['tool_workshop.output']()}</p><pre class="max-h-52 overflow-auto bg-[var(--app-canvas)] p-2 font-mono text-ui-xs">{run.error ?? JSON.stringify(run.output, null, 2)}</pre></div></div></div></details>{/each}</div>{/if}</Tabs.Content>
        <Tabs.Content value="revisions" class="m-0 min-h-0 overflow-y-auto p-4">{#if revisions.length === 0}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['tool_workshop.no_revisions']()}</p>{:else}<div class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{#each revisions as revision (revision.id)}<article class="flex items-center justify-between gap-3 bg-[var(--app-surface)] px-3 py-3"><div><p class="text-xs font-medium">r{revision.revision}</p><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{revision.changeSummary || new Date(revision.createdAt).toLocaleString()}</p></div>{#if revision.revision !== selected.currentRevision}<Button variant="ghost" size="sm" disabled={busy} onclick={() => void rollback(revision)}><RotateCcw size={13} />{m['tool_workshop.rollback']()}</Button>{/if}</article>{/each}</div>{/if}</Tabs.Content>
      </Tabs.Root>
    {:else}
      <div class="grid min-h-0 flex-1 place-items-center p-8 text-center"><div><Braces class="mx-auto text-[var(--app-text-muted)]" size={28} /><h2 class="mt-3 text-sm font-semibold">{m['tool_workshop.select_title']()}</h2><p class="mt-1 max-w-sm text-ui-xs text-[var(--app-text-muted)]">{m['tool_workshop.select_help']()}</p><Button class="mt-4" size="sm" onclick={newTool}><Plus size={14} />{m['tool_workshop.new']()}</Button></div></div>
    {/if}
  </div>
</section>
