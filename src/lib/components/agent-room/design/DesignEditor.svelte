<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import {
    AlignCenter,
    AlignHorizontalDistributeCenter,
    AlignHorizontalJustifyCenter,
    AlignHorizontalJustifyEnd,
    AlignHorizontalJustifyStart,
    AlignLeft,
    AlignRight,
    AlignVerticalDistributeCenter,
    AlignVerticalJustifyCenter,
    AlignVerticalJustifyEnd,
    AlignVerticalJustifyStart,
    ArrowDown,
    ArrowUp,
    Blend,
    Braces,
    ChevronDown,
    Circle,
    ClipboardCopy,
    Combine,
    CornerDownRight,
    Diamond,
    Download,
    Frame,
    Group,
    Hand,
    ImagePlus,
    Layers3,
    MoveDiagonal2,
    Magnet,
    Maximize2,
    MousePointer2,
    PenTool,
    Palette,
    Play,
    Plus,
    Redo2,
    RectangleHorizontal,
    Ruler,
    ShieldCheck,
    Sparkles,
    Spline,
    Trash2,
    Type,
    Undo2,
    Ungroup,
    Unlink2,
    SlidersHorizontal,
    UsersRound,
    Workflow,
    ZoomIn,
    ZoomOut,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import {
    designElementSchema,
    type DesignAsset,
    type DesignBindableProperty,
    type DesignCollaborator,
    type DesignDocument,
    type DesignEffect,
    type DesignElement,
    type DesignOperation,
    type DesignPage,
    type DesignPaint,
    type DesignPathPoint,
    type DesignProposal,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import type { DesignCollaborationSnapshot } from '$lib/modules/agent-room/application/services/DesignCollaborationService.js';
  import {
    autoLayoutChanges,
    bendDesignPathSegment,
    combineDesignElements,
    convertDesignPathPointMode,
    designPathBounds,
    constrainedChildChanges,
    designPathData,
    designPathSegmentData,
    designPathSegmentPoint,
    designTextHeight,
    scaleDesignPathSubpaths,
    splitDesignPathSegment,
    type DesignBooleanOperation,
  } from '$lib/modules/agent-room/domain/design-geometry.js';
  import { importSvgToDesign, SvgImportError } from '$lib/modules/agent-room/domain/design-svg-import.js';
  import { resolveDesignElements } from '$lib/modules/agent-room/domain/design-variables.js';
  import {
    designContentBounds,
    designSceneBounds,
    visibleDesignElements,
    type DesignViewportBounds,
  } from '$lib/modules/agent-room/domain/design-viewport.js';
  import { defaultPrototypeFlow, exportMotionCss, prototypeFrames } from '$lib/modules/agent-room/domain/design-prototype.js';
  import * as m from '$lib/paraglide/messages.js';
  import { eventTargetMatches } from '$lib/components/agent-room/event-target.js';
  import DesignColorTools from './DesignColorTools.svelte';
  import DesignCollaborationPanel from './DesignCollaborationPanel.svelte';
  import DesignComponentsPanel from './DesignComponentsPanel.svelte';
  import DesignPaintEditor from './DesignPaintEditor.svelte';
  import DesignPrototypePanel from './DesignPrototypePanel.svelte';
  import DesignQualityPanel from './DesignQualityPanel.svelte';
  import DesignPrototypePlayer from './DesignPrototypePlayer.svelte';
  import DesignRenderer from './DesignRenderer.svelte';
  import DesignToolbarButton from './DesignToolbarButton.svelte';
  import DesignFilePanel from './DesignFilePanel.svelte';
  import DesignVariableBindings from './DesignVariableBindings.svelte';
  import DesignVariablesPanel from './DesignVariablesPanel.svelte';
  import {
    readDesignEditorSession,
    writeDesignEditorSession,
    type DesignEditorLeftPanel,
    type DesignEditorRightPanel,
    type DesignEditorSession,
    type DesignEditorTool,
  } from './design-editor-session.js';
  import {
    canPasteDesignLayers,
    copyDesignLayers,
    pasteDesignLayerOperations,
  } from './design-clipboard.js';
  import { pageDeleteInverseOperations } from './design-page-history.js';

  let {
    workspaceId,
    nodeId,
    externalRevision = 0,
    class: className = '',
  }: {
    workspaceId: string;
    nodeId: string;
    externalRevision?: number;
    class?: string;
  } = $props();

  type Tool = DesignEditorTool;
  type ShapeTool = Exclude<Tool, 'select' | 'hand' | 'path'>;
  type HistoryEntry = { forward: DesignOperation[]; inverse: DesignOperation[]; summary: string };
  type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'distribute-x' | 'distribute-y';
  type PathPointSelection = { elementId: string; subpathIndex: number; pointIndex: number };
  type PathSegmentSelection = { elementId: string; subpathIndex: number; segmentIndex: number };
  type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  type SelectionMarquee = { start: { x: number; y: number }; current: { x: number; y: number } };
  const resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  let document = $state<DesignDocument | null>(null);
  let selectedIds = $state<string[]>([]);
  let tool = $state<Tool>('select');
  let loading = $state(true);
  let saving = $state(false);
  let errorMessage = $state('');
  let zoom = $state(0.65);
  let spacePressed = $state(false);
  let panning = $state(false);
  let viewport = $state<HTMLElement>();
  let viewportBounds = $state<DesignViewportBounds | null>(null);
  let editorRoot = $state<HTMLElement>();
  let pageSvg = $state<SVGSVGElement>();
  let assetInput = $state<HTMLInputElement>();
  let undoStack = $state<HistoryEntry[]>([]);
  let redoStack = $state<HistoryEntry[]>([]);
  let draftElement = $state<DesignElement | null>(null);
  let cancelDrawing: (() => void) | null = null;
  let penPoints = $state<DesignPathPoint[]>([]);
  let penPointer = $state<{ x: number; y: number } | null>(null);
  let penContinuation = $state<{ original: DesignElement; subpathIndex: number } | null>(null);
  let vectorEditId = $state<string | null>(null);
  let pathPointSelections = $state<PathPointSelection[]>([]);
  let hoveredPathSegment = $state<PathSegmentSelection | null>(null);
  let selectionMarquee = $state<SelectionMarquee | null>(null);
  let selectionMarqueeKind = $state<'layers' | 'points' | null>(null);
  let editingTextId = $state<string | null>(null);
  let editingTextDraft = $state('');
  let textEditor = $state<HTMLTextAreaElement>();
  let snapEnabled = $state(true);
  let rulersVisible = $state(true);
  let snapLinesX = $state<number[]>([]);
  let snapLinesY = $state<number[]>([]);
  let exporting = $state(false);
  let colorMenuOpen = $state(false);
  let leftPanel = $state<DesignEditorLeftPanel>('layers');
  let rightPanel = $state<DesignEditorRightPanel>('design');
  let leftPanelVisible = $state(true);
  let rightPanelVisible = $state(true);
  let editorWidth = $state(0);
  let sessionReady = false;
  let sessionWriteTimer: ReturnType<typeof setTimeout> | null = null;
  let clipboardVersion = $state(0);
  let prototypeOpen = $state(false);
  let prototypeFlowId = $state<string | null>(null);
  let thumbnailRevision = $state(-1);
  let thumbnailTimer: ReturnType<typeof setTimeout> | null = null;
  let collaboration = $state<DesignCollaborationSnapshot | null>(null);
  let collaborationTimer: ReturnType<typeof setInterval> | null = null;
  let collaborationRequest: Promise<DesignCollaborationSnapshot | null> | null = null;
  let collaborationErrorShown = false;
  let cursorPoint = $state<{ x: number; y: number } | null>(null);
  let lastPresenceSentAt = 0;
  let followParticipantId = $state<string | null>(null);
  let proposalPreview = $state<{ elementId: string; changes: Partial<DesignElement> } | null>(null);
  let participant = $state<DesignCollaborator>({
    kind: 'user',
    id: `local_${uuidv7().replaceAll('-', '_')}`,
    name: m['design.collaboration_you'](),
    color: '#2563eb',
  });

  const page = $derived(document?.pages.find((item) => item.id === document?.activePageId) ?? document?.pages[0] ?? null);
  const pageElements = $derived(document && page ? document.elements.filter((element) => element.pageId === page.id) : []);
  const contentBounds = $derived(page ? designContentBounds(pageElements, page) : null);
  const sceneBounds = $derived(page ? designSceneBounds(pageElements, page) : null);
  const renderedElements = $derived.by(() => {
    const draft = draftElement;
    let elements: DesignElement[] = draft
      ? pageElements.some((element) => element.id === draft.id)
        ? pageElements.map((element) => element.id === draft.id ? draft : element)
        : [...pageElements, draft]
      : pageElements;
    if (proposalPreview) elements = elements.map((element) => element.id === proposalPreview?.elementId ? { ...element, ...proposalPreview.changes } : element);
    if (editingTextId) elements = elements.map((element) => element.id === editingTextId ? { ...element, text: '' } : element);
    return document ? resolveDesignElements(document, elements) : elements;
  });
  const viewportRenderedElements = $derived(visibleDesignElements(
    renderedElements,
    viewportBounds,
    [
      ...selectedIds,
      ...(draftElement ? [draftElement.id] : []),
      ...(collaboration?.presences.flatMap((presence) => presence.elementIds) ?? []),
    ],
  ));
  const selectedElements = $derived(pageElements.filter((element) => selectedIds.includes(element.id)));
  const selected = $derived(selectedElements.length === 1 ? selectedElements[0] : null);
  const primaryPathPointSelection = $derived(pathPointSelections.at(-1) ?? null);
  const selectedPathPoint = $derived.by(() => {
    if (!selected || selected.type !== 'path' || primaryPathPointSelection?.elementId !== selected.id) return null;
    const subpaths = selected.pathSubpaths.length ? selected.pathSubpaths : [selected.pathPoints];
    return subpaths[primaryPathPointSelection.subpathIndex]?.[primaryPathPointSelection.pointIndex] ?? null;
  });
  const vectorEditing = $derived(Boolean(selected?.type === 'path' && vectorEditId === selected.id));
  const rendererSelectionIds = $derived(vectorEditing && selected ? selectedIds.filter((id) => id !== selected.id) : selectedIds);
  const selectedPathPointMode = $derived.by(() => {
    if (!selected || selected.type !== 'path' || !pathPointSelections.length) return null;
    const subpaths = pathSubpaths(selected);
    const modes = new Set(pathPointSelections
      .filter((selection) => selection.elementId === selected.id)
      .map((selection) => subpaths[selection.subpathIndex]?.[selection.pointIndex]?.mode)
      .filter(Boolean));
    return modes.size === 1 ? [...modes][0] : null;
  });
  const selectedPathPointBounds = $derived.by(() => {
    if (!selected || selected.type !== 'path' || pathPointSelections.length < 2) return null;
    const subpaths = pathSubpaths(selected);
    const points = pathPointSelections
      .filter((selection) => selection.elementId === selected.id)
      .map((selection) => subpaths[selection.subpathIndex]?.[selection.pointIndex])
      .filter((point): point is DesignPathPoint => Boolean(point));
    if (points.length < 2) return null;
    const left = Math.min(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const right = Math.max(...points.map((point) => point.x));
    const bottom = Math.max(...points.map((point) => point.y));
    return { x: selected.x + left, y: selected.y + top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  });
  const penWillClose = $derived(Boolean(
    penPointer && penPoints.length >= 3 && Math.hypot(penPointer.x - penPoints[0].x, penPointer.y - penPoints[0].y) * zoom <= 10,
  ));
  const editingTextHeight = $derived(selected?.type === 'text' && editingTextId === selected.id
    ? Math.max(selected.height, Math.ceil(designTextHeight(editingTextDraft, selected.width, selected.fontSize, selected.fontWeight)))
    : 0);
  const rulerXTicks = $derived(sceneBounds ? rulerTicks(sceneBounds.x, sceneBounds.x + sceneBounds.width) : []);
  const rulerYTicks = $derived(sceneBounds ? rulerTicks(sceneBounds.y, sceneBounds.y + sceneBounds.height) : []);
  const panelsOverlay = $derived(editorWidth > 0 && editorWidth < 980);
  const editorGridColumns = $derived(panelsOverlay
    ? '0 minmax(0,1fr) 0'
    : `${leftPanelVisible ? '240px' : '0'} minmax(0,1fr) ${rightPanelVisible ? '288px' : '0'}`);
  const internalPasteAvailable = $derived.by(() => {
    void clipboardVersion;
    return Boolean(document && canPasteDesignLayers(document.id));
  });

  function uuidv7(): string {
    const timestamp = Date.now().toString(16).padStart(12, '0');
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const variant = ((Number.parseInt(random[3], 16) & 0x3) | 0x8).toString(16);
    return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      const error = new Error(payload.error || m['design.error_save']()) as Error & { status?: number; data?: DesignDocument };
      error.status = response.status;
      error.data = payload.data;
      throw error;
    }
    return payload.data as T;
  }

  async function load(silent = false) {
    if (!silent) loading = true;
    errorMessage = '';
    try {
      const latest = await api<DesignDocument>(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}`);
      if (!document || latest.revision > document.revision) {
        document = latest;
        selectedIds = selectedIds.filter((id) => document?.elements.some((element) => element.id === id));
        if (silent) {
          undoStack = [];
          redoStack = [];
        }
      }
    } catch (error) {
      if (!silent) errorMessage = error instanceof Error ? error.message : m['design.error_load']();
    } finally {
      if (!silent) loading = false;
    }
  }

  async function apply(
    operations: DesignOperation[],
    summary: string,
    options: { inverse?: DesignOperation[]; record?: boolean } = {},
  ): Promise<boolean> {
    if (!document || saving || !operations.length) return false;
    const live = await syncCollaboration(true);
    if (live?.leaseConflict) {
      toast.error(m['design.collaboration_editing_by']({ name: live.leaseConflict.participantName }));
      return false;
    }
    saving = true;
    try {
      document = await api<DesignDocument>(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          baseRevision: document.revision,
          operations,
          summary,
          actor: { kind: 'user', id: null, name: null, taskId: null },
          collaborationParticipantId: participant.id,
        }),
      });
      if (options.record !== false && options.inverse) {
        undoStack = [...undoStack.slice(-99), { forward: operations, inverse: options.inverse, summary }];
        redoStack = [];
      }
      return true;
    } catch (error) {
      const candidate = error as Error & { status?: number; data?: DesignDocument };
      if (candidate.status === 409 && candidate.data) {
        document = candidate.data;
        selectedIds = selectedIds.filter((id) => document?.elements.some((element) => element.id === id));
        undoStack = [];
        redoStack = [];
        toast.error(m['design.conflict']());
      } else if (candidate.status === 423) {
        const lease = candidate.data as unknown as { participantName?: string };
        toast.error(lease.participantName ? m['design.collaboration_editing_by']({ name: lease.participantName }) : m['design.collaboration_error']());
      } else {
        toast.error(candidate.message || m['design.error_save']());
      }
      return false;
    } finally {
      saving = false;
    }
  }

  function toolLabel(value: Tool): string {
    if (value === 'hand') return m['design.pan']();
    if (value === 'frame') return m['design.frame']();
    if (value === 'rectangle') return m['design.rectangle']();
    if (value === 'ellipse') return m['design.ellipse']();
    if (value === 'text') return m['design.text']();
    if (value === 'path') return m['design.pen']();
    return m['design.select']();
  }

  function switchTool(next: Tool) {
    cancelDrawing?.();
    tool = next;
    penPoints = [];
    penPointer = null;
    penContinuation = null;
    draftElement = null;
    editingTextId = null;
    if (next !== 'select') {
      vectorEditId = null;
      pathPointSelections = [];
    }
  }

  function elementDefaults(kind: Exclude<Tool, 'select'> | 'image' | 'group', x: number, y: number): DesignElement {
    const count = document?.elements.filter((element) => element.type === kind).length ?? 0;
    return designElementSchema.parse({
      id: uuidv7(),
      pageId: page!.id,
      parentId: null,
      type: kind,
      name: `${kind === 'image' ? m['design.image']() : kind === 'group' ? m['design.group']() : toolLabel(kind)} ${count + 1}`,
      x,
      y,
      width: kind === 'frame' ? 390 : kind === 'text' ? 240 : kind === 'image' ? 320 : 180,
      height: kind === 'frame' ? 844 : kind === 'text' ? 48 : kind === 'image' ? 240 : 120,
      fill: kind === 'frame' ? '#ffffff' : kind === 'text' ? '#191919' : kind === 'path' || kind === 'image' || kind === 'group' ? 'transparent' : '#7c5cff',
      stroke: kind === 'frame' ? '#d4d4d0' : kind === 'path' ? '#7c5cff' : 'transparent',
      strokeWidth: kind === 'frame' || kind === 'path' ? 1 : 0,
      cornerRadius: kind === 'ellipse' || kind === 'path' ? 0 : 8,
      text: kind === 'text' ? m['design.text']() : '',
      fontSize: kind === 'text' ? 32 : 16,
      fontWeight: kind === 'text' ? 600 : 400,
      order: Math.max(-1, ...pageElements.map((element) => element.order)) + 1,
    });
  }

  function pagePoint(event: PointerEvent, svg = pageSvg): { x: number; y: number } {
    if (!svg || !sceneBounds) return { x: 0, y: 0 };
    const bounds = svg.getBoundingClientRect();
    return {
      x: Math.round(sceneBounds.x + (event.clientX - bounds.left) * sceneBounds.width / bounds.width),
      y: Math.round(sceneBounds.y + (event.clientY - bounds.top) * sceneBounds.height / bounds.height),
    };
  }

  function rulerTicks(start: number, end: number): number[] {
    const first = Math.floor(start / 100) * 100;
    const last = Math.ceil(end / 100) * 100;
    return Array.from({ length: Math.max(0, Math.floor((last - first) / 100) + 1) }, (_, index) => first + index * 100);
  }

  function startViewportPan(event: PointerEvent): void {
    if (!viewport || !(tool === 'hand' || spacePressed || event.button === 1)) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = viewport.scrollLeft;
    const startTop = viewport.scrollTop;
    panning = true;
    const move = (moveEvent: PointerEvent) => {
      if (!viewport || moveEvent.pointerId !== pointerId) return;
      viewport.scrollLeft = startLeft - (moveEvent.clientX - startX);
      viewport.scrollTop = startTop - (moveEvent.clientY - startY);
      handleViewportScroll();
    };
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      panning = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function editorSession(): DesignEditorSession | null {
    if (!viewport) return null;
    return {
      zoom,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      selectedIds,
      tool,
      leftPanel,
      rightPanel,
      leftPanelVisible,
      rightPanelVisible,
    };
  }

  function persistEditorSession(): void {
    const session = editorSession();
    if (!session || typeof localStorage === 'undefined') return;
    writeDesignEditorSession(localStorage, workspaceId, nodeId, session);
  }

  function scheduleEditorSessionWrite(): void {
    if (!sessionReady) return;
    if (sessionWriteTimer) clearTimeout(sessionWriteTimer);
    sessionWriteTimer = setTimeout(() => {
      sessionWriteTimer = null;
      persistEditorSession();
    }, 120);
  }

  function handleViewportScroll(): void {
    updateViewportBounds();
    scheduleEditorSessionWrite();
  }

  function toggleLeftPanel(): void {
    const next = !leftPanelVisible;
    leftPanelVisible = next;
    if (next && panelsOverlay) rightPanelVisible = false;
  }

  function toggleRightPanel(): void {
    const next = !rightPanelVisible;
    rightPanelVisible = next;
    if (next && panelsOverlay) leftPanelVisible = false;
  }

  function participantColor(id: string): string {
    const palette = ['#2563eb', '#c026d3', '#ea580c', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#4d7c0f'];
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  }

  async function syncCollaboration(silent = false): Promise<DesignCollaborationSnapshot | null> {
    if (!document || !page) return null;
    if (collaborationRequest) return collaborationRequest;
    collaborationRequest = api<DesignCollaborationSnapshot>(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}/collaboration`, {
      method: 'PUT',
      body: JSON.stringify({
        participant,
        pageId: page.id,
        elementIds: selectedIds,
        cursor: cursorPoint,
        viewport: viewport ? { x: viewport.scrollLeft, y: viewport.scrollTop, zoom } : null,
        followParticipantId,
      }),
    }).then((snapshot) => {
      collaboration = snapshot;
      collaborationErrorShown = false;
      lastPresenceSentAt = Date.now();
      const followed = followParticipantId ? snapshot.presences.find((presence) => presence.participant.id === followParticipantId) : null;
      if (followParticipantId && !followed) followParticipantId = null;
      if (followed) {
        if (document && document.pages.some((candidate) => candidate.id === followed.pageId)) document.activePageId = followed.pageId;
        selectedIds = followed.elementIds.filter((id) => document?.elements.some((element) => element.id === id));
        if (viewport && followed.viewport) viewport.scrollTo({ left: followed.viewport.x, top: followed.viewport.y, behavior: 'smooth' });
      }
      return snapshot;
    }).catch(() => {
      if (!silent && !collaborationErrorShown) {
        collaborationErrorShown = true;
        toast.error(m['design.collaboration_error']());
      }
      return null;
    }).finally(() => {
      collaborationRequest = null;
    });
    return collaborationRequest;
  }

  function trackPresence(event: PointerEvent): void {
    cursorPoint = pagePoint(event);
    if (tool === 'path') penPointer = cursorPoint;
    if (Date.now() - lastPresenceSentAt >= 700) void syncCollaboration(true);
  }

  function followParticipant(id: string | null): void {
    followParticipantId = id;
    void syncCollaboration(true);
  }

  function previewProposal(elementId: string | null, changes: Partial<DesignElement> | null): void {
    proposalPreview = elementId && changes ? { elementId, changes } : null;
  }

  function openProposalCouncil(proposal: DesignProposal): void {
    window.dispatchEvent(new CustomEvent('orkestrai:open-council', {
      detail: {
        workspaceId,
        source: { taskTitle: proposal.title, taskDescription: proposal.description || proposal.operations.map((operation) => String(operation.kind ?? '')).join(', ') },
      },
    }));
  }

  async function createProposalFloor(proposal: DesignProposal): Promise<void> {
    try {
      const floor = await api<{ id: string }>(`/api/agent-room/workspaces/${workspaceId}/floors`, {
        method: 'POST',
        body: JSON.stringify({ name: proposal.title.slice(0, 80), existingBranch: false, cloneLayout: true }),
      });
      const linked = await apply([{ kind: 'link-design-proposal', proposalId: proposal.id, floorId: floor.id }], m['design.proposal_parallel_floor']());
      if (linked) toast.success(m['design.proposal_floor_created']());
    } catch {
      toast.error(m['design.proposal_floor_error']());
    }
  }

  function startCreate(event: PointerEvent, kind: ShapeTool, svg: SVGSVGElement) {
    if (!page || event.button !== 0 || saving) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrawing?.();
    const start = pagePoint(event, svg);
    const pointerId = event.pointerId;
    const initial = { ...elementDefaults(kind, start.x, start.y), width: 1, height: 1 };
    let dragged = false;
    draftElement = initial;
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      cancelDrawing = null;
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const current = pagePoint(moveEvent, svg);
      if (Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) >= 4) dragged = true;
      let deltaX = current.x - start.x;
      let deltaY = current.y - start.y;
      if (moveEvent.shiftKey) {
        const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
        deltaX = Math.sign(deltaX || 1) * size;
        deltaY = Math.sign(deltaY || 1) * size;
      }
      const endX = start.x + deltaX;
      const endY = start.y + deltaY;
      draftElement = {
        ...initial,
        x: moveEvent.altKey ? start.x - Math.abs(deltaX) : Math.min(start.x, endX),
        y: moveEvent.altKey ? start.y - Math.abs(deltaY) : Math.min(start.y, endY),
        width: Math.max(1, Math.abs(deltaX) * (moveEvent.altKey ? 2 : 1)),
        height: Math.max(1, Math.abs(deltaY) * (moveEvent.altKey ? 2 : 1)),
      };
    };
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      const element = dragged && draftElement ? { ...draftElement } : elementDefaults(kind, start.x, start.y);
      draftElement = null;
      void apply([{ kind: 'create', element }], m['design.operation_create']({ type: toolLabel(kind) }), {
        inverse: [{ kind: 'delete', elementId: element.id }],
      }).then((created) => {
        if (!created) return;
        selectedIds = [element.id];
        tool = 'select';
      });
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      draftElement = null;
    };
    cancelDrawing = () => {
      cleanup();
      draftElement = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  }

  function draftPath(points: DesignPathPoint[], closed = false, base: DesignElement | null = null): DesignElement | null {
    if (!page || !points.length) return null;
    const bounds = designPathBounds([points], closed);
    if (!bounds) return null;
    const { x, y, width, height } = bounds;
    return designElementSchema.parse({
      ...(base ?? elementDefaults('path', x, y)),
      x,
      y,
      width,
      height,
      pathPoints: points.map((point) => ({
        x: point.x - x,
        y: point.y - y,
        inX: point.inX === null ? null : point.inX - x,
        inY: point.inY === null ? null : point.inY - y,
        outX: point.outX === null ? null : point.outX - x,
        outY: point.outY === null ? null : point.outY - y,
        mode: point.mode,
      })),
      pathSubpaths: [],
      pathClosed: closed,
    });
  }

  function startPenPoint(event: PointerEvent) {
    if (event.button !== 0 || saving) return;
    event.preventDefault();
    event.stopPropagation();
    const position = pagePoint(event);
    const first = penPoints[0];
    if (first && penPoints.length >= 3 && Math.hypot(position.x - first.x, position.y - first.y) * zoom <= 10) {
      void finishPath(true);
      return;
    }
    if (event.detail >= 2 && penPoints.length >= 2) {
      void finishPath();
      return;
    }
    const point: DesignPathPoint = { ...position, inX: null, inY: null, outX: null, outY: null, mode: 'corner' };
    penPoints = [...penPoints, point];
    draftElement = draftPath(penPoints, false, penContinuation?.original ?? null);
    const pointerId = event.pointerId;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const current = pagePoint(moveEvent);
      const dx = current.x - position.x;
      const dy = current.y - position.y;
      if (Math.hypot(dx, dy) < Math.max(2, 3 / zoom)) return;
      penPoints = penPoints.map((candidate, index) => index === penPoints.length - 1
        ? {
            ...candidate,
            inX: position.x - dx,
            inY: position.y - dy,
            outX: position.x + dx,
            outY: position.y + dy,
            mode: 'mirrored' as const,
          }
        : candidate);
      draftElement = draftPath(penPoints, false, penContinuation?.original ?? null);
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  async function finishPath(closed = false) {
    const continuation = penContinuation;
    const element = draftPath(penPoints, closed, continuation?.original ?? null);
    if (!element || penPoints.length < (closed ? 3 : 2)) return;
    draftElement = null;
    penPoints = [];
    penPointer = null;
    penContinuation = null;
    const saved = continuation
      ? await apply([{ kind: 'update', elementId: continuation.original.id, changes: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          pathPoints: element.pathPoints,
          pathSubpaths: [],
          pathClosed: closed,
        } }], m['design.operation_update']({ name: continuation.original.name }), {
          inverse: [{ kind: 'update', elementId: continuation.original.id, changes: {
            x: continuation.original.x,
            y: continuation.original.y,
            width: continuation.original.width,
            height: continuation.original.height,
            pathPoints: continuation.original.pathPoints,
            pathSubpaths: continuation.original.pathSubpaths,
            pathClosed: continuation.original.pathClosed,
          } }],
        })
      : await apply([{ kind: 'create', element }], m['design.operation_create']({ type: m['design.pen']() }), {
          inverse: [{ kind: 'delete', elementId: element.id }],
        });
    if (!saved) return;
    selectedIds = [element.id];
    vectorEditId = element.id;
    pathPointSelections = [{ elementId: element.id, subpathIndex: 0, pointIndex: element.pathPoints.length - 1 }];
    tool = 'select';
  }

  function beginPathContinuation(event: PointerEvent, element: DesignElement, atStart: boolean) {
    if (tool !== 'path' || element.type !== 'path' || element.locked || element.pathClosed || element.pathSubpaths.length || element.pathPoints.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const original = pathSnapshot(element);
    const source = original.pathPoints.map((point) => ({
      ...point,
      x: original.x + point.x,
      y: original.y + point.y,
      inX: point.inX === null ? null : original.x + point.inX,
      inY: point.inY === null ? null : original.y + point.inY,
      outX: point.outX === null ? null : original.x + point.outX,
      outY: point.outY === null ? null : original.y + point.outY,
    }));
    const points = atStart
      ? source.reverse().map((point) => ({ ...point, inX: point.outX, inY: point.outY, outX: point.inX, outY: point.inY }))
      : source;
    selectedIds = [element.id];
    vectorEditId = element.id;
    pathPointSelections = [];
    penContinuation = { original, subpathIndex: 0 };
    penPoints = points;
    draftElement = draftPath(points, false, original);
  }

  function enterVectorEdit(element: DesignElement) {
    if (element.type !== 'path' || element.locked) return;
    selectedIds = [element.id];
    vectorEditId = element.id;
    pathPointSelections = [];
    tool = 'select';
  }

  function beginTextEditing(element: DesignElement) {
    if (element.type !== 'text' || element.locked) return;
    selectedIds = [element.id];
    vectorEditId = null;
    pathPointSelections = [];
    editingTextId = element.id;
    editingTextDraft = element.text || element.name;
    void tick().then(() => {
      textEditor?.focus();
      textEditor?.select();
    });
  }

  async function finishTextEditing(save = true) {
    const element = pageElements.find((candidate) => candidate.id === editingTextId);
    const value = editingTextDraft;
    editingTextId = null;
    if (!save || !element || element.type !== 'text') return;
    const height = Math.max(element.height, Math.ceil(designTextHeight(value, element.width, element.fontSize, element.fontWeight)));
    if (value === element.text && height === element.height) return;
    await updateElement(element, { text: value, height });
  }

  function canvasDoubleClick(event: MouseEvent) {
    const target = (event.target as SVGElement).closest<SVGGElement>('[data-design-element]');
    const element = target ? pageElements.find((candidate) => candidate.id === target.dataset.designElement) : null;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    if (element.type === 'path') enterVectorEdit(element);
    else if (element.type === 'text') beginTextEditing(element);
  }

  function selectForPointer(element: DesignElement, event: PointerEvent): string[] {
    if (vectorEditId !== element.id) {
      vectorEditId = null;
      pathPointSelections = [];
    }
    if (event.shiftKey) {
      selectedIds = selectedIds.includes(element.id)
        ? selectedIds.filter((id) => id !== element.id)
        : [...selectedIds, element.id];
      return selectedIds;
    }
    if (!selectedIds.includes(element.id)) selectedIds = [element.id];
    return selectedIds;
  }

  function canvasPointerDown(event: PointerEvent) {
    if (!page || event.button !== 0) return;
    const guideTarget = (event.target as SVGElement).closest<SVGLineElement>('[data-design-guide]');
    if (guideTarget) {
      startGuideDrag(event, guideTarget.dataset.designGuide!);
      return;
    }
    if (tool === 'path') {
      startPenPoint(event);
      return;
    }
    if (tool === 'select') {
      const target = (event.target as SVGElement).closest<SVGGElement>('[data-design-element]');
      const hit = target ? pageElements.find((item) => item.id === target.dataset.designElement) : null;
      const element = hit ? selectableElement(hit, event.altKey) : null;
      if (!element) {
        startSelectionMarquee(event, vectorEditing ? 'points' : 'layers');
        return;
      }
      const dragIds = selectForPointer(element, event);
      if (!event.shiftKey && dragIds.includes(element.id)) startDrag(event, dragIds);
      return;
    }
    if (tool === 'hand') return;
    startCreate(event, tool, event.currentTarget as SVGSVGElement);
  }

  function selectableElement(element: DesignElement, deep: boolean): DesignElement {
    if (deep) return element;
    let current = element;
    while (current.parentId) {
      const parent = pageElements.find((candidate) => candidate.id === current.parentId);
      if (!parent || parent.type !== 'group') break;
      current = parent;
    }
    return current;
  }

  function startSelectionMarquee(event: PointerEvent, kind: 'layers' | 'points') {
    if (!document || event.button !== 0) return;
    event.preventDefault();
    const start = pagePoint(event);
    const pointerId = event.pointerId;
    const initialIds = [...selectedIds];
    const initialPoints = [...pathPointSelections];
    let dragged = false;
    selectionMarquee = { start, current: start };
    selectionMarqueeKind = kind;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const current = pagePoint(moveEvent);
      if (!dragged && Math.hypot(current.x - start.x, current.y - start.y) * zoom >= 3) dragged = true;
      selectionMarquee = { start, current };
      const left = Math.min(start.x, current.x);
      const right = Math.max(start.x, current.x);
      const top = Math.min(start.y, current.y);
      const bottom = Math.max(start.y, current.y);
      if (kind === 'layers') {
        const found = pageElements.filter((element) => element.visible && !element.locked
          && element.x <= right && element.x + element.width >= left
          && element.y <= bottom && element.y + element.height >= top).map((element) => element.id);
        selectedIds = moveEvent.shiftKey ? [...new Set([...initialIds, ...found])] : found;
      } else if (selected?.type === 'path') {
        const found = pathSubpaths(selected).flatMap((points, subpathIndex) => points.flatMap((point, pointIndex) => {
          const { x, y } = rotatePoint({ x: selected.x + point.x, y: selected.y + point.y }, selected);
          return x >= left && x <= right && y >= top && y <= bottom
            ? [{ elementId: selected.id, subpathIndex, pointIndex }]
            : [];
        }));
        pathPointSelections = moveEvent.shiftKey
          ? [...initialPoints, ...found.filter((candidate) => !initialPoints.some((currentSelection) => samePathPoint(currentSelection, candidate)))]
          : found;
      }
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      selectionMarquee = null;
      selectionMarqueeKind = null;
      if (dragged || upEvent.shiftKey) return;
      if (kind === 'points') pathPointSelections = [];
      else {
        selectedIds = [];
        vectorEditId = null;
        pathPointSelections = [];
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function snappedPosition(element: DesignElement, x: number, y: number, excluded: Set<string>) {
    if (!snapEnabled) return { x, y, linesX: [] as number[], linesY: [] as number[] };
    const threshold = Math.max(2, 7 / zoom);
    const xAnchors = [0, element.width / 2, element.width];
    const yAnchors = [0, element.height / 2, element.height];
    const targetX = document?.guides.filter((guide) => guide.axis === 'x').map((guide) => guide.position) ?? [];
    const targetY = document?.guides.filter((guide) => guide.axis === 'y').map((guide) => guide.position) ?? [];
    for (const other of pageElements) {
      if (excluded.has(other.id) || !other.visible) continue;
      targetX.push(other.x, other.x + other.width / 2, other.x + other.width);
      targetY.push(other.y, other.y + other.height / 2, other.y + other.height);
    }
    let bestX = { difference: threshold + 1, value: x, line: null as number | null };
    let bestY = { difference: threshold + 1, value: y, line: null as number | null };
    for (const anchor of xAnchors) for (const target of targetX) {
      const difference = Math.abs(x + anchor - target);
      if (difference < bestX.difference) bestX = { difference, value: target - anchor, line: target };
    }
    for (const anchor of yAnchors) for (const target of targetY) {
      const difference = Math.abs(y + anchor - target);
      if (difference < bestY.difference) bestY = { difference, value: target - anchor, line: target };
    }
    return {
      x: bestX.difference <= threshold ? bestX.value : x,
      y: bestY.difference <= threshold ? bestY.value : y,
      linesX: bestX.difference <= threshold && bestX.line !== null ? [bestX.line] : [],
      linesY: bestY.difference <= threshold && bestY.line !== null ? [bestY.line] : [],
    };
  }

  function startDrag(event: PointerEvent, ids: string[]) {
    if (!document || tool !== 'select') return;
    const movingIds = descendantIds(ids);
    const moving = document.elements
      .filter((element) => movingIds.has(element.id) && !element.locked)
      .sort((left, right) => Number(!ids.includes(left.id)) - Number(!ids.includes(right.id)));
    if (!moving.length) return;
    event.preventDefault();
    const start = new Map(moving.map((element) => [element.id, { x: element.x, y: element.y }]));
    const anchor = moving[0];
    const excluded = new Set(moving.map((element) => element.id));
    const origin = { clientX: event.clientX, clientY: event.clientY };
    const move = (moveEvent: PointerEvent) => {
      if (!document) return;
      const deltaX = (moveEvent.clientX - origin.clientX) / zoom;
      const deltaY = (moveEvent.clientY - origin.clientY) / zoom;
      const snapped = snappedPosition(anchor, Math.round(start.get(anchor.id)!.x + deltaX), Math.round(start.get(anchor.id)!.y + deltaY), excluded);
      const snappedDeltaX = snapped.x - start.get(anchor.id)!.x;
      const snappedDeltaY = snapped.y - start.get(anchor.id)!.y;
      snapLinesX = snapped.linesX;
      snapLinesY = snapped.linesY;
      document = {
        ...document,
        elements: document.elements.map((item) => {
          const initial = start.get(item.id);
          return initial ? { ...item, x: Math.round(initial.x + snappedDeltaX), y: Math.round(initial.y + snappedDeltaY) } : item;
        }),
      };
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      snapLinesX = [];
      snapLinesY = [];
      const operations: DesignOperation[] = [];
      const inverse: DesignOperation[] = [];
      for (const element of moving) {
        const moved = document?.elements.find((item) => item.id === element.id);
        const initial = start.get(element.id)!;
        if (!moved || (moved.x === initial.x && moved.y === initial.y)) continue;
        operations.push({ kind: 'update', elementId: element.id, changes: { x: moved.x, y: moved.y } });
        inverse.push({ kind: 'update', elementId: element.id, changes: initial });
      }
      await apply(operations, m['design.operation_move']({ name: moving.length === 1 ? moving[0].name : String(moving.length) }), { inverse });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  function scaledGroupChildChanges(child: DesignElement, original: DesignElement, next: DesignElement): Partial<DesignElement> {
    const scaleX = next.width / original.width;
    const scaleY = next.height / original.height;
    const changes: Partial<DesignElement> = {
      x: next.x + (child.x - original.x) * scaleX,
      y: next.y + (child.y - original.y) * scaleY,
      width: Math.max(1, child.width * scaleX),
      height: Math.max(1, child.height * scaleY),
    };
    if (child.type === 'path') {
      const scaled = scaleDesignPathSubpaths(pathSubpaths(child), scaleX, scaleY);
      if (child.pathSubpaths.length) changes.pathSubpaths = scaled;
      else changes.pathPoints = scaled[0] ?? [];
    }
    if (child.type === 'text') changes.fontSize = Math.max(4, child.fontSize * Math.min(scaleX, scaleY));
    changes.strokeWidth = child.strokeWidth * Math.min(scaleX, scaleY);
    return changes;
  }

  function resizedElement(original: DesignElement, handle: ResizeHandle, point: { x: number; y: number }, shiftKey: boolean, altKey: boolean): DesignElement {
    const leftHandle = handle.includes('w');
    const rightHandle = handle.includes('e');
    const topHandle = handle.includes('n');
    const bottomHandle = handle.includes('s');
    const centerX = original.x + original.width / 2;
    const centerY = original.y + original.height / 2;
    let left = leftHandle ? point.x : original.x;
    let right = rightHandle ? point.x : original.x + original.width;
    let top = topHandle ? point.y : original.y;
    let bottom = bottomHandle ? point.y : original.y + original.height;
    if (altKey) {
      if (leftHandle || rightHandle) {
        const half = Math.abs(point.x - centerX);
        left = centerX - half;
        right = centerX + half;
      }
      if (topHandle || bottomHandle) {
        const half = Math.abs(point.y - centerY);
        top = centerY - half;
        bottom = centerY + half;
      }
    }
    if (left > right) [left, right] = [right, left];
    if (top > bottom) [top, bottom] = [bottom, top];
    let width = Math.max(1, right - left);
    let height = Math.max(1, bottom - top);
    if (shiftKey && (leftHandle || rightHandle) && (topHandle || bottomHandle)) {
      const ratio = original.width / original.height;
      if (width / height > ratio) height = width / ratio;
      else width = height * ratio;
      if (altKey) {
        left = centerX - width / 2;
        top = centerY - height / 2;
      } else {
        if (leftHandle) left = original.x + original.width - width;
        if (topHandle) top = original.y + original.height - height;
      }
    }
    const scaleX = width / original.width;
    const scaleY = height / original.height;
    const scaled = original.type === 'path' ? scaleDesignPathSubpaths(pathSubpaths(original), scaleX, scaleY) : null;
    return {
      ...original,
      x: Math.round(left),
      y: Math.round(top),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      ...(scaled ? original.pathSubpaths.length ? { pathSubpaths: scaled } : { pathPoints: scaled[0] ?? [] } : {}),
    };
  }

  function unrotatePoint(point: { x: number; y: number }, element: DesignElement): { x: number; y: number } {
    if (!element.rotation) return point;
    const radians = -element.rotation * Math.PI / 180;
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return {
      x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  }

  function rotatePoint(point: { x: number; y: number }, element: DesignElement): { x: number; y: number } {
    if (!element.rotation) return point;
    const radians = element.rotation * Math.PI / 180;
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return {
      x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  }

  function resizeHandlePosition(element: Pick<DesignElement, 'x' | 'y' | 'width' | 'height'>, handle: ResizeHandle): { x: number; y: number } {
    return {
      x: handle.includes('w') ? element.x : handle.includes('e') ? element.x + element.width : element.x + element.width / 2,
      y: handle.includes('n') ? element.y : handle.includes('s') ? element.y + element.height : element.y + element.height / 2,
    };
  }

  function resizeCursor(handle: ResizeHandle): string {
    if (handle === 'n' || handle === 's') return 'ns-resize';
    if (handle === 'e' || handle === 'w') return 'ew-resize';
    if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
    return 'nwse-resize';
  }

  function penPreviewData(): string {
    const from = penPoints.at(-1);
    if (!from || !penPointer) return '';
    const to: DesignPathPoint = { ...penPointer, inX: null, inY: null, outX: null, outY: null, mode: 'corner' };
    return `M ${from.x} ${from.y} ${designPathSegmentData(from, to)}`;
  }

  function startResize(event: PointerEvent, handle: ResizeHandle) {
    if (!selected || selected.locked || !document) return;
    event.preventDefault();
    event.stopPropagation();
    const original = pathSnapshot(selected);
    const childSnapshots = selected.type === 'frame'
      ? pageElements.filter((element) => element.parentId === selected.id).map(pathSnapshot)
      : selected.type === 'group'
        ? pageElements.filter((element) => element.id !== selected.id && descendantIds([selected.id]).has(element.id)).map(pathSnapshot)
        : [];
    const pointerId = event.pointerId;
    let next = original;
    let changed = false;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || !document) return;
      next = resizedElement(original, handle, unrotatePoint(pagePoint(moveEvent), original), moveEvent.shiftKey, moveEvent.altKey);
      changed = next.x !== original.x || next.y !== original.y || next.width !== original.width || next.height !== original.height;
      const childChanges = new Map(childSnapshots.map((child) => [child.id, selected.type === 'group'
        ? scaledGroupChildChanges(child, original, next)
        : constrainedChildChanges(child, original, next)]));
      document = {
        ...document,
        elements: document.elements.map((element) => {
          if (element.id === original.id) return next;
          const changes = childChanges.get(element.id);
          return changes ? { ...element, ...changes } : element;
        }),
      };
    };
    const up = async (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!changed) return;
      const changes: Partial<DesignElement> = { x: next.x, y: next.y, width: next.width, height: next.height };
      if (original.type === 'path') {
        if (original.pathSubpaths.length) changes.pathSubpaths = next.pathSubpaths;
        else changes.pathPoints = next.pathPoints;
      }
      const operations: DesignOperation[] = [{ kind: 'update', elementId: original.id, changes }];
      const inverse: DesignOperation[] = [{ kind: 'update', elementId: original.id, changes: {
        x: original.x,
        y: original.y,
        width: original.width,
        height: original.height,
        ...(original.pathSubpaths.length ? { pathSubpaths: original.pathSubpaths } : original.type === 'path' ? { pathPoints: original.pathPoints } : {}),
      } }];
      for (const child of childSnapshots) {
        const childChanges = selected.type === 'group'
          ? scaledGroupChildChanges(child, original, next)
          : constrainedChildChanges(child, original, next);
        operations.push({ kind: 'update', elementId: child.id, changes: childChanges });
        inverse.push({ kind: 'update', elementId: child.id, changes: Object.fromEntries(Object.keys(childChanges).map((key) => [key, child[key as keyof DesignElement]])) as Partial<DesignElement> });
      }
      await apply(operations, m['design.operation_resize']({ name: original.name }), { inverse });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  async function updateSelected(changes: Partial<DesignElement>, summary = selected?.name ?? '') {
    if (!selected) return;
    let resolvedChanges = { ...changes };
    if (selected.type === 'path' && ('width' in changes || 'height' in changes)) {
      const scaleX = Math.max(1, changes.width ?? selected.width) / selected.width;
      const scaleY = Math.max(1, changes.height ?? selected.height) / selected.height;
      const scaled = scaleDesignPathSubpaths(pathSubpaths(selected), scaleX, scaleY);
      resolvedChanges = {
        ...resolvedChanges,
        ...(selected.pathSubpaths.length ? { pathSubpaths: scaled } : { pathPoints: scaled[0] ?? [] }),
      };
    }
    const inverseChanges = Object.fromEntries(Object.keys(resolvedChanges).map((key) => [key, selected[key as keyof DesignElement]])) as Partial<DesignElement>;
    const operations: DesignOperation[] = [{ kind: 'update', elementId: selected.id, changes: resolvedChanges }];
    const inverse: DesignOperation[] = [{ kind: 'update', elementId: selected.id, changes: inverseChanges }];
    if ((selected.type === 'frame' || selected.type === 'group') && ['x', 'y', 'width', 'height'].some((key) => key in resolvedChanges)) {
      const nextFrame = { ...selected, ...resolvedChanges };
      const children = selected.type === 'group'
        ? pageElements.filter((element) => element.id !== selected.id && descendantIds([selected.id]).has(element.id))
        : pageElements.filter((element) => element.parentId === selected.id);
      for (const child of children) {
        const childChanges = selected.type === 'group'
          ? scaledGroupChildChanges(child, selected, nextFrame)
          : constrainedChildChanges(child, selected, nextFrame);
        operations.push({ kind: 'update', elementId: child.id, changes: childChanges });
        inverse.push({
          kind: 'update',
          elementId: child.id,
          changes: Object.fromEntries(Object.keys(childChanges).map((key) => [key, child[key as keyof DesignElement]])) as Partial<DesignElement>,
        });
      }
    }
    await apply(operations, m['design.operation_update']({ name: summary }), { inverse });
  }

  async function bindSelectedVariable(property: DesignBindableProperty, variableId: string | null) {
    if (!selected) return;
    const previous = selected.variableBindings[property] ?? null;
    if (previous === variableId) return;
    await apply(
      [{ kind: 'bind-variable', elementId: selected.id, property, variableId }],
      m['design.operation_bind_variable']({ property }),
      { inverse: [{ kind: 'bind-variable', elementId: selected.id, property, variableId: previous }] },
    );
  }

  async function updateElement(element: DesignElement, changes: Partial<DesignElement>) {
    selectedIds = [element.id];
    const inverse = Object.fromEntries(Object.keys(changes).map((key) => [key, element[key as keyof DesignElement]])) as Partial<DesignElement>;
    await apply([{ kind: 'update', elementId: element.id, changes }], m['design.operation_update']({ name: element.name }), {
      inverse: [{ kind: 'update', elementId: element.id, changes: inverse }],
    });
  }

  function selectLayer(elementId: string, additive: boolean): void {
    vectorEditId = null;
    pathPointSelections = [];
    if (additive) selectedIds = selectedIds.includes(elementId)
      ? selectedIds.filter((id) => id !== elementId)
      : [...selectedIds, elementId];
    else selectedIds = [elementId];
  }

  async function activatePage(pageId: string): Promise<void> {
    if (!document || pageId === document.activePageId) return;
    const previousPageId = document.activePageId;
    if (await apply([{ kind: 'set-active-page', pageId }], m['design.operation_activate_page'](), {
      inverse: [{ kind: 'set-active-page', pageId: previousPageId }],
    })) {
      selectedIds = [];
      vectorEditId = null;
      pathPointSelections = [];
      await tick();
      await fitPage();
    }
  }

  async function createPage(): Promise<void> {
    if (!document || document.pages.length >= 100) return;
    const id = uuidv7();
    const nextNumber = document.pages.length + 1;
    if (await apply([{
      kind: 'create-page',
      page: { id, name: m['design.default_page_name']({ number: String(nextNumber) }), width: 1440, height: 1024, background: '#f5f5f3' },
    }], m['design.operation_create_page'](), { inverse: [{ kind: 'delete-page', pageId: id }] })) {
      selectedIds = [];
      await tick();
      await fitPage();
    }
  }

  async function renamePage(item: DesignPage, name: string): Promise<void> {
    await apply([{ kind: 'update-page', pageId: item.id, changes: { name } }], m['design.operation_rename_page']({ name }), {
      inverse: [{ kind: 'update-page', pageId: item.id, changes: { name: item.name } }],
    });
  }

  async function duplicatePage(item: DesignPage): Promise<void> {
    const duplicateId = uuidv7();
    if (await apply([{
      kind: 'duplicate-page',
      pageId: item.id,
      duplicateId,
      name: m['design.copy_name']({ name: item.name }),
    }], m['design.operation_duplicate_page']({ name: item.name }), { inverse: [{ kind: 'delete-page', pageId: duplicateId }] })) {
      selectedIds = [];
      await tick();
      await fitPage();
    }
  }

  async function deletePage(item: DesignPage): Promise<void> {
    if (!document || document.pages.length <= 1) return;
    const inverse = pageDeleteInverseOperations(document, item.id);
    if (await apply([{ kind: 'delete-page', pageId: item.id }], m['design.operation_delete_page']({ name: item.name }), { inverse })) {
      selectedIds = [];
      await tick();
      await fitPage();
    }
  }

  async function reorderPages(sourceId: string, targetId: string, placement: 'before' | 'after'): Promise<void> {
    if (!document || sourceId === targetId) return;
    const ordered = [...document.pages].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const source = ordered.find((item) => item.id === sourceId);
    const targetIndex = ordered.filter((item) => item.id !== sourceId).findIndex((item) => item.id === targetId);
    if (!source || targetIndex < 0) return;
    const next = ordered.filter((item) => item.id !== sourceId);
    next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, source);
    const forward = next.map((item, order) => ({ kind: 'reorder-page' as const, pageId: item.id, order }));
    const inverse = ordered.map((item) => ({ kind: 'reorder-page' as const, pageId: item.id, order: item.order }));
    await apply(forward, m['design.operation_reorder_page'](), { inverse });
  }

  function copyLayers(elementId?: string): void {
    if (!document) return;
    const ids = elementId && !selectedIds.includes(elementId) ? [elementId] : selectedIds;
    const count = copyDesignLayers(document.id, pageElements, ids);
    if (!count) return;
    clipboardVersion += 1;
    toast.success(m['design.layers_copied']({ count: String(count) }));
  }

  async function pasteLayers(offset = 24): Promise<void> {
    if (!document || !page) return;
    const pasted = pasteDesignLayerOperations(document.id, page.id, pageElements, uuidv7, offset);
    if (!pasted.operations.length) return;
    const inverse = pasted.selectedIds.map((elementId) => ({ kind: 'delete' as const, elementId }));
    if (await apply(pasted.operations, m['design.operation_paste_layers']({ count: String(pasted.selectedIds.length) }), { inverse })) {
      selectedIds = pasted.selectedIds;
      vectorEditId = null;
      pathPointSelections = [];
    }
  }

  async function duplicateLayers(elementId?: string): Promise<void> {
    if (elementId && !selectedIds.includes(elementId)) selectedIds = [elementId];
    copyLayers(elementId);
    await pasteLayers(24);
  }

  async function cutLayers(): Promise<void> {
    copyLayers();
    await removeSelected();
  }

  async function deleteLayer(elementId?: string): Promise<void> {
    if (elementId && !selectedIds.includes(elementId)) selectedIds = [elementId];
    await removeSelected();
  }

  async function moveLayer(elementId: string, direction: -1 | 1): Promise<void> {
    const element = pageElements.find((candidate) => candidate.id === elementId);
    if (!element) return;
    const siblings = pageElements.filter((candidate) => candidate.parentId === element.parentId).sort((left, right) => left.order - right.order);
    const index = siblings.findIndex((candidate) => candidate.id === elementId);
    const other = siblings[index + direction];
    if (!other) return;
    await apply([
      { kind: 'reorder', elementId, order: other.order },
      { kind: 'reorder', elementId: other.id, order: element.order },
    ], m['design.operation_reorder_layers'](), {
      inverse: [
        { kind: 'reorder', elementId, order: element.order },
        { kind: 'reorder', elementId: other.id, order: other.order },
      ],
    });
  }

  async function dropLayers(elementIds: string[], targetId: string | null, placement: 'before' | 'inside' | 'after'): Promise<void> {
    const roots = elementIds.map((id) => pageElements.find((element) => element.id === id)).filter((element): element is DesignElement => Boolean(element));
    const target = targetId ? pageElements.find((element) => element.id === targetId) ?? null : null;
    if (!roots.length || (target && roots.some((root) => descendantIds([root.id]).has(target.id)))) return;
    const parentId = placement === 'inside' ? target?.id ?? null : target?.parentId ?? null;
    if (placement === 'inside' && target && target.type !== 'frame' && target.type !== 'group') return;
    const siblings = pageElements
      .filter((element) => element.parentId === parentId && !roots.some((root) => root.id === element.id))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    let index = siblings.length;
    if (target && placement !== 'inside') {
      const targetIndex = siblings.findIndex((element) => element.id === target.id);
      if (targetIndex >= 0) index = targetIndex + (placement === 'after' ? 1 : 0);
    }
    const next = [...siblings];
    next.splice(index, 0, ...roots);
    const forward: DesignOperation[] = next.flatMap((element, order) => roots.some((root) => root.id === element.id)
      ? [{ kind: 'reparent' as const, elementId: element.id, parentId, order }]
      : element.order === order ? [] : [{ kind: 'reorder' as const, elementId: element.id, order }]);
    const inverse = roots.map((element) => ({ kind: 'reparent' as const, elementId: element.id, parentId: element.parentId, order: element.order }));
    if (await apply(forward, m['design.operation_reparent_layers']({ count: String(roots.length) }), { inverse })) selectedIds = roots.map((element) => element.id);
  }

  async function removeSelected() {
    const selectedSet = new Set(selectedIds);
    const targets = selectedElements.filter((element) => !element.locked && !ancestorSelected(element, selectedSet));
    if (!targets.length) return;
    const removedIds = new Set<string>();
    for (const target of targets) {
      removedIds.add(target.id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const element of pageElements) if (element.parentId && removedIds.has(element.parentId) && !removedIds.has(element.id)) {
          removedIds.add(element.id);
          changed = true;
        }
      }
    }
    const snapshots = pageElements.filter((element) => removedIds.has(element.id)).sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) || a.order - b.order);
    if (await apply(targets.map((element) => ({ kind: 'delete', elementId: element.id })), m['design.operation_delete']({ name: targets.length === 1 ? targets[0].name : String(targets.length) }), {
      inverse: snapshots.map((element) => ({ kind: 'create', element })),
    })) {
      selectedIds = [];
      vectorEditId = null;
      pathPointSelections = [];
    }
  }

  function ancestorSelected(element: DesignElement, ids: Set<string>): boolean {
    let parentId = element.parentId;
    while (parentId) {
      if (ids.has(parentId)) return true;
      parentId = pageElements.find((item) => item.id === parentId)?.parentId ?? null;
    }
    return false;
  }

  function descendantIds(ids: Iterable<string>): Set<string> {
    const descendants = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const element of pageElements) {
        if (element.parentId && descendants.has(element.parentId) && !descendants.has(element.id)) {
          descendants.add(element.id);
          changed = true;
        }
      }
    }
    return descendants;
  }

  async function groupSelection() {
    if (!page) return;
    const selectedSet = new Set(selectedIds);
    const targets = selectedElements.filter((element) => !element.locked && !ancestorSelected(element, selectedSet));
    if (targets.length < 2) return;
    const left = Math.min(...targets.map((element) => element.x));
    const top = Math.min(...targets.map((element) => element.y));
    const right = Math.max(...targets.map((element) => element.x + element.width));
    const bottom = Math.max(...targets.map((element) => element.y + element.height));
    const commonParent = targets.every((element) => element.parentId === targets[0].parentId) ? targets[0].parentId : null;
    const group = {
      ...elementDefaults('group', left, top),
      parentId: commonParent,
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      order: Math.min(...targets.map((element) => element.order)),
    };
    const operations: DesignOperation[] = [
      { kind: 'create', element: group },
      ...targets.map((element, index) => ({ kind: 'reparent' as const, elementId: element.id, parentId: group.id, order: index })),
    ];
    const inverse: DesignOperation[] = [
      ...targets.map((element) => ({ kind: 'reparent' as const, elementId: element.id, parentId: element.parentId, order: element.order })),
      { kind: 'delete', elementId: group.id },
    ];
    if (await apply(operations, m['design.operation_group']({ count: String(targets.length) }), { inverse })) selectedIds = [group.id];
  }

  async function ungroupSelection() {
    const groups = selectedElements.filter((element) => element.type === 'group' && !element.locked);
    if (!groups.length) return;
    const operations: DesignOperation[] = [];
    const inverse: DesignOperation[] = [];
    const nextSelection: string[] = [];
    for (const group of groups) {
      const children = pageElements.filter((element) => element.parentId === group.id).sort((left, right) => left.order - right.order);
      for (const child of children) {
        operations.push({ kind: 'reparent', elementId: child.id, parentId: group.parentId, order: group.order + child.order });
        nextSelection.push(child.id);
      }
      operations.push({ kind: 'delete', elementId: group.id });
      inverse.unshift({ kind: 'create', element: group });
      inverse.push(...children.map((child) => ({ kind: 'reparent' as const, elementId: child.id, parentId: group.id, order: child.order })));
    }
    if (await apply(operations, m['design.operation_ungroup']({ count: String(groups.length) }), { inverse })) selectedIds = nextSelection;
  }

  async function reorder(direction: -1 | 1) {
    if (!selected) return;
    const siblings = pageElements.filter((element) => element.parentId === selected.parentId).sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((element) => element.id === selected.id);
    const other = siblings[index + direction];
    if (!other) return;
    await apply([
      { kind: 'reorder', elementId: selected.id, order: other.order },
      { kind: 'reorder', elementId: other.id, order: selected.order },
    ], m['design.operation_update']({ name: selected.name }), {
      inverse: [
        { kind: 'reorder', elementId: selected.id, order: selected.order },
        { kind: 'reorder', elementId: other.id, order: other.order },
      ],
    });
  }

  async function alignSelection(mode: AlignMode) {
    const elements = selectedElements.filter((element) => !element.locked);
    if (elements.length < 2) return;
    const left = Math.min(...elements.map((element) => element.x));
    const right = Math.max(...elements.map((element) => element.x + element.width));
    const top = Math.min(...elements.map((element) => element.y));
    const bottom = Math.max(...elements.map((element) => element.y + element.height));
    const changes = new Map<string, Partial<DesignElement>>();
    if (mode === 'distribute-x' && elements.length >= 3) {
      const ordered = [...elements].sort((a, b) => a.x - b.x);
      const totalWidth = ordered.reduce((total, element) => total + element.width, 0);
      const gap = (right - left - totalWidth) / (ordered.length - 1);
      let x = left;
      for (const element of ordered) {
        changes.set(element.id, { x });
        x += element.width + gap;
      }
    } else if (mode === 'distribute-y' && elements.length >= 3) {
      const ordered = [...elements].sort((a, b) => a.y - b.y);
      const totalHeight = ordered.reduce((total, element) => total + element.height, 0);
      const gap = (bottom - top - totalHeight) / (ordered.length - 1);
      let y = top;
      for (const element of ordered) {
        changes.set(element.id, { y });
        y += element.height + gap;
      }
    } else for (const element of elements) {
      if (mode === 'left') changes.set(element.id, { x: left });
      else if (mode === 'hcenter') changes.set(element.id, { x: left + (right - left - element.width) / 2 });
      else if (mode === 'right') changes.set(element.id, { x: right - element.width });
      else if (mode === 'top') changes.set(element.id, { y: top });
      else if (mode === 'vcenter') changes.set(element.id, { y: top + (bottom - top - element.height) / 2 });
      else if (mode === 'bottom') changes.set(element.id, { y: bottom - element.height });
    }
    const operations: DesignOperation[] = [];
    const inverse: DesignOperation[] = [];
    for (const element of elements) {
      const elementChanges = changes.get(element.id);
      if (!elementChanges) continue;
      operations.push({ kind: 'update', elementId: element.id, changes: elementChanges });
      inverse.push({ kind: 'update', elementId: element.id, changes: Object.fromEntries(Object.keys(elementChanges).map((key) => [key, element[key as keyof DesignElement]])) as Partial<DesignElement> });
    }
    await apply(operations, m['design.operation_align']({ count: String(elements.length) }), { inverse });
  }

  type PaintRole = 'fill' | 'stroke';

  function paintCollection(element: DesignElement, role: PaintRole): DesignPaint[] {
    return role === 'fill' ? element.fills : element.strokes;
  }

  function legacyPaint(element: DesignElement, role: PaintRole): string {
    return role === 'fill' ? element.fill : element.stroke;
  }

  function normalizedHex(color: string): string {
    return color.trim().toLowerCase();
  }

  function paintContainsColor(paint: DesignPaint, color: string): boolean {
    const target = normalizedHex(color);
    if (paint.type === 'solid') return normalizedHex(paint.color) === target;
    return paint.stops.some((stop) => normalizedHex(stop.color) === target);
  }

  function elementContainsColor(element: DesignElement, role: PaintRole, color: string): boolean {
    const paints = paintCollection(element, role);
    if (paints.some((paint) => paintContainsColor(paint, color))) return true;
    return !paints.length && legacyPaint(element, role) !== 'transparent' && normalizedHex(legacyPaint(element, role)) === normalizedHex(color);
  }

  function primaryColor(element: DesignElement | null | undefined, role: PaintRole): string | null {
    if (!element) return null;
    for (const paint of paintCollection(element, role)) {
      if (paint.type === 'solid') return paint.color;
      if (paint.stops.length) return paint.stops[0].color;
    }
    const fallback = legacyPaint(element, role);
    return fallback === 'transparent' ? null : fallback;
  }

  function matchingColorLayers(role: PaintRole, color: string | null): Array<{ id: string; name: string }> {
    if (!color) return [];
    return pageElements.filter((element) => element.visible && elementContainsColor(element, role, color)).map(({ id, name }) => ({ id, name }));
  }

  function replacedPaint(paint: DesignPaint, from: string, to: string): DesignPaint {
    if (paint.type === 'solid') return normalizedHex(paint.color) === normalizedHex(from) ? { ...paint, color: to } : paint;
    return { ...paint, stops: paint.stops.map((stop) => normalizedHex(stop.color) === normalizedHex(from) ? { ...stop, color: to } : stop) };
  }

  async function applyColorToSelection(role: PaintRole, color: string) {
    const targets = selectedElements.filter((element) => !element.locked && element.type !== 'group' && (role !== 'fill' || element.type !== 'image'));
    if (!targets.length) return;
    const operations: DesignOperation[] = [];
    const inverse: DesignOperation[] = [];
    for (const element of targets) {
      const changes: Partial<DesignElement> = role === 'fill'
        ? { fills: [{ type: 'solid', color, opacity: 1, visible: true }], fill: 'transparent' }
        : { strokes: [{ type: 'solid', color, opacity: 1, visible: true }], stroke: 'transparent', strokeWidth: element.strokeWidth || 1 };
      operations.push({ kind: 'update', elementId: element.id, changes });
      inverse.push({ kind: 'update', elementId: element.id, changes: role === 'fill'
        ? { fills: element.fills, fill: element.fill }
        : { strokes: element.strokes, stroke: element.stroke, strokeWidth: element.strokeWidth } });
    }
    await apply(operations, m['design.operation_apply_color']({ count: String(targets.length) }), { inverse });
  }

  async function replaceMatchingColor(role: PaintRole, from: string, to: string) {
    const targets = pageElements.filter((element) => !element.locked && elementContainsColor(element, role, from));
    if (!targets.length) return;
    const operations: DesignOperation[] = [];
    const inverse: DesignOperation[] = [];
    for (const element of targets) {
      const currentPaints = paintCollection(element, role);
      const nextPaints = currentPaints.map((paint) => replacedPaint(paint, from, to));
      const currentLegacy = legacyPaint(element, role);
      const nextLegacy = !currentPaints.length && normalizedHex(currentLegacy) === normalizedHex(from) ? to : currentLegacy;
      const changes: Partial<DesignElement> = role === 'fill' ? { fills: nextPaints, fill: nextLegacy } : { strokes: nextPaints, stroke: nextLegacy };
      operations.push({ kind: 'update', elementId: element.id, changes });
      inverse.push({ kind: 'update', elementId: element.id, changes: role === 'fill'
        ? { fills: element.fills, fill: element.fill }
        : { strokes: element.strokes, stroke: element.stroke } });
    }
    await apply(operations, m['design.operation_replace_color']({ count: String(targets.length) }), { inverse });
  }

  function selectMatchingColor(role: PaintRole, color: string) {
    selectedIds = pageElements.filter((element) => element.visible && elementContainsColor(element, role, color)).map((element) => element.id);
    vectorEditId = null;
    pathPointSelections = [];
    colorMenuOpen = false;
  }

  async function combineSelection(operation: DesignBooleanOperation) {
    const elements = [...selectedElements].filter((element) => !element.locked).sort((a, b) => a.order - b.order);
    if (elements.length < 2) return;
    try {
      const result = combineDesignElements(elements, operation);
      const path = designElementSchema.parse({
        ...elementDefaults('path', result.x, result.y),
        id: uuidv7(),
        name: `${booleanLabel(operation)} ${elements.length}`,
        ...result,
        pathPoints: [],
        pathSubpaths: result.subpaths,
        pathClosed: true,
        fillRule: 'evenodd',
        fill: elements[0].fill === 'transparent' ? '#7c5cff' : elements[0].fill,
        fills: elements[0].fills,
        stroke: elements[0].stroke,
        strokes: elements[0].strokes,
        strokeWidth: elements[0].strokeWidth,
      });
      const forward: DesignOperation[] = [...elements.map((element) => ({ kind: 'delete', elementId: element.id } as DesignOperation)), { kind: 'create', element: path }];
      const inverse: DesignOperation[] = [{ kind: 'delete', elementId: path.id }, ...elements.map((element) => ({ kind: 'create', element } as DesignOperation))];
      if (await apply(forward, m['design.operation_combine']({ operation: booleanLabel(operation), count: String(elements.length) }), { inverse })) selectedIds = [path.id];
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['design.error_save']());
    }
  }

  function booleanLabel(operation: DesignBooleanOperation): string {
    if (operation === 'union') return m['design.union']();
    if (operation === 'subtract') return m['design.subtract']();
    if (operation === 'intersect') return m['design.intersect']();
    return m['design.exclude']();
  }

  async function createMask() {
    const elements = [...selectedElements].filter((element) => !element.locked).sort((a, b) => a.order - b.order);
    if (elements.length < 2) return;
    const mask = elements[0];
    const targets = elements.slice(1);
    const forward: DesignOperation[] = [
      { kind: 'update', elementId: mask.id, changes: { isMask: true } },
      ...targets.map((element) => ({ kind: 'update', elementId: element.id, changes: { maskId: mask.id } } as DesignOperation)),
    ];
    const inverse: DesignOperation[] = [
      { kind: 'update', elementId: mask.id, changes: { isMask: mask.isMask } },
      ...targets.map((element) => ({ kind: 'update', elementId: element.id, changes: { maskId: element.maskId } } as DesignOperation)),
    ];
    await apply(forward, m['design.operation_mask']({ count: String(elements.length) }), { inverse });
  }

  async function releaseMasks() {
    const targets = selectedElements.filter((element) => element.maskId);
    if (!targets.length) return;
    const maskIds = new Set(targets.map((element) => element.maskId!));
    const forward: DesignOperation[] = targets.map((element) => ({ kind: 'update', elementId: element.id, changes: { maskId: null } }));
    const inverse: DesignOperation[] = targets.map((element) => ({ kind: 'update', elementId: element.id, changes: { maskId: element.maskId } }));
    for (const maskId of maskIds) {
      const mask = pageElements.find((element) => element.id === maskId);
      if (!mask) continue;
      forward.push({ kind: 'update', elementId: mask.id, changes: { isMask: false } });
      inverse.push({ kind: 'update', elementId: mask.id, changes: { isMask: mask.isMask } });
    }
    await apply(forward, m['design.release_mask'](), { inverse });
  }

  async function applyAutoLayout() {
    const frame = selected?.type === 'frame' ? selected : selectedElements.find((element) => element.type === 'frame');
    if (!frame) return;
    const selectedChildren = selectedElements.filter((element) => element.id !== frame.id);
    const existingChildren = pageElements.filter((element) => element.parentId === frame.id);
    const children = selectedChildren.length ? selectedChildren : existingChildren;
    if (!children.length) return;
    const changes = autoLayoutChanges(frame, children);
    const forward: DesignOperation[] = [];
    const inverse: DesignOperation[] = [];
    children.forEach((child, index) => {
      if (child.parentId !== frame.id) {
        forward.push({ kind: 'reparent', elementId: child.id, parentId: frame.id, order: index });
        inverse.unshift({ kind: 'reparent', elementId: child.id, parentId: child.parentId, order: child.order });
      }
      const childChanges = changes.get(child.id);
      if (childChanges) {
        forward.push({ kind: 'update', elementId: child.id, changes: childChanges });
        inverse.unshift({ kind: 'update', elementId: child.id, changes: Object.fromEntries(Object.keys(childChanges).map((key) => [key, child[key as keyof DesignElement]])) as Partial<DesignElement> });
      }
    });
    await apply(forward, m['design.operation_layout']({ name: frame.name }), { inverse });
  }

  async function addGuide(axis: 'x' | 'y') {
    if (!page) return;
    const guide = { id: uuidv7(), axis, position: axis === 'x' ? page.width / 2 : page.height / 2 } as const;
    await apply([{ kind: 'add-guide', guide }], m['design.operation_guide'](), { inverse: [{ kind: 'delete-guide', guideId: guide.id }] });
  }

  async function removeGuide(guideId: string) {
    const guide = document?.guides.find((item) => item.id === guideId);
    if (!guide) return;
    await apply([{ kind: 'delete-guide', guideId }], m['design.operation_guide'](), { inverse: [{ kind: 'add-guide', guide }] });
  }

  function startGuideDrag(event: PointerEvent, guideId: string) {
    const guide = document?.guides.find((item) => item.id === guideId);
    if (!guide || !document) return;
    event.preventDefault();
    event.stopPropagation();
    const start = guide.position;
    const move = (moveEvent: PointerEvent) => {
      if (!document) return;
      const point = pagePoint(moveEvent);
      const position = guide.axis === 'x' ? point.x : point.y;
      document = { ...document, guides: document.guides.map((item) => item.id === guide.id ? { ...item, position } : item) };
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const current = document?.guides.find((item) => item.id === guide.id)?.position;
      if (current === undefined || current === start) return;
      await apply([{ kind: 'update-guide', guideId: guide.id, position: current }], m['design.operation_guide'](), {
        inverse: [{ kind: 'update-guide', guideId: guide.id, position: start }],
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  function pathSubpaths(element: DesignElement): DesignPathPoint[][] {
    return (element.pathSubpaths.length ? element.pathSubpaths : [element.pathPoints])
      .map((subpath) => subpath.map((point) => ({ ...point })));
  }

  function pathSnapshot(element: DesignElement): DesignElement {
    return {
      ...element,
      pathPoints: element.pathPoints.map((point) => ({ ...point })),
      pathSubpaths: element.pathSubpaths.map((subpath) => subpath.map((point) => ({ ...point }))),
    };
  }

  function normalizedPathChanges(element: DesignElement, subpaths: DesignPathPoint[][]): Partial<DesignElement> {
    const bounds = designPathBounds(subpaths, element.pathClosed);
    if (!bounds) return element.pathSubpaths.length ? { pathSubpaths: subpaths } : { pathPoints: subpaths[0] ?? [] };
    const minX = bounds.x;
    const minY = bounds.y;
    const normalized = subpaths.map((subpath) => subpath.map((point) => ({
      ...point,
      x: point.x - minX,
      y: point.y - minY,
      inX: point.inX === null ? null : point.inX - minX,
      inY: point.inY === null ? null : point.inY - minY,
      outX: point.outX === null ? null : point.outX - minX,
      outY: point.outY === null ? null : point.outY - minY,
    })));
    return {
      x: element.x + minX,
      y: element.y + minY,
      width: bounds.width,
      height: bounds.height,
      ...(element.pathSubpaths.length ? { pathSubpaths: normalized } : { pathPoints: normalized[0] ?? [] }),
    };
  }

  function setLivePath(elementId: string, subpaths: DesignPathPoint[][]) {
    if (!document) return;
    document = {
      ...document,
      elements: document.elements.map((element) => element.id === elementId
        ? { ...element, ...(element.pathSubpaths.length ? { pathSubpaths: subpaths } : { pathPoints: subpaths[0] ?? [] }) }
        : element),
    };
  }

  async function commitPathEdit(
    original: DesignElement,
    subpaths: DesignPathPoint[][],
    additionalChanges: Partial<DesignElement> = {},
  ): Promise<boolean> {
    const changes = { ...normalizedPathChanges(original, subpaths), ...additionalChanges };
    const inverse = Object.fromEntries(Object.keys(changes).map((key) => [key, original[key as keyof DesignElement]])) as Partial<DesignElement>;
    return apply([{ kind: 'update', elementId: original.id, changes }], m['design.operation_update']({ name: original.name }), {
      inverse: [{ kind: 'update', elementId: original.id, changes: inverse }],
    });
  }

  function samePathPoint(left: PathPointSelection, right: PathPointSelection): boolean {
    return left.elementId === right.elementId && left.subpathIndex === right.subpathIndex && left.pointIndex === right.pointIndex;
  }

  function isPathPointSelected(elementId: string, subpathIndex: number, pointIndex: number): boolean {
    return pathPointSelections.some((selection) => samePathPoint(selection, { elementId, subpathIndex, pointIndex }));
  }

  function selectPathPoint(event: PointerEvent, selection: PathPointSelection): boolean {
    const exists = pathPointSelections.some((candidate) => samePathPoint(candidate, selection));
    if (event.shiftKey && exists) {
      pathPointSelections = pathPointSelections.filter((candidate) => !samePathPoint(candidate, selection));
      return false;
    }
    if (event.shiftKey) pathPointSelections = [...pathPointSelections, selection];
    else if (!exists) pathPointSelections = [selection];
    return true;
  }

  function startPathPointDrag(event: PointerEvent, subpathIndex: number, index: number) {
    if (!selected || selected.type !== 'path' || selected.locked || !document) return;
    event.preventDefault();
    event.stopPropagation();
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    const source = subpaths[subpathIndex]?.[index];
    if (!source) return;
    const selection = { elementId: original.id, subpathIndex, pointIndex: index };
    if (!selectPathPoint(event, selection)) return;
    const movingSelections = pathPointSelections.filter((candidate) => candidate.elementId === original.id);
    const sources = new Map(movingSelections.map((candidate) => [
      `${candidate.subpathIndex}:${candidate.pointIndex}`,
      { ...subpaths[candidate.subpathIndex][candidate.pointIndex] },
    ]));
    const pointerId = event.pointerId;
    let changed = false;
    const origin = unrotatePoint(pagePoint(event), original);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const point = unrotatePoint(pagePoint(moveEvent), original);
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      if (!changed && Math.hypot(dx, dy) * zoom < 2) return;
      changed = true;
      for (const candidate of movingSelections) {
        const initial = sources.get(`${candidate.subpathIndex}:${candidate.pointIndex}`)!;
        subpaths[candidate.subpathIndex][candidate.pointIndex] = {
          ...initial,
          x: initial.x + dx,
          y: initial.y + dy,
          inX: initial.inX === null ? null : initial.inX + dx,
          inY: initial.inY === null ? null : initial.inY + dy,
          outX: initial.outX === null ? null : initial.outX + dx,
          outY: initial.outY === null ? null : initial.outY + dy,
        };
      }
      setLivePath(original.id, subpaths);
    };
    const up = async (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (changed) await commitPathEdit(original, subpaths);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startPathHandleDrag(event: PointerEvent, subpathIndex: number, index: number, handle: 'in' | 'out') {
    if (!selected || selected.type !== 'path' || selected.locked || !document) return;
    event.preventDefault();
    event.stopPropagation();
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    const source = subpaths[subpathIndex]?.[index];
    if (!source) return;
    const pointerId = event.pointerId;
    let changed = false;
    pathPointSelections = [{ elementId: original.id, subpathIndex, pointIndex: index }];
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      changed = true;
      const pagePosition = unrotatePoint(pagePoint(moveEvent), original);
      let x = pagePosition.x - original.x;
      let y = pagePosition.y - original.y;
      if (moveEvent.shiftKey) {
        const distance = Math.hypot(x - source.x, y - source.y);
        const angle = Math.round(Math.atan2(y - source.y, x - source.x) / (Math.PI / 4)) * (Math.PI / 4);
        x = source.x + Math.cos(angle) * distance;
        y = source.y + Math.sin(angle) * distance;
      }
      const next = { ...subpaths[subpathIndex][index], mode: moveEvent.altKey ? 'disconnected' as const : source.mode };
      if (handle === 'in') {
        next.inX = x;
        next.inY = y;
      } else {
        next.outX = x;
        next.outY = y;
      }
      if (!moveEvent.altKey && source.mode !== 'disconnected' && source.mode !== 'corner') {
        const opposite = handle === 'in' ? 'out' : 'in';
        const oppositeX = opposite === 'in' ? next.inX : next.outX;
        const oppositeY = opposite === 'in' ? next.inY : next.outY;
        const length = source.mode === 'mirrored'
          ? Math.hypot(x - source.x, y - source.y)
          : oppositeX === null || oppositeY === null
          ? Math.hypot(x - source.x, y - source.y)
          : Math.hypot(oppositeX - source.x, oppositeY - source.y);
        const magnitude = Math.hypot(x - source.x, y - source.y) || 1;
        const mirroredX = source.x - (x - source.x) / magnitude * length;
        const mirroredY = source.y - (y - source.y) / magnitude * length;
        if (opposite === 'in') {
          next.inX = mirroredX;
          next.inY = mirroredY;
        } else {
          next.outX = mirroredX;
          next.outY = mirroredY;
        }
      }
      subpaths[subpathIndex][index] = next;
      setLivePath(original.id, subpaths);
    };
    const up = async (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (changed) await commitPathEdit(original, subpaths);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function segmentAmount(event: PointerEvent | MouseEvent, element: DesignElement, points: DesignPathPoint[], segmentIndex: number): number {
    const position = unrotatePoint(pagePoint(event as PointerEvent), element);
    const local = { x: position.x - element.x, y: position.y - element.y };
    const from = points[segmentIndex];
    const to = points[(segmentIndex + 1) % points.length];
    let best = { amount: 0.5, distance: Number.POSITIVE_INFINITY };
    for (let step = 0; step <= 64; step += 1) {
      const amount = step / 64;
      const candidate = designPathSegmentPoint(from, to, amount);
      const distance = Math.hypot(candidate.x - local.x, candidate.y - local.y);
      if (distance < best.distance) best = { amount, distance };
    }
    return best.amount;
  }

  function startPathSegmentDrag(event: PointerEvent, subpathIndex: number, segmentIndex: number) {
    if (!selected || selected.type !== 'path' || selected.locked || !document) return;
    event.preventDefault();
    event.stopPropagation();
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    const source = subpaths[subpathIndex];
    if (!source?.length) return;
    const amount = segmentAmount(event, original, source, segmentIndex);
    const origin = unrotatePoint(pagePoint(event), original);
    const pointerId = event.pointerId;
    let changed = false;
    pathPointSelections = [
      { elementId: original.id, subpathIndex, pointIndex: segmentIndex },
      { elementId: original.id, subpathIndex, pointIndex: (segmentIndex + 1) % source.length },
    ];
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const current = unrotatePoint(pagePoint(moveEvent), original);
      const dx = current.x - origin.x;
      const dy = current.y - origin.y;
      if (!changed && Math.hypot(dx, dy) * zoom < 3) return;
      changed = true;
      subpaths[subpathIndex] = bendDesignPathSegment(source, segmentIndex, amount, dx, dy, original.pathClosed);
      setLivePath(original.id, subpaths);
    };
    const up = async (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (changed) await commitPathEdit(original, subpaths);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  async function insertPathPoint(event: MouseEvent, targetSubpathIndex?: number, targetSegmentIndex?: number) {
    if (!selected || selected.type !== 'path') return;
    event.preventDefault();
    event.stopPropagation();
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    const position = unrotatePoint(pagePoint(event as unknown as PointerEvent), original);
    const local = { x: position.x - original.x, y: position.y - original.y };
    let best: { subpathIndex: number; segmentIndex: number; amount: number; distance: number } | null = null;
    for (let subpathIndex = 0; subpathIndex < subpaths.length; subpathIndex += 1) {
      const subpath = subpaths[subpathIndex];
      const segmentCount = original.pathClosed ? subpath.length : Math.max(0, subpath.length - 1);
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        if (targetSubpathIndex !== undefined && (subpathIndex !== targetSubpathIndex || segmentIndex !== targetSegmentIndex)) continue;
        const from = subpath[segmentIndex];
        const to = subpath[(segmentIndex + 1) % subpath.length];
        for (let step = 0; step <= 32; step += 1) {
          const amount = step / 32;
          const candidate = designPathSegmentPoint(from, to, amount);
          const distance = Math.hypot(candidate.x - local.x, candidate.y - local.y);
          if (!best || distance < best.distance) best = { subpathIndex, segmentIndex, amount, distance };
        }
      }
    }
    if (!best) return;
    const oldLength = subpaths[best.subpathIndex].length;
    subpaths[best.subpathIndex] = splitDesignPathSegment(subpaths[best.subpathIndex], best.segmentIndex, best.amount, original.pathClosed);
    const pointIndex = best.segmentIndex === oldLength - 1 && original.pathClosed ? oldLength : best.segmentIndex + 1;
    if (await commitPathEdit(original, subpaths) && vectorEditId === original.id) pathPointSelections = [{ elementId: original.id, subpathIndex: best.subpathIndex, pointIndex }];
  }

  async function addPathPointAfterSelection() {
    const selection = primaryPathPointSelection;
    if (!selected || selected.type !== 'path' || !selection) return;
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    const subpath = subpaths[selection.subpathIndex];
    if (!subpath?.length) return;
    const segmentIndex = !original.pathClosed && selection.pointIndex >= subpath.length - 1
      ? Math.max(0, subpath.length - 2)
      : selection.pointIndex;
    const oldLength = subpath.length;
    subpaths[selection.subpathIndex] = splitDesignPathSegment(subpath, segmentIndex, 0.5, original.pathClosed);
    const pointIndex = segmentIndex === oldLength - 1 && original.pathClosed ? oldLength : segmentIndex + 1;
    if (await commitPathEdit(original, subpaths) && vectorEditId === original.id) pathPointSelections = [{ elementId: original.id, subpathIndex: selection.subpathIndex, pointIndex }];
  }

  async function setSelectedPathPointMode(mode: DesignPathPoint['mode']) {
    if (!selected || selected.type !== 'path' || !pathPointSelections.length) return;
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    for (const selection of pathPointSelections.filter((candidate) => candidate.elementId === original.id)) {
      const points = subpaths[selection.subpathIndex];
      if (!points?.[selection.pointIndex]) continue;
      subpaths[selection.subpathIndex] = convertDesignPathPointMode(points, selection.pointIndex, mode, original.pathClosed);
    }
    await commitPathEdit(original, subpaths);
  }

  async function updateSelectedPathPointPosition(axis: 'x' | 'y', value: number) {
    const selection = primaryPathPointSelection;
    if (!selected || selected.type !== 'path' || !selection) return;
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    const point = subpaths[selection.subpathIndex]?.[selection.pointIndex];
    if (!point) return;
    const delta = value - point[axis];
    subpaths[selection.subpathIndex][selection.pointIndex] = {
      ...point,
      [axis]: value,
      ...(axis === 'x'
        ? { inX: point.inX === null ? null : point.inX + delta, outX: point.outX === null ? null : point.outX + delta }
        : { inY: point.inY === null ? null : point.inY + delta, outY: point.outY === null ? null : point.outY + delta }),
    };
    await commitPathEdit(original, subpaths);
  }

  function startPathPointResize(event: PointerEvent, handle: ResizeHandle) {
    if (!selected || selected.type !== 'path' || !selectedPathPointBounds || !document) return;
    event.preventDefault();
    event.stopPropagation();
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    const bounds = { ...selectedPathPointBounds };
    const boxElement: DesignElement = { ...original, type: 'rectangle', x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    const selectedPoints = pathPointSelections.filter((selection) => selection.elementId === original.id);
    const sources = new Map(selectedPoints.map((selection) => [
      `${selection.subpathIndex}:${selection.pointIndex}`,
      { ...subpaths[selection.subpathIndex][selection.pointIndex] },
    ]));
    const pointerId = event.pointerId;
    let changed = false;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const pointer = unrotatePoint(pagePoint(moveEvent), original);
      const next = resizedElement(boxElement, handle, pointer, moveEvent.shiftKey, moveEvent.altKey);
      const scaleX = next.width / bounds.width;
      const scaleY = next.height / bounds.height;
      changed = next.x !== bounds.x || next.y !== bounds.y || next.width !== bounds.width || next.height !== bounds.height;
      for (const selection of selectedPoints) {
        const source = sources.get(`${selection.subpathIndex}:${selection.pointIndex}`)!;
        const transformX = (value: number) => next.x + (original.x + value - bounds.x) * scaleX - original.x;
        const transformY = (value: number) => next.y + (original.y + value - bounds.y) * scaleY - original.y;
        subpaths[selection.subpathIndex][selection.pointIndex] = {
          ...source,
          x: transformX(source.x),
          y: transformY(source.y),
          inX: source.inX === null ? null : transformX(source.inX),
          inY: source.inY === null ? null : transformY(source.inY),
          outX: source.outX === null ? null : transformX(source.outX),
          outY: source.outY === null ? null : transformY(source.outY),
        };
      }
      setLivePath(original.id, subpaths);
    };
    const up = async (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (changed) await commitPathEdit(original, subpaths);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  async function deleteSelectedPathPoint(): Promise<boolean> {
    if (!selected || selected.type !== 'path' || !pathPointSelections.length) return false;
    const original = pathSnapshot(selected);
    const subpaths = pathSubpaths(original);
    const bySubpath = new Map<number, number[]>();
    for (const selection of pathPointSelections.filter((candidate) => candidate.elementId === original.id)) {
      bySubpath.set(selection.subpathIndex, [...(bySubpath.get(selection.subpathIndex) ?? []), selection.pointIndex]);
    }
    for (const [subpathIndex, indexes] of [...bySubpath.entries()].sort((left, right) => right[0] - left[0])) {
      const remaining = subpaths[subpathIndex]?.filter((_, index) => !indexes.includes(index)) ?? [];
      if (remaining.length < 2) subpaths.splice(subpathIndex, 1);
      else subpaths[subpathIndex] = remaining;
    }
    if (!subpaths.length) {
      pathPointSelections = [];
      await removeSelected();
      return true;
    }
    const closed = original.pathClosed && subpaths.every((subpath) => subpath.length >= 3);
    if (await commitPathEdit(original, subpaths, { pathClosed: closed }) && vectorEditId === original.id) {
      const firstSubpathIndex = Math.min(...bySubpath.keys());
      const nextSubpathIndex = Math.min(firstSubpathIndex, subpaths.length - 1);
      const firstPointIndex = Math.min(...(bySubpath.get(firstSubpathIndex) ?? [0]));
      pathPointSelections = [{ elementId: original.id, subpathIndex: nextSubpathIndex, pointIndex: Math.min(firstPointIndex, subpaths[nextSubpathIndex].length - 1) }];
    }
    return true;
  }

  async function importFiles(files: File[]) {
    for (const file of files) await importAsset(file);
  }

  async function importSvgText(svg: string, name: string) {
    if (!document || !page || saving) return;
    try {
      const result = importSvgToDesign(svg, {
        name: name.replace(/\.svg$/i, '') || m['design.svg_layer'](),
        centerX: page.width / 2,
        centerY: page.height / 2,
        maxWidth: page.width * 0.8,
        maxHeight: page.height * 0.8,
        createElement: (type, x, y) => elementDefaults(type, x, y),
      });
      const root = result.elements[0];
      if (await apply(result.elements.map((element) => ({ kind: 'create' as const, element })), m['design.operation_import']({ name }), {
        inverse: [{ kind: 'delete', elementId: root.id }],
      })) {
        selectedIds = [root.id];
        if (result.warnings.length) toast.warning(m['design.svg_import_warning']({ count: String(result.warnings.length) }));
        else toast.success(m['design.svg_imported']({ count: String(result.elements.length) }));
      }
    } catch (error) {
      if (error instanceof SvgImportError) {
        toast.error(error.code === 'invalid' ? m['design.svg_invalid']() : m['design.svg_empty']());
      } else {
        toast.error(m['design.asset_error']());
      }
    } finally {
      if (assetInput) assetInput.value = '';
    }
  }

  async function imageDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      const url = URL.createObjectURL(file);
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Invalid image'));
          image.src = url;
        });
        return { width: image.naturalWidth || null, height: image.naturalHeight || null };
      } catch {
        return { width: null, height: null };
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  async function importAsset(file: File) {
    if (!document || saving || (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg'))) return;
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
      await importSvgText(await file.text(), file.name);
      return;
    }
    saving = true;
    try {
      const dimensions = await imageDimensions(file);
      const form = new FormData();
      form.set('file', file);
      form.set('baseRevision', String(document.revision));
      if (dimensions.width) form.set('width', String(dimensions.width));
      if (dimensions.height) form.set('height', String(dimensions.height));
      const csrf = getCsrfToken();
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}/assets`, {
        method: 'POST',
        headers: csrf ? { 'X-CSRF-Token': csrf } : {},
        body: form,
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || m['design.asset_error']());
      document = payload.data;
      const asset = document!.assets.at(-1)!;
      saving = false;
      await insertAsset(asset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['design.asset_error']());
    } finally {
      saving = false;
      if (assetInput) assetInput.value = '';
    }
  }

  async function insertAsset(asset: DesignAsset) {
    if (!page) return;
    const naturalWidth = asset.width ?? 320;
    const naturalHeight = asset.height ?? 240;
    const scale = Math.min(1, 640 / naturalWidth, 480 / naturalHeight);
    const element = designElementSchema.parse({
      ...elementDefaults('image', Math.max(0, page.width / 2 - naturalWidth * scale / 2), Math.max(0, page.height / 2 - naturalHeight * scale / 2)),
      name: asset.name,
      width: Math.max(1, naturalWidth * scale),
      height: Math.max(1, naturalHeight * scale),
      assetId: asset.id,
    });
    if (await apply([{ kind: 'create', element }], m['design.operation_import']({ name: asset.name }), {
      inverse: [{ kind: 'delete', elementId: element.id }],
    })) selectedIds = [element.id];
  }

  async function deleteAsset(asset: DesignAsset) {
    if (document?.elements.some((element) => element.assetId === asset.id)) return;
    await apply([{ kind: 'delete-asset', assetId: asset.id }], m['design.operation_delete']({ name: asset.name }), {
      inverse: [{ kind: 'add-asset', asset }],
    });
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.svg'));
    if (files.length) {
      void importFiles(files);
      return;
    }
    const svg = event.dataTransfer?.getData('image/svg+xml') || event.dataTransfer?.getData('text/plain');
    if (svg?.trim().startsWith('<svg')) void importSvgText(svg, m['design.pasted_svg']());
  }

  function handlePaste(event: ClipboardEvent) {
    if (!editorRoot?.contains(globalThis.document?.activeElement ?? null)) return;
    if ((globalThis.document?.activeElement as HTMLElement | null)?.closest('input,textarea,[contenteditable="true"]')) return;
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void importFiles(files);
      return;
    }
    const direct = event.clipboardData?.getData('image/svg+xml') || '';
    const html = event.clipboardData?.getData('text/html') || '';
    const plain = event.clipboardData?.getData('text/plain') || '';
    const source = direct.trim().startsWith('<svg')
      ? direct
      : html.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0] ?? (plain.trim().startsWith('<svg') ? plain : '');
    if (!source) return;
    event.preventDefault();
    void importSvgText(source, m['design.pasted_svg']());
  }

  function exportName(): string {
    return (document?.name || 'design').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'design';
  }

  function serializationBounds(ids: string[] | null): { x: number; y: number; width: number; height: number; ids: Set<string> | null } {
    if (!page || !ids?.length) return {
      x: contentBounds?.x ?? 0,
      y: contentBounds?.y ?? 0,
      width: contentBounds?.width ?? page?.width ?? 1,
      height: contentBounds?.height ?? page?.height ?? 1,
      ids: null,
    };
    const included = descendantIds(ids);
    const elements = pageElements.filter((element) => included.has(element.id) && element.visible && !element.isMask);
    if (!elements.length) return { x: 0, y: 0, width: page.width, height: page.height, ids: null };
    const padding = Math.max(2, ...elements.map((element) => element.strokeWidth / 2));
    const left = Math.min(...elements.map((element) => element.x)) - padding;
    const top = Math.min(...elements.map((element) => element.y)) - padding;
    const right = Math.max(...elements.map((element) => element.x + element.width)) + padding;
    const bottom = Math.max(...elements.map((element) => element.y + element.height)) + padding;
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top), ids: included };
  }

  async function serializedSvg(ids: string[] | null = null): Promise<string> {
    if (!pageSvg) throw new Error(m['design.export_error']());
    const clone = pageSvg.cloneNode(true) as SVGSVGElement;
    const bounds = serializationBounds(ids);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    clone.setAttribute('width', String(bounds.width));
    clone.setAttribute('height', String(bounds.height));
    clone.querySelectorAll('[data-design-selection],[data-design-guide],[data-design-ruler],[data-design-snap],[data-design-ui],[data-design-hit]').forEach((element) => element.remove());
    if (bounds.ids) {
      clone.querySelectorAll<SVGGElement>('[data-design-element]').forEach((element) => {
        if (!bounds.ids?.has(element.dataset.designElement || '')) element.remove();
      });
    } else if (page?.background && page.background !== 'transparent') {
      const background = globalThis.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      background.setAttribute('x', String(bounds.x));
      background.setAttribute('y', String(bounds.y));
      background.setAttribute('width', String(bounds.width));
      background.setAttribute('height', String(bounds.height));
      background.setAttribute('fill', page.background);
      clone.insertBefore(background, clone.firstChild);
    }
    for (const image of Array.from(clone.querySelectorAll('image'))) {
      const href = image.getAttribute('href');
      if (!href?.startsWith('/')) continue;
      const response = await fetch(href);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      image.setAttribute('href', dataUrl);
    }
    return new XMLSerializer().serializeToString(clone);
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function serializedPrototypeFrame(frameId: string): Promise<{ svg: string; width: number; height: number; overflow: DesignElement['prototypeOverflow'] }> {
    if (!pageSvg || !document) throw new Error(m['design.export_error']());
    const frame = document.elements.find((element) => element.id === frameId && element.type === 'frame');
    if (!frame) throw new Error(m['design.prototype_frame_missing']());
    const ids = descendantIds([frameId]);
    const elements = document.elements.filter((element) => ids.has(element.id) && element.visible);
    const width = frame.prototypeOverflow === 'horizontal' || frame.prototypeOverflow === 'both'
      ? Math.max(frame.width, ...elements.map((element) => element.x + element.width - frame.x))
      : frame.width;
    const height = frame.prototypeOverflow === 'vertical' || frame.prototypeOverflow === 'both'
      ? Math.max(frame.height, ...elements.map((element) => element.y + element.height - frame.y))
      : frame.height;
    const clone = pageSvg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `${frame.x} ${frame.y} ${width} ${height}`);
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.querySelectorAll('[data-design-selection],[data-design-guide],[data-design-ruler],[data-design-snap],[data-design-ui],[data-design-hit]').forEach((element) => element.remove());
    clone.querySelectorAll<SVGGElement>('[data-design-element]').forEach((element) => {
      if (!ids.has(element.dataset.designElement || '')) element.remove();
    });
    for (const image of Array.from(clone.querySelectorAll('image'))) {
      const href = image.getAttribute('href');
      if (!href?.startsWith('/')) continue;
      const response = await fetch(href);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      image.setAttribute('href', dataUrl);
    }
    return { svg: new XMLSerializer().serializeToString(clone), width: frame.width, height: frame.height, overflow: frame.prototypeOverflow };
  }

  function escapedHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  async function presentationHtml(flowId: string): Promise<string> {
    if (!document) throw new Error(m['design.export_error']());
    const flow = document.prototypeFlows.find((candidate) => candidate.id === flowId);
    if (!flow) throw new Error(m['design.prototype_flow_missing']());
    const frames = Object.fromEntries(await Promise.all(prototypeFrames(document).map(async (frame) => [frame.id, {
      id: frame.id,
      name: frame.name,
      ...(await serializedPrototypeFrame(frame.id)),
    }])));
    const payload = JSON.stringify({
      flow,
      frames,
      interactions: document.prototypeInteractions,
      background: document.presentation.background,
      showDeviceFrame: document.presentation.showDeviceFrame,
    }).replaceAll('<', '\\u003c');
    const motionCss = exportMotionCss(document).replaceAll('</style', '<\\/style');
    const title = escapedHtml(`${document.name} - ${flow.name}`);
    const labels = JSON.stringify({
      back: m['design.prototype_back'](),
      restart: m['design.prototype_restart'](),
      readonly: m['design.prototype_readonly'](),
    }).replaceAll('<', '\\u003c');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#111;color:#fff}.bar{height:48px;display:flex;align-items:center;gap:8px;padding:0 12px;background:#18181b;border-bottom:1px solid #ffffff18}.bar strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.bar span{font-size:10px;color:#ffffff80}.bar button{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:6px;background:#ffffff0a;color:#fff;cursor:pointer}.bar button:hover{background:#ffffff16}.spacer{flex:1}.stage{height:calc(100vh - 48px);display:grid;place-items:center;padding:28px}.viewport{position:relative;overflow:hidden;background:#fff;box-shadow:0 24px 80px #0009}.viewport.device{border-radius:18px;box-shadow:0 24px 80px #0009,0 0 0 1px #ffffff30}.viewport.scroll-y{overflow-y:auto}.viewport.scroll-x{overflow-x:auto}.viewport.scroll-both{overflow:auto}.viewport svg{display:block}.overlay{position:absolute;inset:0;display:grid;place-items:center;padding:16px}.overlay svg{max-width:100%;max-height:100%;border-radius:8px;box-shadow:0 20px 60px #000a}${motionCss}</style></head>
<body><header class="bar"><button id="back" aria-label="Back">&#8592;</button><button id="restart" aria-label="Restart">&#8635;</button><strong>${title}</strong><div class="spacer"></div><span id="readonly"></span></header><main class="stage" id="stage"></main>
<script>const data=${payload};const labels=${labels};const stage=document.querySelector('#stage');const history=[];let current=data.flow.startFrameId;let timers=[];document.querySelector('#readonly').textContent=labels.readonly;document.querySelector('#back').title=labels.back;document.querySelector('#restart').title=labels.restart;
function fit(el,frame){const scale=Math.min((innerWidth-56)/frame.width,(innerHeight-104)/frame.height,1.5);el.style.width=(frame.width*scale)+'px';el.style.height=(frame.height*scale)+'px';const svg=el.querySelector('svg');if(svg){svg.style.width=(Number(svg.getAttribute('width'))*scale)+'px';svg.style.height=(Number(svg.getAttribute('height'))*scale)+'px'}}
function delayed(){timers.forEach(clearTimeout);timers=[];data.interactions.filter(i=>i.trigger.type==='after-delay'&&stage.querySelector('[data-design-element="'+i.sourceElementId+'"]')).forEach(i=>timers.push(setTimeout(()=>run(i),i.trigger.delayMs)))}
function show(id,push=true){const frame=data.frames[id];if(!frame)return;if(push&&current!==id)history.push(current);current=id;stage.style.background=data.background;stage.innerHTML='<div class="viewport '+(data.showDeviceFrame?'device ':'')+(frame.overflow==='vertical'?'scroll-y':frame.overflow==='horizontal'?'scroll-x':frame.overflow==='both'?'scroll-both':'')+'">'+frame.svg+'</div>';fit(stage.firstElementChild,frame);delayed()}
function overlay(i){const frame=data.frames[i.action.targetFrameId];if(!frame)return;const host=document.createElement('div');host.className='overlay';host.dataset.overlay='true';host.style.background=i.action.backgroundColor+Math.round(i.action.backgroundOpacity*255).toString(16).padStart(2,'0');host.innerHTML=frame.svg;host.addEventListener('click',e=>{if(e.target===host&&i.action.dismissOnOutside)host.remove()});stage.firstElementChild.append(host)}
function run(i){const a=i.action;if(a.type==='navigate')show(a.targetFrameId);else if(a.type==='open-overlay')overlay(i);else if(a.type==='close-overlay')stage.querySelector('[data-overlay]:last-of-type')?.remove();else if(a.type==='back'){const id=history.pop();if(id)show(id,false)}else if(a.type==='scroll-to')stage.querySelector('[data-design-element="'+a.targetElementId+'"]')?.scrollIntoView({behavior:'smooth',block:'center'})}
function interaction(e,type){const el=e.target.closest?.('[data-design-element]');if(!el)return;const i=data.interactions.find(x=>x.sourceElementId===el.dataset.designElement&&x.trigger.type===type);if(i){e.preventDefault();run(i)}}stage.addEventListener('click',e=>interaction(e,'click'));stage.addEventListener('pointerdown',e=>interaction(e,'press'));stage.addEventListener('pointerover',e=>interaction(e,'hover'));document.querySelector('#back').onclick=()=>{const overlay=stage.querySelector('[data-overlay]:last-of-type');if(overlay)overlay.remove();else{const id=history.pop();if(id)show(id,false)}};document.querySelector('#restart').onclick=()=>{history.length=0;show(data.flow.startFrameId,false)};addEventListener('resize',()=>show(current,false));show(current,false);<\/script></body></html>`;
  }

  async function sharePrototype(flowId: string) {
    if (!document || exporting) return;
    exporting = true;
    try {
      const file = new File([await presentationHtml(flowId)], `${exportName()}-prototype.html`, { type: 'text/html' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: document.name });
      else downloadBlob(file, file.name);
      toast.success(m['design.prototype_shared']());
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') toast.error(error instanceof Error ? error.message : m['design.export_error']());
    } finally {
      exporting = false;
    }
  }

  function openPrototype(flowId: string | null = null) {
    if (!document?.prototypeFlows.length) {
      rightPanel = 'prototype';
      toast.info(m['design.prototype_create_flow_first']());
      return;
    }
    prototypeFlowId = flowId ?? defaultPrototypeFlow(document)?.id ?? null;
    prototypeOpen = true;
  }

  async function rasterBlob(format: 'png' | 'jpeg' | 'webp', maxDimension = Number.POSITIVE_INFINITY, ids: string[] | null = null): Promise<Blob> {
    const bounds = serializationBounds(ids);
    const svg = await serializedSvg(ids);
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(m['design.export_error']()));
        image.src = svgUrl;
      });
      const canvas = globalThis.document.createElement('canvas');
      const scale = Math.min(1, maxDimension / Math.max(bounds.width, bounds.height));
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error(m['design.export_error']());
      if (format === 'jpeg') {
        context.fillStyle = page?.background === 'transparent' ? '#ffffff' : page?.background ?? '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(m['design.export_error']())), `image/${format}`, 0.92));
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  async function captureDesignDataUrl(ids: string[], width: number, height: number): Promise<string> {
    const blob = await rasterBlob('png', Math.max(width, height), ids);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error(m['design.export_error']()));
      reader.readAsDataURL(blob);
    });
  }

  async function copyDesign(format: 'svg' | 'png') {
    if (!selectedIds.length || exporting) return;
    exporting = true;
    try {
      if (format === 'svg') {
        const svg = await serializedSvg(selectedIds);
        try {
          await navigator.clipboard.write([new ClipboardItem({
            'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }),
            'text/plain': new Blob([svg], { type: 'text/plain' }),
          })]);
        } catch {
          await navigator.clipboard.writeText(svg);
        }
      } else {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': await rasterBlob('png', Number.POSITIVE_INFINITY, selectedIds) })]);
      }
      toast.success(format === 'svg' ? m['design.copied_svg']() : m['design.copied_png']());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['design.export_error']());
    } finally {
      exporting = false;
    }
  }

  async function uploadThumbnail(revision: number) {
    if (!document || document.revision !== revision || !pageSvg) return;
    try {
      const form = new FormData();
      form.set('file', new File([await rasterBlob('png', 640)], `${nodeId}.png`, { type: 'image/png' }));
      form.set('revision', String(revision));
      const csrf = getCsrfToken();
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}/thumbnail`, {
        method: 'POST',
        headers: csrf ? { 'X-CSRF-Token': csrf } : {},
        body: form,
      });
      if (response.ok && document?.revision === revision) thumbnailRevision = revision;
    } catch {
      // The live SVG remains the fallback when thumbnail generation is unavailable.
    }
  }

  async function exportDesign(format: 'svg' | 'png' | 'jpeg' | 'webp' | 'pdf') {
    if (!page || exporting) return;
    exporting = true;
    try {
      const exportIds = selectedIds.length ? selectedIds : null;
      if (format === 'svg') {
        downloadBlob(new Blob([await serializedSvg(exportIds)], { type: 'image/svg+xml' }), `${exportName()}.svg`);
        return;
      }
      const blob = await rasterBlob(format === 'pdf' ? 'png' : format, Number.POSITIVE_INFINITY, exportIds);
      if (format !== 'pdf') {
        downloadBlob(blob, `${exportName()}.${format === 'jpeg' ? 'jpg' : format}`);
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const csrf = getCsrfToken();
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}/export/pdf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ dataUrl, width: Math.round(serializationBounds(exportIds).width), height: Math.round(serializationBounds(exportIds).height), name: exportName() }),
      });
      if (!response.ok) throw new Error((await response.json()).error || m['design.export_error']());
      downloadBlob(await response.blob(), `${exportName()}.pdf`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['design.export_error']());
    } finally {
      exporting = false;
    }
  }

  async function undo() {
    const entry = undoStack.at(-1);
    if (!entry) return;
    if (await apply(entry.inverse, m['design.undo'](), { record: false })) {
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, entry];
    }
  }

  async function redo() {
    const entry = redoStack.at(-1);
    if (!entry) return;
    if (await apply(entry.forward, m['design.redo'](), { record: false })) {
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, entry];
    }
  }

  async function nudgeSelection(dx: number, dy: number) {
    if (!document) return;
    if (vectorEditing && selected?.type === 'path' && pathPointSelections.length) {
      const original = pathSnapshot(selected);
      const subpaths = pathSubpaths(original);
      for (const selection of pathPointSelections.filter((candidate) => candidate.elementId === original.id)) {
        const point = subpaths[selection.subpathIndex]?.[selection.pointIndex];
        if (!point) continue;
        subpaths[selection.subpathIndex][selection.pointIndex] = {
          ...point,
          x: point.x + dx,
          y: point.y + dy,
          inX: point.inX === null ? null : point.inX + dx,
          inY: point.inY === null ? null : point.inY + dy,
          outX: point.outX === null ? null : point.outX + dx,
          outY: point.outY === null ? null : point.outY + dy,
        };
      }
      await commitPathEdit(original, subpaths);
      return;
    }
    const targetIds = descendantIds(selectedIds);
    const targets = pageElements.filter((element) => targetIds.has(element.id) && !element.locked);
    if (!targets.length) return;
    await apply(targets.map((element) => ({ kind: 'update', elementId: element.id, changes: { x: element.x + dx, y: element.y + dy } })), m['design.operation_move']({ name: targets.length === 1 ? targets[0].name : String(targets.length) }), {
      inverse: targets.map((element) => ({ kind: 'update', elementId: element.id, changes: { x: element.x, y: element.y } })),
    });
  }

  async function zoomAt(nextZoom: number, clientX?: number, clientY?: number): Promise<void> {
    if (!viewport || !pageSvg || !sceneBounds) {
      zoom = Math.max(0.02, Math.min(3, nextZoom));
      return;
    }
    const before = pageSvg.getBoundingClientRect();
    if (before.width <= 0 || before.height <= 0) {
      zoom = Math.max(0.02, Math.min(3, nextZoom));
      return;
    }
    const anchorX = clientX ?? viewport.getBoundingClientRect().left + viewport.clientWidth / 2;
    const anchorY = clientY ?? viewport.getBoundingClientRect().top + viewport.clientHeight / 2;
    const sceneX = sceneBounds.x + (anchorX - before.left) * sceneBounds.width / before.width;
    const sceneY = sceneBounds.y + (anchorY - before.top) * sceneBounds.height / before.height;
    zoom = Math.max(0.02, Math.min(3, nextZoom));
    await tick();
    if (!viewport || !pageSvg || !sceneBounds) return;
    const after = pageSvg.getBoundingClientRect();
    const projectedX = after.left + (sceneX - sceneBounds.x) * after.width / sceneBounds.width;
    const projectedY = after.top + (sceneY - sceneBounds.y) * after.height / sceneBounds.height;
    viewport.scrollLeft += projectedX - anchorX;
    viewport.scrollTop += projectedY - anchorY;
    handleViewportScroll();
  }

  function handleViewportWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.002);
    void zoomAt(zoom * factor, event.clientX, event.clientY);
  }

  async function fitBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
    if (!viewport) return;
    zoom = Math.max(0.02, Math.min(1.5, Math.min(
      (viewport.clientWidth - 96) / bounds.width,
      (viewport.clientHeight - 96) / bounds.height,
    )));
    await tick();
    if (!viewport || !pageSvg || !sceneBounds) return;
    const container = viewport.getBoundingClientRect();
    const canvas = pageSvg.getBoundingClientRect();
    const canvasLeft = canvas.left - container.left + viewport.scrollLeft;
    const canvasTop = canvas.top - container.top + viewport.scrollTop;
    viewport.scrollTo({
      left: canvasLeft + (bounds.x + bounds.width / 2 - sceneBounds.x) * zoom - viewport.clientWidth / 2,
      top: canvasTop + (bounds.y + bounds.height / 2 - sceneBounds.y) * zoom - viewport.clientHeight / 2,
    });
    handleViewportScroll();
  }

  async function fitPage() {
    if (!contentBounds) return;
    await fitBounds(contentBounds);
  }

  async function fitSelection(): Promise<void> {
    if (!page || !selectedElements.length) return;
    await fitBounds(designContentBounds(selectedElements, page));
  }

  function updateViewportBounds() {
    if (!viewport || !pageSvg || !sceneBounds) {
      viewportBounds = null;
      return;
    }
    const container = viewport.getBoundingClientRect();
    const canvas = pageSvg.getBoundingClientRect();
    const scale = canvas.width / sceneBounds.width;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const left = Math.max(container.left, canvas.left);
    const top = Math.max(container.top, canvas.top);
    const right = Math.min(container.right, canvas.right);
    const bottom = Math.min(container.bottom, canvas.bottom);
    const overscan = 320 / Math.max(zoom, 0.1);
    viewportBounds = {
      x: sceneBounds.x + (left - canvas.left) / scale - overscan,
      y: sceneBounds.y + (top - canvas.top) / scale - overscan,
      width: Math.max(0, (right - left) / scale) + overscan * 2,
      height: Math.max(0, (bottom - top) / scale) + overscan * 2,
    };
  }

  function keyboard(event: KeyboardEvent) {
    if (!editorRoot?.contains(globalThis.document?.activeElement ?? null)) return;
    if (eventTargetMatches(event.target, 'input, textarea, [contenteditable="true"]')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      spacePressed = true;
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void (event.shiftKey ? redo() : undo());
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      event.stopImmediatePropagation();
      copyLayers();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void cutLayers();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void pasteLayers();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void duplicateLayers();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && vectorEditing && selected?.type === 'path') {
      event.preventDefault();
      event.stopImmediatePropagation();
      pathPointSelections = pathSubpaths(selected).flatMap((points, subpathIndex) => points.map((_, pointIndex) => ({ elementId: selected.id, subpathIndex, pointIndex })));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectedIds = pageElements.filter((element) => element.visible && !element.parentId).map((element) => element.id);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void (event.shiftKey ? ungroupSelection() : groupSelection());
      return;
    }
    if (event.key === 'Enter' && tool === 'path' && penPoints.length >= 2) {
      event.preventDefault();
      void finishPath();
      return;
    }
    if (event.key === 'Enter' && selected?.type === 'path' && !vectorEditing) {
      event.preventDefault();
      enterVectorEdit(selected);
      return;
    }
    if (event.key === 'Enter' && selected?.type === 'text' && !editingTextId) {
      event.preventDefault();
      beginTextEditing(selected);
      return;
    }
    if (event.key === 'Escape' && tool === 'path' && penPoints.length >= 2) {
      event.preventDefault();
      void finishPath();
      return;
    }
    if (event.key === 'Escape' && vectorEditing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pathPointSelections = [];
      hoveredPathSegment = null;
      vectorEditId = null;
      return;
    }
    if (event.key === 'Escape' && tool !== 'select') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelDrawing?.();
      penPoints = [];
      penPointer = null;
      penContinuation = null;
      draftElement = null;
      tool = 'select';
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const amount = event.shiftKey ? 10 : 1;
      void nudgeSelection(event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pathPointSelections.length) void deleteSelectedPathPoint();
      else void removeSelected();
      return;
    }
    const shortcut = event.key.toLowerCase();
    if (shortcut === 'v') switchTool('select');
    else if (shortcut === 'h') switchTool('hand');
    else if (shortcut === 'f') switchTool('frame');
    else if (shortcut === 'r') switchTool('rectangle');
    else if (shortcut === 'o') switchTool('ellipse');
    else if (shortcut === 't') switchTool('text');
    else if (shortcut === 'p') switchTool('path');
  }

  function number(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }

  function focusEditor(event: PointerEvent) {
    if (eventTargetMatches(event.target, 'input, textarea, button, select, [contenteditable="true"]')) return;
    editorRoot?.focus({ preventScroll: true });
  }

  function keyboardUp(event: KeyboardEvent) {
    if (event.code === 'Space') spacePressed = false;
  }

  function resetTransientInput() {
    spacePressed = false;
    panning = false;
  }

  onMount(() => {
    const restoredSession = readDesignEditorSession(localStorage, workspaceId, nodeId);
    if (restoredSession) {
      zoom = restoredSession.zoom;
      tool = restoredSession.tool;
      leftPanel = restoredSession.leftPanel;
      rightPanel = restoredSession.rightPanel;
      leftPanelVisible = restoredSession.leftPanelVisible;
      rightPanelVisible = restoredSession.rightPanelVisible;
    }
    const storageKey = 'orkestrai.design.collaboration.participant';
    const storedId = sessionStorage.getItem(storageKey);
    const id = storedId && storedId.length >= 8 ? storedId : participant.id;
    sessionStorage.setItem(storageKey, id);
    participant = { ...participant, id, color: participantColor(id) };
    const resizeObserver = new ResizeObserver(() => {
      const previousWidth = editorWidth;
      editorWidth = editorRoot?.clientWidth ?? 0;
      if (editorWidth < 980 && (previousWidth === 0 || previousWidth >= 980)) {
        if (!restoredSession && previousWidth === 0) {
          leftPanelVisible = false;
          rightPanelVisible = false;
        } else if (leftPanelVisible && rightPanelVisible) {
          rightPanelVisible = false;
        }
      }
      updateViewportBounds();
    });
    if (editorRoot) resizeObserver.observe(editorRoot);
    if (viewport) resizeObserver.observe(viewport);
    void load().then(async () => {
      await tick();
      if (restoredSession && viewport) {
        selectedIds = restoredSession.selectedIds.filter((id) => document?.elements.some((element) => element.id === id));
        viewport.scrollTo({ left: restoredSession.scrollLeft, top: restoredSession.scrollTop });
      } else {
        await fitPage();
      }
      await tick();
      updateViewportBounds();
      sessionReady = true;
      void syncCollaboration();
    });
    collaborationTimer = setInterval(() => void syncCollaboration(true), 3_000);
    window.addEventListener('keydown', keyboard, { capture: true });
    window.addEventListener('keyup', keyboardUp, { capture: true });
    window.addEventListener('blur', resetTransientInput);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', keyboard, { capture: true });
      window.removeEventListener('keyup', keyboardUp, { capture: true });
      window.removeEventListener('blur', resetTransientInput);
      window.removeEventListener('paste', handlePaste);
      persistEditorSession();
      if (sessionWriteTimer) clearTimeout(sessionWriteTimer);
      resizeObserver.disconnect();
      cancelDrawing?.();
      if (thumbnailTimer) clearTimeout(thumbnailTimer);
      if (collaborationTimer) clearInterval(collaborationTimer);
      const csrf = getCsrfToken();
      void fetch(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}/collaboration`, {
        method: 'DELETE',
        keepalive: true,
        headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ participantId: participant.id }),
      }).catch(() => undefined);
    };
  });

  $effect(() => {
    const revision = externalRevision;
    if (!revision || saving || loading || !document || revision <= document.revision) return;
    void load(true);
  });

  $effect(() => {
    zoom;
    selectedIds;
    tool;
    leftPanel;
    rightPanel;
    leftPanelVisible;
    rightPanelVisible;
    scheduleEditorSessionWrite();
  });

  $effect(() => {
    zoom;
    page?.id;
    sceneBounds?.x;
    sceneBounds?.y;
    sceneBounds?.width;
    sceneBounds?.height;
    queueMicrotask(updateViewportBounds);
  });

  $effect(() => {
    const revision = document?.revision;
    const svg = pageSvg;
    if (revision === undefined || !svg || loading || revision === thumbnailRevision) return;
    if (thumbnailTimer) clearTimeout(thumbnailTimer);
    thumbnailTimer = setTimeout(() => void uploadThumbnail(revision), 650);
    return () => {
      if (thumbnailTimer) clearTimeout(thumbnailTimer);
    };
  });
</script>

<div class={`@container/design h-full min-h-0 ${className}`}>
  <div
    bind:this={editorRoot}
    class="relative grid h-full min-h-0 grid-rows-[42px_minmax(0,1fr)] overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)]"
    style:grid-template-columns={editorGridColumns}
    data-testid="design-editor"
    aria-label={m['design.mode_aria']()}
    tabindex="-1"
    onpointerdowncapture={focusEditor}
  >
    <header class="col-span-3 flex min-w-0 items-center gap-1 overflow-x-auto border-b border-[var(--app-border)] bg-[var(--app-surface)] px-2" data-testid="design-toolbar">
      <DesignToolbarButton label={leftPanelVisible ? m['design.hide_left_panel']() : m['design.show_left_panel']()} active={leftPanelVisible} pressed={leftPanelVisible} onclick={toggleLeftPanel}><Layers3 size={16} /></DesignToolbarButton>
      <span class="mx-1 h-5 w-px shrink-0 bg-[var(--app-border)]"></span>
      <DesignToolbarButton label={m['design.import_artwork']()} onclick={() => assetInput?.click()}><ImagePlus size={16} /></DesignToolbarButton>
      <input bind:this={assetInput} class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple onchange={(event: Event) => void importFiles(Array.from((event.currentTarget as HTMLInputElement).files ?? []))} />
      <span class="mx-1 h-5 w-px bg-[var(--app-border)]"></span>
      <DesignToolbarButton label={m['design.undo']()} disabled={!undoStack.length || saving} onclick={() => void undo()}><Undo2 size={16} /></DesignToolbarButton>
      <DesignToolbarButton label={m['design.redo']()} disabled={!redoStack.length || saving} onclick={() => void redo()}><Redo2 size={16} /></DesignToolbarButton>

      <DropdownMenu.Root>
        <Tooltip.Root delayDuration={250}><Tooltip.Trigger>{#snippet child({ props })}<DropdownMenu.Trigger {...props} class="inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0.5 rounded-md text-[var(--app-text-soft)] hover:bg-[var(--app-border)] data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-text)]" aria-label={m['design.grouping']()}><Group size={15} /><ChevronDown size={10} /></DropdownMenu.Trigger>{/snippet}</Tooltip.Trigger><Tooltip.Content class="z-[120]" side="bottom" sideOffset={6}>{m['design.grouping']()}</Tooltip.Content></Tooltip.Root>
        <DropdownMenu.Content align="start" class="z-[120] w-56">
          <DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void groupSelection()}><Group size={14} />{m['design.group_selection']()}<DropdownMenu.Shortcut>⌘G</DropdownMenu.Shortcut></DropdownMenu.Item>
          <DropdownMenu.Item disabled={!selectedElements.some((element) => element.type === 'group')} onclick={() => void ungroupSelection()}><Ungroup size={14} />{m['design.ungroup_selection']()}<DropdownMenu.Shortcut>⇧⌘G</DropdownMenu.Shortcut></DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root bind:open={colorMenuOpen}>
        <Tooltip.Root delayDuration={250}><Tooltip.Trigger>{#snippet child({ props })}<DropdownMenu.Trigger {...props} class="inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0.5 rounded-md text-[var(--app-text-soft)] hover:bg-[var(--app-border)] data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-text)]" disabled={!selected} aria-label={m['design.color_tools']()}><Palette size={15} /><ChevronDown size={10} /></DropdownMenu.Trigger>{/snippet}</Tooltip.Trigger><Tooltip.Content class="z-[120]" side="bottom" sideOffset={6}>{m['design.color_tools']()}</Tooltip.Content></Tooltip.Root>
        <DropdownMenu.Content align="start" class="z-[120] w-64">
          <DropdownMenu.Item disabled={!primaryColor(selected, 'fill')} onclick={() => { const color = primaryColor(selected, 'fill'); if (color) selectMatchingColor('fill', color); }}>{m['design.select_same_fill']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={!primaryColor(selected, 'stroke')} onclick={() => { const color = primaryColor(selected, 'stroke'); if (color) selectMatchingColor('stroke', color); }}>{m['design.select_same_stroke']()}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <Tooltip.Root delayDuration={250}><Tooltip.Trigger>{#snippet child({ props })}<DropdownMenu.Trigger {...props} class="inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0.5 rounded-md text-[var(--app-text-soft)] hover:bg-[var(--app-border)] data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-text)]" aria-label={m['design.alignment']()}><AlignCenter size={15} /><ChevronDown size={10} /></DropdownMenu.Trigger>{/snippet}</Tooltip.Trigger><Tooltip.Content class="z-[120]" side="bottom" sideOffset={6}>{m['design.alignment']()}</Tooltip.Content></Tooltip.Root>
        <DropdownMenu.Content align="start" class="z-[120] w-56">
          <DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void alignSelection('left')}><AlignHorizontalJustifyStart size={14} />{m['design.align_left']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void alignSelection('hcenter')}><AlignHorizontalJustifyCenter size={14} />{m['design.align_horizontal_center']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void alignSelection('right')}><AlignHorizontalJustifyEnd size={14} />{m['design.align_right']()}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void alignSelection('top')}><AlignVerticalJustifyStart size={14} />{m['design.align_top']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void alignSelection('vcenter')}><AlignVerticalJustifyCenter size={14} />{m['design.align_vertical_center']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void alignSelection('bottom')}><AlignVerticalJustifyEnd size={14} />{m['design.align_bottom']()}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={selectedElements.length < 3} onclick={() => void alignSelection('distribute-x')}><AlignHorizontalDistributeCenter size={14} />{m['design.distribute_horizontal']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={selectedElements.length < 3} onclick={() => void alignSelection('distribute-y')}><AlignVerticalDistributeCenter size={14} />{m['design.distribute_vertical']()}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <Tooltip.Root delayDuration={250}><Tooltip.Trigger>{#snippet child({ props })}<DropdownMenu.Trigger {...props} class="inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0.5 rounded-md text-[var(--app-text-soft)] hover:bg-[var(--app-border)] data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-text)]" aria-label={m['design.boolean']()}><Combine size={15} /><ChevronDown size={10} /></DropdownMenu.Trigger>{/snippet}</Tooltip.Trigger><Tooltip.Content class="z-[120]" side="bottom" sideOffset={6}>{m['design.boolean']()}</Tooltip.Content></Tooltip.Root>
        <DropdownMenu.Content align="start" class="z-[120] w-52">
          {#each ['union', 'subtract', 'intersect', 'exclude'] as operation}<DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void combineSelection(operation as DesignBooleanOperation)}>{booleanLabel(operation as DesignBooleanOperation)}</DropdownMenu.Item>{/each}
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={selectedElements.length < 2} onclick={() => void createMask()}>{m['design.mask']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={!selectedElements.some((element) => element.maskId)} onclick={() => void releaseMasks()}>{m['design.release_mask']()}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <Tooltip.Root delayDuration={250}><Tooltip.Trigger>{#snippet child({ props })}<DropdownMenu.Trigger {...props} class="inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0.5 rounded-md text-[var(--app-text-soft)] hover:bg-[var(--app-border)] data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-text)]" aria-label={m['design.rulers']()}><Ruler size={15} /><ChevronDown size={10} /></DropdownMenu.Trigger>{/snippet}</Tooltip.Trigger><Tooltip.Content class="z-[120]" side="bottom" sideOffset={6}>{m['design.rulers']()}</Tooltip.Content></Tooltip.Root>
        <DropdownMenu.Content align="start" class="z-[120] w-56">
          <DropdownMenu.CheckboxItem checked={rulersVisible} onCheckedChange={(checked: boolean) => (rulersVisible = checked)} closeOnSelect={false}>{m['design.rulers']()}</DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem checked={snapEnabled} onCheckedChange={(checked: boolean) => (snapEnabled = checked)} closeOnSelect={false}><Magnet size={14} />{m['design.snap']()}</DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={() => void addGuide('y')}><Plus size={14} />{m['design.add_horizontal_guide']()}</DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void addGuide('x')}><Plus size={14} />{m['design.add_vertical_guide']()}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <div class="min-w-0 flex-1"></div>
      {#if document}<span class="hidden text-[10px] text-[var(--app-text-muted)] xl:inline">{m['design.revision']({ revision: document.revision })}</span>{/if}
      <DesignToolbarButton label={m['design.zoom_out']()} onclick={() => void zoomAt(zoom - 0.1)}><ZoomOut size={16} /></DesignToolbarButton>
      <span class="w-10 shrink-0 text-center text-[10px] tabular-nums text-[var(--app-text-muted)]">{Math.round(zoom * 100)}%</span>
      <DesignToolbarButton label={m['design.zoom_in']()} onclick={() => void zoomAt(zoom + 0.1)}><ZoomIn size={16} /></DesignToolbarButton>
      <DropdownMenu.Root>
        <Tooltip.Root delayDuration={250}><Tooltip.Trigger>{#snippet child({ props })}<DropdownMenu.Trigger {...props} class="inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0.5 rounded-md text-[var(--app-text-soft)] hover:bg-[var(--app-border)] data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-text)]" aria-label={m['design.fit']()}><Maximize2 size={15} /><ChevronDown size={10} /></DropdownMenu.Trigger>{/snippet}</Tooltip.Trigger><Tooltip.Content class="z-[120]" side="bottom" sideOffset={6}>{m['design.fit']()}</Tooltip.Content></Tooltip.Root>
        <DropdownMenu.Content align="end" class="z-[120] w-48">
          <DropdownMenu.Item onclick={() => void fitPage()}>{m['design.fit_all']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={!selectedElements.length} onclick={() => void fitSelection()}>{m['design.fit_selection']()}</DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void zoomAt(1)}>{m['design.zoom_actual_size']()}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <DesignToolbarButton label={m['design.prototype_play']()} disabled={!document?.prototypeFlows.length} onclick={() => openPrototype()}><Play size={16} fill="currentColor" /></DesignToolbarButton>
      <DropdownMenu.Root>
        <Tooltip.Root delayDuration={250}><Tooltip.Trigger>{#snippet child({ props })}<DropdownMenu.Trigger {...props} class="inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0.5 rounded-md text-[var(--app-text-soft)] hover:bg-[var(--app-border)] data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-text)]" disabled={exporting} aria-label={m['design.export']()}><Download size={15} /><ChevronDown size={10} /></DropdownMenu.Trigger>{/snippet}</Tooltip.Trigger><Tooltip.Content class="z-[120]" side="bottom" sideOffset={6}>{m['design.export']()}</Tooltip.Content></Tooltip.Root>
        <DropdownMenu.Content align="end" class="z-[120]">
          <DropdownMenu.Item disabled={!selectedIds.length} onclick={() => void copyDesign('svg')}><ClipboardCopy size={14} />{m['design.copy_svg']()}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={!selectedIds.length} onclick={() => void copyDesign('png')}><ClipboardCopy size={14} />{m['design.copy_png']()}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={() => void exportDesign('svg')}>{m['design.export_svg']()}</DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void exportDesign('png')}>{m['design.export_png']()}</DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void exportDesign('jpeg')}>{m['design.export_jpeg']()}</DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void exportDesign('webp')}>{m['design.export_webp']()}</DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void exportDesign('pdf')}>{m['design.export_pdf']()}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <span class="mx-1 h-5 w-px shrink-0 bg-[var(--app-border)]"></span>
      <DesignToolbarButton label={rightPanelVisible ? m['design.hide_right_panel']() : m['design.show_right_panel']()} active={rightPanelVisible} pressed={rightPanelVisible} onclick={toggleRightPanel}><SlidersHorizontal size={16} /></DesignToolbarButton>
    </header>

    {#if panelsOverlay && (leftPanelVisible || rightPanelVisible)}
      <button class="absolute inset-x-0 top-[42px] bottom-0 z-30 cursor-default bg-black/20 backdrop-blur-[1px]" aria-label={m['design.close_panels']()} onclick={() => { leftPanelVisible = false; rightPanelVisible = false; }}></button>
    {/if}

    {#if leftPanelVisible}
    <aside
      class={`flex min-h-0 flex-col overflow-hidden border-r border-[var(--app-border)] bg-[var(--app-surface)] ${panelsOverlay ? 'absolute top-[42px] bottom-0 left-0 z-40 w-[min(320px,calc(100%-48px))] shadow-2xl' : 'col-start-1 row-start-2'}`}
      data-testid="design-left-panel"
    >
      <div class="grid grid-cols-3 border-b border-[var(--app-border)] p-1">
        <button class={`flex h-8 items-center justify-center gap-1.5 rounded text-[10px] font-medium ${leftPanel === 'layers' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={leftPanel === 'layers'} onclick={() => (leftPanel = 'layers')}><Layers3 size={12} />{m['design.layers']()}</button>
        <button class={`flex h-8 items-center justify-center gap-1.5 rounded text-[10px] font-medium ${leftPanel === 'variables' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={leftPanel === 'variables'} onclick={() => (leftPanel = 'variables')}><Braces size={12} />{m['design.variables']()}</button>
        <button class={`flex h-8 items-center justify-center gap-1.5 rounded text-[10px] font-medium ${leftPanel === 'components' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={leftPanel === 'components'} onclick={() => (leftPanel = 'components')}><Diamond size={12} />{m['design.components']()}</button>
      </div>
      {#if leftPanel === 'layers'}
        <div class="grid min-h-0 flex-1 grid-rows-[minmax(260px,1fr)_190px]">
          {#if loading}
            <p class="p-3 text-xs text-[var(--app-text-muted)]">{m['design.loading']()}</p>
          {:else if document}
            <DesignFilePanel
              pages={document.pages}
              activePageId={document.activePageId}
              elements={pageElements}
              {selectedIds}
              {saving}
              canPaste={internalPasteAvailable}
              onActivatePage={activatePage}
              onCreatePage={createPage}
              onRenamePage={renamePage}
              onDuplicatePage={duplicatePage}
              onDeletePage={deletePage}
              onReorderPage={reorderPages}
              onSelect={selectLayer}
              onRenameLayer={(element, name) => updateElement(element, { name })}
              onToggleVisibility={(element) => updateElement(element, { visible: !element.visible })}
              onToggleLock={(element) => updateElement(element, { locked: !element.locked })}
              onDropLayers={dropLayers}
              onCopy={() => copyLayers()}
              onCut={cutLayers}
              onPaste={pasteLayers}
              onDuplicate={duplicateLayers}
              onDelete={deleteLayer}
              onMoveLayer={moveLayer}
            />
          {/if}
          <section class="min-h-0 overflow-y-auto border-t border-[var(--app-border)]">
            <div class="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1.5 text-[10px] font-semibold uppercase text-[var(--app-text-muted)]"><span>{m['design.assets']()}</span><Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.import_asset']()} onclick={() => assetInput?.click()}><Plus size={12} /></Button></div>
            {#if !document?.assets.length}<p class="p-3 text-[10px] leading-4 text-[var(--app-text-muted)]">{m['design.assets_empty']()}</p>{:else}
              <div class="grid grid-cols-2 gap-1.5 p-2">
                {#each document.assets as asset (asset.id)}
                  <div class="group relative overflow-hidden border border-[var(--app-border)] bg-[var(--app-canvas)]">
                    <button class="block aspect-square w-full" title={m['design.insert_asset']()} onclick={() => void insertAsset(asset)}><img class="h-full w-full object-contain" src={`/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(asset.path)}`} alt={asset.name} /></button>
                    <span class="block truncate border-t border-[var(--app-border)] px-1.5 py-1 text-[9px]">{asset.name}</span>
                    {#if !document.elements.some((element) => element.assetId === asset.id)}<button class="absolute top-1 right-1 grid size-6 place-items-center bg-[var(--app-surface)] text-[var(--app-danger)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label={m['design.delete']()} onclick={() => void deleteAsset(asset)}><Trash2 size={11} /></button>{/if}
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        </div>
      {:else if leftPanel === 'variables' && document}
        <div class="min-h-0 flex-1"><DesignVariablesPanel {document} {saving} makeId={uuidv7} onApply={(operations, summary, inverse) => apply(operations, summary, { inverse })} onSelectElements={(elementIds) => { selectedIds = elementIds; vectorEditId = null; pathPointSelections = []; }} /></div>
      {:else if document}
        <div class="min-h-0 flex-1"><DesignComponentsPanel {document} {selectedIds} {saving} makeId={uuidv7} onApply={(operations, summary, inverse) => apply(operations, summary, { inverse })} onSelectElements={(elementIds) => { selectedIds = elementIds; vectorEditId = null; pathPointSelections = []; }} onDocumentChange={(nextDocument) => { document = nextDocument; selectedIds = []; undoStack = []; redoStack = []; }} onCaptureDesign={captureDesignDataUrl} /></div>
      {/if}
    </aside>
    {/if}

    <main class={`relative col-start-2 row-start-2 min-h-0 min-w-0 overflow-auto bg-[var(--app-canvas)] ${panning ? 'cursor-grabbing select-none' : tool === 'hand' || spacePressed ? 'cursor-grab' : ''}`} bind:this={viewport} data-testid="design-viewport" onpointerdowncapture={startViewportPan} onscroll={handleViewportScroll} onwheel={handleViewportWheel} ondragover={(event) => event.preventDefault()} ondrop={handleDrop}>
      {#if errorMessage}
        <div class="grid h-full place-items-center p-8 text-center"><div><p class="text-sm text-[var(--app-danger)]">{errorMessage}</p><Button class="mt-3" variant="outline" size="sm" onclick={() => void load()}>{m['workspace_access.retry']()}</Button></div></div>
      {:else if loading || !document || !page}
        <div class="grid h-full place-items-center text-xs text-[var(--app-text-muted)]">{m['design.loading']()}</div>
      {:else}
        {#if vectorEditing && selected?.type === 'path'}
          <div class="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-1 shadow-lg">
            <span class="whitespace-nowrap px-2 text-[10px] font-medium text-[var(--app-text-soft)]">{m['design.vector_edit']()}</span>
            <span class="h-5 w-px bg-[var(--app-border)]"></span>
            <DesignToolbarButton label={m['design.path_corner']()} active={selectedPathPointMode === 'corner'} pressed={selectedPathPointMode === 'corner'} disabled={!pathPointSelections.length} onclick={() => void setSelectedPathPointMode('corner')}><CornerDownRight size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.path_mirrored']()} active={selectedPathPointMode === 'mirrored'} pressed={selectedPathPointMode === 'mirrored'} disabled={!pathPointSelections.length} onclick={() => void setSelectedPathPointMode('mirrored')}><Spline size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.path_asymmetric']()} active={selectedPathPointMode === 'asymmetric'} pressed={selectedPathPointMode === 'asymmetric'} disabled={!pathPointSelections.length} onclick={() => void setSelectedPathPointMode('asymmetric')}><MoveDiagonal2 size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.path_disconnected']()} active={selectedPathPointMode === 'disconnected'} pressed={selectedPathPointMode === 'disconnected'} disabled={!pathPointSelections.length} onclick={() => void setSelectedPathPointMode('disconnected')}><Unlink2 size={15} /></DesignToolbarButton>
            <span class="h-5 w-px bg-[var(--app-border)]"></span>
            <DesignToolbarButton label={m['design.path_add_point']()} disabled={!pathPointSelections.length} onclick={() => void addPathPointAfterSelection()}><Plus size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.path_delete_point']()} disabled={!pathPointSelections.length} onclick={() => void deleteSelectedPathPoint()}><Trash2 size={15} /></DesignToolbarButton>
            <span class="min-w-7 px-1 text-center text-[10px] tabular-nums text-[var(--app-text-muted)]" aria-label={m['design.vector_selection_count']({ count: String(pathPointSelections.length) })}>{pathPointSelections.length}</span>
          </div>
        {:else if selectedElements.length > 1}
          <div class="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-1 shadow-lg">
            <span class="whitespace-nowrap px-2 text-[10px] font-medium text-[var(--app-text-soft)]">{m['design.layers_count']({ count: String(selectedElements.length) })}</span>
            <span class="h-5 w-px bg-[var(--app-border)]"></span>
            <DesignToolbarButton label={m['design.align_left']()} onclick={() => void alignSelection('left')}><AlignHorizontalJustifyStart size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.align_horizontal_center']()} onclick={() => void alignSelection('hcenter')}><AlignHorizontalJustifyCenter size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.align_right']()} onclick={() => void alignSelection('right')}><AlignHorizontalJustifyEnd size={15} /></DesignToolbarButton>
            <span class="h-5 w-px bg-[var(--app-border)]"></span>
            <DesignToolbarButton label={m['design.align_top']()} onclick={() => void alignSelection('top')}><AlignVerticalJustifyStart size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.align_vertical_center']()} onclick={() => void alignSelection('vcenter')}><AlignVerticalJustifyCenter size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.align_bottom']()} onclick={() => void alignSelection('bottom')}><AlignVerticalJustifyEnd size={15} /></DesignToolbarButton>
            <span class="h-5 w-px bg-[var(--app-border)]"></span>
            <DesignToolbarButton label={m['design.distribute_horizontal']()} disabled={selectedElements.length < 3} onclick={() => void alignSelection('distribute-x')}><AlignHorizontalDistributeCenter size={15} /></DesignToolbarButton>
            <DesignToolbarButton label={m['design.distribute_vertical']()} disabled={selectedElements.length < 3} onclick={() => void alignSelection('distribute-y')}><AlignVerticalDistributeCenter size={15} /></DesignToolbarButton>
            <span class="h-5 w-px bg-[var(--app-border)]"></span>
            <DesignToolbarButton label={m['design.group_selection']()} onclick={() => void groupSelection()}><Group size={15} /></DesignToolbarButton>
          </div>
        {:else if selected?.type === 'group'}
          <div class="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-1 shadow-lg">
            <span class="max-w-48 truncate px-2 text-[10px] font-medium text-[var(--app-text-soft)]">{selected.name}</span>
            <span class="h-5 w-px bg-[var(--app-border)]"></span>
            <DesignToolbarButton label={m['design.ungroup_selection']()} onclick={() => void ungroupSelection()}><Ungroup size={15} /></DesignToolbarButton>
          </div>
        {/if}
        <div class="relative min-h-full min-w-full p-12" style:width={`${Math.max(viewport?.clientWidth ?? 0, (sceneBounds?.width ?? page.width) * zoom + 96)}px`} style:height={`${Math.max(viewport?.clientHeight ?? 0, (sceneBounds?.height ?? page.height) * zoom + 96)}px`}>
          <svg
            bind:this={pageSvg}
            class={`mx-auto block ${tool === 'select' ? 'cursor-default [&_g[data-design-element]]:cursor-move' : tool === 'hand' ? 'cursor-grab' : 'cursor-crosshair'}`}
            width={(sceneBounds?.width ?? page.width) * zoom}
            height={(sceneBounds?.height ?? page.height) * zoom}
            viewBox={`${sceneBounds?.x ?? 0} ${sceneBounds?.y ?? 0} ${sceneBounds?.width ?? page.width} ${sceneBounds?.height ?? page.height}`}
            style:background="transparent"
            onpointerdown={canvasPointerDown}
            onpointermove={trackPresence}
            onpointerleave={() => { cursorPoint = null; if (tool === 'path') penPointer = null; void syncCollaboration(true); }}
            ondblclick={canvasDoubleClick}
            role="application"
            aria-label={page.name}
          >
            <rect data-design-ui x="0" y="0" width={page.width} height={page.height} fill={page.background} pointer-events="none" />
            <DesignRenderer elements={viewportRenderedElements} assets={document.assets} {workspaceId} selectedIds={rendererSelectionIds} showFrameLabels />
            {#each (collaboration?.presences ?? []).filter((presence) => presence.participant.id !== participant.id && presence.pageId === page.id) as presence (presence.participant.id)}
              <g data-design-ui pointer-events="none">
                {#each presence.elementIds as elementId}
                  {@const remoteElement = pageElements.find((element) => element.id === elementId)}
                  {#if remoteElement}<rect x={remoteElement.x} y={remoteElement.y} width={remoteElement.width} height={remoteElement.height} fill="none" stroke={presence.participant.color} stroke-width={1.5 / zoom} stroke-dasharray={`${5 / zoom} ${3 / zoom}`} vector-effect="non-scaling-stroke" />{/if}
                {/each}
                {#if presence.cursor}
                  <path d={`M ${presence.cursor.x} ${presence.cursor.y} l ${10 / zoom} ${18 / zoom} l ${4 / zoom} ${-7 / zoom} l ${7 / zoom} ${7 / zoom}`} fill={presence.participant.color} stroke="#ffffff" stroke-width={1 / zoom} vector-effect="non-scaling-stroke" />
                  <g transform={`translate(${presence.cursor.x + 12 / zoom} ${presence.cursor.y + 16 / zoom})`}><rect width={Math.max(48, presence.participant.name.length * 6) / zoom} height={18 / zoom} rx={3 / zoom} fill={presence.participant.color} /><text x={5 / zoom} y={12 / zoom} fill="#ffffff" font-size={9 / zoom} font-weight="600">{presence.participant.name}</text></g>
                {/if}
              </g>
            {/each}
            {#each document.comments.filter((comment) => comment.pageId === page.id && comment.status === 'open' && comment.x !== null && comment.y !== null) as comment, index (comment.id)}
              <g data-design-ui pointer-events="none" transform={`translate(${comment.x} ${comment.y})`}><circle r={10 / zoom} fill="var(--app-accent)" stroke="#ffffff" stroke-width={2 / zoom} vector-effect="non-scaling-stroke" /><text x="0" y={3 / zoom} text-anchor="middle" fill="#ffffff" font-size={8 / zoom} font-weight="700">{index + 1}</text></g>
            {/each}
            {#if rulersVisible}
              <g data-design-ruler pointer-events="none" opacity="0.65">
                <rect x="0" y="0" width={page.width} height="18" fill="var(--app-surface)" />
                <rect x="0" y="0" width="18" height={page.height} fill="var(--app-surface)" />
                {#each rulerXTicks as tick}<line x1={tick} y1="0" x2={tick} y2="10" stroke="var(--app-text-muted)" stroke-width="1" vector-effect="non-scaling-stroke" /><text x={tick + 3} y="10" font-size="8" fill="var(--app-text-muted)">{tick}</text>{/each}
                {#each rulerYTicks as tick}<line x1="0" y1={tick} x2="10" y2={tick} stroke="var(--app-text-muted)" stroke-width="1" vector-effect="non-scaling-stroke" /><text x="3" y={tick + 10} font-size="8" fill="var(--app-text-muted)">{tick}</text>{/each}
              </g>
            {/if}
            {#each document.guides as guide (guide.id)}
              <line data-design-guide={guide.id} x1={guide.axis === 'x' ? guide.position : 0} y1={guide.axis === 'y' ? guide.position : 0} x2={guide.axis === 'x' ? guide.position : page.width} y2={guide.axis === 'y' ? guide.position : page.height} stroke="var(--app-secondary)" stroke-width="1" vector-effect="non-scaling-stroke" class="cursor-col-resize" />
            {/each}
            {#each snapLinesX as line}<line data-design-snap x1={line} x2={line} y1="0" y2={page.height} stroke="#2563eb" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none" />{/each}
            {#each snapLinesY as line}<line data-design-snap y1={line} y2={line} x1="0" x2={page.width} stroke="#2563eb" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none" />{/each}
            {#if selected && !vectorEditing && !selected.locked}
              <g data-design-resize data-design-ui transform={`rotate(${selected.rotation} ${selected.x + selected.width / 2} ${selected.y + selected.height / 2})`}>
                {#each resizeHandles as handle}
                  {@const position = resizeHandlePosition(selected, handle)}
                  <rect
                    x={position.x - 4 / zoom}
                    y={position.y - 4 / zoom}
                    width={8 / zoom}
                    height={8 / zoom}
                    rx={1.5 / zoom}
                    fill="#ffffff"
                    stroke="#2563eb"
                    stroke-width={1.5 / zoom}
                    vector-effect="non-scaling-stroke"
                    style:cursor={resizeCursor(handle)}
                    role="button"
                    aria-label={m['design.resize_handle']({ handle })}
                    tabindex="0"
                    onpointerdown={(event) => startResize(event, handle)}
                  />
                {/each}
              </g>
            {/if}
            {#if vectorEditing && selected?.type === 'path'}
              <g data-design-vector-edit data-design-ui transform={`rotate(${selected.rotation} ${selected.x + selected.width / 2} ${selected.y + selected.height / 2})`}>
                <path d={designPathData(selected)} fill="none" stroke="#2563eb" stroke-width={1.5 / zoom} vector-effect="non-scaling-stroke" pointer-events="none" />
                {#if selectedPathPointBounds}
                  <rect x={selectedPathPointBounds.x} y={selectedPathPointBounds.y} width={selectedPathPointBounds.width} height={selectedPathPointBounds.height} fill="none" stroke="#2563eb" stroke-width={1 / zoom} stroke-dasharray={`${4 / zoom} ${3 / zoom}`} pointer-events="none" />
                  {#each resizeHandles as handle}
                    {@const position = resizeHandlePosition(selectedPathPointBounds, handle)}
                    <rect x={position.x - 3.5 / zoom} y={position.y - 3.5 / zoom} width={7 / zoom} height={7 / zoom} rx={1 / zoom} fill="#ffffff" stroke="#2563eb" stroke-width={1.25 / zoom} style:cursor={resizeCursor(handle)} role="button" aria-label={m['design.resize_vector_points']({ handle })} tabindex="0" onpointerdown={(event) => startPathPointResize(event, handle)} />
                  {/each}
                {/if}
                {#each pathSubpaths(selected) as points, subpathIndex}
                  {@const segmentCount = selected.pathClosed ? points.length : Math.max(0, points.length - 1)}
                  {#each Array(segmentCount) as _, segmentIndex}
                    {@const from = points[segmentIndex]}
                    {@const to = points[(segmentIndex + 1) % points.length]}
                    {@const hovered = hoveredPathSegment?.elementId === selected.id && hoveredPathSegment.subpathIndex === subpathIndex && hoveredPathSegment.segmentIndex === segmentIndex}
                    <path
                      d={`M ${selected.x + from.x} ${selected.y + from.y} ${designPathSegmentData(from, to, selected.x, selected.y)}`}
                      fill="none"
                      stroke="transparent"
                      stroke-width={14 / zoom}
                      pointer-events="stroke"
                      class="cursor-crosshair"
                      role="button"
                      aria-label={m['design.path_segment']({ index: String(segmentIndex + 1) })}
                      tabindex="0"
                      onpointerenter={() => hoveredPathSegment = { elementId: selected.id, subpathIndex, segmentIndex }}
                      onpointerleave={() => hoveredPathSegment = null}
                      onpointerdown={(event) => startPathSegmentDrag(event, subpathIndex, segmentIndex)}
                      ondblclick={(event) => void insertPathPoint(event, subpathIndex, segmentIndex)}
                    />
                    {#if hovered}<path d={`M ${selected.x + from.x} ${selected.y + from.y} ${designPathSegmentData(from, to, selected.x, selected.y)}`} fill="none" stroke="#60a5fa" stroke-width={4 / zoom} pointer-events="none" />{/if}
                  {/each}
                  {#each points as point, index}
                    {@const pointSelected = isPathPointSelected(selected.id, subpathIndex, index)}
                    {#if pointSelected}
                      {#if point.inX !== null && point.inY !== null}
                        <line x1={selected.x + point.x} y1={selected.y + point.y} x2={selected.x + point.inX} y2={selected.y + point.inY} stroke="#60a5fa" stroke-width={1 / zoom} vector-effect="non-scaling-stroke" pointer-events="none" />
                        <circle cx={selected.x + point.inX} cy={selected.y + point.inY} r={4 / zoom} fill="#ffffff" stroke="#2563eb" stroke-width={1.5 / zoom} vector-effect="non-scaling-stroke" class="cursor-crosshair" role="button" aria-label={m['design.path_handle_in']({ index: String(index + 1) })} tabindex="0" onpointerdown={(event) => startPathHandleDrag(event, subpathIndex, index, 'in')} />
                      {/if}
                      {#if point.outX !== null && point.outY !== null}
                        <line x1={selected.x + point.x} y1={selected.y + point.y} x2={selected.x + point.outX} y2={selected.y + point.outY} stroke="#60a5fa" stroke-width={1 / zoom} vector-effect="non-scaling-stroke" pointer-events="none" />
                        <circle cx={selected.x + point.outX} cy={selected.y + point.outY} r={4 / zoom} fill="#ffffff" stroke="#2563eb" stroke-width={1.5 / zoom} vector-effect="non-scaling-stroke" class="cursor-crosshair" role="button" aria-label={m['design.path_handle_out']({ index: String(index + 1) })} tabindex="0" onpointerdown={(event) => startPathHandleDrag(event, subpathIndex, index, 'out')} />
                      {/if}
                    {/if}
                    <circle
                      cx={selected.x + point.x}
                      cy={selected.y + point.y}
                      r={(pointSelected ? 5 : 4) / zoom}
                      fill={pointSelected ? '#2563eb' : '#ffffff'}
                      stroke="#2563eb"
                      stroke-width={1.5 / zoom}
                      vector-effect="non-scaling-stroke"
                      class="cursor-move"
                      role="button"
                      aria-label={m['design.path_anchor']({ index: String(index + 1) })}
                      tabindex="0"
                      onpointerdown={(event) => startPathPointDrag(event, subpathIndex, index)}
                      ondblclick={(event) => { event.stopPropagation(); pathPointSelections = [{ elementId: selected.id, subpathIndex, pointIndex: index }]; void setSelectedPathPointMode(point.mode === 'corner' ? 'mirrored' : 'corner'); }}
                    />
                  {/each}
                {/each}
              </g>
            {/if}
            {#if tool === 'path' && selected?.type === 'path' && !selected.pathClosed && !selected.pathSubpaths.length && selected.pathPoints.length >= 2 && !penPoints.length}
              <g data-design-ui transform={`rotate(${selected.rotation} ${selected.x + selected.width / 2} ${selected.y + selected.height / 2})`}>
                {#each [0, selected.pathPoints.length - 1] as pointIndex}
                  {@const endpoint = selected.pathPoints[pointIndex]}
                  <circle cx={selected.x + endpoint.x} cy={selected.y + endpoint.y} r={7 / zoom} fill="#ffffff" stroke="#2563eb" stroke-width={2 / zoom} vector-effect="non-scaling-stroke" class="cursor-crosshair" role="button" aria-label={m['design.path_continue']()} tabindex="0" onpointerdown={(event) => beginPathContinuation(event, selected, pointIndex === 0)} />
                {/each}
              </g>
            {/if}
            {#if tool === 'path' && penPoints.length && penPointer}
              <g data-design-ui>
                <path d={penPreviewData()} fill="none" stroke={penWillClose ? '#16a34a' : '#2563eb'} stroke-width={1.5 / zoom} stroke-dasharray={`${5 / zoom} ${4 / zoom}`} vector-effect="non-scaling-stroke" pointer-events="none" />
                {#each penPoints as point, index}
                  <circle cx={point.x} cy={point.y} r={(index === 0 && penWillClose ? 7 : 4) / zoom} fill={index === 0 && penWillClose ? '#16a34a' : '#ffffff'} stroke={index === 0 && penWillClose ? '#16a34a' : '#2563eb'} stroke-width={1.5 / zoom} vector-effect="non-scaling-stroke" pointer-events="none" />
                {/each}
              </g>
            {/if}
            {#if selectionMarquee}
              {@const marqueeX = Math.min(selectionMarquee.start.x, selectionMarquee.current.x)}
              {@const marqueeY = Math.min(selectionMarquee.start.y, selectionMarquee.current.y)}
              <rect data-design-ui x={marqueeX} y={marqueeY} width={Math.abs(selectionMarquee.current.x - selectionMarquee.start.x)} height={Math.abs(selectionMarquee.current.y - selectionMarquee.start.y)} fill="#2563eb1a" stroke="#2563eb" stroke-width={1 / zoom} vector-effect="non-scaling-stroke" pointer-events="none" />
            {/if}
            {#if editingTextId && selected?.type === 'text' && editingTextId === selected.id}
              <foreignObject data-design-ui x={selected.x} y={selected.y} width={Math.max(selected.width, 40)} height={Math.max(editingTextHeight, selected.fontSize * 1.5)} transform={`rotate(${selected.rotation} ${selected.x + selected.width / 2} ${selected.y + selected.height / 2})`}>
                <textarea
                  bind:this={textEditor}
                  data-design-text-editor
                  class="size-full resize-none overflow-hidden border-2 border-[#2563eb] bg-transparent p-0 outline-none"
                  style={`font: ${selected.fontWeight} ${selected.fontSize}px/1.2 Inter Variable, Inter, sans-serif; color: ${selected.fills[0]?.type === 'solid' ? selected.fills[0].color : selected.fill}; text-align: ${selected.textAlign};`}
                  value={editingTextDraft}
                  oninput={(event) => editingTextDraft = event.currentTarget.value}
                  onpointerdown={(event) => event.stopPropagation()}
                  onblur={() => void finishTextEditing(true)}
                  onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); void finishTextEditing(false); } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void finishTextEditing(true); } }}
                ></textarea>
              </foreignObject>
            {/if}
          </svg>
          {#if tool === 'path' && penPoints.length}<div class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 bg-[var(--app-surface)] px-3 py-1.5 text-[10px] text-[var(--app-text-soft)] shadow-md">{m['design.finish_path']()}</div>{/if}
        </div>
      {/if}
    </main>

    <div class="pointer-events-none z-30 col-start-2 row-start-2 flex items-end justify-center p-3" data-testid="design-primary-tools">
      <div class="pointer-events-auto flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-1 shadow-xl">
        {#each [
          { id: 'select' as const, icon: MousePointer2, shortcut: 'V' },
          { id: 'hand' as const, icon: Hand, shortcut: 'H' },
          { id: 'frame' as const, icon: Frame, shortcut: 'F' },
          { id: 'rectangle' as const, icon: RectangleHorizontal, shortcut: 'R' },
          { id: 'ellipse' as const, icon: Circle, shortcut: 'O' },
          { id: 'text' as const, icon: Type, shortcut: 'T' },
          { id: 'path' as const, icon: PenTool, shortcut: 'P' },
        ] as item (item.id)}
          <DesignToolbarButton
            label={toolLabel(item.id)}
            hint={item.id === 'path'
              ? `${item.shortcut} · ${m['design.pen_hint']()}`
              : item.id === 'hand'
                ? `${item.shortcut} · ${m['design.pan_hint']()}`
                : item.shortcut}
            active={tool === item.id}
            pressed={tool === item.id}
            side="top"
            onclick={() => switchTool(item.id)}
          >
            <item.icon size={16} />
          </DesignToolbarButton>
        {/each}
      </div>
    </div>

    {#if !loading && document && page && !renderedElements.length}
      <div class="pointer-events-none z-20 col-start-2 row-start-2 grid place-items-center p-16 text-center">
        <span class="max-w-sm rounded-md border border-[var(--app-border)] bg-[var(--app-surface)]/95 px-4 py-2 text-xs leading-5 text-[var(--app-text-muted)] shadow-sm">{m['design.empty']()}</span>
      </div>
    {/if}

    {#if rightPanelVisible}
    <aside
      class={`flex min-h-0 flex-col overflow-hidden border-l border-[var(--app-border)] bg-[var(--app-surface)] ${panelsOverlay ? 'absolute top-[42px] right-0 bottom-0 z-40 w-[min(320px,calc(100%-48px))] shadow-2xl' : 'col-start-3 row-start-2'}`}
      data-testid="design-right-panel"
    >
      <div class="grid grid-cols-4 gap-1 border-b border-[var(--app-border)] p-1.5">
        <button title={m['design.properties']()} class={`grid h-8 place-items-center rounded ${rightPanel === 'design' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-label={m['design.properties']()} aria-pressed={rightPanel === 'design'} onclick={() => (rightPanel = 'design')}><SlidersHorizontal size={14} /></button>
        <button title={m['design.prototype']()} class={`grid h-8 place-items-center rounded ${rightPanel === 'prototype' ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-label={m['design.prototype']()} aria-pressed={rightPanel === 'prototype'} onclick={() => (rightPanel = 'prototype')}><Workflow size={14} /></button>
        <button title={m['design.collaboration']()} class={`grid h-8 place-items-center rounded ${rightPanel === 'collaboration' ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-label={m['design.collaboration']()} aria-pressed={rightPanel === 'collaboration'} onclick={() => (rightPanel = 'collaboration')}><UsersRound size={14} /></button>
        <button title={m['design.quality']()} class={`grid h-8 place-items-center rounded ${rightPanel === 'quality' ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-label={m['design.quality']()} aria-pressed={rightPanel === 'quality'} onclick={() => (rightPanel = 'quality')}><ShieldCheck size={14} /></button>
      </div>
      {#if rightPanel === 'quality' && document}
        <div class="min-h-0 flex-1"><DesignQualityPanel {workspaceId} {nodeId} {document} {saving} onSelect={(elementId) => { selectedIds = [elementId]; vectorEditId = null; pathPointSelections = []; }} onDocumentChange={(nextDocument) => { document = nextDocument; selectedIds = []; undoStack = []; redoStack = []; }} /></div>
      {:else if rightPanel === 'collaboration' && document}
        <div class="min-h-0 flex-1"><DesignCollaborationPanel {document} {selected} {participant} {collaboration} {followParticipantId} {saving} makeId={uuidv7} onApply={(operations, summary) => apply(operations, summary)} onFollow={followParticipant} onPreview={previewProposal} onOpenCouncil={openProposalCouncil} onCreateFloor={createProposalFloor} /></div>
      {:else if rightPanel === 'prototype' && document}
        <div class="min-h-0 flex-1"><DesignPrototypePanel {document} {selected} {saving} makeId={uuidv7} onApply={(operations, summary, inverse) => apply(operations, summary, { inverse })} onPreview={openPrototype} onShare={sharePrototype} /></div>
      {:else if selected && document}
        <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="space-y-4 p-3 text-[11px]">
          <label class="block space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.name']()}</span><Input value={selected.name} onchange={(event: Event) => void updateSelected({ name: (event.currentTarget as HTMLInputElement).value })} /></label>
          <section class="space-y-2"><h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.position']()}</h3><div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[var(--app-text-muted)]">X</span><Input type="number" value={selected.x} onchange={(event: Event) => void updateSelected({ x: number(event) })} /></label><label class="space-y-1"><span class="text-[var(--app-text-muted)]">Y</span><Input type="number" value={selected.y} onchange={(event: Event) => void updateSelected({ y: number(event) })} /></label><label class="col-span-2 space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.rotation']()}</span><Input type="number" value={selected.rotation} onchange={(event: Event) => void updateSelected({ rotation: number(event) })} /></label></div></section>
          <section class="space-y-2"><h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.size']()}</h3><div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[var(--app-text-muted)]">W</span><Input type="number" min="1" value={selected.width} onchange={(event: Event) => void updateSelected({ width: Math.max(1, number(event)) })} /></label><label class="space-y-1"><span class="text-[var(--app-text-muted)]">H</span><Input type="number" min="1" value={selected.height} onchange={(event: Event) => void updateSelected({ height: Math.max(1, number(event)) })} /></label></div></section>
          <section class="space-y-2"><h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.appearance']()}</h3><div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.stroke_width']()}</span><Input type="number" min="0" value={selected.strokeWidth} onchange={(event: Event) => void updateSelected({ strokeWidth: Math.max(0, number(event)) })} /></label><label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.radius']()}</span><Input type="number" min="0" value={selected.cornerRadius} onchange={(event: Event) => void updateSelected({ cornerRadius: Math.max(0, number(event)) })} /></label><label class="col-span-2 space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.opacity']()}</span><Input type="number" min="0" max="100" value={Math.round(selected.opacity * 100)} onchange={(event: Event) => void updateSelected({ opacity: Math.max(0, Math.min(1, number(event) / 100)) })} /></label></div><label class="block space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.blend_mode']()}</span><NativeSelect.Root class="w-full" value={selected.blendMode} onchange={(event: Event) => void updateSelected({ blendMode: (event.currentTarget as HTMLSelectElement).value as DesignElement['blendMode'] })}><NativeSelect.Option value="normal">{m['design.blend_normal']()}</NativeSelect.Option><NativeSelect.Option value="multiply">{m['design.blend_multiply']()}</NativeSelect.Option><NativeSelect.Option value="screen">{m['design.blend_screen']()}</NativeSelect.Option><NativeSelect.Option value="overlay">{m['design.blend_overlay']()}</NativeSelect.Option><NativeSelect.Option value="darken">{m['design.blend_darken']()}</NativeSelect.Option><NativeSelect.Option value="lighten">{m['design.blend_lighten']()}</NativeSelect.Option></NativeSelect.Root></label></section>
          <DesignVariableBindings document={document} element={selected} onBind={(property, variableId) => void bindSelectedVariable(property, variableId)} onOpenVariables={() => (leftPanel = 'variables')} />
          <section class="space-y-2 border-y border-[var(--app-border)] py-3">
            <h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.accessibility']()}</h3>
            <label class="block space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.accessibility_role']()}</span><NativeSelect.Root class="w-full" value={selected.accessibilityRole} onchange={(event: Event) => void updateSelected({ accessibilityRole: (event.currentTarget as HTMLSelectElement).value as DesignElement['accessibilityRole'] })}><NativeSelect.Option value="none">{m['design.accessibility_role_none']()}</NativeSelect.Option><NativeSelect.Option value="button">{m['design.accessibility_role_button']()}</NativeSelect.Option><NativeSelect.Option value="link">{m['design.accessibility_role_link']()}</NativeSelect.Option><NativeSelect.Option value="heading">{m['design.accessibility_role_heading']()}</NativeSelect.Option><NativeSelect.Option value="image">{m['design.accessibility_role_image']()}</NativeSelect.Option><NativeSelect.Option value="text">{m['design.accessibility_role_text']()}</NativeSelect.Option><NativeSelect.Option value="input">{m['design.accessibility_role_input']()}</NativeSelect.Option><NativeSelect.Option value="navigation">{m['design.accessibility_role_navigation']()}</NativeSelect.Option><NativeSelect.Option value="region">{m['design.accessibility_role_region']()}</NativeSelect.Option></NativeSelect.Root></label>
            <label class="block space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.accessibility_label']()}</span><Input value={selected.accessibilityLabel ?? ''} placeholder={m['design.accessibility_label_placeholder']()} onchange={(event: Event) => void updateSelected({ accessibilityLabel: (event.currentTarget as HTMLInputElement).value.trim() || null })} /></label>
            <label class="flex items-center justify-between gap-3"><span class="text-[var(--app-text-muted)]">{m['design.decorative']()}</span><Switch checked={selected.decorative} onCheckedChange={(checked: boolean) => void updateSelected({ decorative: checked })} /></label>
          </section>
          {#if selected.type !== 'image' && selected.type !== 'group'}
            <DesignPaintEditor title={m['design.fill']()} paints={selected.fills} fallbackColor={selected.fill} onChange={(fills: DesignPaint[]) => void updateSelected({ fills, fill: fills.length ? 'transparent' : selected.fill })} />
            <DesignColorTools role="fill" color={primaryColor(selected, 'fill')} matches={matchingColorLayers('fill', primaryColor(selected, 'fill'))} selectionCount={selectedElements.length} onSelectMatches={() => { const color = primaryColor(selected, 'fill'); if (color) selectMatchingColor('fill', color); }} onSelectLayer={(id) => (selectedIds = [id])} onApplySelection={(color) => void applyColorToSelection('fill', color)} onReplaceMatches={(color) => { const from = primaryColor(selected, 'fill'); if (from) void replaceMatchingColor('fill', from, color); }} />
          {/if}
          {#if selected.type !== 'group'}
            <DesignPaintEditor title={m['design.stroke']()} paints={selected.strokes} fallbackColor={selected.stroke} onChange={(strokes: DesignPaint[]) => void updateSelected({ strokes, stroke: strokes.length ? 'transparent' : selected.stroke, strokeWidth: strokes.length && !selected.strokeWidth ? 1 : selected.strokeWidth })} />
            <DesignColorTools role="stroke" color={primaryColor(selected, 'stroke')} matches={matchingColorLayers('stroke', primaryColor(selected, 'stroke'))} selectionCount={selectedElements.length} onSelectMatches={() => { const color = primaryColor(selected, 'stroke'); if (color) selectMatchingColor('stroke', color); }} onSelectLayer={(id) => (selectedIds = [id])} onApplySelection={(color) => void applyColorToSelection('stroke', color)} onReplaceMatches={(color) => { const from = primaryColor(selected, 'stroke'); if (from) void replaceMatchingColor('stroke', from, color); }} />
          {/if}
          <section class="space-y-2"><div class="flex items-center justify-between"><h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.effects']()}</h3><div class="flex gap-1"><Button variant="ghost" size="sm" class="h-6 px-1.5 text-[9px]" onclick={() => void updateSelected({ effects: [...selected.effects, { type: 'drop-shadow', color: '#00000040', x: 0, y: 4, blur: 12, spread: 0, visible: true }] })}>{m['design.add_shadow']()}</Button><Button variant="ghost" size="sm" class="h-6 px-1.5 text-[9px]" onclick={() => void updateSelected({ effects: [...selected.effects, { type: 'layer-blur', blur: 8, visible: true }] })}>{m['design.add_blur']()}</Button></div></div>{#each selected.effects as effect, index}<div class="grid grid-cols-[1fr_64px_26px] items-center gap-1.5 border border-[var(--app-border)] p-2"><span>{effect.type === 'drop-shadow' || effect.type === 'inner-shadow' ? m['design.shadow']() : m['design.blur']()}</span><Input class="h-7" type="number" min="0" value={effect.blur} onchange={(event: Event) => { const effects = selected.effects.map((item, itemIndex) => itemIndex === index ? { ...item, blur: Math.max(0, number(event)) } as DesignEffect : item); void updateSelected({ effects }); }} /><Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.delete']()} onclick={() => void updateSelected({ effects: selected.effects.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={11} /></Button></div>{/each}</section>
          {#if selected.type === 'text'}<section class="space-y-2"><h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.content']()}</h3><Textarea value={selected.text} onchange={(event: Event) => void updateSelected({ text: (event.currentTarget as HTMLTextAreaElement).value })} /><div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.font_size']()}</span><Input type="number" min="4" value={selected.fontSize} onchange={(event: Event) => void updateSelected({ fontSize: Math.max(4, number(event)) })} /></label><label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.font_weight']()}</span><Input type="number" min="100" max="900" step="100" value={selected.fontWeight} onchange={(event: Event) => void updateSelected({ fontWeight: Math.max(100, Math.min(900, number(event))) })} /></label></div><div class="grid grid-cols-3 gap-1">{#each [{ value: 'left' as const, icon: AlignLeft, label: m['design.align_left']() }, { value: 'center' as const, icon: AlignCenter, label: m['design.align_center']() }, { value: 'right' as const, icon: AlignRight, label: m['design.align_right']() }] as alignment}<Button variant={selected.textAlign === alignment.value ? 'secondary' : 'outline'} size="sm" aria-label={alignment.label} onclick={() => void updateSelected({ textAlign: alignment.value })}><alignment.icon size={14} /></Button>{/each}</div></section>{/if}
          {#if selected.type === 'path'}
            <section class="space-y-2 border-y border-[var(--app-border)] py-3">
              <div class="flex items-center justify-between">
                <h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.path_points']()}</h3>
                <span class="tabular-nums text-[var(--app-text-muted)]">{pathPointSelections.length}/{pathSubpaths(selected).reduce((total, points) => total + points.length, 0)}</span>
              </div>
              {#if !vectorEditing}
                <Button class="w-full" variant="outline" size="sm" onclick={() => enterVectorEdit(selected)}><Spline size={13} />{m['design.vector_edit']()}</Button>
              {:else if pathPointSelections.length}
                <div class="grid grid-cols-4 gap-1">
                  <Button variant={selectedPathPointMode === 'corner' ? 'secondary' : 'outline'} size="icon-sm" aria-label={m['design.path_corner']()} title={m['design.path_corner']()} onclick={() => void setSelectedPathPointMode('corner')}><CornerDownRight size={13} /></Button>
                  <Button variant={selectedPathPointMode === 'mirrored' ? 'secondary' : 'outline'} size="icon-sm" aria-label={m['design.path_mirrored']()} title={m['design.path_mirrored']()} onclick={() => void setSelectedPathPointMode('mirrored')}><Spline size={13} /></Button>
                  <Button variant={selectedPathPointMode === 'asymmetric' ? 'secondary' : 'outline'} size="icon-sm" aria-label={m['design.path_asymmetric']()} title={m['design.path_asymmetric']()} onclick={() => void setSelectedPathPointMode('asymmetric')}><MoveDiagonal2 size={13} /></Button>
                  <Button variant={selectedPathPointMode === 'disconnected' ? 'secondary' : 'outline'} size="icon-sm" aria-label={m['design.path_disconnected']()} title={m['design.path_disconnected']()} onclick={() => void setSelectedPathPointMode('disconnected')}><Unlink2 size={13} /></Button>
                </div>
                {#if selectedPathPoint}
                  <div class="grid grid-cols-2 gap-2">
                    <label class="space-y-1"><span class="text-[var(--app-text-muted)]">X</span><Input type="number" value={Math.round(selectedPathPoint.x * 100) / 100} onchange={(event: Event) => void updateSelectedPathPointPosition('x', number(event))} /></label>
                    <label class="space-y-1"><span class="text-[var(--app-text-muted)]">Y</span><Input type="number" value={Math.round(selectedPathPoint.y * 100) / 100} onchange={(event: Event) => void updateSelectedPathPointPosition('y', number(event))} /></label>
                  </div>
                {/if}
                <div class="grid grid-cols-2 gap-1.5">
                  <Button variant="outline" size="sm" onclick={() => void addPathPointAfterSelection()}><Plus size={12} />{m['design.path_add_point']()}</Button>
                  <Button variant="outline" size="sm" onclick={() => void deleteSelectedPathPoint()}><Trash2 size={12} />{m['design.path_delete_point']()}</Button>
                </div>
              {/if}
              <label class="flex items-center justify-between gap-3"><span>{m['design.close_path']()}</span><Switch size="sm" checked={selected.pathClosed} onCheckedChange={(checked: boolean) => void updateSelected({ pathClosed: checked })} /></label>
            </section>
          {/if}
          {#if selected.type === 'image'}<section class="space-y-2"><h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.image_fit']()}</h3><NativeSelect.Root class="w-full" value={selected.imageFit} onchange={(event: Event) => void updateSelected({ imageFit: (event.currentTarget as HTMLSelectElement).value as DesignElement['imageFit'] })}><NativeSelect.Option value="cover">{m['design.fit_cover']()}</NativeSelect.Option><NativeSelect.Option value="contain">{m['design.fit_contain']()}</NativeSelect.Option><NativeSelect.Option value="fill">{m['design.fit_fill']()}</NativeSelect.Option></NativeSelect.Root></section>{/if}
          {#if selected.type === 'frame'}<section class="space-y-2"><h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.auto_layout']()}</h3><NativeSelect.Root class="w-full" value={selected.layoutMode} onchange={(event: Event) => void updateSelected({ layoutMode: (event.currentTarget as HTMLSelectElement).value as DesignElement['layoutMode'] })}><NativeSelect.Option value="none">{m['design.layout_none']()}</NativeSelect.Option><NativeSelect.Option value="horizontal">{m['design.layout_horizontal']()}</NativeSelect.Option><NativeSelect.Option value="vertical">{m['design.layout_vertical']()}</NativeSelect.Option><NativeSelect.Option value="grid">{m['design.layout_grid']()}</NativeSelect.Option></NativeSelect.Root><div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.gap']()}</span><Input type="number" min="0" value={selected.layoutGap} onchange={(event: Event) => void updateSelected({ layoutGap: Math.max(0, number(event)) })} /></label><label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.padding']()}</span><Input type="number" min="0" value={selected.layoutPaddingTop} onchange={(event: Event) => { const value = Math.max(0, number(event)); void updateSelected({ layoutPaddingTop: value, layoutPaddingRight: value, layoutPaddingBottom: value, layoutPaddingLeft: value }); }} /></label>{#if selected.layoutMode === 'grid'}<label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.columns']()}</span><Input type="number" min="1" value={selected.layoutGridColumns} onchange={(event: Event) => void updateSelected({ layoutGridColumns: Math.max(1, number(event)) })} /></label>{/if}</div><label class="flex items-center justify-between gap-3"><span>{m['design.wrap']()}</span><Switch size="sm" checked={selected.layoutWrap} onCheckedChange={(checked: boolean) => void updateSelected({ layoutWrap: checked })} /></label><label class="flex items-center justify-between gap-3"><span>{m['design.clip_content']()}</span><Switch size="sm" checked={selected.clipContent} onCheckedChange={(checked: boolean) => void updateSelected({ clipContent: checked })} /></label><Button class="w-full" variant="outline" size="sm" onclick={() => void applyAutoLayout()}><Sparkles size={13} />{m['design.apply_layout']()}</Button></section>{/if}
          {#if selected.parentId}<section class="space-y-2"><h3 class="font-semibold text-[var(--app-text-soft)]">{m['design.constraints']()}</h3><div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.horizontal']()}</span><NativeSelect.Root value={selected.constraintHorizontal} onchange={(event: Event) => void updateSelected({ constraintHorizontal: (event.currentTarget as HTMLSelectElement).value as DesignElement['constraintHorizontal'] })}><NativeSelect.Option value="left">{m['design.align_left']()}</NativeSelect.Option><NativeSelect.Option value="right">{m['design.align_right']()}</NativeSelect.Option><NativeSelect.Option value="left-right">{m['design.constraint_left_right']()}</NativeSelect.Option><NativeSelect.Option value="center">{m['design.align_center']()}</NativeSelect.Option><NativeSelect.Option value="scale">{m['design.constraint_scale']()}</NativeSelect.Option></NativeSelect.Root></label><label class="space-y-1"><span class="text-[var(--app-text-muted)]">{m['design.vertical']()}</span><NativeSelect.Root value={selected.constraintVertical} onchange={(event: Event) => void updateSelected({ constraintVertical: (event.currentTarget as HTMLSelectElement).value as DesignElement['constraintVertical'] })}><NativeSelect.Option value="top">{m['design.align_top']()}</NativeSelect.Option><NativeSelect.Option value="bottom">{m['design.align_bottom']()}</NativeSelect.Option><NativeSelect.Option value="top-bottom">{m['design.constraint_top_bottom']()}</NativeSelect.Option><NativeSelect.Option value="center">{m['design.align_center']()}</NativeSelect.Option><NativeSelect.Option value="scale">{m['design.constraint_scale']()}</NativeSelect.Option></NativeSelect.Root></label></div></section>{/if}
          {#if selected.type === 'group'}<Button class="w-full" variant="outline" size="sm" onclick={() => void ungroupSelection()}><Ungroup size={13} />{m['design.ungroup_selection']()}</Button>{/if}
          <div class="flex items-center gap-1 border-t border-[var(--app-border)] pt-3"><Button variant="outline" size="icon-sm" aria-label={m['design.move_down']()} onclick={() => void reorder(-1)}><ArrowDown /></Button><Button variant="outline" size="icon-sm" aria-label={m['design.move_up']()} onclick={() => void reorder(1)}><ArrowUp /></Button><div class="flex-1"></div><Button variant="destructive" size="icon-sm" disabled={selected.locked} aria-label={m['design.delete']()} onclick={() => void removeSelected()}><Trash2 /></Button></div>
        </div></div>
      {:else if selectedElements.length > 1}
        <div class="min-h-0 flex-1 overflow-y-auto"><div class="space-y-4 p-3">
          <p class="text-xs font-medium">{m['design.multiple_selection']({ count: String(selectedElements.length) })}</p>
          <section class="space-y-2">
            <h3 class="text-[11px] font-semibold text-[var(--app-text-soft)]">{m['design.alignment']()}</h3>
            <div class="grid grid-cols-4 gap-1">
              <Button variant="outline" size="icon-sm" title={m['design.align_left']()} aria-label={m['design.align_left']()} onclick={() => void alignSelection('left')}><AlignHorizontalJustifyStart size={14} /></Button>
              <Button variant="outline" size="icon-sm" title={m['design.align_horizontal_center']()} aria-label={m['design.align_horizontal_center']()} onclick={() => void alignSelection('hcenter')}><AlignHorizontalJustifyCenter size={14} /></Button>
              <Button variant="outline" size="icon-sm" title={m['design.align_right']()} aria-label={m['design.align_right']()} onclick={() => void alignSelection('right')}><AlignHorizontalJustifyEnd size={14} /></Button>
              <Button variant="outline" size="icon-sm" title={m['design.distribute_horizontal']()} aria-label={m['design.distribute_horizontal']()} disabled={selectedElements.length < 3} onclick={() => void alignSelection('distribute-x')}><AlignHorizontalDistributeCenter size={14} /></Button>
              <Button variant="outline" size="icon-sm" title={m['design.align_top']()} aria-label={m['design.align_top']()} onclick={() => void alignSelection('top')}><AlignVerticalJustifyStart size={14} /></Button>
              <Button variant="outline" size="icon-sm" title={m['design.align_vertical_center']()} aria-label={m['design.align_vertical_center']()} onclick={() => void alignSelection('vcenter')}><AlignVerticalJustifyCenter size={14} /></Button>
              <Button variant="outline" size="icon-sm" title={m['design.align_bottom']()} aria-label={m['design.align_bottom']()} onclick={() => void alignSelection('bottom')}><AlignVerticalJustifyEnd size={14} /></Button>
              <Button variant="outline" size="icon-sm" title={m['design.distribute_vertical']()} aria-label={m['design.distribute_vertical']()} disabled={selectedElements.length < 3} onclick={() => void alignSelection('distribute-y')}><AlignVerticalDistributeCenter size={14} /></Button>
            </div>
          </section>
          <section class="space-y-2">
            <h3 class="text-[11px] font-semibold text-[var(--app-text-soft)]">{m['design.color_tools']()}</h3>
            <DesignColorTools role="fill" color={primaryColor(selectedElements[0], 'fill')} matches={matchingColorLayers('fill', primaryColor(selectedElements[0], 'fill'))} selectionCount={selectedElements.length} onSelectMatches={() => { const color = primaryColor(selectedElements[0], 'fill'); if (color) selectMatchingColor('fill', color); }} onSelectLayer={(id) => (selectedIds = [id])} onApplySelection={(color) => void applyColorToSelection('fill', color)} onReplaceMatches={(color) => { const from = primaryColor(selectedElements[0], 'fill'); if (from) void replaceMatchingColor('fill', from, color); }} />
            <DesignColorTools role="stroke" color={primaryColor(selectedElements[0], 'stroke')} matches={matchingColorLayers('stroke', primaryColor(selectedElements[0], 'stroke'))} selectionCount={selectedElements.length} onSelectMatches={() => { const color = primaryColor(selectedElements[0], 'stroke'); if (color) selectMatchingColor('stroke', color); }} onSelectLayer={(id) => (selectedIds = [id])} onApplySelection={(color) => void applyColorToSelection('stroke', color)} onReplaceMatches={(color) => { const from = primaryColor(selectedElements[0], 'stroke'); if (from) void replaceMatchingColor('stroke', from, color); }} />
          </section>
          <Button variant="outline" size="sm" class="w-full" onclick={() => void groupSelection()}><Group size={13} />{m['design.group_selection']()}</Button>
          <p class="text-[10px] leading-4 text-[var(--app-text-muted)]">{m['design.boolean']()} · {m['design.mask']()}</p>
          <Button variant="destructive" size="sm" class="w-full" onclick={() => void removeSelected()}><Trash2 size={13} />{m['design.delete']()}</Button>
        </div></div>
      {:else}
        <div class="min-h-0 flex-1 overflow-y-auto"><div class="space-y-4 p-3"><p class="text-xs leading-5 text-[var(--app-text-muted)]">{m['design.no_selection']()}</p>{#if document?.guides.length}<section class="space-y-2"><h3 class="text-[11px] font-semibold">{m['design.rulers']()}</h3>{#each document.guides as guide}<div class="flex items-center gap-2"><span class="w-4 text-[10px] font-semibold uppercase text-[var(--app-text-muted)]">{guide.axis}</span><Input class="h-7 flex-1" type="number" value={guide.position} onchange={(event: Event) => void apply([{ kind: 'update-guide', guideId: guide.id, position: number(event) }], m['design.operation_guide'](), { inverse: [{ kind: 'update-guide', guideId: guide.id, position: guide.position }] })} /><Button variant="ghost" size="icon-sm" class="size-7" aria-label={m['design.remove_guide']()} onclick={() => void removeGuide(guide.id)}><Trash2 size={11} /></Button></div>{/each}</section>{/if}</div></div>
      {/if}
    </aside>
    {/if}
  </div>
</div>

{#if prototypeOpen && document}
  <DesignPrototypePlayer {document} {workspaceId} flowId={prototypeFlowId} onClose={() => (prototypeOpen = false)} onShare={sharePrototype} />
{/if}
