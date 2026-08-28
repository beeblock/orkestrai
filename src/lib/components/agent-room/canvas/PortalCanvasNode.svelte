<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { ArrowRight, Globe, MousePointer2, Navigation, Pencil, RotateCcw, Send, Smartphone, X } from '@lucide/svelte';
  import type { PortalViewport } from './portal-device-presets.js';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import DOMPurify from 'dompurify';
  import NodeShell from './NodeShell.svelte';
  import type { NodeConnection } from './NodeShell.svelte';
  import IconAction from './IconAction.svelte';
  import PortalViewportToolbar from './PortalViewportToolbar.svelte';
  import { portalScriptExpression, unwrapPortalScriptResult } from './portal-script.js';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Badge } from '$lib/components/ui/badge';
  import {
    beginPortalInspection,
    cancelPortalInspection,
    capturePortalSelection,
    portalScreenshotFile,
    portalSelectionExists,
    type PortalWebviewElement,
  } from '$lib/components/agent-room/portal-design-inspector.js';
  import {
    sendPortalDesignFeedbackSchema,
    type PortalDesignCapture,
    type PortalDesignFeedbackResult,
  } from '$lib/modules/agent-room/contracts/schemas/portal-design-feedback.schema.js';
  import type { CanvasNode, WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';
  import {
    deleteWorkspaceAttachment,
    uploadWorkspaceAttachment,
  } from '$lib/components/agent-room/workspace-attachments.js';
  import * as m from '$lib/paraglide/messages.js';

  export type PortalNodeData = {
    title: string;
    workspaceId: string;
    payload: { url?: string; viewport?: PortalViewport | null };
    connections?: NodeConnection[];
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onUrlChange?: (id: string, url: string) => void;
    onRename?: (id: string, title: string) => void;
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void;
  };

  type WebviewLoadFailure = Event & {
    errorCode?: number;
    errorDescription?: string;
    validatedURL?: string;
    isMainFrame?: boolean;
  };

  type WebviewNavigation = Event & {
    url?: string;
    isMainFrame?: boolean;
  };

  type AgentTarget = { id: string; title: string; role: string | null; maestro: boolean };
  type TaskTarget = { id: string; title: string; status: string; assigneeTitle: string | null };
  const NEW_TASK_DESTINATION = 'new-task';

  let { id, data, selected } = $props<NodeProps & { data: PortalNodeData }>();

  let address = $state(data.payload.url ?? '');
  let editingName = $state(false);
  let nameDraft = $state('');
  let viewport = $state<PortalViewport | null>(data.payload.viewport ?? null);
  let deviceToolbarOpen = $state(false);
  let frame: (PortalWebviewElement | HTMLIFrameElement) | null = $state(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  let urlPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let portalReady = $state(false);
  let portalError = $state('');
  let inspecting = $state(false);
  let reviewOpen = $state(false);
  let capture = $state<PortalDesignCapture | null>(null);
  let screenshotDataUrl = $state('');
  let instruction = $state('');
  let destinationKind = $state<'agent' | 'task'>('task');
  let destinationId = $state('');
  let agents = $state<AgentTarget[]>([]);
  let tasks = $state<TaskTarget[]>([]);
  let targetsLoading = $state(false);
  let sending = $state(false);
  let selectionDetached = $state(false);
  const readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const isDesktop = typeof window !== 'undefined' && 'orkestraiDesktop' in window;
  const sanitizedElementHtml = $derived(DOMPurify.sanitize(capture?.html ?? '', {
    ALLOWED_TAGS: ['a', 'button', 'div', 'span', 'p', 'label', 'input', 'select', 'option', 'img', 'svg', 'path', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'small'],
    ALLOWED_ATTR: ['role', 'aria-label', 'title', 'alt', 'href', 'src', 'type', 'placeholder', 'viewBox', 'd'],
    FORBID_ATTR: ['style'],
  }));
  const currentTargets = $derived(destinationKind === 'agent' ? agents : tasks);

  function csrfHeaders(json = false): HeadersInit {
    const csrf = getCsrfToken();
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    };
  }

  async function postResult(commandId: string, ok: boolean, result?: unknown, error?: string) {
    await fetch(`/api/agent-room/workspaces/${data.workspaceId}/portal/${id}/commands/${commandId}/result`, {
      method: 'POST',
      headers: csrfHeaders(true),
      body: JSON.stringify({ ok, result, error }),
    }).catch(() => {});
  }

  function publicPortalError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\r\n]+/g, ' ').slice(0, 2_000) || 'Portal command failed.';
  }

  function targetUrl() {
    return address.trim() || String(data.payload.url ?? '').trim();
  }

  function desktopFrame(): PortalWebviewElement | null {
    return frame && 'executeJavaScript' in frame ? frame : null;
  }

  async function executePortalScript(webview: PortalWebviewElement, source: string): Promise<unknown> {
    return unwrapPortalScriptResult(await webview.executeJavaScript(portalScriptExpression(source)));
  }

  const RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 30_000, 30_000, 30_000, 30_000] as const;

  function clearRetry(resetAttempts = true) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (resetAttempts) retryAttempt = 0;
  }

  function markReady() {
    portalReady = true;
    portalError = '';
    clearRetry();
    for (const waiter of readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    readyWaiters.clear();
  }

  function retryLoad() {
    const url = targetUrl();
    const webview = desktopFrame();
    if (!url || !webview) return;
    void webview.loadURL(url).catch((error) => markUnavailable(error instanceof Error ? error.message : String(error)));
  }

  function scheduleRetry() {
    if (retryTimer || !targetUrl()) return;
    const delay = RETRY_DELAYS_MS[retryAttempt];
    if (delay === undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryAttempt += 1;
      retryLoad();
    }, delay);
  }

  function markUnavailable(detail: string) {
    portalReady = false;
    portalError = detail;
    if (inspecting) void cancelInspection();
    scheduleRetry();
  }

  function persistNavigatedUrl(event: Event) {
    const navigation = event as WebviewNavigation;
    if (navigation.isMainFrame === false) return;
    const url = String(navigation.url ?? '').trim();
    if (!/^https?:\/\//.test(url) || url === address) return;
    address = url;
    if (urlPersistTimer) clearTimeout(urlPersistTimer);
    urlPersistTimer = setTimeout(() => {
      urlPersistTimer = null;
      data.onUrlChange?.(id, url);
    }, 250);
  }

  function waitUntilReady(timeoutMs = 25_000): Promise<void> {
    if (portalReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          readyWaiters.delete(waiter);
          reject(new Error(`Portal indisponível em ${targetUrl() || 'URL vazia'}: ${portalError || 'a página não terminou de carregar'}.`));
        }, timeoutMs),
      };
      readyWaiters.add(waiter);
      retryLoad();
    });
  }

  async function verifyLoadedPage(webview: PortalWebviewElement) {
    try {
      const href = String(await executePortalScript(webview, 'location.href') ?? '');
      if (href && href !== 'about:blank' && !href.startsWith('chrome-error:')) markReady();
      else if (targetUrl()) markUnavailable(href.startsWith('chrome-error:') ? 'o servidor ainda não respondeu' : 'a página ainda está vazia');
    } catch {
      markUnavailable('a página ainda não está pronta');
    }
  }

  async function executeCommand(command: { id: string; action: string; args: Record<string, unknown> }) {
    const webview = desktopFrame();
    if (!webview) {
      await postResult(command.id, false, undefined, 'Portal sem webview (precisa do app desktop).');
      return;
    }
    try {
      switch (command.action) {
        case 'navigate': {
          const url = String(command.args.url ?? '');
          portalReady = false;
          address = url;
          resetCapture();
          data.onUrlChange?.(id, url);
          try {
            await webview.loadURL(url);
          } catch {
            await waitUntilReady();
          }
          await waitUntilReady();
          await postResult(command.id, true, { navigated: url });
          break;
        }
        case 'eval': {
          await waitUntilReady();
          const result = await executePortalScript(webview, String(command.args.js ?? ''));
          await postResult(command.id, true, result);
          break;
        }
        case 'dom': {
          await waitUntilReady();
          const html = await executePortalScript(webview, 'document.documentElement.outerHTML');
          await postResult(command.id, true, String(html).slice(0, 50_000));
          break;
        }
        case 'screenshot': {
          await waitUntilReady();
          const image = await webview.capturePage();
          const dataUrl = image.toDataURL();
          if (dataUrl.length > 28_000_000) throw new Error('Portal screenshot exceeds the 20 MB capture limit.');
          await postResult(command.id, true, { dataUrl });
          break;
        }
        default:
          await postResult(command.id, false, undefined, `Acao desconhecida: ${command.action}`);
      }
    } catch (error) {
      await postResult(command.id, false, undefined, publicPortalError(error));
    }
  }

  function startPolling() {
    if (pollTimer || !isDesktop) return;
    pollTimer = setInterval(async () => {
      const response = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/portal/${id}/commands`);
      const payload = await response.json().catch(() => ({ data: [] }));
      for (const command of payload.data ?? []) await executeCommand(command);
    }, 2_000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function resetCapture() {
    reviewOpen = false;
    capture = null;
    screenshotDataUrl = '';
    instruction = '';
    selectionDetached = false;
  }

  async function navigate() {
    let url = address.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) url = `https://${url}`;
    if (inspecting) await cancelInspection();
    resetCapture();
    clearRetry();
    address = url;
    portalReady = false;
    data.onUrlChange?.(id, url);
    retryLoad();
  }

  function retryNow() {
    clearRetry();
    retryLoad();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') void navigate();
  }

  function startNameEdit() {
    nameDraft = data.title || m['portal.default_title']();
    editingName = true;
  }

  function commitNameEdit() {
    if (!editingName) return;
    editingName = false;
    const next = nameDraft.trim();
    if (next && next !== data.title) data.onRename?.(id, next);
  }

  function setViewport(next: PortalViewport | null) {
    viewport = next;
    data.onPayloadChange?.(id, { viewport: next });
  }

  async function loadTargets() {
    targetsLoading = true;
    try {
      const [nodesResponse, tasksResponse] = await Promise.all([
        fetch(`/api/agent-room/workspaces/${data.workspaceId}/nodes`),
        fetch(`/api/agent-room/workspaces/${data.workspaceId}/tasks`),
      ]);
      const [nodesPayload, tasksPayload] = await Promise.all([nodesResponse.json(), tasksResponse.json()]);
      if (!nodesResponse.ok || nodesPayload.error) throw new Error(nodesPayload.error || `HTTP ${nodesResponse.status}`);
      if (!tasksResponse.ok || tasksPayload.error) throw new Error(tasksPayload.error || `HTTP ${tasksResponse.status}`);
      agents = (nodesPayload.data as CanvasNode[])
        .filter((node) => node.type === 'terminal')
        .map((node) => ({
          id: node.id,
          title: node.title ?? m['portal.design_unnamed_agent'](),
          role: String((node.payload as { role?: string }).role ?? '').trim() || null,
          maestro: Boolean((node.payload as { maestro?: boolean }).maestro),
        }))
        .sort((left, right) => Number(right.maestro) - Number(left.maestro) || left.title.localeCompare(right.title));
      tasks = (tasksPayload.data as TaskTarget[]).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        assigneeTitle: task.assigneeTitle ?? null,
      }));
      const options = destinationKind === 'agent' ? agents : tasks;
      if (destinationKind === 'task') {
        if (destinationId !== NEW_TASK_DESTINATION && !options.some((target) => target.id === destinationId)) {
          destinationId = NEW_TASK_DESTINATION;
        }
      } else if (!options.some((target) => target.id === destinationId)) {
        destinationId = options[0]?.id ?? '';
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['portal.design_targets_error']());
    } finally {
      targetsLoading = false;
    }
  }

  function chooseDestination(kind: 'agent' | 'task') {
    destinationKind = kind;
    const options = kind === 'agent' ? agents : tasks;
    destinationId = kind === 'task' ? NEW_TASK_DESTINATION : (options[0]?.id ?? '');
  }

  async function startInspection() {
    const webview = desktopFrame();
    if (!isDesktop || !webview) {
      toast.error(m['portal.design_desktop_only']());
      return;
    }
    if (!portalReady) {
      toast.error(m['portal.design_disconnected']({ detail: portalError || m['portal.design_loading']() }));
      return;
    }
    if (inspecting) {
      await cancelInspection();
      return;
    }
    resetCapture();
    inspecting = true;
    try {
      const selectedElement = await beginPortalInspection(webview);
      if (!selectedElement) return;
      if (!await portalSelectionExists(webview, selectedElement.selector)) {
        throw new Error('element_removed');
      }
      const screenshot = await capturePortalSelection(webview, selectedElement);
      capture = selectedElement;
      screenshotDataUrl = screenshot;
      await loadTargets();
      reviewOpen = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (reason.includes('element_removed')) toast.error(m['portal.design_element_removed']());
      else if (portalError) toast.error(m['portal.design_disconnected']({ detail: portalError }));
      else toast.error(m['portal.design_inspection_error']());
    } finally {
      inspecting = false;
    }
  }

  async function cancelInspection() {
    const webview = desktopFrame();
    if (webview) await cancelPortalInspection(webview);
    inspecting = false;
  }

  async function verifySelection(): Promise<boolean> {
    const webview = desktopFrame();
    if (!webview || !capture) return false;
    try {
      const exists = await portalSelectionExists(webview, capture.selector);
      selectionDetached = !exists;
      return exists;
    } catch {
      selectionDetached = true;
      return false;
    }
  }

  async function sendFeedback() {
    if (!capture || !screenshotDataUrl || !instruction.trim() || !destinationId) {
      toast.error(m['portal.design_form_error']());
      return;
    }
    if (!await verifySelection()) {
      toast.error(m['portal.design_element_removed']());
      return;
    }
    sending = true;
    let attachment: WorkspaceAttachment | null = null;
    try {
      attachment = await uploadWorkspaceAttachment(data.workspaceId, portalScreenshotFile(screenshotDataUrl));
      const { html: _previewOnlyHtml, ...context } = capture;
      const body = sendPortalDesignFeedbackSchema.parse({
        capture: context,
        screenshot: attachment,
        instruction,
        destination: destinationKind === 'agent'
          ? { kind: 'agent', nodeId: destinationId }
          : destinationId === NEW_TASK_DESTINATION
            ? { kind: 'triage' }
            : { kind: 'task', taskId: destinationId },
      });
      const response = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/portal/${id}/design-feedback`, {
        method: 'POST',
        headers: csrfHeaders(true),
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
      const result = payload.data as PortalDesignFeedbackResult;
      if (!result.persisted) {
        await deleteWorkspaceAttachment(data.workspaceId, attachment).catch(() => undefined);
        attachment = null;
        toast.error(result.delivery?.error || m['portal.design_send_error']());
        return;
      }
      if (result.delivery && !result.delivery.delivered) {
        toast.warning(m['portal.design_saved_offline']({ destination: result.destinationTitle }));
      } else {
        toast.success(m['portal.design_sent']({ destination: result.destinationTitle }));
      }
      resetCapture();
    } catch (error) {
      if (attachment) await deleteWorkspaceAttachment(data.workspaceId, attachment).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : m['portal.design_send_error']());
    } finally {
      sending = false;
    }
  }

  async function closePortal() {
    if (inspecting) await cancelInspection();
    data.onDelete(id);
  }

  $effect(() => {
    const webview = desktopFrame();
    if (!webview) return;
    const handleFinish = () => void verifyLoadedPage(webview);
    const handleFailure = (event: Event) => {
      const failure = event as WebviewLoadFailure;
      if (failure.isMainFrame === false || failure.errorCode === -3) return;
      markUnavailable(failure.errorDescription || `falha ao carregar ${failure.validatedURL || targetUrl()}`);
    };
    webview.addEventListener('did-finish-load', handleFinish);
    webview.addEventListener('did-fail-load', handleFailure);
    webview.addEventListener('did-navigate', persistNavigatedUrl);
    webview.addEventListener('did-navigate-in-page', persistNavigatedUrl);
    void verifyLoadedPage(webview);
    return () => {
      webview.removeEventListener('did-finish-load', handleFinish);
      webview.removeEventListener('did-fail-load', handleFailure);
      webview.removeEventListener('did-navigate', persistNavigatedUrl);
      webview.removeEventListener('did-navigate-in-page', persistNavigatedUrl);
    };
  });

  onMount(() => {
    startPolling();
    return () => {
      stopPolling();
      clearRetry();
      if (urlPersistTimer) clearTimeout(urlPersistTimer);
      urlPersistTimer = null;
      if (inspecting) void cancelInspection();
      for (const waiter of readyWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Portal fechado antes de concluir o carregamento.'));
      }
      readyWaiters.clear();
    };
  });
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-portal"
  accent="#c084fc"
  minWidth={360}
  minHeight={260}
  onResize={data.onResize}
  connections={data.connections ?? []}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<Globe size={13} />{/snippet}
  {#snippet title()}
    {#if editingName}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="portal-name-input nodrag"
        bind:value={nameDraft}
        autofocus
        spellcheck="false"
        aria-label={m['portal.name']()}
        onkeydown={(event) => {
          if (event.key === 'Enter') commitNameEdit();
          if (event.key === 'Escape') editingName = false;
        }}
        onblur={commitNameEdit}
      />
    {:else}
      <span class="portal-name">{data.title || m['portal.default_title']()}</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    <IconAction label={m['portal.rename']()} disabled={editingName} onclick={startNameEdit}><Pencil size={13} /></IconAction>
    <IconAction
      label={deviceToolbarOpen ? m['portal.device_toolbar_hide']() : m['portal.device_toolbar_show']()}
      active={deviceToolbarOpen || viewport !== null}
      onclick={() => (deviceToolbarOpen = !deviceToolbarOpen)}
    ><Smartphone size={13} /></IconAction>
    <IconAction
      label={isDesktop ? (inspecting ? m['portal.design_cancel']() : m['portal.design_inspect']()) : m['portal.design_desktop_only']()}
      active={inspecting}
      onclick={() => void startInspection()}
    ><MousePointer2 size={13} /></IconAction>
    <IconAction label={m['portal.close']()} danger onclick={() => void closePortal()}><X size={13} /></IconAction>
  {/snippet}

  <div class="portal-body nodrag nowheel" class:inspecting>
    <div class="portal-navigation">
      <input
        class="portal-address nodrag"
        bind:value={address}
        onkeydown={handleKeydown}
        placeholder="https://..."
        spellcheck="false"
        aria-label={m['portal.address']()}
      />
      <IconAction label={m['portal.navigate']()} disabled={inspecting} onclick={() => void navigate()}><ArrowRight size={14} /></IconAction>
    </div>
    {#if deviceToolbarOpen}
      <PortalViewportToolbar {viewport} onchange={setViewport} />
    {/if}
    {#if inspecting}
      <div class="inspection-bar" role="status">
        <span class="inspection-pulse"></span>
        <span>{m['portal.design_pick_hint']()}</span>
        <button type="button" onclick={() => void cancelInspection()}>{m['portal.design_cancel']()}</button>
      </div>
    {/if}
    <div class="portal-stage" class:portal-stage-device={viewport !== null}>
      <div class="portal-scroll">
        <div class:portal-device-surface={viewport !== null} class:portal-fluid-surface={viewport === null}>
          {#if data.payload.url}
            {#if isDesktop}
              <webview
                bind:this={frame}
                src={data.payload.url}
                class="portal-frame"
                class:portal-frame-hidden={reviewOpen}
                class:portal-frame-device={viewport !== null}
                style={viewport ? `width:${viewport.width}px;height:${viewport.height}px;` : ''}
                partition="persist:orkestrai-portals"
                webpreferences="contextIsolation=yes, sandbox=yes, nodeIntegration=no"
              ></webview>
            {:else}
              <iframe
                bind:this={frame}
                src={data.payload.url}
                title={data.title || m['portal.default_title']()}
                class="portal-frame"
                class:portal-frame-device={viewport !== null}
                style={viewport ? `width:${viewport.width}px;height:${viewport.height}px;` : ''}
              ></iframe>
            {/if}
          {:else}
            <p class="portal-empty">{m['portal.empty']()}</p>
          {/if}
        </div>
      </div>
      {#if !portalReady && data.payload.url && isDesktop && portalError}
        <div class="portal-status" role="status">
          <Navigation size={15} />
          <span>{m['portal.design_disconnected']({ detail: portalError })}</span>
          <button type="button" class="nodrag" onclick={retryNow}>
            <RotateCcw size={13} />
            {m['portal.retry']()}
          </button>
        </div>
      {/if}
    </div>
  </div>
</NodeShell>

<Dialog.Root bind:open={reviewOpen} onOpenChange={(open) => { if (!open) resetCapture(); }}>
  <Dialog.Content class="max-h-[min(92dvh,880px)] max-w-[calc(100%-1.5rem)]! grid-rows-[auto_minmax(0,1fr)_auto] gap-0! overflow-hidden p-0! sm:max-w-5xl!">
    <Dialog.Header class="border-b border-border/60 px-5 py-4 pr-12">
      <Dialog.Title>{m['portal.design_review_title']()}</Dialog.Title>
      <Dialog.Description>{m['portal.design_review_desc']()}</Dialog.Description>
    </Dialog.Header>

    {#if capture}
      <div class="grid min-h-0 overflow-y-auto lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.8fr)] lg:overflow-hidden">
        <section class="min-h-[280px] border-b border-border/60 bg-[var(--app-canvas)] p-4 lg:min-h-0 lg:border-r lg:border-b-0">
          <div class="flex h-full min-h-0 flex-col">
            <div class="mb-3 flex min-w-0 items-center gap-2">
              <Badge variant="secondary">&lt;{capture.tagName}&gt;</Badge>
              <code class="min-w-0 flex-1 truncate text-[11px] text-[var(--app-text-muted)]" title={capture.selector}>{capture.selector}</code>
              <span class="shrink-0 text-[10px] tabular-nums text-[var(--app-text-muted)]">{Math.round(capture.rect.width)} × {Math.round(capture.rect.height)}</span>
            </div>
            <div class="flex min-h-[220px] flex-1 items-center justify-center overflow-hidden border border-[var(--app-border)] bg-[linear-gradient(45deg,var(--app-surface)_25%,transparent_25%),linear-gradient(-45deg,var(--app-surface)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--app-surface)_75%),linear-gradient(-45deg,transparent_75%,var(--app-surface)_75%)] bg-[length:18px_18px] bg-[position:0_0,0_9px,9px_-9px,-9px_0] p-4">
              <img src={screenshotDataUrl} alt={m['portal.design_screenshot_alt']()} class="max-h-full max-w-full object-contain shadow-sm ring-1 ring-black/10" />
            </div>
            <div class="mt-3 grid gap-2 text-[11px] text-[var(--app-text-muted)] sm:grid-cols-2">
              <div><span class="font-medium text-[var(--app-text)]">{m['portal.design_page']()}</span><br />{capture.page.title || capture.page.origin}<br /><code>{capture.page.origin}{capture.page.path}</code></div>
              <div><span class="font-medium text-[var(--app-text)]">{m['portal.design_viewport']()}</span><br />{capture.viewport.width} × {capture.viewport.height} @ {capture.viewport.deviceScaleFactor}x<br />{capture.styles.fontSize} · {capture.styles.fontWeight}</div>
            </div>
          </div>
        </section>

        <section class="min-h-0 overflow-y-auto p-4">
          <div class="space-y-4">
            <div>
              <h3 class="text-xs font-semibold">{m['portal.design_element_preview']()}</h3>
              <div class="portal-element-preview mt-2 min-h-14 overflow-hidden border border-[var(--app-border)] bg-[var(--app-surface)] p-3 text-xs">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify and a strict allowlist -->
                {@html sanitizedElementHtml}
              </div>
              {#if capture.text}
                <p class="mt-2 line-clamp-4 whitespace-pre-wrap text-[11px] leading-4 text-[var(--app-text-muted)]">{capture.text}</p>
              {/if}
            </div>

            <label class="block">
              <span class="mb-1.5 block text-xs font-medium">{m['portal.design_instruction']()}</span>
              <Textarea class="min-h-24 resize-y text-xs" bind:value={instruction} maxlength={4000} placeholder={m['portal.design_instruction_placeholder']()} />
            </label>

            <fieldset>
              <legend class="mb-1.5 text-xs font-medium">{m['portal.design_destination']()}</legend>
              <div class="grid grid-cols-2 gap-1 rounded-lg bg-[var(--app-surface)] p-1" aria-label={m['portal.design_destination']()}>
                <Button size="sm" variant={destinationKind === 'agent' ? 'secondary' : 'ghost'} aria-pressed={destinationKind === 'agent'} onclick={() => chooseDestination('agent')}>{m['portal.design_agent']()}</Button>
                <Button size="sm" variant={destinationKind === 'task' ? 'secondary' : 'ghost'} aria-pressed={destinationKind === 'task'} onclick={() => chooseDestination('task')}>{m['portal.design_task']()}</Button>
              </div>
              <NativeSelect.Root class="mt-2 w-full" bind:value={destinationId} disabled={targetsLoading || (destinationKind === 'agent' && currentTargets.length === 0)} aria-label={m['portal.design_destination']()}>
                {#if targetsLoading}
                  <NativeSelect.Option value="">{m['portal.design_loading_targets']()}</NativeSelect.Option>
                {:else if destinationKind === 'task'}
                  <NativeSelect.Option value={NEW_TASK_DESTINATION}>{m['portal.design_new_task']()}</NativeSelect.Option>
                  {#each tasks as target (target.id)}
                    <NativeSelect.Option value={target.id}>{target.title} — {target.status}</NativeSelect.Option>
                  {/each}
                {:else if currentTargets.length === 0}
                  <NativeSelect.Option value="">{m['portal.design_no_agents']()}</NativeSelect.Option>
                {:else}
                  {#each currentTargets as target (target.id)}
                    <NativeSelect.Option value={target.id}>
                      {target.title}{'role' in target && target.role ? ` — ${target.role}` : ''}
                    </NativeSelect.Option>
                  {/each}
                {/if}
              </NativeSelect.Root>
              {#if destinationKind === 'agent'}
                <p class="mt-1.5 text-[10px] leading-4 text-[var(--app-text-muted)]">{m['portal.design_agent_traceability']()}</p>
              {:else if destinationId === NEW_TASK_DESTINATION}
                <p class="mt-1.5 text-[10px] leading-4 text-[var(--app-text-muted)]">{m['portal.design_triage_hint']()}</p>
              {/if}
            </fieldset>

            <div class="border-l-2 border-[var(--app-border-strong)] pl-3 text-[10px] leading-4 text-[var(--app-text-muted)]">
              {m['portal.design_privacy_note']()}
            </div>

            {#if selectionDetached}
              <div class="flex items-start gap-2 border border-[var(--app-danger)]/40 bg-[var(--app-danger)]/10 p-2.5 text-xs text-[var(--app-danger)]" role="alert">
                <RotateCcw size={14} class="mt-0.5 shrink-0" />
                <span>{m['portal.design_element_removed']()}</span>
              </div>
            {/if}
          </div>
        </section>
      </div>
    {/if}

    <Dialog.Footer class="m-0! rounded-none border-t border-border/60 px-5 py-3">
      <Button variant="outline" disabled={sending} onclick={() => resetCapture()}>{m['settings.cancel']()}</Button>
      <Button variant="outline" disabled={sending} onclick={() => { resetCapture(); void startInspection(); }}><MousePointer2 />{m['portal.design_pick_again']()}</Button>
      <Button disabled={sending || selectionDetached || !instruction.trim() || !destinationId} onclick={() => void sendFeedback()}>
        {#if sending}<span class="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"></span>{:else}<Send />{/if}
        {m['portal.design_send']()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .portal-name {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .portal-name-input {
    width: min(220px, 100%);
    min-width: 0;
    border: 1px solid var(--app-accent);
    border-radius: 4px;
    background: var(--app-surface);
    color: var(--app-text);
    padding: 2px 6px;
    font: inherit;
  }

  .portal-navigation {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 6px 8px;
    border-bottom: 1px solid var(--app-border);
    background: var(--app-surface-subtle);
  }

  .portal-address {
    flex: 1;
    width: 100%;
    height: 28px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    outline: none;
    background: var(--app-surface);
    color: var(--app-text);
    caret-color: var(--app-accent);
    font-size: 12px;
    font-weight: 400;
    transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
  }

  .portal-address::placeholder {
    color: var(--app-text-muted);
  }

  .portal-address:hover {
    border-color: var(--app-border-strong);
  }

  .portal-address:focus-visible {
    border-color: var(--app-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-accent) 20%, transparent);
  }

  .portal-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--app-surface);
  }

  .inspection-bar {
    display: flex;
    height: 32px;
    flex: none;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 0 8px;
    color: var(--app-text);
    background: var(--app-accent-soft);
    border-bottom: 1px solid var(--app-accent);
    font-size: 10px;
  }

  .inspection-bar span:nth-child(2) {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inspection-bar button {
    color: var(--app-accent);
    font-weight: 650;
  }

  .inspection-pulse {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--app-accent);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--app-accent) 45%, transparent);
    animation: inspect-pulse 1.8s ease-out infinite;
  }

  .portal-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .portal-scroll {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* Modo dispositivo: o frame vira tamanho fixo (nao 100%), entao o palco
     rola se o dispositivo emulado for maior que a area visivel do no — sem
     escalar/transformar o webview, que teria coordenadas de mouse erradas
     dentro da pagina carregada (mesma classe de bug ja vista com zoom do
     canvas em outro lugar do app). */
  .portal-stage-device .portal-scroll {
    overflow: auto;
    background: repeating-conic-gradient(var(--app-surface) 0% 25%, var(--app-canvas) 0% 50%) 0 0 / 16px 16px;
  }

  .portal-fluid-surface {
    width: 100%;
    height: 100%;
  }

  .portal-device-surface {
    box-sizing: border-box;
    display: grid;
    width: max-content;
    min-width: 100%;
    min-height: 100%;
    place-items: center;
    padding: 12px;
  }

  .portal-frame {
    width: 100%;
    height: 100%;
    border: none;
    display: flex;
  }

  .portal-frame-device {
    flex: none;
    box-shadow: 0 0 0 1px var(--app-border), 0 10px 28px rgb(0 0 0 / 18%);
  }

  .portal-frame-hidden { visibility: hidden; }

  .portal-empty {
    color: var(--app-text-muted);
    font-size: 12px;
    padding: 12px;
    background: var(--app-canvas);
    height: 100%;
    margin: 0;
  }

  .portal-status {
    position: absolute;
    inset: auto 10px 10px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    border: 1px solid var(--app-warning);
    background: color-mix(in srgb, var(--app-canvas) 92%, var(--app-warning));
    color: var(--app-text);
    font-size: 10px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 16%);
  }

  .portal-status span {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .portal-status button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 5px;
    border: 0;
    border-left: 1px solid color-mix(in srgb, var(--app-warning) 45%, transparent);
    background: transparent;
    color: inherit;
    padding: 1px 0 1px 8px;
    font: inherit;
    cursor: pointer;
  }

  .portal-status button:hover {
    color: var(--app-warning);
  }

  .portal-element-preview :global(*) {
    max-width: 100%;
    pointer-events: none;
  }

  @keyframes inspect-pulse {
    70%, 100% { box-shadow: 0 0 0 7px transparent; }
  }

  @media (prefers-reduced-motion: reduce) {
    .inspection-pulse { animation: none; }
  }
</style>
