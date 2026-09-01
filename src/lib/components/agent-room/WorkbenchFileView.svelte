<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import {
    Braces,
    ChevronLeft,
    ChevronRight,
    Code2,
    Eye,
    FileArchive,
    FileText,
    Focus,
    ListTree,
    Maximize2,
    MessageSquareQuote,
    Minus,
    Plus,
    RefreshCw,
    Save,
    WrapText,
  } from '@lucide/svelte';
  import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
  import CssWorker from 'monaco-editor/language/css/css.worker?worker';
  import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
  import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
  import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
  import PdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
  import type { editor } from 'monaco-editor';
  import MarkdownView from './MarkdownView.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { appSettingsStore, getAppSettings } from './app-settings.svelte.js';
  import {
    getWorkbenchEditorBuffer,
    markWorkbenchEditorBufferSaved,
    notifyWorkbenchEditorState,
    registerWorkbenchEditorBuffer,
    saveWorkbenchEditorViewState,
    workbenchEditorBufferKey,
    type WorkbenchEditorBuffer,
  } from './workbench-editor-registry.js';
  import type { NodeConnection } from './canvas/NodeShell.svelte';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  type Monaco = typeof import('monaco-editor');
  type FsInspection = {
    path: string;
    name: string;
    extension: string;
    size: number;
    modifiedAt: string;
    contentType: string;
    kind: 'text' | 'markdown' | 'image' | 'pdf' | 'binary';
  };

  let {
    workspaceId,
    workingDir,
    path,
    connections = [],
  }: {
    workspaceId: string;
    workingDir: string;
    path: string;
    connections?: NodeConnection[];
  } = $props();

  let editorHost = $state<HTMLDivElement>();
  let pdfCanvas = $state<HTMLCanvasElement>();
  let codeEditor: editor.IStandaloneCodeEditor | null = null;
  let buffer = $state.raw<WorkbenchEditorBuffer | null>(null);
  let modelRevision = $state(0);
  let inspection = $state<FsInspection | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let errorMessage = $state('');
  let statusMessage = $state('');
  let cursorLine = $state(1);
  let cursorColumn = $state(1);
  let minimap = $state(true);
  let wordWrap = $state(false);
  let autoSave = $state(false);
  let sourceMode = $state(true);
  let previewContent = $state('');
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let graphSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let themeObserver: MutationObserver | null = null;
  let pdfDocument: any = null;
  let pdfRenderTask: any = null;
  let pdfPage = $state(1);
  let pdfPages = $state(0);
  let pdfZoom = $state(1);
  let imageZoom = $state(1);
  let imageX = $state(0);
  let imageY = $state(0);
  let imageWidth = $state(0);
  let imageHeight = $state(0);
  let draggingImage = false;
  let dragOrigin = { x: 0, y: 0, imageX: 0, imageY: 0 };

  const rawUrl = $derived(`/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(path)}`);
  const relativePath = $derived(path.startsWith(workingDir) ? path.slice(workingDir.length).replace(/^[\\/]+/, '') : path);
  const breadcrumbs = $derived(relativePath.split(/[\\/]/).filter(Boolean));
  const dirty = $derived(Boolean(
    buffer
      && modelRevision >= 0
      && buffer.model.getAlternativeVersionId() !== buffer.savedAlternativeVersionId,
  ));
  const modifiedLabel = $derived(inspection
    ? m['workbench_editor.modified']({
        date: new Intl.DateTimeFormat(localeState.current, { dateStyle: 'medium', timeStyle: 'short' })
          .format(new Date(inspection.modifiedAt)),
      })
    : '');

  function csrfHeaders(extra: Record<string, string> = {}): HeadersInit {
    const token = getCsrfToken();
    return token ? { ...extra, 'X-CSRF-Token': token } : extra;
  }

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['editor.error_api']());
    return payload.data as T;
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

  function cssColor(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function applyMonacoTheme(instance: Monaco): void {
    const dark = document.documentElement.classList.contains('dark');
    instance.editor.defineTheme('orkestrai-workbench', {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: cssColor('--app-text-muted', dark ? '#8b8c96' : '#686b7a').slice(1) },
        { token: 'string', foreground: cssColor('--app-success', '#45c992').slice(1) },
        { token: 'keyword', foreground: cssColor('--app-secondary', '#65a9ff').slice(1) },
      ],
      colors: {
        'editor.background': cssColor('--app-canvas', dark ? '#151619' : '#eef0f7'),
        'editor.foreground': cssColor('--app-text', dark ? '#f2f3f5' : '#181822'),
        'editorLineNumber.foreground': cssColor('--app-text-muted', dark ? '#898e98' : '#686b7a'),
        'editorLineNumber.activeForeground': cssColor('--app-text-soft', dark ? '#c5c8ce' : '#474957'),
        'editor.selectionBackground': cssColor('--app-accent-soft', dark ? '#303238' : '#e9e3ff'),
        'editor.inactiveSelectionBackground': cssColor('--app-surface-raised', dark ? '#292b31' : '#e7e9f1'),
        'editorCursor.foreground': cssColor('--app-accent', '#9675ff'),
        'editorIndentGuide.background1': cssColor('--app-border', dark ? '#30333a' : '#d7d9e3'),
        'editorIndentGuide.activeBackground1': cssColor('--app-border-strong', dark ? '#464a54' : '#b8bbc9'),
        'editorWidget.background': cssColor('--app-surface-raised', dark ? '#292b31' : '#ffffff'),
        'editorWidget.border': cssColor('--app-border', dark ? '#30333a' : '#d7d9e3'),
        'minimap.background': cssColor('--app-canvas', dark ? '#151619' : '#eef0f7'),
      },
    });
    instance.editor.setTheme('orkestrai-workbench');
  }

  async function loadInspection(): Promise<void> {
    inspection = await api<FsInspection>(
      `/api/agent-room/workspaces/${workspaceId}/fs/inspect?path=${encodeURIComponent(path)}`,
    );
    sourceMode = inspection.kind !== 'markdown';
  }

  async function loadText(): Promise<{ content: string; truncated: boolean }> {
    return api(`/api/agent-room/workspaces/${workspaceId}/fs/read?path=${encodeURIComponent(path)}`);
  }

  async function mountEditor(): Promise<void> {
    if (!editorHost || !inspection || !['text', 'markdown'].includes(inspection.kind)) return;
    configureWorkers();
    const instance = await import('monaco-editor');
    applyMonacoTheme(instance);
    themeObserver = new MutationObserver(() => applyMonacoTheme(instance));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-app-theme'] });

    let activeBuffer = getWorkbenchEditorBuffer(workspaceId, path);
    if (!activeBuffer) {
      const loaded = await loadText();
      previewContent = loaded.content;
      const uri = instance.Uri.from({ scheme: 'orkestrai-file', authority: workspaceId, path: `/${relativePath}` });
      const existingModel = instance.editor.getModel(uri);
      const model = existingModel ?? instance.editor.createModel(loaded.content, undefined, uri);
      activeBuffer = registerWorkbenchEditorBuffer({
        key: workbenchEditorBufferKey(workspaceId, path),
        workspaceId,
        path,
        model,
        savedAlternativeVersionId: model.getAlternativeVersionId(),
        savedValue: loaded.content,
        truncated: loaded.truncated,
        viewState: null,
      });
    } else {
      previewContent = activeBuffer.model.getValue();
    }
    buffer = activeBuffer;
    modelRevision = activeBuffer.model.getAlternativeVersionId();

    codeEditor = instance.editor.create(editorHost, {
      model: activeBuffer.model,
      theme: 'orkestrai-workbench',
      automaticLayout: true,
      readOnly: activeBuffer.truncated,
      editContext: false,
      minimap: { enabled: minimap },
      wordWrap: wordWrap ? 'on' : 'off',
      fontFamily: appSettingsStore.values.terminalFontFamily || 'JetBrains Mono Variable, ui-monospace, monospace',
      fontSize: Number(appSettingsStore.values.editorFontSize || 13),
      fontLigatures: true,
      padding: { top: 10, bottom: 10 },
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      stickyScroll: { enabled: true },
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
    });
    if (activeBuffer.viewState) codeEditor.restoreViewState(activeBuffer.viewState);
    codeEditor.addCommand(instance.KeyMod.CtrlCmd | instance.KeyCode.KeyS, () => void save());
    codeEditor.focus();
    codeEditor.onDidChangeCursorPosition((event) => {
      cursorLine = event.position.lineNumber;
      cursorColumn = event.position.column;
      if (graphSyncTimer) clearTimeout(graphSyncTimer);
      graphSyncTimer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('orkestrai:editor-location', {
          detail: { workspaceId, path: relativePath, line: cursorLine, column: cursorColumn },
        }));
      }, 180);
    });
    const revealKey = `orkestrai:file-reveal:${workspaceId}:${relativePath}`;
    const reveal = sessionStorage.getItem(revealKey);
    if (reveal) {
      sessionStorage.removeItem(revealKey);
      try {
        const location = JSON.parse(reveal) as { line?: number; column?: number };
        const lineNumber = Math.max(1, Number(location.line) || 1);
        const column = Math.max(1, Number(location.column) || 1);
        codeEditor.setPosition({ lineNumber, column });
        codeEditor.revealLineInCenter(lineNumber);
      } catch {
        // Ignore invalid transient navigation state.
      }
    }
    codeEditor.onDidChangeModelContent(() => {
      modelRevision = activeBuffer.model.getAlternativeVersionId();
      previewContent = activeBuffer.model.getValue();
      notifyWorkbenchEditorState(activeBuffer.key);
      if (!autoSave || activeBuffer.truncated) return;
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      if (graphSyncTimer) clearTimeout(graphSyncTimer);
      autoSaveTimer = setTimeout(() => void save(), 900);
    });
  }

  async function save(): Promise<void> {
    if (!buffer || buffer.truncated || saving) return;
    saving = true;
    errorMessage = '';
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/fs/write`, {
        method: 'PUT',
        headers: csrfHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ path, content: buffer.model.getValue() }),
      });
      markWorkbenchEditorBufferSaved(buffer);
      modelRevision = buffer.model.getAlternativeVersionId();
      statusMessage = m['workbench_editor.saved']();
      setTimeout(() => (statusMessage = ''), 1600);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['editor.error_save']();
    } finally {
      saving = false;
    }
  }

  async function reload(): Promise<void> {
    if (!buffer || dirty) return;
    const loaded = await loadText();
    buffer.model.setValue(loaded.content);
    buffer.truncated = loaded.truncated;
    previewContent = loaded.content;
    markWorkbenchEditorBufferSaved(buffer);
    modelRevision = buffer.model.getAlternativeVersionId();
    codeEditor?.updateOptions({ readOnly: loaded.truncated });
  }

  async function formatDocument(): Promise<void> {
    await codeEditor?.getAction('editor.action.formatDocument')?.run();
  }

  async function showOutline(): Promise<void> {
    codeEditor?.focus();
    await codeEditor?.getAction('editor.action.quickOutline')?.run();
  }

  function toggleMinimap(): void {
    minimap = !minimap;
    codeEditor?.updateOptions({ minimap: { enabled: minimap } });
  }

  function toggleWrap(): void {
    wordWrap = !wordWrap;
    codeEditor?.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' });
  }

  async function citeSelection(): Promise<void> {
    if (!codeEditor || !buffer) return;
    const selection = codeEditor.getSelection();
    if (!selection || selection.isEmpty()) {
      statusMessage = m['editor.cite_no_selection']();
      return;
    }
    const target = connections.find((connection) => connection.targetType === 'terminal');
    if (!target) {
      statusMessage = m['editor.cite_no_terminal']();
      return;
    }
    const text = buffer.model.getValueInRange(selection);
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/terminals/${target.targetId}/write`, {
        method: 'POST',
        headers: csrfHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ data: `\n[${m['workbench_editor.quote_label']({ file: inspection?.name ?? path, line: selection.startLineNumber })}]\n${text}\n` }),
      });
      statusMessage = m['editor.cite_sent']({ title: target.targetTitle });
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : m['editor.error_cite']();
    }
  }

  async function openExternally(): Promise<void> {
    const desktop = (window as unknown as { orkestraiDesktop?: { openPath?: (path: string) => Promise<string> } }).orkestraiDesktop;
    if (desktop?.openPath && inspection?.path) {
      const result = await desktop.openPath(inspection.path);
      if (result) errorMessage = m['workbench_editor.external_error']();
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = rawUrl;
    anchor.download = inspection?.name ?? 'file';
    anchor.click();
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function renderPdf(): Promise<void> {
    if (!pdfCanvas || !pdfDocument) return;
    pdfRenderTask?.cancel?.();
    const page = await pdfDocument.getPage(pdfPage);
    const viewport = page.getViewport({ scale: pdfZoom });
    const ratio = window.devicePixelRatio || 1;
    const context = pdfCanvas.getContext('2d');
    if (!context) return;
    pdfCanvas.width = Math.floor(viewport.width * ratio);
    pdfCanvas.height = Math.floor(viewport.height * ratio);
    pdfCanvas.style.width = `${Math.floor(viewport.width)}px`;
    pdfCanvas.style.height = `${Math.floor(viewport.height)}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    pdfRenderTask = page.render({ canvasContext: context, viewport });
    await pdfRenderTask.promise.catch((error: unknown) => {
      if ((error as { name?: string })?.name !== 'RenderingCancelledException') throw error;
    });
  }

  async function loadPdf(): Promise<void> {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;
    pdfDocument = await pdfjs.getDocument({ url: rawUrl }).promise;
    pdfPages = pdfDocument.numPages;
    await tick();
    await renderPdf();
  }

  function changePdfPage(delta: number): void {
    pdfPage = Math.min(pdfPages, Math.max(1, pdfPage + delta));
    void renderPdf();
  }

  function changePdfZoom(delta: number): void {
    pdfZoom = Math.min(2.5, Math.max(0.5, Number((pdfZoom + delta).toFixed(2))));
    void renderPdf();
  }

  function resetImage(): void {
    imageZoom = 1;
    imageX = 0;
    imageY = 0;
  }

  function captureImageDimensions(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    imageWidth = image.naturalWidth;
    imageHeight = image.naturalHeight;
  }

  function startImagePan(event: PointerEvent): void {
    draggingImage = true;
    dragOrigin = { x: event.clientX, y: event.clientY, imageX, imageY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function panImage(event: PointerEvent): void {
    if (!draggingImage) return;
    imageX = dragOrigin.imageX + event.clientX - dragOrigin.x;
    imageY = dragOrigin.imageY + event.clientY - dragOrigin.y;
  }

  onMount(() => {
    let destroyed = false;
    const initialize = async () => {
      try {
        const settings = await getAppSettings();
        minimap = settings.editorMinimap !== 'false';
        wordWrap = settings.editorWordWrap === 'true';
        autoSave = settings.editorAutoSave === 'true';
        await loadInspection();
        if (destroyed || !inspection) return;
        loading = false;
        if (inspection.kind === 'text' || inspection.kind === 'markdown') {
          await tick();
          await mountEditor();
        } else if (inspection.kind === 'pdf') {
          await tick();
          await loadPdf();
        }
      } catch (error) {
        if (!destroyed) errorMessage = error instanceof Error ? error.message : m['editor.error_open']();
      } finally {
        if (!destroyed) loading = false;
      }
    };
    void initialize();
    return () => {
      destroyed = true;
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      if (buffer && codeEditor) saveWorkbenchEditorViewState(buffer, codeEditor.saveViewState());
      codeEditor?.dispose();
      codeEditor = null;
      themeObserver?.disconnect();
      pdfRenderTask?.cancel?.();
      pdfDocument?.destroy?.();
    };
  });
</script>

<div class="grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)_24px] overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)]" data-testid="workbench-file-view">
  <header class="flex min-w-0 items-center gap-1 border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-2">
    <div class="flex min-w-0 flex-1 items-center overflow-hidden text-[11px] text-[var(--app-text-muted)]" aria-label={m['workbench_editor.breadcrumbs']()}>
      {#each breadcrumbs as crumb, index (index)}
        {#if index > 0}<ChevronRight size={11} class="mx-0.5 shrink-0 opacity-50" aria-hidden="true" />{/if}
        <span class={index === breadcrumbs.length - 1 ? 'truncate font-medium text-[var(--app-text)]' : 'max-w-32 truncate'}>{crumb}</span>
      {/each}
      {#if dirty}<span class="ml-2 size-1.5 shrink-0 rounded-full bg-[var(--app-warning)]" title={m['editor.unsaved']()}></span>{/if}
    </div>

    {#if inspection?.kind === 'markdown'}
      <div class="mr-1 flex items-center rounded-[5px] border border-[var(--app-border)] bg-[var(--app-surface)] p-0.5">
        <button class={`grid size-6 place-items-center rounded-[3px] ${sourceMode ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)]' : 'text-[var(--app-text-muted)]'}`} aria-label={m['workbench_editor.source']()} onclick={() => (sourceMode = true)}><Code2 size={12} /></button>
        <button class={`grid size-6 place-items-center rounded-[3px] ${!sourceMode ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)]' : 'text-[var(--app-text-muted)]'}`} aria-label={m['workbench_editor.preview']()} onclick={() => (sourceMode = false)}><Eye size={12} /></button>
      </div>
    {/if}

    {#if inspection && (inspection.kind === 'text' || inspection.kind === 'markdown')}
      <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-xs" aria-label={m['workbench_editor.outline']()} onclick={showOutline}><ListTree size={13} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['workbench_editor.outline']()}</Tooltip.Content></Tooltip.Root>
      <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant={wordWrap ? 'secondary' : 'ghost'} size="icon-xs" aria-label={m['workbench_editor.wrap']()} onclick={toggleWrap}><WrapText size={13} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['workbench_editor.wrap']()}</Tooltip.Content></Tooltip.Root>
      <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant={minimap ? 'secondary' : 'ghost'} size="icon-xs" aria-label={m['workbench_editor.minimap']()} onclick={toggleMinimap}><Focus size={13} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['workbench_editor.minimap']()}</Tooltip.Content></Tooltip.Root>
      <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-xs" aria-label={m['workbench_editor.format']()} onclick={formatDocument}><Braces size={13} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['workbench_editor.format']()}</Tooltip.Content></Tooltip.Root>
      <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-xs" aria-label={m['editor.cite_tooltip']()} onclick={citeSelection}><MessageSquareQuote size={13} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['editor.cite_tooltip']()}</Tooltip.Content></Tooltip.Root>
      <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-xs" disabled={dirty} aria-label={m['editor.reload']()} onclick={reload}><RefreshCw size={13} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{dirty ? m['workbench_editor.reload_dirty']() : m['editor.reload']()}</Tooltip.Content></Tooltip.Root>
      <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-xs" disabled={!dirty || saving || buffer?.truncated} aria-label={m['editor.save']()} onclick={save}><Save size={13} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['editor.save']()}</Tooltip.Content></Tooltip.Root>
    {/if}
  </header>

  <section class="relative min-h-0 min-w-0 overflow-hidden">
    {#if loading}
      <div class="flex h-full items-center justify-center text-xs text-[var(--app-text-muted)]">{m['workbench_editor.loading']()}</div>
    {:else if errorMessage}
      <div class="flex h-full items-center justify-center p-8"><p class="max-w-md text-center text-xs leading-5 text-[var(--app-danger)]">{errorMessage}</p></div>
    {:else if inspection && (inspection.kind === 'text' || inspection.kind === 'markdown')}
      <div class="h-full min-h-0" class:hidden={inspection.kind === 'markdown' && !sourceMode} bind:this={editorHost}></div>
      {#if inspection.kind === 'markdown' && !sourceMode}
        <div class="absolute inset-0 overflow-auto bg-[var(--app-surface)] px-[clamp(24px,7vw,96px)] py-8">
          <article class="mx-auto max-w-4xl"><MarkdownView content={previewContent} /></article>
        </div>
      {/if}
      {#if buffer?.truncated}
        <div class="absolute inset-x-3 bottom-3 rounded-[6px] border border-[color-mix(in_srgb,var(--app-warning)_45%,var(--app-border))] bg-[var(--app-surface-raised)] px-3 py-2 text-xs text-[var(--app-warning)] shadow-lg">
          {m['workbench_editor.truncated_readonly']()}
        </div>
      {/if}
    {:else if inspection?.kind === 'image'}
      <div class="image-stage relative flex h-full touch-none items-center justify-center overflow-hidden bg-[var(--app-surface-subtle)]" role="application" aria-label={m['workbench_editor.image_viewer']()} onpointerdown={startImagePan} onpointermove={panImage} onpointerup={() => (draggingImage = false)} onpointercancel={() => (draggingImage = false)}>
        <img
          src={rawUrl}
          alt={inspection.name}
          draggable="false"
          class="max-h-[88%] max-w-[88%] select-none object-contain shadow-[0_10px_34px_rgba(0,0,0,.22)]"
          style:transform={`translate(${imageX}px, ${imageY}px) scale(${imageZoom})`}
          onload={captureImageDimensions}
        />
        <div class="absolute right-3 top-3 flex items-center gap-1 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-1 shadow-lg">
          <Button variant="ghost" size="icon-xs" aria-label={m['workbench_editor.zoom_out']()} onclick={() => (imageZoom = Math.max(0.25, imageZoom - 0.25))}><Minus size={13} /></Button>
          <span class="w-11 text-center text-[10px] tabular-nums">{Math.round(imageZoom * 100)}%</span>
          <Button variant="ghost" size="icon-xs" aria-label={m['workbench_editor.zoom_in']()} onclick={() => (imageZoom = Math.min(4, imageZoom + 0.25))}><Plus size={13} /></Button>
          <Button variant="ghost" size="icon-xs" aria-label={m['workbench_editor.reset_view']()} onclick={resetImage}><Maximize2 size={13} /></Button>
        </div>
      </div>
    {:else if inspection?.kind === 'pdf'}
      <div class="flex h-full min-h-0 flex-col bg-[var(--app-surface-subtle)]">
        <div class="flex h-9 shrink-0 items-center justify-center gap-1 border-b border-[var(--app-border)] bg-[var(--app-surface)]">
          <Button variant="ghost" size="icon-xs" disabled={pdfPage <= 1} aria-label={m['workbench_editor.previous_page']()} onclick={() => changePdfPage(-1)}><ChevronLeft size={13} /></Button>
          <span class="min-w-20 text-center text-[10px] tabular-nums">{m['workbench_editor.page_count']({ current: pdfPage, total: pdfPages })}</span>
          <Button variant="ghost" size="icon-xs" disabled={pdfPage >= pdfPages} aria-label={m['workbench_editor.next_page']()} onclick={() => changePdfPage(1)}><ChevronRight size={13} /></Button>
          <span class="mx-1 h-4 w-px bg-[var(--app-border)]"></span>
          <Button variant="ghost" size="icon-xs" aria-label={m['workbench_editor.zoom_out']()} onclick={() => changePdfZoom(-0.15)}><Minus size={13} /></Button>
          <span class="w-11 text-center text-[10px] tabular-nums">{Math.round(pdfZoom * 100)}%</span>
          <Button variant="ghost" size="icon-xs" aria-label={m['workbench_editor.zoom_in']()} onclick={() => changePdfZoom(0.15)}><Plus size={13} /></Button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-5 text-center"><canvas bind:this={pdfCanvas} class="mx-auto bg-white shadow-[0_10px_34px_rgba(0,0,0,.2)]"></canvas></div>
      </div>
    {:else if inspection}
      <div class="flex h-full items-center justify-center p-8">
        <div class="max-w-sm text-center">
          <span class="mx-auto mb-4 grid size-12 place-items-center rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text-muted)]">
            {#if inspection.kind === 'binary'}<FileArchive size={22} strokeWidth={1.5} />{:else}<FileText size={22} strokeWidth={1.5} />{/if}
          </span>
          <h2 class="truncate text-sm font-semibold">{inspection.name}</h2>
          <p class="mt-1 text-xs text-[var(--app-text-muted)]">{inspection.contentType} · {formatBytes(inspection.size)}</p>
          <Button class="mt-4" size="sm" variant="outline" onclick={openExternally}>{m['workbench_editor.open_external']()}</Button>
        </div>
      </div>
    {/if}
  </section>

  <footer class="flex min-w-0 items-center gap-3 border-t border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-2.5 text-[10px] text-[var(--app-text-muted)]">
    {#if inspection}
      <span class="truncate">{inspection.contentType}</span>
      <span>{formatBytes(inspection.size)}</span>
      {#if inspection.kind === 'image' && imageWidth && imageHeight}<span class="tabular-nums">{imageWidth} × {imageHeight}</span>{/if}
      <span class="min-w-0 truncate">{modifiedLabel}</span>
      {#if inspection.kind === 'text' || inspection.kind === 'markdown'}
        <span class="ml-auto tabular-nums">{m['workbench_editor.cursor_position']({ line: cursorLine, column: cursorColumn })}</span>
        <span>{m['workbench_editor.encoding']()}</span>
        {#if autoSave}<span>{m['workbench_editor.autosave_on']()}</span>{/if}
      {/if}
    {/if}
    {#if statusMessage}<span class="ml-auto truncate text-[var(--app-text-soft)]">{statusMessage}</span>{/if}
  </footer>
</div>

<style>
  .image-stage {
    background-image:
      linear-gradient(45deg, color-mix(in srgb, var(--app-border) 45%, transparent) 25%, transparent 25%),
      linear-gradient(-45deg, color-mix(in srgb, var(--app-border) 45%, transparent) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--app-border) 45%, transparent) 75%),
      linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--app-border) 45%, transparent) 75%);
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    background-size: 12px 12px;
  }

  :global(.monaco-editor .find-widget),
  :global(.monaco-editor .suggest-widget),
  :global(.monaco-editor .quick-input-widget) {
    border-radius: 6px;
  }
</style>
