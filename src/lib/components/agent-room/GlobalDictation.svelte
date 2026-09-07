<script lang="ts">
  import { onMount } from 'svelte';
  import { Mic, Move, Pin, PinOff, RotateCcw, Square } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import * as Kbd from '$lib/components/ui/kbd';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import VoiceConfirmDialog from './VoiceConfirmDialog.svelte';
  import { PcmAudioRecorder } from './audio-pcm.js';
  import { appSettingsStore, getAppSettings, updateAppSettings } from './app-settings.svelte.js';
  import {
    DEFAULT_AUDIO_DEVICE_ID,
    audioDeviceInventory,
    classifyAudioCaptureFailure,
    missingPreferredAudioDevices,
    openPreferredAudioInput,
  } from './audio-devices.js';
  import { audioCaptureFailureMessage } from './audio-device-messages.js';
  import { DEFAULT_DICTATION_HOTKEY, matchesCombo } from './dictation-hotkey.js';
  import {
    LEADER_DICTATION_STATE,
    type LeaderDictationStateDetail,
    type LeaderDictationStatus,
  } from './leader-dictation.js';
  import { TEXT_DICTATION_COMMAND, TEXT_DICTATION_FALLBACK, type TextDictationFallbackDetail } from './text-dictation.js';
  import { voiceModelsReadyForUse } from './voice-model-status.js';
  import { audioSignalIsEmpty } from '$lib/modules/agent-room/domain/voice-audio.js';
  import * as m from '$lib/paraglide/messages.js';

  type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

  let target = $state<Editable | null>(null);
  let savedRange: Range | null = null;
  let status = $state<LeaderDictationStatus>('idle');
  let source = $state<'text' | 'leader' | null>(null);
  let voiceConfirmOpen = $state(false);
  let checkingVoiceModels = false;
  let audioRecorder: PcmAudioRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let recordingTarget: Editable | null = null;
  const PLACEMENT_KEY = 'orkestrai.dictation-placement';
  const BUTTON_SIZE = 48;
  const EDGE_GAP = 14;
  let trigger = $state<HTMLButtonElement | null>(null);
  let placement = $state({ x: 0, y: 56, pinned: true });
  let dockPosition = $state<{ x: number; y: number } | null>(null);
  let hiddenBySurface = $state(false);
  let placementReady = $state(false);
  let placementMenuOpen = $state(false);
  let placementModifier = $state('Ctrl');
  let drag = $state<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  let suppressNextClick = false;
  const hotkey = $derived(appSettingsStore.values.dictationHotkey || DEFAULT_DICTATION_HOTKEY);
  const displayedPlacement = $derived(
    placement.pinned && dockPosition ? { ...placement, ...dockPosition } : placement
  );

  const supported = typeof window !== 'undefined'
    && typeof AudioContext !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia);

  function availableRect() {
    const canvas = document.querySelector<HTMLElement>('.canvas-area .svelte-flow');
    const rect = canvas?.getBoundingClientRect();
    if (rect && rect.width >= BUTTON_SIZE && rect.height >= BUTTON_SIZE) return rect;
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
  }

  function clampPlacement(next = placement) {
    const rect = availableRect();
    placement = {
      ...next,
      x: Math.max(rect.left + EDGE_GAP, Math.min(rect.right - BUTTON_SIZE - EDGE_GAP, next.x)),
      y: Math.max(rect.top + EDGE_GAP, Math.min(rect.bottom - BUTTON_SIZE - EDGE_GAP, next.y)),
    };
  }

  function defaultPlacement() {
    const rect = availableRect();
    return { x: rect.right - BUTTON_SIZE - EDGE_GAP, y: rect.top + 56, pinned: true };
  }

  function persistPlacement() {
    localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placement));
  }

  function resetPlacement() {
    placement = defaultPlacement();
    persistPlacement();
    placementMenuOpen = false;
  }

  function togglePinned() {
    placement = { ...placement, pinned: !placement.pinned };
    persistPlacement();
    placementMenuOpen = false;
  }

  function startDrag(event: PointerEvent) {
    // Capture the active field before the button takes focus on the first click.
    const activeEditable = editableFrom(document.activeElement);
    if (activeEditable) {
      target = activeEditable;
      rememberSelection();
    }
    if (placement.pinned || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - placement.x,
      offsetY: event.clientY - placement.y,
      moved: false,
    };
    trigger?.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved || Math.hypot(event.movementX, event.movementY) > 2;
    drag = { ...drag, moved };
    clampPlacement({ ...placement, x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY });
  }

  function stopDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    trigger?.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      persistPlacement();
      suppressNextClick = true;
    }
    drag = null;
  }

  function triggerClick(event: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      placementMenuOpen = !placementMenuOpen;
      return;
    }
    toggle();
  }

  function editableFrom(value: EventTarget | null): Editable | null {
    if (!(value instanceof HTMLElement)) return null;
    const element = value.closest('input, textarea, [contenteditable="true"]');
    if (!(element instanceof HTMLElement) || element.closest('.xterm') || element.closest('[data-dictation-ignore]')) return null;
    if (element instanceof HTMLInputElement) {
      const excluded = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
      if (excluded.has(element.type) || element.disabled || element.readOnly) return null;
    }
    if (element instanceof HTMLTextAreaElement && (element.disabled || element.readOnly)) return null;
    return element;
  }

  function editableUsable(element: Editable | null): element is Editable {
    if (!element?.isConnected || element.closest('[aria-hidden="true"], [inert]')) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function rememberSelection() {
    if (!target?.isContentEditable) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (target.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
  }

  function insertText(element: Editable, text: string) {
    if (!element.isConnected) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const supportsSelection = !(element instanceof HTMLInputElement)
        || ['text', 'search', 'tel', 'url', 'password'].includes(element.type);
      const start = supportsSelection ? (element.selectionStart ?? element.value.length) : element.value.length;
      const end = supportsSelection ? (element.selectionEnd ?? start) : start;
      const spacer = start > 0 && !/\s$/.test(element.value.slice(0, start)) ? ' ' : '';
      if (supportsSelection) element.setRangeText(`${spacer}${text}`, start, end, 'end');
      else element.value = `${element.value}${spacer}${text}`;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      element.focus();
      return;
    }

    element.focus();
    const selection = window.getSelection();
    const range = savedRange && element.contains(savedRange.commonAncestorContainer)
      ? savedRange
      : document.createRange();
    if (!savedRange || !element.contains(savedRange.commonAncestorContainer)) range.selectNodeContents(element);
    if (!savedRange || !element.contains(savedRange.commonAncestorContainer)) range.collapse(false);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRange = range.cloneRange();
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function stopTracks() {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  function label(): string {
    if (status === 'recording') return m['dictation.stop']();
    if (status === 'transcribing') return m['dictation.transcribing']();
    return editableUsable(target) ? m['dictation.start_field']() : m['dictation.start']();
  }

  function placementStatus(): string {
    return placement.pinned ? m['dictation.position_pinned']() : m['dictation.position_unpinned']();
  }

  function placementShortcut(): string {
    return `${placementModifier} + ${m['dictation.position_controls_hint']()}`;
  }

  async function toggleTextDictation() {
    if (status === 'recording' && source === 'text') {
      void finishTextDictation();
      return;
    }
    if (status !== 'idle' || !editableUsable(target) || checkingVoiceModels) return;

    checkingVoiceModels = true;
    let voiceSettings: Record<string, string> = appSettingsStore.values;
    try {
      voiceSettings = await getAppSettings(true);
      if (!(await voiceModelsReadyForUse(voiceSettings))) {
        voiceConfirmOpen = true;
        return;
      }
    } catch {
      toast.error(m['voice.model_status_error']());
      return;
    } finally {
      checkingVoiceModels = false;
    }

    try {
      const opened = await openPreferredAudioInput(voiceSettings.audioInputDeviceId);
      mediaStream = opened.stream;
      if (opened.fallback) {
        toast.warning(m['voice.mic_fallback']());
        void updateAppSettings({ audioInputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
      }
    } catch (error) {
      const count = (await audioDeviceInventory().catch(() => ({ inputs: [], outputs: [] }))).inputs.length;
      toast.error(audioCaptureFailureMessage(classifyAudioCaptureFailure(error, count)));
      return;
    }

    const recorder = new PcmAudioRecorder(mediaStream);
    audioRecorder = recorder;
    recordingTarget = target;
    try {
      await recorder.start();
    } catch (error) {
      audioRecorder = null;
      recordingTarget = null;
      stopTracks();
      toast.error(audioCaptureFailureMessage(classifyAudioCaptureFailure(error, 1)));
      return;
    }
    source = 'text';
    status = 'recording';
  }

  async function finishTextDictation() {
    const recorder = audioRecorder;
    const insertionTarget = recordingTarget;
    if (!recorder || !insertionTarget || status !== 'recording' || source !== 'text') return;
    audioRecorder = null;
    recordingTarget = null;
    status = 'transcribing';
    try {
      const recording = await recorder.stop();
      stopTracks();
      if (audioSignalIsEmpty(recording.stats)) {
        toast.error(m['voice.mic_no_signal']());
        return;
      }
      const form = new FormData();
      form.append('file', recording.wav, 'dictation.wav');
      const locale = appSettingsStore.values.uiLanguage;
      if (locale === 'pt-BR') form.append('language', 'pt');
      if (locale === 'en') form.append('language', 'en');
      const csrf = getCsrfToken();
      const response = await fetch('/api/agent-room/voice/transcribe', {
        method: 'POST',
        headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 413) throw new Error(m['voice.recording_too_long']());
      if (!response.ok || payload.error) throw new Error(payload.error || m['voice.dictation_error']());
      const text = String(payload.data?.text ?? '').trim();
      if (!text) toast.error(m['voice.nothing_transcribed']());
      else insertText(insertionTarget, text);
    } catch (error) {
      stopTracks();
      toast.error(error instanceof Error ? error.message : m['voice.dictation_error']());
    } finally {
      status = 'idle';
      source = null;
    }
  }

  function requestFallback() {
    const detail: TextDictationFallbackDetail = { handled: false };
    window.dispatchEvent(new CustomEvent(TEXT_DICTATION_FALLBACK, { detail }));
    if (!detail.handled) toast.error(m['dictation.no_target']());
  }

  function toggle() {
    if (!supported || status === 'transcribing') return;
    if (source === 'leader' || (!editableUsable(target) && source !== 'text')) {
      target = null;
      requestFallback();
      return;
    }
    void toggleTextDictation();
  }

  onMount(() => {
    placementModifier = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
    try {
      const saved = JSON.parse(localStorage.getItem(PLACEMENT_KEY) ?? 'null') as Partial<typeof placement> | null;
      placement = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? { x: Number(saved.x), y: Number(saved.y), pinned: saved.pinned !== false }
        : defaultPlacement();
    } catch {
      placement = defaultPlacement();
    }
    clampPlacement();
    placementReady = true;
    let observedSurface: HTMLElement | null = null;
    const syncPlacementSurface = () => {
      hiddenBySurface = Boolean(document.querySelector('[data-dictation-hidden]'));
      const dock = document.querySelector<HTMLElement>('[data-dictation-dock]');
      if (dock) {
        const rect = dock.getBoundingClientRect();
        const footprint = BUTTON_SIZE + 4;
        dockPosition = {
          x: rect.left + Math.max(0, (rect.width - footprint) / 2),
          y: rect.top + Math.max(0, (rect.height - footprint) / 2),
        };
      } else {
        dockPosition = null;
      }
      const canvas = document.querySelector<HTMLElement>('.canvas-area .svelte-flow');
      const surface = dock ?? canvas;
      if (surface !== observedSurface) {
        if (observedSurface) placementObserver.unobserve(observedSurface);
        observedSurface = surface;
        if (surface) placementObserver.observe(surface);
      }
      clampPlacement();
    };
    const placementObserver = new ResizeObserver(syncPlacementSurface);
    syncPlacementSurface();
    const surfaceObserver = new MutationObserver(syncPlacementSurface);
    surfaceObserver.observe(document.body, { childList: true, subtree: true });
    const clampOnResize = () => syncPlacementSurface();
    window.addEventListener('resize', clampOnResize);
    const focusIn = (event: FocusEvent) => {
      const eventTarget = event.target instanceof HTMLElement ? event.target : null;
      if (eventTarget?.closest('[data-dictation-trigger]')) return;
      target = editableFrom(event.target);
      if (!target) savedRange = null;
    };
    const pointerDown = (event: PointerEvent) => {
      const eventTarget = event.target instanceof HTMLElement ? event.target : null;
      if (eventTarget?.closest('[data-dictation-trigger]')) return;
      target = editableFrom(event.target);
      if (!target) savedRange = null;
    };
    const selectionChange = () => rememberSelection();
    const keyDown = (event: KeyboardEvent) => {
      if (!matchesCombo(event, hotkey)) return;
      event.preventDefault();
      toggle();
    };
    const leaderState = (event: Event) => {
      const detail = (event as CustomEvent<LeaderDictationStateDetail>).detail;
      if (!detail) return;
      source = detail.status === 'idle' ? null : 'leader';
      status = detail.status;
    };
    const audioDevicesChanged = async () => {
      const settings = await getAppSettings();
      const inventory = await audioDeviceInventory().catch(() => null);
      if (!inventory) return;
      const missing = missingPreferredAudioDevices(inventory, settings.audioInputDeviceId, settings.audioOutputDeviceId);
      if (!missing.input && !missing.output) return;
      await updateAppSettings({
        ...(missing.input ? { audioInputDeviceId: DEFAULT_AUDIO_DEVICE_ID } : {}),
        ...(missing.output ? { audioOutputDeviceId: DEFAULT_AUDIO_DEVICE_ID } : {}),
      }).catch(() => undefined);
      toast.warning(m['settings.audio_device_removed']());
    };
    document.addEventListener('focusin', focusIn, true);
    window.addEventListener(TEXT_DICTATION_COMMAND, toggle);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('selectionchange', selectionChange);
    window.addEventListener('keydown', keyDown);
    window.addEventListener(LEADER_DICTATION_STATE, leaderState);
    navigator.mediaDevices?.addEventListener?.('devicechange', audioDevicesChanged);
    target = editableFrom(document.activeElement);
    rememberSelection();
    return () => {
      document.removeEventListener('focusin', focusIn, true);
      window.removeEventListener(TEXT_DICTATION_COMMAND, toggle);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('selectionchange', selectionChange);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener(LEADER_DICTATION_STATE, leaderState);
      navigator.mediaDevices?.removeEventListener?.('devicechange', audioDevicesChanged);
      window.removeEventListener('resize', clampOnResize);
      placementObserver.disconnect();
      surfaceObserver.disconnect();
      audioRecorder?.cancel();
      audioRecorder = null;
      recordingTarget = null;
      stopTracks();
    };
  });
</script>

{#if supported && placementReady && !hiddenBySurface}
  <div
    class="fixed z-30 size-12"
    data-dictation-trigger
    style:left={`${displayedPlacement.x}px`}
    style:top={`${displayedPlacement.y}px`}
  >
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            bind:this={trigger}
            type="button"
            class="dictation-trigger absolute inset-0 grid size-12 place-items-center rounded-full border-0 p-[3px] text-white disabled:cursor-wait"
            class:movable={!placement.pinned}
            class:animate-pulse={status === 'recording'}
            class:animate-spin={status === 'transcribing'}
            aria-label={`${label()}. ${placementStatus()}. ${placementShortcut()}`}
            aria-pressed={status === 'recording'}
            disabled={status === 'transcribing'}
            onpointerdown={startDrag}
            onpointermove={moveDrag}
            onpointerup={stopDrag}
            onclick={triggerClick}
          >
            <span class="grid size-full place-items-center rounded-full border border-white/15 bg-[#11102f]">
              {#if status === 'recording'}<Square size={14} fill="currentColor" />{:else}<Mic size={18} />{/if}
            </span>
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="left" sideOffset={10} class="flex w-60 flex-col items-stretch gap-1.5 p-2.5">
        <span class="font-medium">{label()}</span>
        <span class="flex items-center gap-1.5 text-ui-sm opacity-75">
          {#if placement.pinned}<Pin size={12} fill="currentColor" />{:else}<Move size={12} />{/if}
          {placementStatus()}
        </span>
        <span class="flex items-center gap-1.5 border-t border-background/15 pt-1.5 text-ui-sm opacity-80">
          <Kbd.Root>{placementModifier}</Kbd.Root>
          <span>+ {m['dictation.position_controls_hint']()}</span>
        </span>
      </Tooltip.Content>
    </Tooltip.Root>

    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            class={`placement-trigger absolute -right-1 -bottom-1 z-10 grid size-6 cursor-pointer place-items-center rounded-full border-2 border-[var(--app-page)] bg-[var(--app-surface-raised)] shadow-sm transition-[color,transform,background-color] duration-150 hover:scale-105 hover:bg-[var(--app-accent-soft)] active:scale-95 ${placement.pinned ? 'text-[var(--app-accent)]' : 'text-[var(--app-success)]'}`}
            aria-label={`${placementStatus()}. ${m['dictation.position_menu']()}`}
            aria-haspopup="menu"
            aria-expanded={placementMenuOpen}
            aria-controls="dictation-placement-menu"
            onclick={() => (placementMenuOpen = !placementMenuOpen)}
          >
            {#if placement.pinned}<Pin size={10} fill="currentColor" />{:else}<Move size={11} />{/if}
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="left" sideOffset={8}>
        {placementStatus()} · {m['dictation.position_controls_hint']()}
      </Tooltip.Content>
    </Tooltip.Root>
  </div>
  {#if placementMenuOpen}
    <div
      id="dictation-placement-menu"
      class="placement-menu"
      data-dictation-trigger
      role="menu"
      aria-label={m['dictation.position_menu']()}
      style:left={`${Math.max(EDGE_GAP, Math.min(window.innerWidth - 188, displayedPlacement.x - 136))}px`}
      style:top={`${Math.min(window.innerHeight - 92, displayedPlacement.y + BUTTON_SIZE + 8)}px`}
    >
      <button type="button" role="menuitem" onclick={togglePinned}>
        {#if placement.pinned}<PinOff size={14} />{m['dictation.unpin']()}{:else}<Pin size={14} />{m['dictation.pin']()}{/if}
      </button>
      <button type="button" role="menuitem" onclick={resetPlacement}><RotateCcw size={14} />{m['dictation.reset_position']()}</button>
      {#if !placement.pinned}<span><Move size={13} />{m['dictation.drag_hint']()}</span>{/if}
    </div>
  {/if}
{/if}

<VoiceConfirmDialog bind:open={voiceConfirmOpen} onConfirm={() => void toggleTextDictation()} onCancel={() => {}} />

<style>
  .dictation-trigger {
    touch-action: none;
    background: conic-gradient(from 25deg, #58d6ff, #9674ff, #f05fb4, #ffb45e, #61e5a7, #58d6ff);
    box-shadow: 0 8px 24px rgba(5, 4, 26, 0.36);
    transition: transform 150ms ease, box-shadow 150ms ease;
  }

  .dictation-trigger:hover {
    transform: translateY(-1px) scale(1.03);
    box-shadow: 0 10px 28px rgba(5, 4, 26, 0.46);
  }

  .dictation-trigger.movable {
    cursor: grab;
  }

  .dictation-trigger.movable:active {
    cursor: grabbing;
    transform: scale(0.98);
  }

  .placement-menu {
    position: fixed;
    z-index: 45;
    width: 174px;
    display: grid;
    gap: 3px;
    padding: 6px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-surface-raised);
    color: var(--app-text);
    box-shadow: 0 12px 32px color-mix(in srgb, var(--app-page) 32%, transparent);
  }

  .placement-menu button,
  .placement-menu span {
    min-height: 30px;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    border-radius: 5px;
    padding: 6px 8px;
    background: transparent;
    color: inherit;
    font-size: 11px;
    text-align: left;
  }

  .placement-menu button:hover {
    background: var(--app-accent-soft);
  }

  .placement-menu span {
    color: var(--app-text-muted);
  }
</style>
