<script lang="ts">
  import { goto } from '$app/navigation';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import {
    Braces, Camera, CheckCircle2, Code2, Columns2, ExternalLink, FileCode2,
    GitPullRequest, Import, Layers3, Link2, LoaderCircle, MonitorSmartphone,
    RefreshCw, ScanSearch, Send, Trash2, TriangleAlert, Unlink2,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type {
    DesignCodeArtifact,
    DesignComponent,
    DesignDocument,
    DesignOperation,
    DesignVariable,
    DesignVariableType,
    DesignVariableValue,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import type {
    DesignAppliedFile,
    DesignDeliveryFramework,
    DesignDeliveryTarget,
    DesignGeneratedFile,
    DesignImportResult,
    DesignMarkupFormat,
  } from '$lib/modules/agent-room/contracts/schemas/design-delivery.schema.js';
  import type {
    DesignCodebaseScan,
    DesignCodeComponentCandidate,
    DesignCodeTokenCandidate,
  } from '$lib/modules/agent-room/contracts/schemas/designCodebaseSchemas.js';
  import type { ReviewCenterSnapshot } from '$lib/modules/agent-room/contracts/schemas/review-schemas.schema.js';
  import type { WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';
  import { uploadWorkspaceAttachment } from '../workspace-attachments.js';
  import { WORKBENCH_OPEN_REQUEST, type WorkbenchOpenRequestDetail } from '../workbench-open.js';
  import { workbenchReviewCenterItemId } from '../workbench-review-center.js';
  import { compareDesignImages, dataUrlFile, type DesignVisualComparison } from './design-visual-compare.js';
  import * as m from '$lib/paraglide/messages.js';

  type View = 'connect' | 'import' | 'generate' | 'compare';
  type CompareView = 'reference' | 'actual' | 'overlay' | 'diff';
  type ViewportOption = 'frame' | 'mobile' | 'tablet' | 'desktop';

  let {
    document,
    activeComponent,
    selectedIds,
    saving,
    makeId,
    onApply,
    onSelectElements,
    onCaptureDesign,
  }: {
    document: DesignDocument;
    activeComponent: DesignComponent | null;
    selectedIds: string[];
    saving: boolean;
    makeId: () => string;
    onApply: (operations: DesignOperation[], summary: string, inverse: DesignOperation[]) => Promise<boolean>;
    onSelectElements: (elementIds: string[]) => void;
    onCaptureDesign: (elementIds: string[], width: number, height: number) => Promise<string>;
  } = $props();

  let view = $state<View>('connect');
  let scan = $state<DesignCodebaseScan | null>(null);
  let loading = $state(false);
  let search = $state('');
  let busyPath = $state('');

  let importFormat = $state<DesignMarkupFormat>('html');
  let importName = $state('Imported interface');
  let importMarkup = $state('');
  let importCss = $state('');
  let importing = $state(false);
  let importWarnings = $state<string[]>([]);

  let framework = $state<DesignDeliveryFramework>('svelar');
  let outputPath = $state('src/lib/components/generated/GeneratedDesign.svelte');
  let componentName = $state('GeneratedDesign');
  let generating = $state(false);
  let preview = $state<DesignGeneratedFile | null>(null);
  let lastAppliedPath = $state('');

  let targets = $state<DesignDeliveryTarget[]>([]);
  let selectedTargetKey = $state('');
  let viewportOption = $state<ViewportOption>('frame');
  let comparing = $state(false);
  let comparison = $state<DesignVisualComparison | null>(null);
  let comparisonTargetTitle = $state('');
  let comparisonView = $state<CompareView>('overlay');
  let overlayAmount = $state(50);
  let comparisonAttachments = $state<WorkspaceAttachment[]>([]);

  const tokenSources = $derived(scan ? [...new Set(scan.tokens.map((token) => token.path))].sort() : []);
  const components = $derived(scan?.components.filter((component) => `${component.name} ${component.path}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? []);
  const linkedCandidate = $derived(activeComponent?.codeConnect && scan
    ? scan.components.find((candidate) => candidate.path === activeComponent.codeConnect?.path && candidate.exportName === activeComponent.codeConnect?.exportName) ?? null
    : null);
  const linkedStatus = $derived(!activeComponent?.codeConnect
    ? 'none'
    : !linkedCandidate
      ? 'missing'
      : linkedCandidate.hash === activeComponent.codeConnect.hash
        ? 'current'
        : 'changed');
  const activePage = $derived(document.pages.find((page) => page.id === document.activePageId) ?? document.pages[0]);
  const deliveryElementIds = $derived(selectedIds.length
    ? selectedIds
    : document.elements.filter((element) => element.pageId === document.activePageId && !element.parentId).map((element) => element.id));
  const importParentId = $derived(selectedIds.length === 1 && document.elements.some((element) => element.id === selectedIds[0] && (element.type === 'frame' || element.type === 'group')) ? selectedIds[0] : null);
  const selectedTarget = $derived(targets.find((target) => `${target.kind}:${target.nodeId ?? ''}` === selectedTargetKey) ?? null);

  function csrfHeaders(): HeadersInit {
    const token = getCsrfToken();
    return { 'content-type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { ...init, headers: { ...csrfHeaders(), ...(init?.headers ?? {}) } });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.data as T;
  }

  async function scanCodebase() {
    loading = true;
    try {
      scan = await api<DesignCodebaseScan>(`/api/agent-room/workspaces/${document.workspaceId}/design-system/scan`);
    } catch {
      toast.error(m['design.codebase_scan_error']());
    } finally {
      loading = false;
    }
  }

  async function loadTargets() {
    try {
      targets = await api<DesignDeliveryTarget[]>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/delivery`);
      if (!targets.some((target) => `${target.kind}:${target.nodeId ?? ''}` === selectedTargetKey)) {
        const available = targets.find((target) => target.available) ?? targets[0];
        selectedTargetKey = available ? `${available.kind}:${available.nodeId ?? ''}` : '';
      }
    } catch {
      targets = [];
    }
  }

  function variableValue(candidate: DesignCodeTokenCandidate, ids: Map<string, string>): DesignVariableValue {
    if (candidate.aliasKey && ids.has(candidate.aliasKey)) return { kind: 'alias', variableId: ids.get(candidate.aliasKey)! };
    if (candidate.type === 'color') return { kind: 'color', value: String(candidate.value) };
    if (candidate.type === 'boolean') return { kind: 'boolean', value: Boolean(candidate.value) };
    if (candidate.type === 'string') return { kind: 'string', value: String(candidate.value) };
    return { kind: 'number', value: Number(candidate.value) };
  }

  function buildTokenSync(path: string, newCollectionOffset = 0): { operations: DesignOperation[]; inverse: DesignOperation[] } {
    if (!scan) return { operations: [], inverse: [] };
    const candidates = scan.tokens.filter((token) => token.path === path);
    if (!candidates.length) return { operations: [], inverse: [] };
    const existingCollection = document.variableCollections.find((collection) => collection.codeSource?.path === path);
    const collectionId = existingCollection?.id ?? makeId();
    const modeId = existingCollection?.defaultModeId ?? makeId();
    const ids = new Map(candidates.map((candidate) => {
      const existing = document.variables.find((variable) => variable.collectionId === collectionId && variable.codeSourceKey === candidate.key);
      return [candidate.key, existing?.id ?? makeId()];
    }));
    const syncedAt = new Date().toISOString();
    const source = { path, format: candidates[0].format, hash: candidates[0].hash, syncedAt } as const;
    const operations: DesignOperation[] = [];
    const inverse: DesignOperation[] = [];
    const candidateKeys = new Set(candidates.map((candidate) => candidate.key));
    const staleVariables = existingCollection ? document.variables.filter((variable) => variable.collectionId === existingCollection.id && variable.codeSourceKey && !candidateKeys.has(variable.codeSourceKey)) : [];
    const staleIds = new Set(staleVariables.map((variable) => variable.id));
    const restoreStale: DesignOperation[] = [
      ...staleVariables.map((variable) => ({ kind: 'add-variable' as const, variable })),
      ...document.variables.filter((variable) => Object.values(variable.values).some((value) => value.kind === 'alias' && staleIds.has(value.variableId))).map((variable) => ({ kind: 'update-variable' as const, variableId: variable.id, changes: { values: variable.values } })),
      ...document.elements.flatMap((element) => Object.entries(element.variableBindings).filter(([, variableId]) => staleIds.has(variableId)).map(([property, variableId]) => ({ kind: 'bind-variable', elementId: element.id, property, variableId }) as DesignOperation)),
    ];
    if (existingCollection) {
      operations.push({ kind: 'update-variable-collection', collectionId, changes: { codeSource: source } });
      inverse.unshift({ kind: 'update-variable-collection', collectionId, changes: { codeSource: existingCollection.codeSource } });
    } else {
      const name = path.split('/').at(-1)?.replace(/\.[^.]+$/, '') || m['design.code_tokens']();
      operations.push({ kind: 'add-variable-collection', collection: { id: collectionId, name: `${m['design.code']()} · ${name}`, modes: [{ id: modeId, name: m['design.default_mode']() }], defaultModeId: modeId, order: document.variableCollections.length + newCollectionOffset, libraryId: null, librarySourceId: null, codeSource: source } });
      inverse.unshift({ kind: 'delete-variable-collection', collectionId });
    }
    for (const [index, candidate] of candidates.entries()) {
      const existing = document.variables.find((variable) => variable.id === ids.get(candidate.key));
      const variable: DesignVariable = { id: ids.get(candidate.key)!, collectionId, name: candidate.name, type: candidate.type as DesignVariableType, description: path, values: { [modeId]: variableValue(candidate, ids) }, order: existing?.order ?? index, libraryId: null, librarySourceId: null, codeSourceKey: candidate.key };
      if (existing) {
        const { id: _id, ...changes } = variable;
        const { id: _existingId, ...previous } = existing;
        operations.push({ kind: 'update-variable', variableId: existing.id, changes });
        inverse.unshift({ kind: 'update-variable', variableId: existing.id, changes: previous });
      } else {
        operations.push({ kind: 'add-variable', variable });
        inverse.unshift({ kind: 'delete-variable', variableId: variable.id });
      }
    }
    for (const variable of staleVariables) operations.push({ kind: 'delete-variable', variableId: variable.id });
    return { operations, inverse: [...restoreStale, ...inverse] };
  }

  async function syncTokens(path: string) {
    const plan = buildTokenSync(path);
    if (!plan.operations.length) return;
    busyPath = path;
    try { await onApply(plan.operations, m['design.operation_sync_code_tokens']({ path }), plan.inverse); }
    finally { busyPath = ''; }
  }

  async function syncAllTokens() {
    const plans = tokenSources.map((path, index) => buildTokenSync(path, index));
    const operations = plans.flatMap((plan) => plan.operations);
    const inverse = plans.slice().reverse().flatMap((plan) => plan.inverse);
    if (!operations.length) return;
    busyPath = '*';
    try { await onApply(operations, m['design.operation_sync_all_code_tokens'](), inverse); }
    finally { busyPath = ''; }
  }

  async function connectComponent(candidate: DesignCodeComponentCandidate) {
    if (!activeComponent) return;
    const previous = activeComponent.codeConnect;
    const codeConnect = { path: candidate.path, framework: candidate.framework, exportName: candidate.exportName, props: candidate.props, hash: candidate.hash, syncedAt: new Date().toISOString() };
    await onApply(
      [{ kind: 'update-component', componentId: activeComponent.id, changes: { codeConnect, updatedAt: new Date().toISOString() } }],
      m['design.operation_connect_code_component']({ name: activeComponent.name }),
      [{ kind: 'update-component', componentId: activeComponent.id, changes: { codeConnect: previous, updatedAt: activeComponent.updatedAt } }],
    );
  }

  async function disconnectComponent() {
    if (!activeComponent?.codeConnect) return;
    await onApply(
      [{ kind: 'update-component', componentId: activeComponent.id, changes: { codeConnect: null, updatedAt: new Date().toISOString() } }],
      m['design.operation_disconnect_code_component']({ name: activeComponent.name }),
      [{ kind: 'update-component', componentId: activeComponent.id, changes: { codeConnect: activeComponent.codeConnect, updatedAt: activeComponent.updatedAt } }],
    );
  }

  async function importCode() {
    if (!importMarkup.trim() || importing) return;
    importing = true;
    importWarnings = [];
    try {
      const result = await api<DesignImportResult>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/delivery/import`, {
        method: 'POST',
        body: JSON.stringify({ baseRevision: document.revision, format: importFormat, name: importName, markup: importMarkup, css: importCss, x: 80, y: 80, parentId: importParentId }),
      });
      const applied = await onApply(result.operations, `${m['design.delivery_import_title']()}: ${importName}`, result.rootIds.map((elementId) => ({ kind: 'delete', elementId })));
      if (!applied) return;
      importWarnings = result.warnings;
      onSelectElements(result.rootIds);
      toast.success(m['design.delivery_imported']({ count: String(result.elements.length) }));
    } catch {
      toast.error(m['design.delivery_import_error']());
    } finally {
      importing = false;
    }
  }

  function frameworkExtension(value: DesignDeliveryFramework): string {
    if (value === 'svelar' || value === 'svelte') return 'svelte';
    if (value === 'vue') return 'vue';
    if (value === 'html') return 'html';
    return 'tsx';
  }

  function changeFramework(value: DesignDeliveryFramework) {
    const previousExtension = outputPath.split('.').at(-1) ?? '';
    framework = value;
    const extension = frameworkExtension(value);
    if (['svelte', 'vue', 'html', 'tsx'].includes(previousExtension)) outputPath = outputPath.replace(/\.[^.]+$/, `.${extension}`);
    preview = null;
  }

  async function previewCode() {
    if (!deliveryElementIds.length || !outputPath.trim() || !componentName.trim()) return;
    generating = true;
    try {
      preview = await api<DesignGeneratedFile>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/delivery/preview`, {
        method: 'POST', body: JSON.stringify({ framework, elementIds: deliveryElementIds, outputPath, componentName }),
      });
    } catch {
      toast.error(m['design.delivery_preview_error']());
    } finally { generating = false; }
  }

  async function trackArtifact(artifact: DesignCodeArtifact) {
    const existing = document.codeArtifacts.find((candidate) => candidate.path === artifact.path);
    if (existing) {
      const { id: _id, ...changes } = artifact;
      const { id: _existingId, ...previous } = existing;
      await onApply(
        [{ kind: 'update-code-artifact', artifactId: existing.id, changes }],
        `${m['design.delivery_generate_title']()}: ${artifact.path}`,
        [{ kind: 'update-code-artifact', artifactId: existing.id, changes: previous }],
      );
      return;
    }
    await onApply(
      [{ kind: 'add-code-artifact', artifact }],
      `${m['design.delivery_generate_title']()}: ${artifact.path}`,
      [{ kind: 'delete-code-artifact', artifactId: artifact.id }],
    );
  }

  async function writeCode() {
    if (!preview || generating) return;
    generating = true;
    try {
      const applied = await api<DesignAppliedFile>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/delivery/apply`, {
        method: 'POST',
        body: JSON.stringify({ framework, elementIds: deliveryElementIds, outputPath, componentName, baseRevision: preview.sourceRevision, expectedExistingHash: preview.existingHash }),
      });
      await trackArtifact(applied.artifact);
      preview = applied;
      lastAppliedPath = applied.path;
      toast.success(m['design.delivery_written']({ path: applied.path }));
    } catch {
      toast.error(m['design.delivery_write_error']());
    } finally { generating = false; }
  }

  async function openFile(path: string) {
    if (location.pathname === '/terminal') {
      window.dispatchEvent(new CustomEvent('orkestrai:open-file', { detail: { workspaceId: document.workspaceId, path } }));
      return;
    }
    sessionStorage.setItem('orkestrai.open-file', JSON.stringify({ workspaceId: document.workspaceId, path }));
    await goto(`/terminal?workspace=${document.workspaceId}`);
  }

  async function removeArtifact(artifact: DesignCodeArtifact) {
    await onApply(
      [{ kind: 'delete-code-artifact', artifactId: artifact.id }],
      `${m['design.delivery_delete_artifact']()}: ${artifact.path}`,
      [{ kind: 'add-code-artifact', artifact }],
    );
  }

  function viewportSize(): { width: number; height: number } {
    if (viewportOption === 'mobile') return { width: 390, height: 844 };
    if (viewportOption === 'tablet') return { width: 768, height: 1024 };
    if (viewportOption === 'desktop') return { width: 1440, height: 900 };
    const selected = document.elements.find((element) => deliveryElementIds.includes(element.id) && element.type === 'frame');
    return { width: Math.min(1920, Math.max(1, Math.round(selected?.width ?? activePage.width))), height: Math.min(1920, Math.max(1, Math.round(selected?.height ?? activePage.height))) };
  }

  async function captureAndCompare() {
    if (!selectedTarget?.available || !deliveryElementIds.length) return;
    comparing = true;
    comparisonAttachments = [];
    try {
      const size = viewportSize();
      const [reference, captured] = await Promise.all([
        onCaptureDesign(deliveryElementIds, size.width, size.height),
        api<{ dataUrl: string; title: string }>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/delivery/capture`, {
          method: 'POST', body: JSON.stringify({ kind: selectedTarget.kind, nodeId: selectedTarget.nodeId }),
        }),
      ]);
      comparison = await compareDesignImages(reference, captured.dataUrl, size.width, size.height);
      comparisonTargetTitle = captured.title;
      comparisonView = 'overlay';
      overlayAmount = 50;
    } catch {
      toast.error(m['design.delivery_compare_error']());
    } finally { comparing = false; }
  }

  async function ensureComparisonAttachments(): Promise<WorkspaceAttachment[]> {
    if (!comparison) return [];
    if (comparisonAttachments.length === 3) return comparisonAttachments;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    comparisonAttachments = await Promise.all([
      uploadWorkspaceAttachment(document.workspaceId, dataUrlFile(comparison.referenceDataUrl, `design-reference-${stamp}.png`)),
      uploadWorkspaceAttachment(document.workspaceId, dataUrlFile(comparison.actualDataUrl, `implementation-${stamp}.png`)),
      uploadWorkspaceAttachment(document.workspaceId, dataUrlFile(comparison.diffDataUrl, `pixel-diff-${stamp}.png`)),
    ]);
    return comparisonAttachments;
  }

  async function createFeedbackTask() {
    if (!comparison) return;
    comparing = true;
    try {
      const attachments = await ensureComparisonAttachments();
      const percentage = (comparison.mismatchRatio * 100).toFixed(2);
      await api(`/api/agent-room/workspaces/${document.workspaceId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: `${m['design.delivery_compare_title']()}: ${document.name} ↔ ${comparisonTargetTitle}`,
          description: `[design visual comparison]\nDesign: ${document.name} (${document.nodeId})\nTarget: ${comparisonTargetTitle}\nViewport: ${comparison.width}x${comparison.height}\nPixel difference: ${percentage}%\nGenerated artifact: ${lastAppliedPath || document.codeArtifacts.at(-1)?.path || '(none)'}\n\nReview the reference, implementation, and diff attachments before assigning this task.`,
          attachments,
        }),
      });
      toast.success(m['design.delivery_task_created']());
    } catch {
      toast.error(m['design.delivery_task_error']());
    } finally { comparing = false; }
  }

  async function createGitReview() {
    const path = lastAppliedPath || preview?.path || document.codeArtifacts.at(-1)?.path;
    if (!path) return;
    generating = true;
    try {
      const snapshot = await api<ReviewCenterSnapshot>(`/api/agent-room/workspaces/${document.workspaceId}/review-center`);
      if (!snapshot.git.changes.some((change) => change.path === path)) throw new Error(m['design.delivery_review_error']());
      const attachments = comparison ? await ensureComparisonAttachments() : [];
      await api(`/api/agent-room/workspaces/${document.workspaceId}/review-center`, {
        method: 'POST', headers: csrfHeaders(),
        body: JSON.stringify({
          title: `${m['design.delivery_generate_title']()}: ${componentName}`,
          summary: `${document.name} · revision ${document.revision} · ${framework}`,
          selectedPaths: [path],
          evidence: attachments.map((attachment) => attachment.path ?? attachment.url ?? attachment.name),
          tests: comparison ? [`Pixel diff ${(comparison.mismatchRatio * 100).toFixed(2)}% at ${comparison.width}x${comparison.height}`] : [],
          risks: preview?.warnings ?? [],
        }),
      });
      toast.success(m['design.delivery_review_created']());
      openReviewCenter();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['design.delivery_review_error']());
    } finally { generating = false; }
  }

  function openReviewCenter() {
    const nodeId = workbenchReviewCenterItemId(document.workspaceId);
    if (location.pathname === '/terminal') {
      window.dispatchEvent(new CustomEvent<WorkbenchOpenRequestDetail>(WORKBENCH_OPEN_REQUEST, { detail: { workspaceId: document.workspaceId, nodeId, direction: null } }));
      return;
    }
    void goto(`/terminal?workspace=${document.workspaceId}&node=${encodeURIComponent(nodeId)}`);
  }

  function previewStatusLabel(status: DesignGeneratedFile['status']): string {
    if (status === 'create') return m['design.delivery_status_create']();
    if (status === 'update') return m['design.delivery_status_update']();
    return m['design.delivery_status_unchanged']();
  }

  onMount(() => {
    void Promise.all([scanCodebase(), loadTargets()]);
  });
</script>

<div class="flex h-full min-h-0 flex-col text-ui-sm" data-design-delivery>
  <div class="grid shrink-0 grid-cols-4 gap-0.5 border-b border-[var(--app-border)] p-1">
    {#each [
      { id: 'connect' as const, label: m['design.delivery_connect'](), icon: Link2 },
      { id: 'import' as const, label: m['design.delivery_import'](), icon: Import },
      { id: 'generate' as const, label: m['design.delivery_generate'](), icon: FileCode2 },
      { id: 'compare' as const, label: m['design.delivery_compare'](), icon: ScanSearch },
    ] as item (item.id)}
      <button class={`flex h-9 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[5px] text-ui-xs font-medium transition-colors ${view === item.id ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} aria-pressed={view === item.id} onclick={() => (view = item.id)}><item.icon size={12} /><span class="max-w-full truncate">{item.label}</span></button>
    {/each}
  </div>

  {#if view === 'connect'}
    <div class="space-y-2 border-b border-[var(--app-border)] p-2">
      <div class="flex items-center justify-between"><span class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['design.codebase_design_system']()}</span><Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.scan_codebase']()} onclick={() => void scanCodebase()}><RefreshCw size={12} class={loading ? 'animate-spin' : ''} /></Button></div>
      {#if scan}<div class="grid grid-cols-3 gap-1 text-center text-ui-xs"><div><strong class="block text-sm text-[var(--app-text)]">{scan.files.length}</strong>{m['design.code_files']()}</div><div><strong class="block text-sm text-[var(--app-text)]">{scan.tokens.length}</strong>{m['design.tokens']()}</div><div><strong class="block text-sm text-[var(--app-text)]">{scan.components.length}</strong>{m['design.components']()}</div></div>{/if}
      <Button class="w-full" variant="secondary" size="sm" disabled={!tokenSources.length || busyPath === '*'} onclick={() => void syncAllTokens()}>{#if busyPath === '*'}<LoaderCircle size={12} class="animate-spin" />{:else}<Braces size={12} />{/if}{m['design.sync_all_tokens']()}</Button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if loading && !scan}<div class="grid h-32 place-items-center"><LoaderCircle size={17} class="animate-spin text-[var(--app-accent)]" /></div>
      {:else if scan}
        <section class="border-b border-[var(--app-border)] p-2"><div class="mb-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['design.code_token_sources']()}</div><div class="space-y-1">{#each tokenSources as path (path)}{@const collection = document.variableCollections.find((candidate) => candidate.codeSource?.path === path)}<div class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--app-surface-raised)]"><Braces size={11} class="shrink-0 text-[var(--app-accent)]" /><span class="min-w-0 flex-1 truncate">{path}</span><Button variant="ghost" size="sm" class="h-6 px-1.5 text-ui-xs" disabled={busyPath === path} onclick={() => void syncTokens(path)}>{collection ? m['design.sync']() : m['design.import']()}</Button></div>{/each}</div></section>
        <section class="p-2"><div class="mb-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['design.code_components']()}</div><div class="relative mb-2"><Code2 size={11} class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--app-text-muted)]" /><Input class="pl-7" placeholder={m['design.search_code_components']()} bind:value={search} /></div>
          {#if activeComponent?.codeConnect}<div class="mb-2 border border-[var(--app-accent)]/30 bg-[var(--app-accent-soft)] p-2"><div class="flex items-start gap-2"><Link2 size={12} class="mt-0.5 text-[var(--app-accent)]" /><div class="min-w-0 flex-1"><p class="truncate font-medium">{activeComponent.codeConnect.exportName}</p><p class="truncate text-ui-xs text-[var(--app-text-muted)]">{activeComponent.codeConnect.path}</p>{#if linkedStatus === 'changed'}<p class="mt-1 flex items-center gap-1 text-ui-xs text-[var(--app-warning)]"><TriangleAlert size={10} />{m['design.code_source_changed']()}</p>{:else if linkedStatus === 'missing'}<p class="mt-1 flex items-center gap-1 text-ui-xs text-[var(--app-danger)]"><TriangleAlert size={10} />{m['design.code_source_missing']()}</p>{/if}</div>{#if linkedStatus === 'changed' && linkedCandidate}<Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.sync_code_component']()} title={m['design.sync_code_component']()} onclick={() => void connectComponent(linkedCandidate)}><RefreshCw size={11} /></Button>{/if}<Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.disconnect_code_component']()} onclick={() => void disconnectComponent()}><Unlink2 size={11} /></Button></div></div>{/if}
          <div class="space-y-1">{#each components as candidate (candidate.key)}<div class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--app-surface-raised)]"><Code2 size={11} class="shrink-0 text-[var(--app-text-muted)]" /><button class="min-w-0 flex-1 text-left" disabled={!activeComponent || saving} onclick={() => void connectComponent(candidate)}><span class="block truncate">{candidate.name}</span><span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{candidate.path} · {m['design.code_props']({ count: String(candidate.props.length) })}</span></button>{#if activeComponent?.codeConnect?.path === candidate.path}<span class="text-ui-xs text-[var(--app-accent)]">{m['design.connected']()}</span>{/if}</div>{/each}</div>
        </section>
      {:else}<div class="p-3 text-ui-xs text-[var(--app-text-muted)]">{m['design.codebase_scan_error']()}</div>{/if}
    </div>
  {:else if view === 'import'}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <header class="border-b border-[var(--app-border)] p-3"><div class="flex items-center gap-2"><Import size={14} class="text-[var(--app-accent)]" /><h3 class="font-semibold text-[var(--app-text)]">{m['design.delivery_import_title']()}</h3></div><p class="mt-1 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.delivery_import_help']()}</p></header>
      <div class="space-y-3 p-3">
        <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_format']()}</span><NativeSelect.Root name="design-import-format" value={importFormat} onchange={(event: Event) => (importFormat = (event.currentTarget as HTMLSelectElement).value as DesignMarkupFormat)}><NativeSelect.Option value="html">HTML / Tailwind</NativeSelect.Option><NativeSelect.Option value="svelte">Svelte</NativeSelect.Option><NativeSelect.Option value="react">React / JSX</NativeSelect.Option><NativeSelect.Option value="vue">Vue</NativeSelect.Option></NativeSelect.Root></label>
        <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_name']()}</span><Input name="design-import-name" autocomplete="off" bind:value={importName} /></label>
        <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_markup']()}</span><Textarea name="design-import-markup" autocomplete="off" class="min-h-40 resize-y font-mono text-ui-xs leading-4" placeholder={m['design.delivery_markup_placeholder']()} bind:value={importMarkup} /></label>
        <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_css']()}</span><Textarea name="design-import-css" autocomplete="off" class="min-h-24 resize-y font-mono text-ui-xs leading-4" placeholder={m['design.delivery_css_placeholder']()} bind:value={importCss} /></label>
        <p class="flex items-start gap-1.5 text-ui-xs leading-4 text-[var(--app-text-muted)]"><Layers3 size={11} class="mt-0.5 shrink-0" />{importParentId ? m['design.delivery_import_parent']() : m['design.delivery_import_page']()}</p>
        <Button class="w-full" size="sm" disabled={!importMarkup.trim() || !importName.trim() || importing || saving} onclick={() => void importCode()}>{#if importing}<LoaderCircle size={13} class="animate-spin" />{:else}<Import size={13} />{/if}{m['design.delivery_import_action']()}</Button>
        {#if importWarnings.length}<section class="border-l-2 border-[var(--app-warning)] pl-2"><p class="mb-1 text-ui-xs font-semibold text-[var(--app-warning)]">{m['design.delivery_warnings']()}</p>{#each importWarnings as warning}<p class="text-ui-xs leading-4 text-[var(--app-text-muted)]">{warning}</p>{/each}</section>{/if}
      </div>
    </div>
  {:else if view === 'generate'}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <header class="border-b border-[var(--app-border)] p-3"><div class="flex items-center gap-2"><FileCode2 size={14} class="text-[var(--app-accent)]" /><h3 class="font-semibold text-[var(--app-text)]">{m['design.delivery_generate_title']()}</h3></div><p class="mt-1 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.delivery_generate_help']()}</p></header>
      <div class="space-y-3 p-3">
        <div class="flex items-center gap-2 border-y border-[var(--app-border)] py-2 text-ui-xs text-[var(--app-text-muted)]"><Layers3 size={12} class="text-[var(--app-accent)]" />{#if selectedIds.length}{m['design.delivery_selection_count']({ count: String(selectedIds.length) })}{:else}{m['design.delivery_page_scope']()}{/if}</div>
        <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_framework']()}</span><NativeSelect.Root name="design-delivery-framework" value={framework} onchange={(event: Event) => changeFramework((event.currentTarget as HTMLSelectElement).value as DesignDeliveryFramework)}><NativeSelect.Option value="svelar">Svelar / Svelte 5</NativeSelect.Option><NativeSelect.Option value="svelte">Svelte 5</NativeSelect.Option><NativeSelect.Option value="react">React</NativeSelect.Option><NativeSelect.Option value="next">Next.js</NativeSelect.Option><NativeSelect.Option value="vue">Vue 3</NativeSelect.Option><NativeSelect.Option value="html">HTML / Tailwind</NativeSelect.Option></NativeSelect.Root></label>
        <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_component_name']()}</span><Input name="design-delivery-component" autocomplete="off" bind:value={componentName} oninput={() => (preview = null)} /></label>
        <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_output_path']()}</span><Input name="design-delivery-output" autocomplete="off" class="font-mono text-ui-xs" bind:value={outputPath} oninput={() => (preview = null)} /></label>
        <Button class="w-full" variant="secondary" size="sm" disabled={!deliveryElementIds.length || !outputPath.trim() || !componentName.trim() || generating} onclick={() => void previewCode()}>{#if generating}<LoaderCircle size={13} class="animate-spin" />{:else}<ScanSearch size={13} />{/if}{m['design.delivery_preview']()}</Button>
        {#if preview}
          <section class="border-y border-[var(--app-border)] py-2">
            <div class="mb-2 flex items-center justify-between gap-2"><div class="min-w-0"><p class="truncate font-mono text-ui-xs text-[var(--app-text)]">{preview.path}</p><p class={`text-ui-xs font-medium ${preview.status === 'unchanged' ? 'text-[var(--app-success)]' : 'text-[var(--app-warning)]'}`}>{previewStatusLabel(preview.status)}</p></div><span class="shrink-0 text-ui-xs text-[var(--app-text-muted)]">{m['design.delivery_mappings_used']({ count: String(preview.mappingsUsed.length) })}</span></div>
            <pre class="max-h-56 overflow-auto border border-[var(--app-border)] bg-[var(--app-canvas)] p-2 font-mono text-ui-xs leading-4 text-[var(--app-text-soft)]"><code>{preview.content}</code></pre>
            {#if preview.warnings.length}<div class="mt-2 border-l-2 border-[var(--app-warning)] pl-2"><p class="mb-1 text-ui-xs font-semibold text-[var(--app-warning)]">{m['design.delivery_warnings']()}</p>{#each preview.warnings as warning}<p class="text-ui-xs leading-3.5 text-[var(--app-text-muted)]">{warning}</p>{/each}</div>{/if}
            <div class="mt-2 grid grid-cols-2 gap-1.5"><Button size="sm" disabled={generating} onclick={() => void writeCode()}>{#if generating}<LoaderCircle size={12} class="animate-spin" />{:else}<CheckCircle2 size={12} />{/if}{m['design.delivery_write']()}</Button><Button variant="outline" size="sm" disabled={!lastAppliedPath && !document.codeArtifacts.some((artifact) => artifact.path === preview?.path)} onclick={() => void openFile(preview!.path)}><ExternalLink size={12} />{m['design.delivery_open_monaco']()}</Button></div>
            <Button class="mt-1.5 w-full" variant="ghost" size="sm" disabled={generating || (!lastAppliedPath && !document.codeArtifacts.some((artifact) => artifact.path === preview?.path))} onclick={() => void createGitReview()}><GitPullRequest size={12} />{m['design.delivery_create_review']()}</Button>
          </section>
        {/if}
        <section><div class="mb-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['design.delivery_artifacts']()}</div>{#if !document.codeArtifacts.length}<p class="text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.delivery_artifacts_empty']()}</p>{/if}<div class="space-y-1">{#each [...document.codeArtifacts].reverse() as artifact (artifact.id)}<div class="flex items-center gap-1 rounded-[5px] border border-[var(--app-border)] px-2 py-1.5"><FileCode2 size={11} class="shrink-0 text-[var(--app-accent)]" /><button class="min-w-0 flex-1 text-left" onclick={() => void openFile(artifact.path)}><span class="block truncate text-ui-xs font-medium">{artifact.name}</span><span class="block truncate font-mono text-ui-xs text-[var(--app-text-muted)]">{artifact.path}</span></button><Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.delivery_delete_artifact']()} title={m['design.delivery_delete_artifact']()} onclick={() => void removeArtifact(artifact)}><Trash2 size={10} /></Button></div>{/each}</div></section>
      </div>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <header class="border-b border-[var(--app-border)] p-3"><div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2"><MonitorSmartphone size={14} class="text-[var(--app-accent)]" /><h3 class="font-semibold text-[var(--app-text)]">{m['design.delivery_compare_title']()}</h3></div><Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.delivery_refresh_targets']()} title={m['design.delivery_refresh_targets']()} onclick={() => void loadTargets()}><RefreshCw size={11} /></Button></div><p class="mt-1 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.delivery_compare_help']()}</p></header>
      <div class="space-y-3 p-3">
        {#if targets.length}
          <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_target']()}</span><NativeSelect.Root name="design-validation-target" value={selectedTargetKey} onchange={(event: Event) => (selectedTargetKey = (event.currentTarget as HTMLSelectElement).value)}>{#each targets as target}<NativeSelect.Option value={`${target.kind}:${target.nodeId ?? ''}`} disabled={!target.available}>{target.kind === 'portal' ? m['design.delivery_target_portal']() : m['design.delivery_target_mobile']()} · {target.title}{target.available ? '' : ` · ${m['design.delivery_target_offline']()}`}</NativeSelect.Option>{/each}</NativeSelect.Root></label>
          <label class="block space-y-1"><span class="text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.delivery_viewport']()}</span><NativeSelect.Root name="design-validation-viewport" value={viewportOption} onchange={(event: Event) => (viewportOption = (event.currentTarget as HTMLSelectElement).value as ViewportOption)}><NativeSelect.Option value="frame">{m['design.delivery_native_frame']()}</NativeSelect.Option><NativeSelect.Option value="mobile">{m['design.delivery_mobile']()}</NativeSelect.Option><NativeSelect.Option value="tablet">{m['design.delivery_tablet']()}</NativeSelect.Option><NativeSelect.Option value="desktop">{m['design.delivery_desktop']()}</NativeSelect.Option></NativeSelect.Root></label>
          {#if selectedTarget?.kind === 'portal'}<p class="flex items-start gap-1.5 text-ui-xs leading-4 text-[var(--app-text-muted)]"><Camera size={11} class="mt-0.5 shrink-0" />{m['design.delivery_portal_open']()}</p>{/if}
          <Button class="w-full" size="sm" disabled={!selectedTarget?.available || !deliveryElementIds.length || comparing} onclick={() => void captureAndCompare()}>{#if comparing}<LoaderCircle size={13} class="animate-spin" />{:else}<Camera size={13} />{/if}{m['design.delivery_capture_compare']()}</Button>
        {:else}<div class="border border-dashed border-[var(--app-border)] p-3 text-center text-ui-xs leading-4 text-[var(--app-text-muted)]"><MonitorSmartphone size={18} class="mx-auto mb-2 text-[var(--app-accent)]" />{m['design.delivery_targets_empty']()}</div>{/if}
        {#if comparison}
          <section class="border-t border-[var(--app-border)] pt-3">
            <div class="mb-2 flex items-center justify-between gap-2"><div><p class="font-medium text-[var(--app-text)]">{comparisonTargetTitle}</p><p class="text-ui-xs tabular-nums text-[var(--app-text-muted)]">{comparison.width} × {comparison.height}</p></div><span class={`font-mono text-ui-xs font-semibold ${comparison.mismatchRatio <= 0.02 ? 'text-[var(--app-success)]' : comparison.mismatchRatio <= 0.1 ? 'text-[var(--app-warning)]' : 'text-[var(--app-danger)]'}`}>{m['design.delivery_difference']({ value: (comparison.mismatchRatio * 100).toFixed(2) })}</span></div>
            <div class="mb-2 grid grid-cols-4 gap-0.5 rounded-[5px] bg-[var(--app-surface-raised)] p-0.5">{#each [{ id: 'reference' as const, label: m['design.delivery_reference']() }, { id: 'actual' as const, label: m['design.delivery_actual']() }, { id: 'overlay' as const, label: m['design.delivery_overlay']() }, { id: 'diff' as const, label: m['design.delivery_diff']() }] as item}<button class={`h-6 truncate rounded-[4px] px-1 text-ui-xs ${comparisonView === item.id ? 'bg-[var(--app-surface)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)]'}`} onclick={() => (comparisonView = item.id)}>{item.label}</button>{/each}</div>
            <div class="relative aspect-[4/3] overflow-hidden border border-[var(--app-border)] bg-[var(--app-canvas)]">
              {#if comparisonView === 'reference'}<img class="size-full object-contain" src={comparison.referenceDataUrl} alt={m['design.delivery_reference']()} />
              {:else if comparisonView === 'actual'}<img class="size-full object-contain" src={comparison.actualDataUrl} alt={m['design.delivery_actual']()} />
              {:else if comparisonView === 'diff'}<img class="size-full object-contain" src={comparison.diffDataUrl} alt={m['design.delivery_diff']()} />
              {:else}<img class="size-full object-contain" src={comparison.referenceDataUrl} alt={m['design.delivery_reference']()} /><img class="absolute inset-0 size-full object-contain" style:clip-path={`inset(0 ${100 - overlayAmount}% 0 0)`} src={comparison.actualDataUrl} alt={m['design.delivery_actual']()} /><div class="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" style:left={`${overlayAmount}%`}></div>{/if}
            </div>
            {#if comparisonView === 'overlay'}<label class="mt-2 block"><span class="sr-only">{m['design.delivery_overlay_amount']()}</span><input class="w-full accent-[var(--app-accent)]" type="range" min="0" max="100" bind:value={overlayAmount} aria-label={m['design.delivery_overlay_amount']()} /></label>{/if}
            <div class="mt-2 grid grid-cols-2 gap-1.5"><Button size="sm" disabled={comparing} onclick={() => void createFeedbackTask()}><Send size={12} />{m['design.delivery_create_task']()}</Button><Button variant="outline" size="sm" onclick={openReviewCenter}><Columns2 size={12} />{m['design.delivery_open_review_center']()}</Button></div>
            <Button class="mt-1.5 w-full" variant="ghost" size="sm" disabled={generating || !(lastAppliedPath || preview?.path || document.codeArtifacts.length)} onclick={() => void createGitReview()}><GitPullRequest size={12} />{m['design.delivery_create_review']()}</Button>
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>
