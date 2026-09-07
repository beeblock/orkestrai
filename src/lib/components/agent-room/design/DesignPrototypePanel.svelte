<script lang="ts">
  import {
    ArrowRight,
    ChevronDown,
    CirclePlay,
    Clock3,
    Copy,
    Diamond,
    Film,
    Link2,
    MousePointerClick,
    Plus,
    Share2,
    Sparkles,
    Trash2,
  } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type {
    DesignDocument,
    DesignElement,
    DesignMotionEasing,
    DesignMotionKeyframe,
    DesignMotionKeyframeValues,
    DesignMotionTrack,
    DesignOperation,
    DesignPrototypeAction,
    DesignPrototypeInteraction,
    DesignPrototypeTransition,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import {
    defaultPrototypeFlow,
    exportMotionCss,
    exportMotionDev,
    prototypeFrameForElement,
    prototypeFrames,
  } from '$lib/modules/agent-room/domain/design-prototype.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    document,
    selected,
    saving,
    makeId,
    onApply,
    onPreview,
    onShare,
  }: {
    document: DesignDocument;
    selected: DesignElement | null;
    saving: boolean;
    makeId: () => string;
    onApply: (operations: DesignOperation[], summary: string, inverse?: DesignOperation[]) => Promise<boolean>;
    onPreview: (flowId: string | null) => void;
    onShare: (flowId: string) => void | Promise<void>;
  } = $props();

  type PanelTab = 'prototype' | 'motion';
  type EasingPreset = Extract<DesignMotionEasing, { type: 'preset' }>['value'];
  type ActionType = DesignPrototypeAction['type'];

  let tab = $state<PanelTab>('prototype');
  let expandedInteractionId = $state<string | null>(null);
  let expandedTrackId = $state<string | null>(null);
  let selectedKeyframeId = $state<string | null>(null);

  const frames = $derived(prototypeFrames(document));
  const selectedFrame = $derived(selected?.type === 'frame' ? selected : selected ? prototypeFrameForElement(document, selected.id) : null);
  const interactions = $derived(selected ? document.prototypeInteractions.filter((interaction) => interaction.sourceElementId === selected.id).sort((left, right) => left.order - right.order) : []);
  const tracks = $derived(selected ? document.motionTracks.filter((track) => track.elementId === selected.id).sort((left, right) => left.order - right.order) : []);
  const activeFlow = $derived(defaultPrototypeFlow(document));

  function number(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value) || 0;
  }

  function nextTargetFrame(): DesignElement | null {
    return frames.find((frame) => frame.id !== selectedFrame?.id) ?? selectedFrame ?? frames[0] ?? null;
  }

  async function addFlow() {
    const frame = selected?.type === 'frame' ? selected : nextTargetFrame();
    if (!frame) return;
    const flow = {
      id: makeId(),
      name: m['design.prototype_flow_name']({ count: String(document.prototypeFlows.length + 1) }),
      description: '',
      startFrameId: frame.id,
      order: Math.max(-1, ...document.prototypeFlows.map((candidate) => candidate.order)) + 1,
    };
    await onApply(
      [{ kind: 'add-prototype-flow', flow }],
      m['design.prototype_operation_flow_add'](),
      [{ kind: 'delete-prototype-flow', flowId: flow.id }],
    );
  }

  async function updateFlow(flowId: string, changes: Partial<DesignDocument['prototypeFlows'][number]>) {
    const flow = document.prototypeFlows.find((candidate) => candidate.id === flowId);
    if (!flow) return;
    const inverse = Object.fromEntries(Object.keys(changes).map((key) => [key, flow[key as keyof typeof flow]]));
    await onApply(
      [{ kind: 'update-prototype-flow', flowId, changes }],
      m['design.prototype_operation_flow_update'](),
      [{ kind: 'update-prototype-flow', flowId, changes: inverse }],
    );
  }

  async function deleteFlow(flowId: string) {
    const flow = document.prototypeFlows.find((candidate) => candidate.id === flowId);
    if (!flow) return;
    await onApply(
      [{ kind: 'delete-prototype-flow', flowId }],
      m['design.prototype_operation_flow_delete'](),
      [{ kind: 'add-prototype-flow', flow }],
    );
  }

  function defaultAction(type: ActionType): DesignPrototypeAction | null {
    const target = nextTargetFrame();
    if ((type === 'navigate' || type === 'open-overlay') && !target) return null;
    if (type === 'navigate') return { type, targetFrameId: target!.id };
    if (type === 'open-overlay') return { type, targetFrameId: target!.id, position: 'center', dismissOnOutside: true, backgroundColor: '#000000', backgroundOpacity: 0.45 };
    if (type === 'close-overlay') return { type };
    if (type === 'back') return { type };
    if (type === 'scroll-to') return { type, targetElementId: selectedFrame?.id ?? selected?.id ?? document.elements[0]?.id };
    const collection = document.variableCollections[0];
    const mode = collection?.modes[0];
    return collection && mode ? { type, collectionId: collection.id, modeId: mode.id } : null;
  }

  async function addInteraction() {
    if (!selected) return;
    const action = defaultAction('navigate') ?? defaultAction('back');
    if (!action) return;
    const interaction: DesignPrototypeInteraction = {
      id: makeId(),
      sourceElementId: selected.id,
      trigger: { type: 'click', delayMs: 0 },
      action,
      transition: { type: 'dissolve', direction: 'left', durationMs: 300, easing: { type: 'preset', value: 'ease-out' } },
      order: Math.max(-1, ...document.prototypeInteractions.map((candidate) => candidate.order)) + 1,
    };
    if (await onApply(
      [{ kind: 'add-prototype-interaction', interaction }],
      m['design.prototype_operation_interaction_add'](),
      [{ kind: 'delete-prototype-interaction', interactionId: interaction.id }],
    )) expandedInteractionId = interaction.id;
  }

  async function updateInteraction(interaction: DesignPrototypeInteraction, changes: Partial<Omit<DesignPrototypeInteraction, 'id' | 'sourceElementId'>>) {
    const inverse = Object.fromEntries(Object.keys(changes).map((key) => [key, interaction[key as keyof DesignPrototypeInteraction]]));
    await onApply(
      [{ kind: 'update-prototype-interaction', interactionId: interaction.id, changes }],
      m['design.prototype_operation_interaction_update'](),
      [{ kind: 'update-prototype-interaction', interactionId: interaction.id, changes: inverse }],
    );
  }

  function updateActionTarget(interaction: DesignPrototypeInteraction, targetFrameId: string) {
    const action = interaction.action;
    if (action.type !== 'navigate' && action.type !== 'open-overlay') return;
    void updateInteraction(interaction, { action: { ...action, targetFrameId } });
  }

  function updateOverlayAction(
    interaction: DesignPrototypeInteraction,
    changes: Partial<Extract<DesignPrototypeAction, { type: 'open-overlay' }>>,
  ) {
    const action = interaction.action;
    if (action.type !== 'open-overlay') return;
    void updateInteraction(interaction, { action: { ...action, ...changes } });
  }

  function updateVariableMode(interaction: DesignPrototypeInteraction, modeId: string) {
    const action = interaction.action;
    if (action.type !== 'set-variable-mode') return;
    void updateInteraction(interaction, { action: { ...action, modeId } });
  }

  function variableModesFor(interaction: DesignPrototypeInteraction) {
    const action = interaction.action;
    if (action.type !== 'set-variable-mode') return [];
    return document.variableCollections.find((candidate) => candidate.id === action.collectionId)?.modes ?? [];
  }

  async function changeAction(interaction: DesignPrototypeInteraction, type: ActionType) {
    const action = defaultAction(type);
    if (!action) {
      toast.error(type === 'set-variable-mode' ? m['design.prototype_modes_empty']() : m['design.prototype_frames_empty']());
      return;
    }
    await updateInteraction(interaction, { action });
  }

  async function deleteInteraction(interaction: DesignPrototypeInteraction) {
    await onApply(
      [{ kind: 'delete-prototype-interaction', interactionId: interaction.id }],
      m['design.prototype_operation_interaction_delete'](),
      [{ kind: 'add-prototype-interaction', interaction }],
    );
  }

  async function updateSelected(changes: Partial<DesignElement>) {
    if (!selected) return;
    const inverse = Object.fromEntries(Object.keys(changes).map((key) => [key, selected[key as keyof DesignElement]])) as Partial<DesignElement>;
    await onApply(
      [{ kind: 'update', elementId: selected.id, changes }],
      m['design.prototype_operation_layer_update'](),
      [{ kind: 'update', elementId: selected.id, changes: inverse }],
    );
  }

  function keyframeValues(element: DesignElement): DesignMotionKeyframeValues {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      opacity: element.opacity,
      cornerRadius: element.cornerRadius,
      fill: element.fills.find((paint) => paint.type === 'solid')?.color ?? (element.fill === 'transparent' ? '#000000' : element.fill),
    };
  }

  async function addTrack() {
    if (!selected) return;
    const durationMs = document.motionTokens[0]?.durationMs ?? 300;
    const start: DesignMotionKeyframe = { id: makeId(), timeMs: 0, values: keyframeValues(selected) };
    const end: DesignMotionKeyframe = { id: makeId(), timeMs: durationMs, values: keyframeValues(selected) };
    const track: DesignMotionTrack = {
      id: makeId(),
      elementId: selected.id,
      name: m['design.motion_track_name']({ count: String(tracks.length + 1) }),
      durationMs,
      delayMs: 0,
      iterations: 1,
      direction: 'normal',
      fillMode: 'forwards',
      tokenId: document.motionTokens[0]?.id ?? null,
      easing: document.motionTokens[0]?.easing ?? { type: 'preset', value: 'ease-out' },
      keyframes: [start, end],
      order: Math.max(-1, ...document.motionTracks.map((candidate) => candidate.order)) + 1,
    };
    if (await onApply(
      [{ kind: 'add-motion-track', track }],
      m['design.motion_operation_track_add'](),
      [{ kind: 'delete-motion-track', trackId: track.id }],
    )) {
      expandedTrackId = track.id;
      selectedKeyframeId = start.id;
    }
  }

  async function updateTrack(track: DesignMotionTrack, changes: Partial<Omit<DesignMotionTrack, 'id' | 'elementId'>>): Promise<boolean> {
    const inverse = Object.fromEntries(Object.keys(changes).map((key) => [key, track[key as keyof DesignMotionTrack]]));
    return onApply(
      [{ kind: 'update-motion-track', trackId: track.id, changes }],
      m['design.motion_operation_track_update'](),
      [{ kind: 'update-motion-track', trackId: track.id, changes: inverse }],
    );
  }

  async function deleteTrack(track: DesignMotionTrack) {
    await onApply(
      [{ kind: 'delete-motion-track', trackId: track.id }],
      m['design.motion_operation_track_delete'](),
      [{ kind: 'add-motion-track', track }],
    );
  }

  async function addKeyframe(track: DesignMotionTrack) {
    if (!selected) return;
    const occupied = new Set(track.keyframes.map((keyframe) => keyframe.timeMs));
    let timeMs = Math.round(track.durationMs / 2);
    while (occupied.has(timeMs) && timeMs < track.durationMs) timeMs += 1;
    if (occupied.has(timeMs)) return;
    const keyframe = { id: makeId(), timeMs, values: keyframeValues(selected) };
    const keyframes = [...track.keyframes, keyframe].sort((left, right) => left.timeMs - right.timeMs);
    if (await updateTrack(track, { keyframes })) selectedKeyframeId = keyframe.id;
  }

  async function updateKeyframe(track: DesignMotionTrack, keyframe: DesignMotionKeyframe, changes: Partial<DesignMotionKeyframe>) {
    const keyframes = track.keyframes.map((candidate) => candidate.id === keyframe.id ? { ...candidate, ...changes } : candidate).sort((left, right) => left.timeMs - right.timeMs);
    await updateTrack(track, { keyframes });
  }

  async function deleteKeyframe(track: DesignMotionTrack, keyframeId: string) {
    if (track.keyframes.length <= 2) return;
    const keyframes = track.keyframes.filter((candidate) => candidate.id !== keyframeId);
    if (await updateTrack(track, { keyframes })) selectedKeyframeId = keyframes[0]?.id ?? null;
  }

  async function addToken() {
    const token = {
      id: makeId(),
      name: m['design.motion_token_name']({ count: String(document.motionTokens.length + 1) }),
      durationMs: 300,
      easing: { type: 'preset' as const, value: 'ease-out' as const },
      order: Math.max(-1, ...document.motionTokens.map((candidate) => candidate.order)) + 1,
    };
    await onApply(
      [{ kind: 'add-motion-token', token }],
      m['design.motion_operation_token_add'](),
      [{ kind: 'delete-motion-token', tokenId: token.id }],
    );
  }

  async function updateToken(token: DesignDocument['motionTokens'][number], changes: Partial<DesignDocument['motionTokens'][number]>) {
    const inverse = Object.fromEntries(Object.keys(changes).map((key) => [key, token[key as keyof typeof token]]));
    await onApply(
      [{ kind: 'update-motion-token', tokenId: token.id, changes }],
      m['design.motion_operation_token_update'](),
      [{ kind: 'update-motion-token', tokenId: token.id, changes: inverse }],
    );
  }

  async function deleteToken(token: DesignDocument['motionTokens'][number]) {
    await onApply(
      [{ kind: 'delete-motion-token', tokenId: token.id }],
      m['design.motion_operation_token_delete'](),
      [{ kind: 'add-motion-token', token }],
    );
  }

  async function copyMotion(format: 'css' | 'motion') {
    const source = format === 'css' ? exportMotionCss(document, tracks.map((track) => track.id)) : exportMotionDev(document, tracks.map((track) => track.id));
    if (!source.trim()) return;
    await navigator.clipboard.writeText(source);
    toast.success(format === 'css' ? m['design.motion_css_copied']() : m['design.motion_dev_copied']());
  }

  function actionLabel(action: DesignPrototypeAction): string {
    if (action.type === 'navigate') return m['design.prototype_action_navigate']();
    if (action.type === 'open-overlay') return m['design.prototype_action_overlay']();
    if (action.type === 'close-overlay') return m['design.prototype_action_close_overlay']();
    if (action.type === 'back') return m['design.prototype_action_back']();
    if (action.type === 'scroll-to') return m['design.prototype_action_scroll']();
    return m['design.prototype_action_mode']();
  }

  function transitionLabel(type: DesignPrototypeTransition['type']): string {
    if (type === 'instant') return m['design.prototype_transition_instant']();
    if (type === 'dissolve') return m['design.prototype_transition_dissolve']();
    if (type === 'slide') return m['design.prototype_transition_slide']();
    if (type === 'push') return m['design.prototype_transition_push']();
    return m['design.prototype_transition_smart']();
  }

  function motionPropertyLabel(property: string): string {
    const labels: Record<string, () => string> = {
      x: m['design.motion_property_x'],
      y: m['design.motion_property_y'],
      rotation: m['design.motion_property_rotation'],
      opacity: m['design.motion_property_opacity'],
      cornerRadius: m['design.motion_property_cornerRadius'],
    };
    return labels[property]?.() ?? property;
  }
</script>

<div class="flex h-full min-h-0 flex-col text-ui-sm">
  <div class="grid grid-cols-2 gap-1 border-b border-[var(--app-border)] p-1.5">
    <button class={`flex h-8 items-center justify-center gap-1.5 rounded text-ui-xs font-medium ${tab === 'prototype' ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} aria-pressed={tab === 'prototype'} onclick={() => (tab = 'prototype')}><Link2 size={12} />{m['design.prototype']()}</button>
    <button class={`flex h-8 items-center justify-center gap-1.5 rounded text-ui-xs font-medium ${tab === 'motion' ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} aria-pressed={tab === 'motion'} onclick={() => (tab = 'motion')}><Film size={12} />{m['design.motion']()}</button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if tab === 'prototype'}
      <section class="space-y-2 border-b border-[var(--app-border)] p-3">
        <div class="flex items-start justify-between gap-2"><div><h3 class="font-semibold text-[var(--app-text)]">{m['design.prototype_flows']()}</h3><p class="mt-0.5 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.prototype_flows_help']()}</p></div><Button variant="ghost" size="icon-sm" class="size-7 shrink-0" disabled={!frames.length || saving} aria-label={m['design.prototype_add_flow']()} onclick={() => void addFlow()}><Plus size={13} /></Button></div>
        {#if !document.prototypeFlows.length}<div class="border border-dashed border-[var(--app-border)] p-3 text-center text-ui-xs leading-4 text-[var(--app-text-muted)]"><CirclePlay size={18} class="mx-auto mb-2 text-[var(--app-accent)]" />{m['design.prototype_flows_empty']()}</div>{/if}
        {#each [...document.prototypeFlows].sort((left, right) => left.order - right.order) as flow (flow.id)}
          <div class="space-y-2 border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-2">
            <div class="flex items-center gap-1.5"><Input class="h-7 min-w-0 flex-1 text-ui-xs" value={flow.name} onchange={(event: Event) => void updateFlow(flow.id, { name: (event.currentTarget as HTMLInputElement).value })} /><Button variant="ghost" size="icon-sm" class="size-7" aria-label={m['design.prototype_play']()} onclick={() => onPreview(flow.id)}><CirclePlay size={13} /></Button><Button variant="ghost" size="icon-sm" class="size-7" aria-label={m['design.prototype_share']()} onclick={() => void onShare(flow.id)}><Share2 size={12} /></Button><Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-danger)]" aria-label={m['design.delete']()} onclick={() => void deleteFlow(flow.id)}><Trash2 size={12} /></Button></div>
            <NativeSelect.Root class="h-7 w-full text-ui-xs" value={flow.startFrameId} onchange={(event: Event) => void updateFlow(flow.id, { startFrameId: (event.currentTarget as HTMLSelectElement).value })} aria-label={m['design.prototype_start_frame']()}>{#each frames as frame}<NativeSelect.Option value={frame.id}>{frame.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
          </div>
        {/each}
        {#if activeFlow}<Button class="w-full" size="sm" onclick={() => onPreview(activeFlow.id)}><CirclePlay size={13} />{m['design.prototype_play_default']()}</Button>{/if}
      </section>

      {#if selected}
        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          <div class="flex items-start justify-between gap-2"><div class="min-w-0"><h3 class="truncate font-semibold text-[var(--app-text)]">{m['design.prototype_interactions']()}</h3><p class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]">{selected.name}</p></div><Button data-design-add-interaction variant="ghost" size="icon-sm" class="size-7 shrink-0" disabled={saving} aria-label={m['design.prototype_add_interaction']()} onclick={() => void addInteraction()}><Plus size={13} /></Button></div>
          {#if !interactions.length}<div class="border border-dashed border-[var(--app-border)] p-3 text-center text-ui-xs leading-4 text-[var(--app-text-muted)]"><MousePointerClick size={18} class="mx-auto mb-2 text-[var(--app-accent)]" />{m['design.prototype_interactions_empty']()}</div>{/if}
          {#each interactions as interaction (interaction.id)}
            <div class="border border-[var(--app-border)] bg-[var(--app-surface-raised)]">
              <div class="flex items-center gap-2 p-2"><button class="flex min-w-0 flex-1 items-center gap-2 text-left" onclick={() => (expandedInteractionId = expandedInteractionId === interaction.id ? null : interaction.id)}><span class="grid size-6 shrink-0 place-items-center rounded bg-[var(--app-accent-soft)] text-[var(--app-accent)]"><ArrowRight size={12} /></span><span class="min-w-0"><span class="block truncate text-ui-xs font-medium">{actionLabel(interaction.action)}</span><span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{interaction.trigger.type} · {transitionLabel(interaction.transition.type)}</span></span><ChevronDown size={11} class={`ml-auto transition-transform ${expandedInteractionId === interaction.id ? 'rotate-180' : ''}`} /></button><Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-danger)]" aria-label={m['design.delete']()} onclick={() => void deleteInteraction(interaction)}><Trash2 size={11} /></Button></div>
              {#if expandedInteractionId === interaction.id}
                <div class="space-y-2 border-t border-[var(--app-border)] p-2">
                  <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_trigger']()}</span><NativeSelect.Root value={interaction.trigger.type} onchange={(event: Event) => void updateInteraction(interaction, { trigger: { ...interaction.trigger, type: (event.currentTarget as HTMLSelectElement).value as DesignPrototypeInteraction['trigger']['type'] } })}><NativeSelect.Option value="click">{m['design.prototype_trigger_click']()}</NativeSelect.Option><NativeSelect.Option value="hover">{m['design.prototype_trigger_hover']()}</NativeSelect.Option><NativeSelect.Option value="press">{m['design.prototype_trigger_press']()}</NativeSelect.Option><NativeSelect.Option value="after-delay">{m['design.prototype_trigger_delay']()}</NativeSelect.Option></NativeSelect.Root></label><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_action']()}</span><NativeSelect.Root value={interaction.action.type} onchange={(event: Event) => void changeAction(interaction, (event.currentTarget as HTMLSelectElement).value as ActionType)}><NativeSelect.Option value="navigate">{m['design.prototype_action_navigate']()}</NativeSelect.Option><NativeSelect.Option value="open-overlay">{m['design.prototype_action_overlay']()}</NativeSelect.Option><NativeSelect.Option value="close-overlay">{m['design.prototype_action_close_overlay']()}</NativeSelect.Option><NativeSelect.Option value="back">{m['design.prototype_action_back']()}</NativeSelect.Option><NativeSelect.Option value="scroll-to">{m['design.prototype_action_scroll']()}</NativeSelect.Option><NativeSelect.Option value="set-variable-mode">{m['design.prototype_action_mode']()}</NativeSelect.Option></NativeSelect.Root></label></div>
                  {#if interaction.trigger.type === 'after-delay'}<label class="block space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_delay']()}</span><Input type="number" min="0" max="60000" value={interaction.trigger.delayMs} onchange={(event: Event) => void updateInteraction(interaction, { trigger: { ...interaction.trigger, delayMs: Math.max(0, number(event)) } })} /></label>{/if}
                  {#if interaction.action.type === 'navigate' || interaction.action.type === 'open-overlay'}<label class="block space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_target_frame']()}</span><NativeSelect.Root class="w-full" value={interaction.action.targetFrameId} onchange={(event: Event) => updateActionTarget(interaction, (event.currentTarget as HTMLSelectElement).value)}>{#each frames as frame}<NativeSelect.Option value={frame.id}>{frame.name}</NativeSelect.Option>{/each}</NativeSelect.Root></label>{/if}
                  {#if interaction.action.type === 'open-overlay'}<div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_overlay_position']()}</span><NativeSelect.Root value={interaction.action.position} onchange={(event: Event) => updateOverlayAction(interaction, { position: (event.currentTarget as HTMLSelectElement).value as Extract<DesignPrototypeAction, { type: 'open-overlay' }>['position'] })}><NativeSelect.Option value="center">{m['design.align_center']()}</NativeSelect.Option><NativeSelect.Option value="top">{m['design.align_top']()}</NativeSelect.Option><NativeSelect.Option value="right">{m['design.align_right']()}</NativeSelect.Option><NativeSelect.Option value="bottom">{m['design.align_bottom']()}</NativeSelect.Option><NativeSelect.Option value="left">{m['design.align_left']()}</NativeSelect.Option></NativeSelect.Root></label><label class="flex items-end justify-between gap-2 pb-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_dismiss']()}</span><Switch size="sm" checked={interaction.action.dismissOnOutside} onCheckedChange={(checked: boolean) => updateOverlayAction(interaction, { dismissOnOutside: checked })} /></label></div>{/if}
                  {#if interaction.action.type === 'scroll-to'}<label class="block space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_scroll_target']()}</span><NativeSelect.Root class="w-full" value={interaction.action.targetElementId} onchange={(event: Event) => void updateInteraction(interaction, { action: { type: 'scroll-to', targetElementId: (event.currentTarget as HTMLSelectElement).value } })}>{#each document.elements.filter((element) => element.pageId === selected.pageId) as element}<NativeSelect.Option value={element.id}>{element.name}</NativeSelect.Option>{/each}</NativeSelect.Root></label>{/if}
                  {#if interaction.action.type === 'set-variable-mode'}
                    <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.collection']()}</span><NativeSelect.Root value={interaction.action.collectionId} onchange={(event: Event) => { const collection = document.variableCollections.find((candidate) => candidate.id === (event.currentTarget as HTMLSelectElement).value); if (collection) void updateInteraction(interaction, { action: { type: 'set-variable-mode', collectionId: collection.id, modeId: collection.defaultModeId } }); }}>{#each document.variableCollections as collection}<NativeSelect.Option value={collection.id}>{collection.name}</NativeSelect.Option>{/each}</NativeSelect.Root></label><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.mode']()}</span><NativeSelect.Root value={interaction.action.modeId} onchange={(event: Event) => updateVariableMode(interaction, (event.currentTarget as HTMLSelectElement).value)}>{#each variableModesFor(interaction) as mode}<NativeSelect.Option value={mode.id}>{mode.name}</NativeSelect.Option>{/each}</NativeSelect.Root></label></div>
                  {/if}
                  <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_transition']()}</span><NativeSelect.Root value={interaction.transition.type} onchange={(event: Event) => void updateInteraction(interaction, { transition: { ...interaction.transition, type: (event.currentTarget as HTMLSelectElement).value as DesignPrototypeTransition['type'] } })}>{#each ['instant', 'dissolve', 'slide', 'push', 'smart-animate'] as type}<NativeSelect.Option value={type}>{transitionLabel(type as DesignPrototypeTransition['type'])}</NativeSelect.Option>{/each}</NativeSelect.Root></label><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.motion_duration']()}</span><Input type="number" min="0" max="10000" value={interaction.transition.durationMs} onchange={(event: Event) => void updateInteraction(interaction, { transition: { ...interaction.transition, durationMs: Math.max(0, number(event)) } })} /></label></div>
                </div>
              {/if}
            </div>
          {/each}
        </section>

        <section class="space-y-2 p-3">
          <h3 class="font-semibold text-[var(--app-text)]">{m['design.prototype_behavior']()}</h3>
          {#if selected.type === 'frame'}<label class="block space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_overflow']()}</span><NativeSelect.Root class="w-full" value={selected.prototypeOverflow} onchange={(event: Event) => void updateSelected({ prototypeOverflow: (event.currentTarget as HTMLSelectElement).value as DesignElement['prototypeOverflow'] })}><NativeSelect.Option value="none">{m['design.prototype_overflow_none']()}</NativeSelect.Option><NativeSelect.Option value="vertical">{m['design.prototype_overflow_vertical']()}</NativeSelect.Option><NativeSelect.Option value="horizontal">{m['design.prototype_overflow_horizontal']()}</NativeSelect.Option><NativeSelect.Option value="both">{m['design.prototype_overflow_both']()}</NativeSelect.Option></NativeSelect.Root></label>{/if}
          {#if selected.parentId}<label class="flex items-center justify-between gap-3"><span><span class="block font-medium">{m['design.prototype_fixed']()}</span><span class="block text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_fixed_help']()}</span></span><Switch size="sm" checked={selected.prototypeFixed} onCheckedChange={(checked: boolean) => void updateSelected({ prototypeFixed: checked })} /></label>{/if}
          <div class="grid grid-cols-2 gap-2"><label class="flex items-center justify-between gap-2"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_device_frame']()}</span><Switch size="sm" checked={document.presentation.showDeviceFrame} onCheckedChange={(checked: boolean) => void onApply([{ kind: 'update-presentation', changes: { showDeviceFrame: checked } }], m['design.prototype_operation_settings'](), [{ kind: 'update-presentation', changes: { showDeviceFrame: document.presentation.showDeviceFrame } }])} /></label><label class="flex items-center justify-between gap-2"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.prototype_hotspots']()}</span><Switch size="sm" checked={document.presentation.showHotspots} onCheckedChange={(checked: boolean) => void onApply([{ kind: 'update-presentation', changes: { showHotspots: checked } }], m['design.prototype_operation_settings'](), [{ kind: 'update-presentation', changes: { showHotspots: document.presentation.showHotspots } }])} /></label></div>
        </section>
      {:else}
        <div class="p-5 text-center text-ui-xs leading-5 text-[var(--app-text-muted)]"><MousePointerClick size={20} class="mx-auto mb-2 text-[var(--app-accent)]" />{m['design.prototype_select_layer']()}</div>
      {/if}
    {:else}
      <section class="space-y-2 border-b border-[var(--app-border)] p-3">
        <div class="flex items-start justify-between gap-2"><div><h3 class="font-semibold text-[var(--app-text)]">{m['design.motion_tokens']()}</h3><p class="mt-0.5 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.motion_tokens_help']()}</p></div><Button variant="ghost" size="icon-sm" class="size-7 shrink-0" aria-label={m['design.motion_add_token']()} onclick={() => void addToken()}><Plus size={13} /></Button></div>
        {#each [...document.motionTokens].sort((left, right) => left.order - right.order) as token (token.id)}<div class="grid grid-cols-[minmax(0,1fr)_26px] gap-1.5 border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-1.5"><Input class="h-7 min-w-0 text-ui-xs" value={token.name} title={token.name} onchange={(event: Event) => void updateToken(token, { name: (event.currentTarget as HTMLInputElement).value })} /><Button variant="ghost" size="icon-sm" class="size-6 text-[var(--app-danger)]" aria-label={m['design.delete']()} onclick={() => void deleteToken(token)}><Trash2 size={11} /></Button><div class="col-span-2 grid grid-cols-2 gap-1.5"><Input class="h-7 text-ui-xs" type="number" min="1" max="60000" value={token.durationMs} onchange={(event: Event) => void updateToken(token, { durationMs: Math.max(1, number(event)) })} /><NativeSelect.Root class="h-7 min-w-0 text-ui-xs" value={token.easing.type === 'preset' ? token.easing.value : 'ease-out'} onchange={(event: Event) => void updateToken(token, { easing: { type: 'preset', value: (event.currentTarget as HTMLSelectElement).value as EasingPreset } })}><NativeSelect.Option value="linear">{m['design.motion_easing_linear']()}</NativeSelect.Option><NativeSelect.Option value="ease-in">{m['design.motion_easing_in']()}</NativeSelect.Option><NativeSelect.Option value="ease-out">{m['design.motion_easing_out']()}</NativeSelect.Option><NativeSelect.Option value="ease-in-out">{m['design.motion_easing_in_out']()}</NativeSelect.Option></NativeSelect.Root></div></div>{/each}
      </section>

      {#if selected}
        <section class="space-y-2 p-3">
          <div class="flex items-start justify-between gap-2"><div class="min-w-0"><h3 class="font-semibold text-[var(--app-text)]">{m['design.motion_timeline']()}</h3><p class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]">{selected.name}</p></div><Button variant="ghost" size="icon-sm" class="size-7 shrink-0" aria-label={m['design.motion_add_track']()} onclick={() => void addTrack()}><Plus size={13} /></Button></div>
          {#if !tracks.length}<div class="border border-dashed border-[var(--app-border)] p-3 text-center text-ui-xs leading-4 text-[var(--app-text-muted)]"><Film size={18} class="mx-auto mb-2 text-[var(--app-accent)]" />{m['design.motion_tracks_empty']()}</div>{/if}
          {#each tracks as track (track.id)}
            <div class="border border-[var(--app-border)] bg-[var(--app-surface-raised)]">
              <div class="flex items-center gap-2 p-2"><button class="flex min-w-0 flex-1 items-center gap-2 text-left" onclick={() => (expandedTrackId = expandedTrackId === track.id ? null : track.id)}><span class="grid size-6 shrink-0 place-items-center rounded bg-[var(--app-accent-soft)] text-[var(--app-accent)]"><Clock3 size={12} /></span><span class="min-w-0"><span class="block truncate text-ui-xs font-medium">{track.name}</span><span class="block text-ui-xs tabular-nums text-[var(--app-text-muted)]">{track.durationMs} ms · {track.keyframes.length} {m['design.motion_keyframes']()}</span></span><ChevronDown size={11} class={`ml-auto transition-transform ${expandedTrackId === track.id ? 'rotate-180' : ''}`} /></button><Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-danger)]" aria-label={m['design.delete']()} onclick={() => void deleteTrack(track)}><Trash2 size={11} /></Button></div>
              {#if expandedTrackId === track.id}
                {@const keyframe = track.keyframes.find((candidate) => candidate.id === selectedKeyframeId) ?? track.keyframes[0]}
                <div class="space-y-3 border-t border-[var(--app-border)] p-2">
                  <Input class="h-7" value={track.name} onchange={(event: Event) => void updateTrack(track, { name: (event.currentTarget as HTMLInputElement).value })} />
                  <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.motion_token']()}</span><NativeSelect.Root value={track.tokenId ?? ''} onchange={(event: Event) => { const tokenId = (event.currentTarget as HTMLSelectElement).value || null; const token = document.motionTokens.find((candidate) => candidate.id === tokenId); void updateTrack(track, { tokenId, ...(token ? { durationMs: token.durationMs, easing: token.easing, keyframes: track.keyframes.map((keyframe, index) => index === track.keyframes.length - 1 ? { ...keyframe, timeMs: token.durationMs } : { ...keyframe, timeMs: Math.min(keyframe.timeMs, token.durationMs - 1) }) } : {}) }); }}><NativeSelect.Option value="">{m['design.motion_custom']()}</NativeSelect.Option>{#each document.motionTokens as token}<NativeSelect.Option value={token.id}>{token.name}</NativeSelect.Option>{/each}</NativeSelect.Root></label><label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.motion_duration']()}</span><Input type="number" min="1" max="60000" disabled={Boolean(track.tokenId)} value={track.durationMs} onchange={(event: Event) => { const durationMs = Math.max(1, number(event)); void updateTrack(track, { durationMs, keyframes: track.keyframes.map((keyframe, index) => index === track.keyframes.length - 1 ? { ...keyframe, timeMs: durationMs } : { ...keyframe, timeMs: Math.min(keyframe.timeMs, durationMs - 1) }) }); }} /></label></div>
                  <div class="relative h-9 rounded bg-[var(--app-canvas)] px-2"><div class="absolute top-1/2 right-2 left-2 h-px bg-[var(--app-border)]"></div>{#each track.keyframes as keyframe}<button class={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${selectedKeyframeId === keyframe.id ? 'border-[var(--app-accent)] bg-[var(--app-accent)]' : 'border-[var(--app-text-muted)] bg-[var(--app-surface)]'}`} style:left={`${Math.max(3, Math.min(97, keyframe.timeMs / track.durationMs * 100))}%`} aria-label={m['design.motion_keyframe_at']({ time: String(keyframe.timeMs) })} title={m['design.motion_keyframe_at']({ time: String(keyframe.timeMs) })} onclick={() => (selectedKeyframeId = keyframe.id)}></button>{/each}</div>
                  <div class="flex items-center gap-2"><Button variant="outline" size="sm" class="flex-1" onclick={() => void addKeyframe(track)}><Diamond size={11} />{m['design.motion_add_keyframe']()}</Button><Button variant="outline" size="sm" class="flex-1" onclick={() => onPreview(activeFlow?.id ?? null)}><CirclePlay size={11} />{m['design.motion_preview']()}</Button></div>
                  {#if keyframe}<div class="space-y-2 border-t border-[var(--app-border)] pt-2"><div class="flex items-center justify-between"><span class="font-medium">{m['design.motion_keyframe']()}</span><Button variant="ghost" size="icon-sm" class="size-6 text-[var(--app-danger)]" disabled={track.keyframes.length <= 2} aria-label={m['design.delete']()} onclick={() => void deleteKeyframe(track, keyframe.id)}><Trash2 size={10} /></Button></div><label class="block space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.motion_time']()}</span><Input type="number" min="0" max={track.durationMs} value={keyframe.timeMs} onchange={(event: Event) => void updateKeyframe(track, keyframe, { timeMs: Math.max(0, Math.min(track.durationMs, number(event))) })} /></label><div class="grid grid-cols-2 gap-2">{#each ['x', 'y', 'rotation', 'opacity', 'cornerRadius'] as property}<label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{motionPropertyLabel(property)}</span><Input type="number" step={property === 'opacity' ? '0.05' : '1'} min={property === 'opacity' ? '0' : undefined} max={property === 'opacity' ? '1' : undefined} value={keyframe.values[property as keyof DesignMotionKeyframeValues] as number ?? 0} onchange={(event: Event) => void updateKeyframe(track, keyframe, { values: { ...keyframe.values, [property]: number(event) } })} /></label>{/each}<label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.fill']()}</span><Input class="h-8 p-1" type="color" value={keyframe.values.fill ?? '#000000'} onchange={(event: Event) => void updateKeyframe(track, keyframe, { values: { ...keyframe.values, fill: (event.currentTarget as HTMLInputElement).value } })} /></label></div></div>{/if}
                </div>
              {/if}
            </div>
          {/each}
          {#if tracks.length}<div class="grid grid-cols-2 gap-2 pt-1"><Button variant="outline" size="sm" onclick={() => void copyMotion('css')}><Copy size={11} />{m['design.motion_copy_css']()}</Button><Button variant="outline" size="sm" onclick={() => void copyMotion('motion')}><Sparkles size={11} />{m['design.motion_copy_dev']()}</Button></div>{/if}
        </section>
      {:else}
        <div class="p-5 text-center text-ui-xs leading-5 text-[var(--app-text-muted)]"><Film size={20} class="mx-auto mb-2 text-[var(--app-accent)]" />{m['design.motion_select_layer']()}</div>
      {/if}
    {/if}
  </div>
</div>
