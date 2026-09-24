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
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import { Slider } from '$lib/components/ui/slider';
  import NodeEmptyState from '$lib/components/agent-room/canvas/NodeEmptyState.svelte';
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

{#snippet fieldLabel(text: string)}<span class="block text-ui-xs font-medium text-[var(--app-text-muted)]">{text}</span>{/snippet}

{#snippet viewHeader(Icon: typeof Import, title: string, help: string)}
  <header class="border-b border-[var(--app-border)] px-3 py-2.5">
    <div class="flex items-center gap-2"><span class="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--app-hover)] text-[var(--app-text-soft)]"><Icon size={14} /></span><h3 class="min-w-0 truncate text-ui-md font-semibold text-[var(--app-text)]">{title}</h3></div>
    <p class="mt-1.5 text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{help}</p>
  </header>
{/snippet}

<div class="flex h-full min-h-0 flex-col text-ui-sm" data-design-delivery>
  <div class="shrink-0 border-b border-[var(--app-border)] p-2">
    <div class="grid grid-cols-4 gap-0.5 rounded-lg bg-[var(--app-hover)] p-0.5">
      {#each [
        { id: 'connect' as const, label: m['design.delivery_connect'](), icon: Link2 },
        { id: 'import' as const, label: m['design.delivery_import'](), icon: Import },
        { id: 'generate' as const, label: m['design.delivery_generate'](), icon: FileCode2 },
        { id: 'compare' as const, label: m['design.delivery_compare'](), icon: ScanSearch },
      ] as item (item.id)}
        <button type="button" class={`flex h-10 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-ui-xs font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)] ${view === item.id ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-[var(--app-shadow-border)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={view === item.id} title={item.label} onclick={() => (view = item.id)}><item.icon size={14} class={view === item.id ? 'text-[var(--app-accent)]' : ''} /><span class="max-w-full truncate">{item.label}</span></button>
      {/each}
    </div>
  </div>

  {#if view === 'connect'}
    <div class="space-y-2 border-b border-[var(--app-border)] px-3 pt-1.5 pb-3">
      <div class="flex h-7 items-center justify-between gap-2"><span class="section-label truncate">{m['design.codebase_design_system']()}</span><Button variant="ghost" size="icon-sm" class="size-7 shrink-0 text-[var(--app-text-soft)] hover:text-[var(--app-text)]" aria-label={m['design.scan_codebase']()} title={m['design.scan_codebase']()} onclick={() => void scanCodebase()}><RefreshCw size={13} class={loading ? 'animate-spin' : ''} /></Button></div>
      {#if scan}
        <div class="grid grid-cols-3 gap-1.5">
          {#each [{ value: scan.files.length, label: m['design.code_files']() }, { value: scan.tokens.length, label: m['design.tokens']() }, { value: scan.components.length, label: m['design.components']() }] as stat (stat.label)}
            <div class="rounded-lg bg-[var(--app-hover)] px-1 py-1.5 text-center"><strong class="block text-ui-lg font-semibold tabular-nums text-[var(--app-text)]">{stat.value}</strong><span class="block truncate text-ui-xs text-[var(--app-text-muted)]" title={stat.label}>{stat.label}</span></div>
          {/each}
        </div>
      {/if}
      <Button class="h-auto min-h-7 w-full py-1 whitespace-normal" variant="secondary" size="sm" disabled={!tokenSources.length || busyPath === '*'} onclick={() => void syncAllTokens()}>{#if busyPath === '*'}<LoaderCircle size={13} class="animate-spin" />{:else}<Braces size={13} />{/if}<span class="min-w-0 text-left [text-wrap:balance]">{m['design.sync_all_tokens']()}</span></Button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if loading && !scan}
        <div class="grid h-32 place-items-center" role="status"><span class="inline-flex items-center gap-2 rounded-full bg-[var(--app-surface-raised)] px-3 py-1.5 text-ui-sm text-[var(--app-text-soft)] shadow-[var(--app-shadow-border)]"><LoaderCircle size={14} class="animate-spin text-[var(--app-accent)]" />{m['design.scan_codebase']()}</span></div>
      {:else if scan}
        <section class="space-y-1.5 border-b border-[var(--app-border)] px-3 py-2.5"><div class="flex h-6 items-center gap-2"><span class="section-label">{m['design.code_token_sources']()}</span>{#if tokenSources.length}<span class="meta-mono">{tokenSources.length}</span>{/if}</div>
          {#if !tokenSources.length}<p class="text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.code_token_sources_empty']()}</p>{/if}
          <div class="space-y-px">{#each tokenSources as path (path)}{@const collection = document.variableCollections.find((candidate) => candidate.codeSource?.path === path)}<div class="flex h-8 items-center gap-2 rounded-md px-1.5 transition-colors duration-150 hover:bg-[var(--app-hover)]"><Braces size={13} class="shrink-0 text-[var(--app-text-muted)]" /><span class="min-w-0 flex-1 truncate font-mono text-ui-xs text-[var(--app-text-soft)]" title={path}>{path}</span><Button variant="ghost" size="sm" class="h-6 shrink-0 px-2 text-ui-xs" disabled={busyPath === path} onclick={() => void syncTokens(path)}>{collection ? m['design.sync']() : m['design.import']()}</Button></div>{/each}</div>
        </section>
        <section class="space-y-2 px-3 py-2.5"><div class="flex h-6 items-center gap-2"><span class="section-label">{m['design.code_components']()}</span>{#if scan.components.length}<span class="meta-mono">{scan.components.length}</span>{/if}</div>
          <div class="relative"><Code2 size={13} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--app-text-muted)]" /><Input class="h-7 pl-8 text-ui-md md:text-ui-md" placeholder={m['design.search_code_components']()} aria-label={m['design.search_code_components']()} bind:value={search} /></div>
          {#if activeComponent?.codeConnect}<div class="rounded-lg bg-[var(--app-accent-soft)] p-2"><div class="flex items-start gap-2"><Link2 size={13} class="mt-0.5 shrink-0 text-[var(--app-accent)]" /><div class="min-w-0 flex-1"><p class="truncate text-ui-md font-medium">{activeComponent.codeConnect.exportName}</p><p class="truncate font-mono text-ui-xs text-[var(--app-text-muted)]" title={activeComponent.codeConnect.path}>{activeComponent.codeConnect.path}</p>{#if linkedStatus === 'changed'}<p class="mt-1 flex items-center gap-1 text-ui-xs text-[var(--app-warning)]"><TriangleAlert size={12} />{m['design.code_source_changed']()}</p>{:else if linkedStatus === 'missing'}<p class="mt-1 flex items-center gap-1 text-ui-xs text-[var(--app-danger)]"><TriangleAlert size={12} />{m['design.code_source_missing']()}</p>{/if}</div>{#if linkedStatus === 'changed' && linkedCandidate}<Button variant="ghost" size="icon-sm" class="size-7" aria-label={m['design.sync_code_component']()} title={m['design.sync_code_component']()} onclick={() => void connectComponent(linkedCandidate)}><RefreshCw size={13} /></Button>{/if}<Button variant="ghost" size="icon-sm" class="size-7" aria-label={m['design.disconnect_code_component']()} title={m['design.disconnect_code_component']()} onclick={() => void disconnectComponent()}><Unlink2 size={13} /></Button></div></div>{/if}
          {#if !components.length}<p class="text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.code_components_empty']()}</p>{/if}
          <div class="space-y-px">{#each components as candidate (candidate.key)}<div class="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-[var(--app-hover)]"><Code2 size={13} class="shrink-0 text-[var(--app-text-muted)]" /><button type="button" class="min-w-0 flex-1 text-left outline-none focus-visible:underline disabled:cursor-default" disabled={!activeComponent || saving} onclick={() => void connectComponent(candidate)}><span class="block truncate text-ui-md">{candidate.name}</span><span class="block truncate font-mono text-ui-xs text-[var(--app-text-muted)]">{candidate.path} · {m['design.code_props']({ count: String(candidate.props.length) })}</span></button>{#if activeComponent?.codeConnect?.path === candidate.path}<span class="shrink-0 rounded-full bg-[var(--app-success-soft)] px-2 py-0.5 text-ui-xs text-[var(--app-success)]">{m['design.connected']()}</span>{/if}</div>{/each}</div>
        </section>
      {:else}<div class="py-4"><NodeEmptyState compact tone="danger" icon={TriangleAlert} title={m['design.codebase_scan_error']()}>{#snippet actions()}<Button variant="outline" size="sm" onclick={() => void scanCodebase()}><RefreshCw size={13} />{m['design.scan_codebase']()}</Button>{/snippet}</NodeEmptyState></div>{/if}
    </div>
  {:else if view === 'import'}
    <div class="min-h-0 flex-1 overflow-y-auto">
      {@render viewHeader(Import, m['design.delivery_import_title'](), m['design.delivery_import_help']())}
      <div class="space-y-3 p-3">
        <label class="block space-y-1">{@render fieldLabel(m['design.delivery_format']())}<NativeSelect.Root size="sm" class="w-full [&_select]:text-ui-md" name="design-import-format" value={importFormat} onchange={(event: Event) => (importFormat = (event.currentTarget as HTMLSelectElement).value as DesignMarkupFormat)}><NativeSelect.Option value="html">HTML / Tailwind</NativeSelect.Option><NativeSelect.Option value="svelte">Svelte</NativeSelect.Option><NativeSelect.Option value="react">React / JSX</NativeSelect.Option><NativeSelect.Option value="vue">Vue</NativeSelect.Option></NativeSelect.Root></label>
        <label class="block space-y-1">{@render fieldLabel(m['design.delivery_name']())}<Input class="h-7 text-ui-md md:text-ui-md" name="design-import-name" autocomplete="off" bind:value={importName} /></label>
        <label class="block space-y-1">{@render fieldLabel(m['design.delivery_markup']())}<Textarea name="design-import-markup" autocomplete="off" class="min-h-40 resize-y font-mono text-ui-xs leading-5 md:text-ui-xs" placeholder={m['design.delivery_markup_placeholder']()} bind:value={importMarkup} /></label>
        <label class="block space-y-1">{@render fieldLabel(m['design.delivery_css']())}<Textarea name="design-import-css" autocomplete="off" class="min-h-24 resize-y font-mono text-ui-xs leading-5 md:text-ui-xs" placeholder={m['design.delivery_css_placeholder']()} bind:value={importCss} /></label>
        <p class="flex items-start gap-1.5 text-ui-sm leading-5 text-[var(--app-text-muted)]"><Layers3 size={13} class="mt-0.5 shrink-0" />{importParentId ? m['design.delivery_import_parent']() : m['design.delivery_import_page']()}</p>
        <Button class="w-full" size="sm" disabled={!importMarkup.trim() || !importName.trim() || importing || saving} onclick={() => void importCode()}>{#if importing}<LoaderCircle size={13} class="animate-spin" />{:else}<Import size={13} />{/if}{m['design.delivery_import_action']()}</Button>
        {#if importWarnings.length}<section class="space-y-1 rounded-lg bg-[var(--app-warning-soft)] p-2.5"><p class="flex items-center gap-1.5 text-ui-sm font-semibold text-[var(--app-warning)]"><TriangleAlert size={13} />{m['design.delivery_warnings']()}</p>{#each importWarnings as warning}<p class="text-ui-sm leading-5 text-[var(--app-text-soft)]">{warning}</p>{/each}</section>{/if}
      </div>
    </div>
  {:else if view === 'generate'}
    <div class="min-h-0 flex-1 overflow-y-auto">
      {@render viewHeader(FileCode2, m['design.delivery_generate_title'](), m['design.delivery_generate_help']())}
      <div class="space-y-3 p-3">
        <div class="flex items-center gap-2 rounded-lg bg-[var(--app-hover)] px-2.5 py-2 text-ui-sm text-[var(--app-text-soft)]"><Layers3 size={13} class="shrink-0 text-[var(--app-text-muted)]" />{#if selectedIds.length}{m['design.delivery_selection_count']({ count: String(selectedIds.length) })}{:else}{m['design.delivery_page_scope']()}{/if}</div>
        <label class="block space-y-1">{@render fieldLabel(m['design.delivery_framework']())}<NativeSelect.Root size="sm" class="w-full [&_select]:text-ui-md" name="design-delivery-framework" value={framework} onchange={(event: Event) => changeFramework((event.currentTarget as HTMLSelectElement).value as DesignDeliveryFramework)}><NativeSelect.Option value="svelar">Svelar / Svelte 5</NativeSelect.Option><NativeSelect.Option value="svelte">Svelte 5</NativeSelect.Option><NativeSelect.Option value="react">React</NativeSelect.Option><NativeSelect.Option value="next">Next.js</NativeSelect.Option><NativeSelect.Option value="vue">Vue 3</NativeSelect.Option><NativeSelect.Option value="html">HTML / Tailwind</NativeSelect.Option></NativeSelect.Root></label>
        <label class="block space-y-1">{@render fieldLabel(m['design.delivery_component_name']())}<Input class="h-7 text-ui-md md:text-ui-md" name="design-delivery-component" autocomplete="off" bind:value={componentName} oninput={() => (preview = null)} /></label>
        <label class="block space-y-1">{@render fieldLabel(m['design.delivery_output_path']())}<Input name="design-delivery-output" autocomplete="off" class="h-7 font-mono text-ui-xs md:text-ui-xs" bind:value={outputPath} oninput={() => (preview = null)} /></label>
        <Button class="w-full" variant="secondary" size="sm" disabled={!deliveryElementIds.length || !outputPath.trim() || !componentName.trim() || generating} onclick={() => void previewCode()}>{#if generating}<LoaderCircle size={13} class="animate-spin" />{:else}<ScanSearch size={13} />{/if}{m['design.delivery_preview']()}</Button>
        {#if preview}
          <section class="space-y-2 rounded-lg bg-[var(--app-surface-raised)] p-2.5 shadow-[var(--app-shadow-border)]">
            <div class="flex items-center justify-between gap-2"><div class="min-w-0"><p class="truncate font-mono text-ui-xs text-[var(--app-text)]" title={preview.path}>{preview.path}</p><p class={`text-ui-sm font-medium ${preview.status === 'unchanged' ? 'text-[var(--app-success)]' : 'text-[var(--app-warning)]'}`}>{previewStatusLabel(preview.status)}</p></div><span class="shrink-0 text-ui-xs text-[var(--app-text-muted)]">{m['design.delivery_mappings_used']({ count: String(preview.mappingsUsed.length) })}</span></div>
            <pre class="max-h-56 overflow-auto rounded-md bg-[var(--app-canvas)] p-2 font-mono text-ui-xs leading-5 text-[var(--app-text-soft)] shadow-[inset_0_0_0_1px_var(--app-border)]"><code>{preview.content}</code></pre>
            {#if preview.warnings.length}<div class="space-y-1 rounded-md bg-[var(--app-warning-soft)] p-2"><p class="flex items-center gap-1.5 text-ui-sm font-semibold text-[var(--app-warning)]"><TriangleAlert size={13} />{m['design.delivery_warnings']()}</p>{#each preview.warnings as warning}<p class="text-ui-sm leading-5 text-[var(--app-text-soft)]">{warning}</p>{/each}</div>{/if}
            <div class="grid grid-cols-2 gap-1.5"><Button size="sm" class="min-w-0" disabled={generating} onclick={() => void writeCode()}>{#if generating}<LoaderCircle size={13} class="animate-spin" />{:else}<CheckCircle2 size={13} />{/if}<span class="truncate">{m['design.delivery_write']()}</span></Button><Button variant="outline" size="sm" class="min-w-0" disabled={!lastAppliedPath && !document.codeArtifacts.some((artifact) => artifact.path === preview?.path)} onclick={() => void openFile(preview!.path)}><ExternalLink size={13} /><span class="truncate">{m['design.delivery_open_monaco']()}</span></Button></div>
            <Button class="w-full" variant="ghost" size="sm" disabled={generating || (!lastAppliedPath && !document.codeArtifacts.some((artifact) => artifact.path === preview?.path))} onclick={() => void createGitReview()}><GitPullRequest size={13} />{m['design.delivery_create_review']()}</Button>
          </section>
        {/if}
        <section class="space-y-1.5"><div class="flex h-6 items-center gap-2"><span class="section-label">{m['design.delivery_artifacts']()}</span>{#if document.codeArtifacts.length}<span class="meta-mono">{document.codeArtifacts.length}</span>{/if}</div>{#if !document.codeArtifacts.length}<p class="text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.delivery_artifacts_empty']()}</p>{/if}<div class="space-y-1">{#each [...document.codeArtifacts].reverse() as artifact (artifact.id)}<div class="group/artifact flex items-center gap-1.5 rounded-md bg-[var(--app-hover)] py-1 pr-1 pl-2"><FileCode2 size={13} class="shrink-0 text-[var(--app-text-muted)]" /><button type="button" class="min-w-0 flex-1 text-left outline-none focus-visible:underline" onclick={() => void openFile(artifact.path)}><span class="block truncate text-ui-sm font-medium">{artifact.name}</span><span class="block truncate font-mono text-ui-xs text-[var(--app-text-muted)]">{artifact.path}</span></button><Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-muted)] opacity-60 transition-[opacity,color] duration-150 hover:text-[var(--app-danger)] group-focus-within/artifact:opacity-100 group-hover/artifact:opacity-100" aria-label={m['design.delivery_delete_artifact']()} title={m['design.delivery_delete_artifact']()} onclick={() => void removeArtifact(artifact)}><Trash2 size={13} /></Button></div>{/each}</div></section>
      </div>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <header class="border-b border-[var(--app-border)] px-3 py-2.5"><div class="flex items-center justify-between gap-2"><div class="flex min-w-0 items-center gap-2"><span class="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--app-hover)] text-[var(--app-text-soft)]"><MonitorSmartphone size={14} /></span><h3 class="min-w-0 truncate text-ui-md font-semibold text-[var(--app-text)]">{m['design.delivery_compare_title']()}</h3></div><Button variant="ghost" size="icon-sm" class="size-7 shrink-0 text-[var(--app-text-soft)] hover:text-[var(--app-text)]" aria-label={m['design.delivery_refresh_targets']()} title={m['design.delivery_refresh_targets']()} onclick={() => void loadTargets()}><RefreshCw size={13} /></Button></div><p class="mt-1.5 text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.delivery_compare_help']()}</p></header>
      <div class="space-y-3 p-3">
        {#if targets.length}
          <label class="block space-y-1">{@render fieldLabel(m['design.delivery_target']())}<NativeSelect.Root size="sm" class="w-full [&_select]:text-ui-md" name="design-validation-target" value={selectedTargetKey} onchange={(event: Event) => (selectedTargetKey = (event.currentTarget as HTMLSelectElement).value)}>{#each targets as target}<NativeSelect.Option value={`${target.kind}:${target.nodeId ?? ''}`} disabled={!target.available}>{target.kind === 'portal' ? m['design.delivery_target_portal']() : m['design.delivery_target_mobile']()} · {target.title}{target.available ? '' : ` · ${m['design.delivery_target_offline']()}`}</NativeSelect.Option>{/each}</NativeSelect.Root></label>
          <label class="block space-y-1">{@render fieldLabel(m['design.delivery_viewport']())}<NativeSelect.Root size="sm" class="w-full [&_select]:text-ui-md" name="design-validation-viewport" value={viewportOption} onchange={(event: Event) => (viewportOption = (event.currentTarget as HTMLSelectElement).value as ViewportOption)}><NativeSelect.Option value="frame">{m['design.delivery_native_frame']()}</NativeSelect.Option><NativeSelect.Option value="mobile">{m['design.delivery_mobile']()}</NativeSelect.Option><NativeSelect.Option value="tablet">{m['design.delivery_tablet']()}</NativeSelect.Option><NativeSelect.Option value="desktop">{m['design.delivery_desktop']()}</NativeSelect.Option></NativeSelect.Root></label>
          {#if selectedTarget?.kind === 'portal'}<p class="flex items-start gap-1.5 text-ui-sm leading-5 text-[var(--app-text-muted)]"><Camera size={13} class="mt-0.5 shrink-0" />{m['design.delivery_portal_open']()}</p>{/if}
          <Button class="w-full" size="sm" disabled={!selectedTarget?.available || !deliveryElementIds.length || comparing} onclick={() => void captureAndCompare()}>{#if comparing}<LoaderCircle size={13} class="animate-spin" />{:else}<Camera size={13} />{/if}{m['design.delivery_capture_compare']()}</Button>
        {:else}<NodeEmptyState compact icon={MonitorSmartphone} title={m['design.delivery_targets_empty_title']()} description={m['design.delivery_targets_empty']()}>{#snippet actions()}<Button variant="outline" size="sm" onclick={() => void loadTargets()}><RefreshCw size={13} />{m['design.delivery_refresh_targets']()}</Button>{/snippet}</NodeEmptyState>{/if}
        {#if comparison}
          <section class="space-y-2 border-t border-[var(--app-border)] pt-3">
            <div class="flex items-center justify-between gap-2"><div class="min-w-0"><p class="truncate text-ui-md font-medium text-[var(--app-text)]">{comparisonTargetTitle}</p><p class="text-ui-xs tabular-nums text-[var(--app-text-muted)]">{comparison.width} × {comparison.height}</p></div><span class={`shrink-0 rounded-full px-2 py-0.5 font-mono text-ui-xs font-semibold ${comparison.mismatchRatio <= 0.02 ? 'bg-[var(--app-success-soft)] text-[var(--app-success)]' : comparison.mismatchRatio <= 0.1 ? 'bg-[var(--app-warning-soft)] text-[var(--app-warning)]' : 'bg-[var(--app-danger-soft)] text-[var(--app-danger)]'}`}>{m['design.delivery_difference']({ value: (comparison.mismatchRatio * 100).toFixed(2) })}</span></div>
            <SegmentedControl size="sm" fill label={m['design.delivery_compare']()} value={comparisonView} options={[{ value: 'reference' as const, label: m['design.delivery_reference']() }, { value: 'actual' as const, label: m['design.delivery_actual']() }, { value: 'overlay' as const, label: m['design.delivery_overlay']() }, { value: 'diff' as const, label: m['design.delivery_diff']() }]} onValueChange={(next) => (comparisonView = next)} />
            <div class="relative aspect-[4/3] overflow-hidden rounded-lg bg-[var(--app-canvas)] shadow-[inset_0_0_0_1px_var(--app-border)]">
              {#if comparisonView === 'reference'}<img class="size-full object-contain" src={comparison.referenceDataUrl} alt={m['design.delivery_reference']()} />
              {:else if comparisonView === 'actual'}<img class="size-full object-contain" src={comparison.actualDataUrl} alt={m['design.delivery_actual']()} />
              {:else if comparisonView === 'diff'}<img class="size-full object-contain" src={comparison.diffDataUrl} alt={m['design.delivery_diff']()} />
              {:else}<img class="size-full object-contain" src={comparison.referenceDataUrl} alt={m['design.delivery_reference']()} /><img class="absolute inset-0 size-full object-contain" style:clip-path={`inset(0 ${100 - overlayAmount}% 0 0)`} src={comparison.actualDataUrl} alt={m['design.delivery_actual']()} /><div class="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" style:left={`${overlayAmount}%`}></div>{/if}
            </div>
            {#if comparisonView === 'overlay'}<Slider type="single" class="py-1.5 [&_[data-slot=slider-range]]:bg-[var(--app-text-soft)]" value={overlayAmount} min={0} max={100} step={1} aria-label={m['design.delivery_overlay_amount']()} onValueChange={(value: number) => (overlayAmount = value)} />{/if}
            <div class="grid grid-cols-2 gap-1.5"><Button size="sm" class="min-w-0" disabled={comparing} onclick={() => void createFeedbackTask()}><Send size={13} /><span class="truncate">{m['design.delivery_create_task']()}</span></Button><Button variant="outline" size="sm" class="min-w-0" onclick={openReviewCenter}><Columns2 size={13} /><span class="truncate">{m['design.delivery_open_review_center']()}</span></Button></div>
            <Button class="w-full" variant="ghost" size="sm" disabled={generating || !(lastAppliedPath || preview?.path || document.codeArtifacts.length)} onclick={() => void createGitReview()}><GitPullRequest size={13} />{m['design.delivery_create_review']()}</Button>
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>
