<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowUp, Check, LoaderCircle, X } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { PcmAudioRecorder } from '../audio-pcm.js';
  import { DictationOperation, DICTATION_MAX_RECORDING_MS, DICTATION_START_TIMEOUT_MS, DICTATION_TRANSCRIBE_TIMEOUT_MS } from '../dictation-operation.js';
  import { appSettingsStore, getAppSettings, updateAppSettings } from '../app-settings.svelte.js';
  import { DEFAULT_AUDIO_DEVICE_ID, classifyAudioCaptureFailure, openPreferredAudioInput } from '../audio-devices.js';
  import { audioCaptureFailureMessage } from '../audio-device-messages.js';
  import { voiceModelsReadyForUse } from '../voice-model-status.js';
  import { audioSignalIsEmpty } from '$lib/modules/agent-room/domain/voice-audio.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * Voice for the Canvas message bar: records from the chosen microphone with
   * a live waveform, then transcribes locally and either sends the words or
   * leaves them in the field to edit. `onSetupNeeded` hands over to the app's
   * dictation flow when the voice models are not installed yet.
   */
  let {
    onTranscript,
    onClose,
    onSetupNeeded,
  }: {
    onTranscript: (text: string, mode: 'send' | 'edit') => void | Promise<void>;
    onClose: () => void;
    onSetupNeeded: () => void;
  } = $props();

  type Phase = 'starting' | 'recording' | 'transcribing';
  let phase = $state<Phase>('starting');
  let elapsed = $state(0);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let sendButton = $state<HTMLButtonElement | null>(null);

  const operation = new DictationOperation();
  let stream: MediaStream | null = null;
  let recorder: PcmAudioRecorder | null = null;
  let meterContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let frame = 0;
  let startedAt = 0;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  // Recent loudness, newest last: the bars scroll from right to left as you speak.
  const BARS = 42;
  const levels = new Array<number>(BARS).fill(0);

  function stopTracks() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function teardown() {
    cancelAnimationFrame(frame);
    if (maxTimer) clearTimeout(maxTimer);
    maxTimer = null;
    void meterContext?.close().catch(() => {});
    meterContext = null;
    analyser = null;
  }

  function close() {
    if (closed) return;
    closed = true;
    operation.cancel();
    recorder?.cancel();
    recorder = null;
    teardown();
    stopTracks();
    onClose();
  }

  function draw() {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue('--app-accent').trim() || '#e8b84a';
    const quiet = styles.getPropertyValue('--app-text-muted').trim() || '#888';
    const step = width / BARS;
    const barWidth = Math.max(2, step * 0.48);
    for (let index = 0; index < BARS; index += 1) {
      const level = levels[index];
      const barHeight = Math.max(3, Math.min(height, level * height * 1.6));
      const x = index * step + (step - barWidth) / 2;
      const y = (height - barHeight) / 2;
      context.globalAlpha = 0.35 + 0.65 * (index / BARS);
      context.fillStyle = level > 0.04 ? accent : quiet;
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function animate() {
    if (analyser) {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      // Speech sits around 0.02-0.2 RMS; a soft curve keeps quiet voices visible.
      const level = Math.min(1, Math.pow(rms * 6, 0.7));
      levels.push(level * 0.75 + (levels[levels.length - 1] ?? 0) * 0.25);
      levels.shift();
    }
    elapsed = Math.floor((performance.now() - startedAt) / 1000);
    draw();
    frame = requestAnimationFrame(animate);
  }

  async function start() {
    operation.deadline(DICTATION_START_TIMEOUT_MS);
    try {
      const settings = await operation.wait(getAppSettings(true));
      if (!(await operation.wait(voiceModelsReadyForUse(settings, fetch, operation.signal)))) {
        closed = true;
        teardown();
        onSetupNeeded();
        return;
      }
      const opened = await operation.wait(openPreferredAudioInput(settings.audioInputDeviceId),
        (late) => late.stream.getTracks().forEach((track) => track.stop()));
      stream = opened.stream;
      if (opened.fallback) {
        toast.warning(m['voice.mic_fallback']());
        void updateAppSettings({ audioInputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
      }
      recorder = new PcmAudioRecorder(stream);
      await operation.wait(recorder.start());
      meterContext = new AudioContext();
      analyser = meterContext.createAnalyser();
      analyser.fftSize = 1024;
      meterContext.createMediaStreamSource(stream).connect(analyser);
      if (meterContext.state === 'suspended') await meterContext.resume().catch(() => {});
      startedAt = performance.now();
      phase = 'recording';
      frame = requestAnimationFrame(animate);
      // Enter or Space sends from the keyboard right away.
      void tick().then(() => sendButton?.focus());
      maxTimer = setTimeout(() => void finish('edit'), DICTATION_MAX_RECORDING_MS);
    } catch (error) {
      if (!closed) {
        toast.error(operation.signal.reason?.name === 'TimeoutError'
          ? m['voice.operation_timeout']()
          : audioCaptureFailureMessage(classifyAudioCaptureFailure(error, 1)));
        close();
      }
    } finally {
      operation.deadline(null);
    }
  }

  async function finish(mode: 'send' | 'edit') {
    if (phase !== 'recording' || !recorder) return;
    phase = 'transcribing';
    const active = recorder;
    recorder = null;
    teardown();
    operation.deadline(DICTATION_TRANSCRIBE_TIMEOUT_MS);
    try {
      const pending = active.stop();
      stopTracks();
      const recording = await operation.wait(pending);
      if (audioSignalIsEmpty(recording.stats)) {
        toast.error(m['voice.mic_no_signal']());
        return;
      }
      const form = new FormData();
      form.append('file', recording.wav, 'composer.wav');
      const locale = appSettingsStore.values.uiLanguage;
      if (locale === 'pt-BR') form.append('language', 'pt');
      if (locale === 'en') form.append('language', 'en');
      if (locale === 'es') form.append('language', 'es');
      const csrf = getCsrfToken();
      const response = await operation.wait(fetch('/api/agent-room/voice/transcribe', {
        method: 'POST',
        headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
        body: form,
        signal: operation.signal,
      }));
      const payload = await operation.wait(response.json().catch(() => ({}))) as { data?: { text?: string }; error?: string };
      if (response.status === 413) throw new Error(m['voice.recording_too_long']());
      if (!response.ok || payload.error) throw new Error(payload.error || m['voice.dictation_error']());
      const text = String(payload.data?.text ?? '').trim();
      if (!text) toast.error(m['voice.nothing_transcribed']());
      else await onTranscript(text, mode);
    } catch (error) {
      if (!closed) toast.error(operation.signal.reason?.name === 'TimeoutError'
        ? m['voice.operation_timeout']()
        : error instanceof Error ? error.message : m['voice.dictation_error']());
    } finally {
      operation.deadline(null);
      close();
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter' && phase === 'recording') {
      event.preventDefault();
      void finish('send');
    }
  }

  onMount(() => {
    void start();
    return () => {
      if (!closed) {
        closed = true;
        operation.cancel();
        recorder?.cancel();
        teardown();
        stopTracks();
      }
    };
  });

  const clock = $derived(`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`);
</script>

<svelte:window onkeydown={onKeydown} />

<div class="voice" data-phase={phase} data-testid="composer-voice" role="group" aria-label={m['composer.voice_label']()}>
  <button type="button" class="round quiet" onclick={close} aria-label={m['composer.voice_cancel']()} title={m['composer.voice_cancel']()}><X size={15} /></button>
  <div class="meter" aria-live="polite">
    {#if phase === 'transcribing'}
      <span class="status"><LoaderCircle size={14} class="animate-spin" />{m['composer.voice_transcribing']()}</span>
    {:else if phase === 'starting'}
      <span class="status"><span class="pulse" aria-hidden="true"></span>{m['composer.voice_starting']()}</span>
    {:else}
      <span class="rec" aria-hidden="true"></span>
      <canvas bind:this={canvas} class="wave" aria-hidden="true"></canvas>
      <span class="clock">{clock}</span>
      <span class="sr-only">{m['composer.voice_listening']()}</span>
    {/if}
  </div>
  <button type="button" class="round quiet" disabled={phase !== 'recording'} onclick={() => void finish('edit')} aria-label={m['composer.voice_to_text']()} title={m['composer.voice_to_text']()}><Check size={15} /></button>
  <button type="button" class="round send" bind:this={sendButton} disabled={phase !== 'recording'} onclick={() => void finish('send')} aria-label={m['composer.voice_send']()} title={m['composer.voice_send']()}><ArrowUp size={15} strokeWidth={2.4} /></button>
</div>

<style>
  .voice {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    animation: voice-in var(--duration-fast) var(--ease-smooth-out);
  }

  @keyframes voice-in {
    from { opacity: 0; transform: scale(0.98); }
  }

  .meter {
    flex: 1;
    min-width: 0;
    height: 34px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-accent) 9%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 22%, transparent);
  }

  .wave {
    flex: 1;
    min-width: 0;
    height: 24px;
    color: var(--app-accent);
  }

  .rec {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: var(--app-danger, #e5484d);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--app-danger, #e5484d) 60%, transparent);
    animation: rec 1.4s ease-out infinite;
  }

  @keyframes rec {
    70% { box-shadow: 0 0 0 7px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  .clock {
    flex: none;
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text-soft);
    font-size: 12.5px;
  }

  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--app-accent);
    animation: breathe 1s ease-in-out infinite alternate;
  }

  @keyframes breathe {
    from { opacity: 0.35; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1.1); }
  }

  .round {
    width: 32px;
    height: 32px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--app-text-muted);
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .round.quiet:hover:not(:disabled) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .round.send {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .round:disabled {
    opacity: 0.45;
  }

  .round:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .voice, .rec, .pulse {
      animation: none;
    }
  }
</style>
