<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Mic, RefreshCw, Square, Volume2 } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';
  import {
    DEFAULT_AUDIO_DEVICE_ID,
    audioDeviceInventory,
    audioTestTone,
    classifyAudioCaptureFailure,
    missingPreferredAudioDevices,
    openPreferredAudioInput,
    playAudioBlob,
    supportsAudioOutputSelection,
    type AudioDeviceInventory,
  } from './audio-devices.js';
  import { audioCaptureFailureMessage } from './audio-device-messages.js';
  import * as m from '$lib/paraglide/messages.js';

  let { settings, onChange }: { settings: Record<string, string>; onChange: (settings: Record<string, string>) => void } = $props();

  let inventory = $state<AudioDeviceInventory>({ inputs: [], outputs: [] });
  let loading = $state(false);
  let micTesting = $state(false);
  let speakerTesting = $state(false);
  let micLevel = $state(0);
  let testStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let levelFrame: number | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  const outputSelectionSupported = supportsAudioOutputSelection();

  const inputDeviceId = $derived(settings.audioInputDeviceId || DEFAULT_AUDIO_DEVICE_ID);
  const outputDeviceId = $derived(settings.audioOutputDeviceId || DEFAULT_AUDIO_DEVICE_ID);

  function patch(values: Record<string, string>) {
    onChange({ ...settings, ...values });
  }

  function deviceLabel(device: MediaDeviceInfo, index: number, kind: 'input' | 'output'): string {
    if (device.label) return device.label;
    return kind === 'input'
      ? m['settings.audio_input_number']({ number: String(index + 1) })
      : m['settings.audio_output_number']({ number: String(index + 1) });
  }

  function selectedLabel(devices: MediaDeviceInfo[], deviceId: string, kind: 'input' | 'output'): string {
    if (deviceId === DEFAULT_AUDIO_DEVICE_ID) return m['settings.audio_default']();
    const index = devices.findIndex((device) => device.deviceId === deviceId);
    return index >= 0 ? deviceLabel(devices[index], index, kind) : m['settings.audio_device_unavailable']();
  }

  async function refreshDevices(requestPermission = false, checkRemoved = false) {
    if (!navigator.mediaDevices?.enumerateDevices || loading) return;
    loading = true;
    let permissionStream: MediaStream | null = null;
    try {
      if (requestPermission) {
        const opened = await openPreferredAudioInput(inputDeviceId);
        permissionStream = opened.stream;
        if (opened.fallback) {
          patch({ audioInputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
          toast.warning(m['voice.mic_fallback']());
        }
      }
      const next = await audioDeviceInventory();
      if (checkRemoved) {
        const missing = missingPreferredAudioDevices(next, inputDeviceId, outputDeviceId);
        if (missing.input || missing.output) {
          patch({
            ...(missing.input ? { audioInputDeviceId: DEFAULT_AUDIO_DEVICE_ID } : {}),
            ...(missing.output ? { audioOutputDeviceId: DEFAULT_AUDIO_DEVICE_ID } : {}),
          });
          toast.warning(m['settings.audio_device_removed']());
        }
      }
      inventory = next;
    } catch (error) {
      const count = (await audioDeviceInventory().catch(() => ({ inputs: [], outputs: [] }))).inputs.length;
      toast.error(audioCaptureFailureMessage(classifyAudioCaptureFailure(error, count)));
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
      loading = false;
    }
  }

  function stopMicrophoneTest() {
    if (levelFrame !== null) cancelAnimationFrame(levelFrame);
    if (stopTimer) clearTimeout(stopTimer);
    levelFrame = null;
    stopTimer = null;
    testStream?.getTracks().forEach((track) => track.stop());
    testStream = null;
    void audioContext?.close();
    audioContext = null;
    micTesting = false;
    micLevel = 0;
  }

  async function testMicrophone() {
    if (micTesting) {
      stopMicrophoneTest();
      return;
    }
    try {
      const opened = await openPreferredAudioInput(inputDeviceId);
      testStream = opened.stream;
      if (opened.fallback) {
        patch({ audioInputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
        toast.warning(m['voice.mic_fallback']());
      }
      inventory = await audioDeviceInventory();
      const context = new AudioContext();
      audioContext = context;
      if (context.state === 'suspended') await context.resume();
      const source = context.createMediaStreamSource(testStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      micTesting = true;
      const updateLevel = () => {
        if (!micTesting) return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
        micLevel = Math.min(100, Math.round(Math.sqrt(energy / samples.length) * 240));
        levelFrame = requestAnimationFrame(updateLevel);
      };
      updateLevel();
      stopTimer = setTimeout(stopMicrophoneTest, 8_000);
    } catch (error) {
      const count = (await audioDeviceInventory().catch(() => ({ inputs: [], outputs: [] }))).inputs.length;
      toast.error(audioCaptureFailureMessage(classifyAudioCaptureFailure(error, count)));
      stopMicrophoneTest();
    }
  }

  async function testSpeaker() {
    if (speakerTesting) return;
    speakerTesting = true;
    try {
      const result = await playAudioBlob(audioTestTone(), outputDeviceId);
      if (result.unsupported) toast.warning(m['settings.audio_output_unsupported']());
      else if (result.fallback) {
        patch({ audioOutputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
        toast.warning(m['settings.audio_device_removed']());
      }
    } catch {
      toast.error(m['settings.audio_test_failed']());
    } finally {
      speakerTesting = false;
    }
  }

  onMount(() => {
    void refreshDevices();
    const changed = () => void refreshDevices(false, true);
    navigator.mediaDevices?.addEventListener?.('devicechange', changed);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', changed);
  });

  onDestroy(stopMicrophoneTest);
</script>

<section class="space-y-3 border-b border-[var(--line)] pb-5" aria-labelledby="audio-devices-heading">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h3 id="audio-devices-heading" class="text-xs font-semibold text-[var(--copy)]">{m['settings.audio_devices']()}</h3>
      <p class="mt-1 text-ui-sm leading-4 text-[var(--copy-muted)]">{m['settings.audio_devices_desc']()}</p>
    </div>
    <Button variant="ghost" size="icon-sm" disabled={loading} title={m['settings.audio_refresh']()} aria-label={m['settings.audio_refresh']()} onclick={() => void refreshDevices(true)}>
      <RefreshCw size={13} class={loading ? 'animate-spin' : ''} />
    </Button>
  </div>

  <div class="grid gap-3 md:grid-cols-2">
    <div class="flex min-w-0 flex-col gap-1.5">
      <span class="text-xs font-medium text-[var(--copy-soft)]">{m['settings.audio_input']()}</span>
      <Select.Root type="single" value={inputDeviceId} onValueChange={(value: string) => patch({ audioInputDeviceId: value })}>
        <Select.Trigger data-slot="select-trigger" class="w-full min-w-0"><span class="truncate">{selectedLabel(inventory.inputs, inputDeviceId, 'input')}</span></Select.Trigger>
        <Select.Content class="max-h-72">
          <Select.Item value={DEFAULT_AUDIO_DEVICE_ID}>{m['settings.audio_default']()}</Select.Item>
          {#each inventory.inputs as device, index (device.deviceId)}
            {#if device.deviceId && device.deviceId !== DEFAULT_AUDIO_DEVICE_ID}<Select.Item value={device.deviceId}>{deviceLabel(device, index, 'input')}</Select.Item>{/if}
          {/each}
        </Select.Content>
      </Select.Root>
      <Button variant="outline" size="sm" class="mt-2 w-full" onclick={() => void testMicrophone()}>
        {#if micTesting}<Square size={12} />{m['settings.audio_stop_test']()}{:else}<Mic size={13} />{m['settings.audio_test_mic']()}{/if}
      </Button>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]" role="meter" aria-label={m['settings.audio_level']()} aria-valuemin="0" aria-valuemax="100" aria-valuenow={micLevel}>
        <span class="block h-full rounded-full bg-[var(--app-success)] transition-[width] duration-75" style:width={`${micLevel}%`}></span>
      </div>
    </div>

    <div class="flex min-w-0 flex-col gap-1.5">
      <span class="text-xs font-medium text-[var(--copy-soft)]">{m['settings.audio_output']()}</span>
      <Select.Root type="single" value={outputDeviceId} disabled={!outputSelectionSupported} onValueChange={(value: string) => patch({ audioOutputDeviceId: value })}>
        <Select.Trigger data-slot="select-trigger" class="w-full min-w-0"><span class="truncate">{selectedLabel(inventory.outputs, outputDeviceId, 'output')}</span></Select.Trigger>
        <Select.Content class="max-h-72">
          <Select.Item value={DEFAULT_AUDIO_DEVICE_ID}>{m['settings.audio_default']()}</Select.Item>
          {#each inventory.outputs as device, index (device.deviceId)}
            {#if device.deviceId && device.deviceId !== DEFAULT_AUDIO_DEVICE_ID}<Select.Item value={device.deviceId}>{deviceLabel(device, index, 'output')}</Select.Item>{/if}
          {/each}
        </Select.Content>
      </Select.Root>
      <Button variant="outline" size="sm" class="mt-2 w-full" disabled={speakerTesting} onclick={() => void testSpeaker()}>
        <Volume2 size={13} />{m['settings.audio_test_speaker']()}
      </Button>
      {#if !outputSelectionSupported}<p class="mt-2 text-ui-xs leading-4 text-[var(--copy-muted)]">{m['settings.audio_output_unsupported']()}</p>{/if}
    </div>
  </div>
  <p class="text-ui-xs leading-4 text-[var(--copy-muted)]">{m['settings.audio_permission_hint']()}</p>
</section>
