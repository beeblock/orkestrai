<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { Archive, Beaker, Braces, CheckCircle2, CircleX, Code2, History, LoaderCircle, Pencil, Play, Plus, RotateCcw, Save, Send, Wrench } from '@lucide/svelte';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
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
  const formId = $props.id();

  const objectSchema = JSON.stringify({ type: 'object', properties: {}, additionalProperties: true }, null, 2);
  const templates: Record<WorkspaceToolEditorInput['executorKind'], Record<string, unknown>> = {
    browser: { nodeId: '', steps: [{ action: 'extract', args: { kind: 'text' } }] },
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
    id: `workspace-tool-${formId}`, SPA: true, validators: zod(schema) as never,
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
  let portals = $state<Array<{ id:string; title:string }>>([]);
  let activeTab = $state('definition');
  let runInput = $state('{}');
  const selected = $derived(tools.find((tool) => tool.id === selectedId) ?? null);
  const selectedRuns = $derived(runs.filter((run) => !selectedId || run.toolId === selectedId));
  const configuredPortalId = $derived.by(() => { try { return JSON.parse($formData.executorConfig).nodeId ?? ''; } catch { return ''; } });

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
      portals = (await api<Array<{id:string;title:string;type:string}>>(`/api/agent-room/workspaces/${workspaceId}/nodes`)).filter((node)=>node.type==='portal');
      if (selectedId && !tools.some((tool) => tool.id === selectedId)) selectedId = null;
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); }
    finally { loading = false; }
  }

  function capabilities(kind: WorkspaceToolEditorInput['executorKind']): WorkspaceToolManifest['capabilities'] {
    return kind === 'browser' ? ['tool', 'browser'] : kind === 'http' ? ['tool', 'network'] : kind === 'integration' ? ['tool', 'integration'] : kind === 'workspace_command' ? ['tool', 'filesystem'] : ['tool'];
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

  async function execute(dryRun: boolean, retry?: WorkspaceToolRunRecord): Promise<void> {
    if (!selected) return;
    busy = true;
    try {
      const input = retry?.input ?? JSON.parse(runInput);
      const result = await api<WorkspaceToolRunRecord>(`/api/agent-room/workspaces/${workspaceId}/tools/${selected.id}/execute`, { method: 'POST', body: JSON.stringify({ input, idempotencyKey: retry?.idempotencyKey ?? `${dryRun ? 'dry' : 'manual'}:${crypto.randomUUID()}`, dryRun }) });
      if (!['succeeded','dry_run'].includes(result.status)) throw new Error(result.error || runStatusLabel(result.status));
      toast.success(dryRun ? m['tool_workshop.dry_run_complete']() : m['tool_workshop.run_complete']());
      await refresh(); activeTab = 'runs';
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); await refresh(); activeTab = 'runs'; }
    finally { busy = false; }
  }

  async function rollback(revision: WorkspaceToolRevisionRecord): Promise<void> {
    if (!selected) return;
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/tools/${selected.id}/rollback`, { method: 'POST', body: JSON.stringify({ revision: revision.revision }) });
      toast.success(m['tool_workshop.rolled_back']({ revision: revision.revision })); await refresh();
      const updated = tools.find((tool) => tool.id === selected.id); if (updated) editTool(updated);
    } catch (error) { toast.error(error instanceof Error ? error.message : m['tool_workshop.error']()); await refresh(); activeTab = 'runs'; }
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

  // Tom visual do status (mesmas condicoes de statusLabel): cor so para estado.
  function statusTone(tool: WorkspaceToolRecord): 'neutral' | 'success' | 'warning' | 'muted' {
    if (tool.status === 'archived') return 'muted';
    if (tool.publishedRevision != null && tool.publishedRevision !== tool.currentRevision) return 'warning';
    return tool.publishedRevision != null ? 'success' : 'neutral';
  }

  function formatBytes(bytes: number): string {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    return value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MiB` : `${Math.round(value / 1024)} KiB`;
  }

  function executorLabel(kind: WorkspaceToolEditorInput['executorKind']): string {
    if (kind === 'browser') return m['tool_workshop.executor_browser']();
    return kind === 'browser' ? m['tool_workshop.executor_browser']()
      : kind === 'http' ? m['tool_workshop.executor_http']()
      : kind === 'integration' ? m['tool_workshop.executor_integration']()
        : kind === 'workspace_command' ? m['tool_workshop.executor_workspace_command']()
          : m['tool_workshop.executor_transform']();
  }

  function runStatusLabel(status: WorkspaceToolRunRecord['status']): string {
    if (status === 'waiting_approval') return m['automation.status_waiting_approval']();
    if (status === 'running') return m['tool_workshop.run_status_running']();
    if (status === 'succeeded') return m['tool_workshop.run_status_succeeded']();
    if (status === 'failed') return m['tool_workshop.run_status_failed']();
    return m['tool_workshop.run_status_dry_run']();
  }

  function loadFixture(input: Record<string, unknown>): void {
    runInput = JSON.stringify(input, null, 2);
  }

  $effect(() => { workspaceId; void refresh(); });

  $effect(() => {
    const id = workspaceId;
    let disposed = false;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending || busy || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const [nextTools, nextRuns] = await Promise.all([
          api<WorkspaceToolRecord[]>(`/api/agent-room/workspaces/${id}/tools`),
          api<WorkspaceToolRunRecord[]>(`/api/agent-room/workspaces/${id}/tools/runs`),
        ]);
        if (!disposed) { tools = nextTools; runs = nextRuns; }
      } catch { /* Preserve the last confirmed state during a Core reconnect. */ }
      finally { pending = false; }
    }, 5000);
    return () => { disposed = true; clearInterval(timer); };
  });
</script>

{#snippet newToolAction()}<Button size="sm" onclick={newTool}><Plus size={14} />{m['tool_workshop.new']()}</Button>{/snippet}

<section class={`tw h-full min-h-0 bg-[var(--app-sidebar)] text-[var(--app-text)] ${!loading && tools.length === 0 && !editing ? 'grid' : 'grid grid-cols-[minmax(170px,0.34fr)_minmax(0,1fr)]'}`} data-testid="tool-workshop">
  {#if !loading && tools.length === 0 && !editing}
    <!-- Sem ferramentas: um unico estado vazio com a proxima acao, sem lista vazia ao lado. -->
    <div class="grid min-h-0 place-items-center p-6">
      <NodeEmptyState icon={Wrench} title={m['tool_workshop.select_title']()} description={m['tool_workshop.select_help']()} actions={newToolAction} />
    </div>
  {:else}
  <aside class="tw-list flex min-h-0 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3">
      <span class="section-label min-w-0 flex-1 truncate" title={m['tool_workshop.title']()}>{m['tool_workshop.tools']()}</span>
      {#if tools.length}<span class="tw-count">{tools.length}</span>{/if}
      <Button size="icon-sm" variant="ghost" aria-label={m['tool_workshop.new']()} title={m['tool_workshop.new']()} onclick={newTool}><Plus size={14} /></Button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      {#if loading}<div class="grid min-h-28 place-items-center"><LoaderCircle class="animate-spin text-[var(--app-text-muted)]" size={16} /></div>
      {:else if tools.length === 0}<div class="px-2 py-3"><p class="text-[12px] font-medium">{m['tool_workshop.empty']()}</p><p class="mt-1 text-ui-sm leading-relaxed text-[var(--app-text-muted)]">{m['tool_workshop.empty_hint']()}</p></div>
      {:else}{#each tools as tool (tool.id)}<button class="tw-row" aria-current={selectedId === tool.id ? 'true' : undefined} onclick={() => void selectTool(tool)}><span class="tw-row-name">{tool.name}</span><span class="tw-row-meta"><span class="tw-status" data-tone={statusTone(tool)}>{statusLabel(tool)}</span><span class="min-w-0 truncate" title={executorLabel(tool.manifest.executor.kind)}>{executorLabel(tool.manifest.executor.kind)}</span><span class="tw-mono">r{tool.currentRevision}</span></span></button>{/each}{/if}
    </div>
  </aside>

  <div class="flex min-h-0 min-w-0 flex-col bg-[var(--app-surface)]">
    {#if editing}
      <form method="POST" use:enhance class="tw-enter min-h-0 flex-1 overflow-y-auto p-4">
        <div class="mb-5 flex items-start justify-between gap-3"><div class="min-w-0"><h2 class="text-ui-lg font-semibold">{selected ? m['tool_workshop.edit']() : m['tool_workshop.new']()}</h2><p class="mt-1 max-w-prose text-ui-sm leading-relaxed text-pretty text-[var(--app-text-muted)]">{m['tool_workshop.draft_help']()}</p></div><Button type="submit" size="sm" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{:else}<Save size={14} />{/if}{m['tool_workshop.save_draft']()}</Button></div>
        <div class={`grid gap-x-4 gap-y-3.5 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <label><span class="tw-label">{m['tool_workshop.name']()}</span><Input bind:value={$formData.name} /></label>
          <label><span class="tw-label">{m['tool_workshop.slug']()}</span><Input class="font-mono text-[12px]" bind:value={$formData.slug} disabled={Boolean(selected)} /></label>
          <label class={compact ? '' : 'col-span-2'}><span class="tw-label">{m['tool_workshop.description_field']()}</span><Textarea class="min-h-16 resize-y" bind:value={$formData.description} /></label>
          <label><span class="tw-label">{m['tool_workshop.executor']()}</span><Select.Root type="single" value={$formData.executorKind} onValueChange={(value) => changeExecutor(value as WorkspaceToolEditorInput['executorKind'])}><Select.Trigger class="w-full">{executorLabel($formData.executorKind)}</Select.Trigger><Select.Content>{#each ['transform','browser','http','integration','workspace_command'] as kind}<Select.Item value={kind}>{executorLabel(kind as WorkspaceToolEditorInput['executorKind'])}</Select.Item>{/each}</Select.Content></Select.Root></label>
          <label><span class="tw-label">{m['tool_workshop.timeout']()}</span><Input type="number" class="tabular-nums" min="100" max="300000" bind:value={$formData.timeoutMs} /></label>
          {#if $formData.executorKind === 'browser'}
            <label class={compact ? '' : 'col-span-2'}><span class="tw-label">{m['portal.default_title']()}</span><Select.Root type="single" value={configuredPortalId} onValueChange={(nodeId) => { try { $formData.executorConfig=JSON.stringify({...JSON.parse($formData.executorConfig),nodeId},null,2); } catch { toast.error(m['tool_workshop.error']()); } }}><Select.Trigger class="w-full">{portals.find((portal)=>portal.id===configuredPortalId)?.title || m['portal.default_title']()}</Select.Trigger><Select.Content>{#each portals as portal (portal.id)}<Select.Item value={portal.id}>{portal.title}</Select.Item>{/each}</Select.Content></Select.Root></label>
          {/if}
          <label class={compact ? '' : 'col-span-2'}><span class="tw-label">{m['tool_workshop.executor_config']()}</span><Textarea class="tw-code min-h-44 resize-y" spellcheck={false} bind:value={$formData.executorConfig} /></label>
          <label><span class="tw-label">{m['tool_workshop.input_schema']()}</span><Textarea class="tw-code min-h-40 resize-y" spellcheck={false} bind:value={$formData.inputSchema} /></label>
          <label><span class="tw-label">{m['tool_workshop.output_schema']()}</span><Textarea class="tw-code min-h-40 resize-y" spellcheck={false} bind:value={$formData.outputSchema} /></label>
          <label><span class="tw-label">{m['tool_workshop.fixtures']()}</span><Textarea class="tw-code min-h-28 resize-y" spellcheck={false} bind:value={$formData.fixtures} /></label>
          <div class="grid content-start gap-3.5"><label><span class="tw-label"><span>{m['tool_workshop.max_output']()}</span>{#if formatBytes($formData.maxOutputBytes)}<span class="tw-mono">≈ {formatBytes($formData.maxOutputBytes)}</span>{/if}</span><Input type="number" class="tabular-nums" min="1024" max="10485760" bind:value={$formData.maxOutputBytes} /></label><label><span class="tw-label">{m['tool_workshop.change_summary']()}</span><Input bind:value={$formData.changeSummary} /></label></div>
        </div>
      </form>
    {:else if selected}
      <header class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-2.5"><div class="min-w-0"><div class="flex min-w-0 items-center gap-2"><h2 class="truncate text-ui-lg font-semibold">{selected.name}</h2><span class="tw-status" data-tone={statusTone(selected)}>{statusLabel(selected)}</span></div><p class="mt-0.5 truncate text-ui-sm text-[var(--app-text-muted)]" title={selected.description || selected.slug}>{selected.description || selected.slug}</p></div><div class="flex shrink-0 items-center gap-1">{#if selected.status !== 'archived'}<Button variant="ghost" size="sm" onclick={() => editTool(selected)}><Pencil size={13} />{m['tool_workshop.edit']()}</Button><Button variant="ghost" size="icon-sm" class="hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['tool_workshop.archive']()} title={m['tool_workshop.archive']()} disabled={busy} onclick={() => void archive()}><Archive size={13} /></Button>{/if}{#if selected.status !== 'archived' && selected.publishedRevision !== selected.currentRevision}<Button size="sm" disabled={busy} onclick={() => void publish()}><Send size={13} />{m['tool_workshop.publish']()}</Button>{/if}</div></header>
      <Tabs.Root bind:value={activeTab} class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-0"><div class="min-w-0 border-b border-[var(--app-border)] px-3 py-2"><Tabs.List class="h-8 w-fit max-w-full overflow-x-auto justify-start gap-0.5 rounded-lg bg-[var(--app-hover)] p-0.5"><Tabs.Trigger value="definition" class="tw-tab"><Code2 aria-hidden="true" />{m['tool_workshop.definition']()}</Tabs.Trigger><Tabs.Trigger value="runs" class="tw-tab"><History aria-hidden="true" />{m['tool_workshop.runs']()}{#if selectedRuns.length}<span class="tw-count">{selectedRuns.length}</span>{/if}</Tabs.Trigger><Tabs.Trigger value="revisions" class="tw-tab"><RotateCcw aria-hidden="true" />{m['tool_workshop.revisions']()}</Tabs.Trigger></Tabs.List></div>
        <Tabs.Content value="definition" class="m-0 min-h-0 overflow-y-auto p-4"><div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)]"><div class="min-w-0"><h3 class="section-label">{m['tool_workshop.manifest']()}</h3><pre class="tw-pre mt-2 max-h-[440px]">{JSON.stringify(selected.manifest, null, 2)}</pre></div><div class="min-w-0"><h3 class="section-label">{m['tool_workshop.try']()}</h3><p class="mt-1.5 text-ui-sm leading-relaxed text-pretty text-[var(--app-text-muted)]">{m['tool_workshop.try_help']()}</p>{#if selected.manifest.fixtures.length}<div class="mt-3"><p class="text-ui-sm font-medium text-[var(--app-text-soft)]">{m['tool_workshop.fixtures']()}</p><div class="mt-1.5 flex flex-wrap gap-1.5">{#each selected.manifest.fixtures as fixture (fixture.name)}<Button type="button" variant="outline" size="xs" onclick={() => loadFixture(fixture.input)}>{fixture.name}</Button>{/each}</div></div>{/if}<Textarea class="tw-code mt-3 min-h-40 resize-y" bind:value={runInput} spellcheck={false} /><div class="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onclick={() => void execute(true)}><Beaker size={13} />{m['tool_workshop.dry_run']()}</Button><Button size="sm" disabled={busy || selected.status === 'archived' || selected.publishedRevision == null} onclick={() => void execute(false)}><Play size={13} />{m['tool_workshop.run']()}</Button></div></div></div></Tabs.Content>
        <Tabs.Content value="runs" class="m-0 min-h-0 overflow-y-auto p-4">{#if selectedRuns.length === 0}<NodeEmptyState compact icon={History} title={m['tool_workshop.no_runs']()} />{:else}<div class="space-y-2">{#each selectedRuns as run (run.id)}<details class="tw-run group"><summary class="tw-run-summary">{#if run.status === 'succeeded' || run.status === 'dry_run'}<CheckCircle2 size={14} class="mt-0.5 text-[var(--app-success)]" />{:else if run.status === 'running'}<LoaderCircle size={14} class="mt-0.5 animate-spin text-[var(--app-text-muted)]" />{:else}<CircleX size={14} class="mt-0.5 text-[var(--app-danger)]" />{/if}<div class="min-w-0"><p class="text-[12px] font-medium">{runStatusLabel(run.status)} · {run.actor.type}</p><p class="mt-1 truncate font-mono text-[11px] text-[var(--app-text-muted)]">{run.error ?? run.outputDigest ?? run.requestDigest}</p></div><span class="tw-mono">{run.durationMs == null ? '—' : `${run.durationMs} ms`}</span></summary><div class="border-t border-[var(--app-border)] px-3 py-3"><dl class="grid gap-2 text-ui-sm sm:grid-cols-3"><div><dt class="text-[var(--app-text-muted)]">{m['tool_workshop.revision']()}</dt><dd class="mt-0.5 font-mono">r{run.revision}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['tool_workshop.actor']()}</dt><dd class="mt-0.5 truncate font-mono">{run.actor.id ?? run.actor.type}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['tool_workshop.idempotency']()}</dt><dd class="mt-0.5 truncate font-mono" title={run.idempotencyKey}>{run.idempotencyKey}</dd></div></dl>{#if run.status === 'waiting_approval' && run.actor.type === 'user'}<Button class="mt-3" size="sm" disabled={busy} onclick={() => void execute(false, run)}><Play size={13} />{m['tool_workshop.resume_run']()}</Button>{/if}<div class="mt-3 grid gap-3 lg:grid-cols-2"><div class="min-w-0"><p class="mb-1 text-ui-sm font-medium">{m['tool_workshop.input']()}</p><pre class="tw-pre max-h-52">{JSON.stringify(run.input, null, 2)}</pre></div><div class="min-w-0"><p class="mb-1 text-ui-sm font-medium">{run.error ? m['tool_workshop.run_error']() : m['tool_workshop.output']()}</p><pre class="tw-pre max-h-52">{run.error ?? JSON.stringify(run.output, null, 2)}</pre></div></div></div></details>{/each}</div>{/if}</Tabs.Content>
        <Tabs.Content value="revisions" class="m-0 min-h-0 overflow-y-auto p-4">{#if revisions.length === 0}<NodeEmptyState compact icon={RotateCcw} title={m['tool_workshop.no_revisions']()} />{:else}<div class="tw-revisions">{#each revisions as revision (revision.id)}<article class="tw-revision"><div class="min-w-0"><p class="flex items-center gap-2 text-[12px] font-medium"><span class="tw-mono text-[var(--app-text)]">r{revision.revision}</span></p><p class="mt-1 truncate text-ui-sm text-[var(--app-text-muted)]">{revision.changeSummary || new Date(revision.createdAt).toLocaleString()}</p></div>{#if revision.revision !== selected.currentRevision}<Button variant="ghost" size="sm" class="tw-reveal" disabled={busy} onclick={() => void rollback(revision)}><RotateCcw size={13} />{m['tool_workshop.rollback']()}</Button>{/if}</article>{/each}</div>{/if}</Tabs.Content>
      </Tabs.Root>
    {:else}
      <div class="grid min-h-0 flex-1 place-items-center p-6"><NodeEmptyState icon={Braces} title={m['tool_workshop.select_title']()} description={m['tool_workshop.select_help']()} actions={newToolAction} /></div>
    {/if}
  </div>
  {/if}
</section>

<style>
  .tw-list {
    background: var(--app-sidebar);
    box-shadow: inset -1px 0 0 var(--app-border);
  }

  .tw-count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .tw-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin-bottom: 2px;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .tw-row:hover {
    background: var(--app-hover);
  }

  .tw-row[aria-current='true'] {
    background: var(--app-active);
    box-shadow: inset 2px 0 0 var(--app-accent);
  }

  .tw-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .tw-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 500;
  }

  .tw-row-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .tw-status {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  .tw-status[data-tone='success'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .tw-status[data-tone='warning'] {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .tw-status[data-tone='muted'] {
    background: transparent;
    color: var(--app-text-muted);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  .tw-mono {
    flex-shrink: 0;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .tw-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
  }

  .tw :global(.tw-code) {
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.55;
  }

  .tw-pre {
    overflow: auto;
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--app-code-bg);
    color: var(--app-code-text);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  .tw :global(.tw-tab) {
    flex: none;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 12px;
    font-weight: 500;
    box-shadow: none;
    transition: color var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  .tw :global(.tw-tab:hover) {
    color: var(--app-text);
  }

  .tw :global(.tw-tab[data-state='active']) {
    background: var(--app-surface-raised);
    color: var(--app-text);
    box-shadow: var(--app-shadow-border);
  }

  .tw :global(.tw-tab svg) {
    width: 13px;
    height: 13px;
  }

  .tw :global(.tw-tab:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .tw-run {
    overflow: hidden;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .tw-run-summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    padding: 10px 12px;
    list-style: none;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .tw-run-summary::-webkit-details-marker {
    display: none;
  }

  .tw-run-summary:hover {
    background: var(--app-hover);
  }

  .tw-run-summary:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .tw-revisions {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tw-revision {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 48px;
    padding: 8px 10px;
    border-radius: 8px;
    transition: background-color var(--duration-quick) ease-out;
  }

  .tw-revision:hover {
    background: var(--app-hover);
  }

  /* Acao de restaurar aparece ao apontar/focar a revisao. */
  .tw-revision :global(.tw-reveal) {
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .tw-revision:hover :global(.tw-reveal),
  .tw-revision:focus-within :global(.tw-reveal) {
    opacity: 1;
  }

  .tw-enter {
    animation: tw-enter var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes tw-enter {
    from {
      opacity: 0;
      transform: translateY(var(--distance-micro));
    }
  }
</style>
