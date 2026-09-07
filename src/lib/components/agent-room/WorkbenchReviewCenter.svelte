<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import {
    ArrowDownToLine,
    ArrowUpFromLine,
    Check,
    CheckCircle2,
    CircleDot,
    FileCode2,
    GitBranch,
    GitCommitHorizontal,
    MessageSquarePlus,
    Minus,
    Plus,
    RefreshCw,
    RotateCcw,
    ShieldAlert,
    X,
    XCircle,
  } from '@lucide/svelte';
  import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
  import CssWorker from 'monaco-editor/language/css/css.worker?worker';
  import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
  import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
  import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
  import type { editor } from 'monaco-editor';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { GitChange, GitFileDiff } from '$lib/modules/agent-room/application/services/GitService.js';
  import {
    createAgentReviewSchema,
    type AgentReviewData,
    type ReviewCenterSnapshot,
    type ReviewDecisionResult,
    type ReviewStatus,
  } from '$lib/modules/agent-room/contracts/schemas/review-schemas.schema.js';
  import * as m from '$lib/paraglide/messages.js';

  type Monaco = typeof import('monaco-editor');
  let { workspaceId }: { workspaceId: string } = $props();

  let snapshot = $state<ReviewCenterSnapshot | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let errorMessage = $state('');
  let statusMessage = $state('');
  let selectedChangeId = $state<string | null>(null);
  let diff = $state<GitFileDiff | null>(null);
  let diffLoading = $state(false);
  let diffHost = $state<HTMLDivElement>();
  let diffEditor: editor.IStandaloneDiffEditor | null = null;
  let monaco: Monaco | null = null;
  let editorReady = $state(false);
  let loadedDiffKey = '';
  let diffRequest = 0;
  let themeObserver: MutationObserver | null = null;
  let activeReviewId = $state<string | null>(null);
  let reviewDialogOpen = $state(false);
  let reviewTitle = $state('');
  let reviewSummary = $state('');
  let reviewTaskId = $state('');
  let reviewAssigneeId = $state('');
  let reviewEvidence = $state('');
  let reviewTests = $state('');
  let reviewRisks = $state('');
  let reviewPaths = $state<string[]>([]);
  let selectedLine = $state<number | null>(null);
  let selectedSide = $state<'original' | 'modified'>('modified');
  let commentOpen = $state(false);
  let commentBody = $state('');
  let decisionNote = $state('');
  let discardChange = $state<GitChange | null>(null);
  let commitMessage = $state('');

  const changes = $derived(snapshot?.git.changes ?? []);
  const stagedChanges = $derived(changes.filter((change) => change.staged));
  const unstagedChanges = $derived(changes.filter((change) => !change.staged));
  const selectedChange = $derived(changes.find((change) => change.id === selectedChangeId) ?? null);
  const activeReview = $derived(snapshot?.reviews.find((review) => review.id === activeReviewId) ?? null);
  const openCommentCount = $derived(activeReview?.comments.filter((comment) => comment.status === 'open').length ?? 0);

  function csrfHeaders(): HeadersInit {
    const token = getCsrfToken();
    return { 'content-type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['review_center.error_api']());
    return payload.data as T;
  }

  function setStatus(message: string): void {
    statusMessage = message;
    setTimeout(() => statusMessage === message && (statusMessage = ''), 2200);
  }

  async function refresh(preserveSelection = true): Promise<void> {
    errorMessage = '';
    try {
      const next = await api<ReviewCenterSnapshot>(`/api/agent-room/workspaces/${workspaceId}/review-center`);
      snapshot = next;
      if (!preserveSelection || !next.git.changes.some((change) => change.id === selectedChangeId)) {
        selectedChangeId = next.git.changes[0]?.id ?? null;
      }
      if (!activeReviewId || !next.reviews.some((review) => review.id === activeReviewId)) {
        activeReviewId = next.reviews[0]?.id ?? null;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['review_center.error_load']();
    } finally {
      loading = false;
    }
  }

  function cssColor(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function configureWorkers(): void {
    (self as unknown as { MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker } }).MonacoEnvironment = {
      getWorker: (_moduleId, label) => {
        if (label === 'json') return new JsonWorker();
        if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
        if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
        if (label === 'typescript' || label === 'javascript') return new TsWorker();
        return new EditorWorker();
      },
    };
  }

  function applyMonacoTheme(instance: Monaco): void {
    const dark = document.documentElement.classList.contains('dark');
    instance.editor.defineTheme('orkestrai-review', {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': cssColor('--app-canvas', dark ? '#151619' : '#f4f5f9'),
        'editor.foreground': cssColor('--app-text', dark ? '#f2f3f5' : '#181822'),
        'editorLineNumber.foreground': cssColor('--app-text-muted', dark ? '#898e98' : '#686b7a'),
        'editorCursor.foreground': cssColor('--app-accent', '#8f70ff'),
        'diffEditor.insertedTextBackground': `${cssColor('--app-success', '#2fb87c')}33`,
        'diffEditor.removedTextBackground': `${cssColor('--app-danger', '#e05b69')}33`,
        'diffEditor.insertedLineBackground': `${cssColor('--app-success', '#2fb87c')}12`,
        'diffEditor.removedLineBackground': `${cssColor('--app-danger', '#e05b69')}12`,
      },
    });
    instance.editor.setTheme('orkestrai-review');
  }

  async function mountDiffEditor(): Promise<void> {
    if (!diffHost || diffEditor) return;
    configureWorkers();
    monaco = await import('monaco-editor');
    applyMonacoTheme(monaco);
    diffEditor = monaco.editor.createDiffEditor(diffHost, {
      theme: 'orkestrai-review',
      automaticLayout: true,
      readOnly: true,
      editContext: false,
      renderSideBySide: true,
      renderOverviewRuler: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      fontLigatures: true,
      padding: { top: 8, bottom: 8 },
    });
    diffEditor.getOriginalEditor().onDidChangeCursorPosition((event) => {
      selectedLine = event.position.lineNumber;
      selectedSide = 'original';
    });
    diffEditor.getModifiedEditor().onDidChangeCursorPosition((event) => {
      selectedLine = event.position.lineNumber;
      selectedSide = 'modified';
    });
    themeObserver = new MutationObserver(() => monaco && applyMonacoTheme(monaco));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-app-theme'] });
    editorReady = true;
  }

  function disposeDiffModels(): void {
    const model = diffEditor?.getModel();
    diffEditor?.setModel(null);
    if (!model) return;
    setTimeout(() => {
      model.original.dispose();
      model.modified.dispose();
    }, 0);
  }

  async function loadDiff(change: GitChange): Promise<void> {
    if (!monaco || !diffEditor) return;
    const request = ++diffRequest;
    const key = `${change.id}:${snapshot?.git.revision ?? ''}`;
    loadedDiffKey = key;
    diffLoading = true;
    errorMessage = '';
    selectedLine = null;
    commentOpen = false;
    try {
      const result = await api<GitFileDiff>(
        `/api/agent-room/workspaces/${workspaceId}/git/file-diff?path=${encodeURIComponent(change.path)}&staged=${change.staged}`,
      );
      if (request !== diffRequest) return;
      diff = result;
      disposeDiffModels();
      if (!result.binary) {
        const suffix = `${result.staged ? 'staged' : 'working'}-${encodeURIComponent(result.path)}`;
        const original = monaco.editor.createModel(result.original, result.language, monaco.Uri.parse(`orkestrai-review://original/${suffix}`));
        const modified = monaco.editor.createModel(result.modified, result.language, monaco.Uri.parse(`orkestrai-review://modified/${suffix}`));
        diffEditor.setModel({ original, modified });
      }
    } catch (error) {
      if (request !== diffRequest) return;
      loadedDiffKey = '';
      diff = null;
      disposeDiffModels();
      errorMessage = error instanceof Error ? error.message : m['review_center.error_diff']();
    } finally {
      diffLoading = false;
    }
  }

  async function gitAction(endpoint: string, body?: Record<string, unknown>, message?: string): Promise<void> {
    if (busy) return;
    busy = true;
    errorMessage = '';
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/git/${endpoint}`, {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify(body ?? {}),
      });
      await refresh();
      if (message) setStatus(message);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['review_center.error_git']();
    } finally {
      busy = false;
    }
  }

  async function commit(): Promise<void> {
    const message = commitMessage.trim();
    if (!message) return;
    await gitAction('commit', { message }, m['review_center.commit_done']());
    if (!errorMessage) commitMessage = '';
  }

  function beginReview(): void {
    reviewTitle = '';
    reviewSummary = '';
    reviewTaskId = '';
    reviewAssigneeId = '';
    reviewEvidence = '';
    reviewTests = '';
    reviewRisks = '';
    reviewPaths = [...new Set(changes.map((change) => change.path))];
    reviewDialogOpen = true;
  }

  function lines(value: string): string[] {
    return value.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async function createReview(): Promise<void> {
    const input = {
      title: reviewTitle,
      summary: reviewSummary || null,
      taskId: reviewTaskId || null,
      assigneeNodeId: reviewAssigneeId || null,
      selectedPaths: reviewPaths,
      evidence: lines(reviewEvidence),
      tests: lines(reviewTests),
      risks: lines(reviewRisks),
    };
    const parsed = createAgentReviewSchema.safeParse(input);
    if (!parsed.success) {
      errorMessage = parsed.error.issues[0]?.message ?? m['review_center.error_form']();
      return;
    }
    busy = true;
    try {
      const created = await api<AgentReviewData>(`/api/agent-room/workspaces/${workspaceId}/review-center`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify(parsed.data),
      });
      await refresh();
      activeReviewId = created.id;
      reviewDialogOpen = false;
      setStatus(m['review_center.review_created']());
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['review_center.error_create']();
    } finally {
      busy = false;
    }
  }

  async function addComment(): Promise<void> {
    if (!activeReview || !selectedChange || !commentBody.trim()) return;
    busy = true;
    try {
      await api<AgentReviewData>(`/api/agent-room/workspaces/${workspaceId}/review-center/${activeReview.id}/comments`, {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ filePath: selectedChange.path, lineNumber: selectedLine, side: selectedLine ? selectedSide : 'file', body: commentBody }),
      });
      commentBody = '';
      commentOpen = false;
      await refresh();
      setStatus(m['review_center.comment_added']());
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['review_center.error_comment']();
    } finally {
      busy = false;
    }
  }

  async function resolveComment(reviewId: string, commentId: string, resolved: boolean): Promise<void> {
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/review-center/${reviewId}/comments/${commentId}`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ resolved }),
      });
      await refresh();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['review_center.error_comment']();
    }
  }

  async function decide(status: Exclude<ReviewStatus, 'pending'>): Promise<void> {
    if (!activeReview || busy) return;
    busy = true;
    try {
      const result = await api<ReviewDecisionResult>(`/api/agent-room/workspaces/${workspaceId}/review-center/${activeReview.id}`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ status, note: decisionNote || null }),
      });
      await refresh();
      decisionNote = '';
      if (result.feedback && !result.feedback.delivered) setStatus(m['review_center.feedback_pending']());
      else setStatus(m['review_center.decision_saved']());
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['review_center.error_decision']();
    } finally {
      busy = false;
    }
  }

  function statusLabel(status: ReviewStatus): string {
    if (status === 'approved') return m['review_center.status_approved']();
    if (status === 'changes_requested') return m['review_center.status_changes_requested']();
    if (status === 'rejected') return m['review_center.status_rejected']();
    return m['review_center.status_pending']();
  }

  function statusTone(status: ReviewStatus): string {
    if (status === 'approved') return 'text-[var(--app-success)] bg-[color-mix(in_srgb,var(--app-success)_12%,transparent)]';
    if (status === 'rejected') return 'text-[var(--app-danger)] bg-[color-mix(in_srgb,var(--app-danger)_12%,transparent)]';
    if (status === 'changes_requested') return 'text-[var(--app-warning)] bg-[color-mix(in_srgb,var(--app-warning)_12%,transparent)]';
    return 'text-[var(--app-accent)] bg-[var(--app-accent-soft)]';
  }

  $effect(() => {
    const change = selectedChange;
    const key = change ? `${change.id}:${snapshot?.git.revision ?? ''}` : '';
    if (change && editorReady && monaco && diffEditor && key !== loadedDiffKey) void loadDiff(change);
    else if (!change) { diffRequest += 1; loadedDiffKey = ''; diff = null; disposeDiffModels(); }
  });

  onMount(() => {
    let destroyed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (destroyed) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.workspaceId === workspaceId && (message.type === 'gitReviewChanged' || message.type === 'workspaceChanged')) void refresh();
        } catch { /* PTY frames are unrelated. */ }
      };
      socket.onclose = () => !destroyed && (reconnectTimer = setTimeout(connect, 1600));
    };
    void (async () => {
      await refresh(false);
      await tick();
      await mountDiffEditor();
      if (selectedChange) await loadDiff(selectedChange);
      connect();
    })();
    return () => {
      destroyed = true;
      editorReady = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      themeObserver?.disconnect();
      diffRequest += 1;
      const model = diffEditor?.getModel();
      diffEditor?.dispose();
      model?.original.dispose();
      model?.modified.dispose();
    };
  });
</script>

<section class="@container flex h-full min-h-0 flex-col bg-[var(--app-canvas)] text-[var(--app-text)]" data-testid="review-center">
  <header class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3">
    <GitBranch size={14} class="text-[var(--app-accent)]" aria-hidden="true" />
    <span class="max-w-44 truncate text-xs font-semibold">{snapshot?.git.branch ?? m['review_center.no_branch']()}</span>
    {#if snapshot?.git.upstream}
      <span class="hidden truncate text-ui-xs text-[var(--app-text-muted)] @min-[700px]:inline">{snapshot.git.upstream}</span>
    {/if}
    <span class="flex items-center gap-1 text-ui-xs tabular-nums text-[var(--app-text-muted)]" title={m['review_center.sync_state']()}>
      <ArrowUpFromLine size={11} /> {snapshot?.git.ahead ?? 0}
      <ArrowDownToLine size={11} /> {snapshot?.git.behind ?? 0}
    </span>
    <span class="ml-auto text-ui-xs text-[var(--app-text-muted)]">{m['review_center.change_count']({ count: changes.length })}</span>
    <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" disabled={busy} aria-label={m['review_center.pull']()} onclick={() => gitAction('pull', {}, m['review_center.pull_done']())}><ArrowDownToLine size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['review_center.pull']()}</Tooltip.Content></Tooltip.Root>
    <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" disabled={busy} aria-label={m['review_center.push']()} onclick={() => gitAction('push', {}, m['review_center.push_done']())}><ArrowUpFromLine size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['review_center.push']()}</Tooltip.Content></Tooltip.Root>
    <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" disabled={busy} aria-label={m['review_center.refresh']()} onclick={() => refresh()}><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['review_center.refresh']()}</Tooltip.Content></Tooltip.Root>
    <Button size="sm" onclick={beginReview} disabled={!changes.length || busy}><CircleDot size={13} />{m['review_center.new_review']()}</Button>
  </header>

  {#if errorMessage}<div class="shrink-0 border-b border-[color-mix(in_srgb,var(--app-danger)_35%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-danger)_10%,transparent)] px-3 py-1.5 text-ui-sm text-[var(--app-danger)]" role="alert">{errorMessage}</div>{/if}
  {#if statusMessage}<div class="shrink-0 border-b border-[color-mix(in_srgb,var(--app-success)_35%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-success)_10%,transparent)] px-3 py-1.5 text-ui-sm text-[var(--app-success)]" role="status">{statusMessage}</div>{/if}

  <div class="review-grid grid min-h-0 flex-1">
    <aside class="min-h-0 overflow-y-auto border-r border-[var(--app-border)] bg-[var(--app-surface)]" aria-label={m['review_center.source_control']()}>
      {#if loading}
        <p class="px-3 py-4 text-xs text-[var(--app-text-muted)]">{m['review_center.loading']()}</p>
      {:else if !snapshot?.git.isRepo}
        <div class="px-3 py-5 text-center"><ShieldAlert class="mx-auto mb-2 text-[var(--app-warning)]" size={22} /><p class="text-xs font-medium">{m['review_center.not_repo']()}</p></div>
      {:else if !changes.length}
        <div class="px-3 py-5 text-center"><CheckCircle2 class="mx-auto mb-2 text-[var(--app-success)]" size={22} /><p class="text-xs font-medium">{m['review_center.clean']()}</p></div>
      {:else}
        {#each [{ label: m['review_center.staged'](), items: stagedChanges }, { label: m['review_center.changes'](), items: unstagedChanges }] as group (group.label)}
          <div class="sticky top-0 z-10 flex h-7 items-center border-y border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">
            {group.label}<span class="ml-auto tabular-nums">{group.items.length}</span>
          </div>
          {#each group.items.slice(0, 500) as change (change.id)}
            <div class={`group flex h-8 items-center ${selectedChangeId === change.id ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-surface-raised)]'}`}>
              <button class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-ui-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]" onclick={() => (selectedChangeId = change.id)}>
                <span class={`w-3 shrink-0 text-center font-mono text-ui-xs font-semibold ${change.status === 'D' ? 'text-[var(--app-danger)]' : change.status === '?' || change.status === 'A' ? 'text-[var(--app-success)]' : 'text-[var(--app-warning)]'}`}>{change.status}</span>
                <span class="min-w-0 flex-1 truncate" title={change.path}>{change.path.split('/').at(-1)}</span>
                <span class="max-w-16 truncate text-ui-xs text-[var(--app-text-muted)]">{change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''}</span>
              </button>
              <button class="mr-0.5 grid size-6 shrink-0 place-items-center rounded-[4px] text-[var(--app-text-muted)] opacity-0 hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:opacity-100 group-hover:opacity-100" aria-label={change.staged ? m['review_center.unstage_file']({ file: change.path }) : m['review_center.stage_file']({ file: change.path })} onclick={() => gitAction(change.staged ? 'unstage' : 'stage', { path: change.path })}>{#if change.staged}<Minus size={12} />{:else}<Plus size={12} />{/if}</button>
              {#if !change.staged && change.status !== '?'}<button class="mr-1 grid size-6 shrink-0 place-items-center rounded-[4px] text-[var(--app-text-muted)] opacity-0 hover:bg-[color-mix(in_srgb,var(--app-danger)_12%,transparent)] hover:text-[var(--app-danger)] focus-visible:opacity-100 group-hover:opacity-100" aria-label={m['review_center.discard_file']({ file: change.path })} onclick={() => (discardChange = change)}><RotateCcw size={12} /></button>{/if}
            </div>
          {/each}
          {#if group.items.length > 500}<p class="px-3 py-2 text-ui-xs text-[var(--app-warning)]">{m['review_center.file_limit']({ count: group.items.length - 500 })}</p>{/if}
        {/each}
      {/if}
      {#if stagedChanges.length}
        <div class="sticky bottom-0 border-t border-[var(--app-border)] bg-[var(--app-surface)] p-2">
          <Textarea class="min-h-16 resize-none text-xs" bind:value={commitMessage} placeholder={m['review_center.commit_placeholder']()} />
          <Button class="mt-2 w-full" size="sm" disabled={!commitMessage.trim() || busy} onclick={commit}><GitCommitHorizontal size={13} />{m['review_center.commit']()}</Button>
        </div>
      {/if}
    </aside>

    <main class="relative min-h-0 min-w-0 bg-[var(--app-canvas)]">
      <div class="flex h-9 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-2">
        <FileCode2 size={13} class="text-[var(--app-text-muted)]" />
        <span class="min-w-0 flex-1 truncate text-ui-sm font-medium">{selectedChange?.path ?? m['review_center.select_file']()}</span>
        {#if diff?.truncated}<span class="rounded-[3px] bg-[color-mix(in_srgb,var(--app-warning)_12%,transparent)] px-1.5 py-0.5 text-ui-xs font-medium text-[var(--app-warning)]">{m['review_center.truncated']()}</span>{/if}
        <Button variant="ghost" size="sm" disabled={!selectedChange || !activeReview} onclick={() => (commentOpen = !commentOpen)}><MessageSquarePlus size={13} />{m['review_center.comment']()}</Button>
      </div>
      {#if commentOpen && selectedChange && activeReview}
        <div class="absolute right-3 top-12 z-20 w-[min(360px,calc(100%-24px))] border border-[var(--app-border-strong)] bg-[var(--app-surface-raised)] p-3 shadow-xl">
          <div class="mb-2 flex items-center gap-2"><MessageSquarePlus size={13} /><strong class="text-ui-sm">{selectedLine ? m['review_center.comment_line']({ line: selectedLine }) : m['review_center.comment_file']()}</strong><button class="ml-auto" aria-label={m['settings.cancel']()} onclick={() => (commentOpen = false)}><X size={14} /></button></div>
          <Textarea class="min-h-24 resize-none text-xs" bind:value={commentBody} placeholder={m['review_center.comment_placeholder']()} />
          <div class="mt-2 flex justify-end gap-2"><Button variant="outline" size="sm" onclick={() => (commentOpen = false)}>{m['settings.cancel']()}</Button><Button size="sm" disabled={!commentBody.trim() || busy} onclick={addComment}>{m['review_center.add_comment']()}</Button></div>
        </div>
      {/if}
      {#if diffLoading}<div class="absolute inset-9 z-10 grid place-items-center bg-[color-mix(in_srgb,var(--app-canvas)_75%,transparent)]"><RefreshCw size={20} class="animate-spin text-[var(--app-accent)]" /></div>{/if}
      {#if diff?.binary}<div class="absolute inset-9 grid place-items-center text-center"><div><FileCode2 class="mx-auto mb-2 text-[var(--app-text-muted)]" size={26} /><p class="text-xs font-medium">{m['review_center.binary']()}</p><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{m['review_center.binary_desc']()}</p></div></div>{/if}
      <div bind:this={diffHost} class={`diff-host absolute inset-x-0 bottom-0 top-9 ${diff?.binary || !selectedChange ? 'invisible' : ''}`}></div>
      {#if !selectedChange && !loading}<div class="absolute inset-9 grid place-items-center"><p class="text-xs text-[var(--app-text-muted)]">{m['review_center.select_file_hint']()}</p></div>{/if}
    </main>

    <aside class="min-h-0 overflow-y-auto border-l border-[var(--app-border)] bg-[var(--app-surface)] p-3" aria-label={m['review_center.review_details']()}>
      <div class="mb-3 flex items-center gap-2"><h2 class="text-xs font-semibold">{m['review_center.reviews']()}</h2><span class="ml-auto text-ui-xs tabular-nums text-[var(--app-text-muted)]">{snapshot?.reviews.length ?? 0}</span></div>
      {#if snapshot?.reviews.length}
        <NativeSelect.Root class="mb-3 w-full" size="sm" bind:value={activeReviewId} aria-label={m['review_center.select_review']()}>
          {#each snapshot.reviews as review (review.id)}<NativeSelect.Option value={review.id}>{review.title}</NativeSelect.Option>{/each}
        </NativeSelect.Root>
      {:else}
        <p class="mb-4 text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['review_center.no_reviews']()}</p>
      {/if}

      {#if activeReview}
        <div class="mb-3 flex items-start gap-2"><div class="min-w-0 flex-1"><h3 class="break-words text-sm font-semibold">{activeReview.title}</h3><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{activeReview.taskTitle ?? m['review_center.no_task']()} · {activeReview.assigneeTitle ?? m['review_center.no_assignee']()}</p></div><span class={`shrink-0 rounded-[3px] px-1.5 py-1 text-ui-xs font-semibold ${statusTone(activeReview.status)}`}>{statusLabel(activeReview.status)}</span></div>
        {#if activeReview.summary}<p class="mb-4 whitespace-pre-wrap text-ui-sm leading-5 text-[var(--app-text-soft)]">{activeReview.summary}</p>{/if}
        {#each [{ label: m['review_center.evidence'](), items: activeReview.evidence }, { label: m['review_center.tests'](), items: activeReview.tests }, { label: m['review_center.risks'](), items: activeReview.risks }] as section (section.label)}
          {#if section.items.length}<div class="mb-3"><h4 class="mb-1 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{section.label}</h4>{#each section.items as item}<p class="mb-1 flex gap-1.5 text-ui-xs leading-4"><Check size={11} class="mt-0.5 shrink-0 text-[var(--app-success)]" />{item}</p>{/each}</div>{/if}
        {/each}
        <div class="my-3 border-t border-[var(--app-border)]"></div>
        <div class="mb-2 flex items-center"><h4 class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['review_center.comments']()}</h4><span class="ml-auto text-ui-xs tabular-nums text-[var(--app-text-muted)]">{openCommentCount}</span></div>
        {#each [...new Set(activeReview.comments.map((comment) => comment.filePath))] as filePath (filePath)}
          <div class="mb-3"><button class="mb-1 max-w-full truncate text-left font-mono text-ui-xs font-medium text-[var(--app-accent)]" title={filePath} onclick={() => { const match = changes.find((change) => change.path === filePath); if (match) selectedChangeId = match.id; }}>{filePath}</button>
            {#each activeReview.comments.filter((comment) => comment.filePath === filePath) as comment (comment.id)}
              <div class={`mb-1.5 border-l-2 py-1 pl-2 ${comment.status === 'resolved' ? 'border-[var(--app-border-strong)] opacity-55' : comment.stale ? 'border-[var(--app-warning)]' : 'border-[var(--app-accent)]'}`}>
                <div class="flex items-center gap-1 text-ui-xs text-[var(--app-text-muted)]"><span>{comment.lineNumber ? `L${comment.lineNumber}` : m['review_center.whole_file']()}</span>{#if comment.stale}<span class="text-[var(--app-warning)]">{m['review_center.stale']()}</span>{/if}<button class="ml-auto text-[var(--app-accent)] hover:underline" onclick={() => resolveComment(activeReview.id, comment.id, comment.status !== 'resolved')}>{comment.status === 'resolved' ? m['review_center.reopen']() : m['review_center.resolve']()}</button></div>
                <p class="mt-1 break-words text-ui-xs leading-4">{comment.body}</p>
              </div>
            {/each}
          </div>
        {/each}
        {#if !activeReview.comments.length}<p class="mb-4 text-ui-xs text-[var(--app-text-muted)]">{m['review_center.no_comments']()}</p>{/if}

        <Textarea class="min-h-20 resize-none text-xs" bind:value={decisionNote} placeholder={m['review_center.decision_placeholder']()} />
        <div class="mt-2 grid grid-cols-3 gap-1.5">
          <Button size="sm" class="min-w-0 px-1 text-ui-xs" disabled={busy} onclick={() => decide('approved')}><CheckCircle2 size={12} />{m['review_center.approve']()}</Button>
          <Button size="sm" variant="outline" class="min-w-0 px-1 text-ui-xs text-[var(--app-warning)]" disabled={busy} onclick={() => decide('changes_requested')}><ShieldAlert size={12} />{m['review_center.request_changes']()}</Button>
          <Button size="sm" variant="outline" class="min-w-0 px-1 text-ui-xs text-[var(--app-danger)]" disabled={busy} onclick={() => decide('rejected')}><XCircle size={12} />{m['review_center.reject']()}</Button>
        </div>
        {#if activeReview.decisionNote}<div class="mt-3 border-l-2 border-[var(--app-border-strong)] pl-2"><span class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['review_center.last_decision']()}</span><p class="mt-1 whitespace-pre-wrap text-ui-xs leading-4">{activeReview.decisionNote}</p></div>{/if}
      {/if}
    </aside>
  </div>
</section>

<Dialog.Root bind:open={reviewDialogOpen}>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header><Dialog.Title>{m['review_center.create_title']()}</Dialog.Title><Dialog.Description>{m['review_center.create_description']()}</Dialog.Description></Dialog.Header>
    <div class="grid gap-3 py-2 sm:grid-cols-2">
      <label class="sm:col-span-2"><span class="mb-1 block text-xs font-medium">{m['review_center.title_field']()}</span><Input bind:value={reviewTitle} maxlength={160} /></label>
      <label><span class="mb-1 block text-xs font-medium">{m['review_center.task_field']()}</span><NativeSelect.Root class="w-full" bind:value={reviewTaskId}><NativeSelect.Option value="">{m['review_center.no_task']()}</NativeSelect.Option>{#each snapshot?.tasks ?? [] as task (task.id)}<NativeSelect.Option value={task.id}>{task.title}</NativeSelect.Option>{/each}</NativeSelect.Root></label>
      <label><span class="mb-1 block text-xs font-medium">{m['review_center.assignee_field']()}</span><NativeSelect.Root class="w-full" bind:value={reviewAssigneeId}><NativeSelect.Option value="">{m['review_center.no_assignee']()}</NativeSelect.Option>{#each snapshot?.agents ?? [] as agent (agent.id)}<NativeSelect.Option value={agent.id}>{agent.title}</NativeSelect.Option>{/each}</NativeSelect.Root></label>
      <label class="sm:col-span-2"><span class="mb-1 block text-xs font-medium">{m['review_center.summary_field']()}</span><Textarea class="min-h-20 resize-y" bind:value={reviewSummary} /></label>
      <label><span class="mb-1 block text-xs font-medium">{m['review_center.evidence']()}</span><Textarea class="min-h-20 resize-y text-xs" bind:value={reviewEvidence} placeholder={m['review_center.one_per_line']()} /></label>
      <label><span class="mb-1 block text-xs font-medium">{m['review_center.tests']()}</span><Textarea class="min-h-20 resize-y text-xs" bind:value={reviewTests} placeholder={m['review_center.one_per_line']()} /></label>
      <label class="sm:col-span-2"><span class="mb-1 block text-xs font-medium">{m['review_center.risks']()}</span><Textarea class="min-h-20 resize-y text-xs" bind:value={reviewRisks} placeholder={m['review_center.one_per_line']()} /></label>
      <fieldset class="sm:col-span-2"><legend class="mb-1 text-xs font-medium">{m['review_center.files_field']()}</legend><div class="max-h-32 overflow-y-auto border border-[var(--app-border)] bg-[var(--app-surface)] p-2">{#each [...new Set(changes.map((change) => change.path))] as path (path)}<label class="flex min-h-7 items-center gap-2 text-ui-sm"><input type="checkbox" checked={reviewPaths.includes(path)} onchange={(event) => reviewPaths = (event.currentTarget as HTMLInputElement).checked ? [...reviewPaths, path] : reviewPaths.filter((item) => item !== path)} /><span class="min-w-0 truncate">{path}</span></label>{/each}</div></fieldset>
    </div>
    <Dialog.Footer><Button variant="outline" onclick={() => (reviewDialogOpen = false)}>{m['settings.cancel']()}</Button><Button disabled={busy || !reviewTitle.trim()} onclick={createReview}>{m['review_center.create_review']()}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={Boolean(discardChange)} onOpenChange={(open) => !open && (discardChange = null)}>
  <AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['review_center.discard_title']()}</AlertDialog.Title><AlertDialog.Description>{m['review_center.discard_description']({ file: discardChange?.path ?? '' })}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => { if (discardChange) void gitAction('discard', { path: discardChange.path }, m['review_center.discard_done']()); discardChange = null; }}>{m['review_center.discard_confirm']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content>
</AlertDialog.Root>

<style>
  .review-grid { grid-template-columns: minmax(180px, 230px) minmax(360px, 1fr) minmax(260px, 320px); }
  @container (max-width: 980px) {
    .review-grid { grid-template-columns: minmax(180px, 220px) minmax(360px, 1fr); grid-template-rows: minmax(360px, 1fr) minmax(220px, 38%); }
    .review-grid > aside:last-child { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--app-border); }
  }
  @container (max-width: 620px) {
    .review-grid { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 28%) minmax(360px, 1fr) minmax(240px, 38%); }
    .review-grid > aside:first-child { border-right: 0; border-bottom: 1px solid var(--app-border); }
    .review-grid > aside:last-child { grid-column: 1; }
  }
</style>
