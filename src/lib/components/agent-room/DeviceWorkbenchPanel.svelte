<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import {
    ArrowLeft,
    Camera,
    ExternalLink,
    House,
    Keyboard,
    ListTree,
    LoaderCircle,
    Maximize2,
    Minus,
    PackagePlus,
    PanelRightClose,
    PanelRightOpen,
    PanelsTopLeft,
    Play,
    Plus,
    Power,
    RefreshCw,
    RotateCw,
    ScrollText,
    ShieldCheck,
    ShieldAlert,
    Smartphone,
    ZoomIn,
    ZoomOut,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import AndroidDeviceStream from './AndroidDeviceStream.svelte';
  import { fitDeviceViewportScale, stepDeviceViewportScale } from './device-viewport.js';
  import type {
    DeviceCommandInput,
    DeviceCommandResponse,
    DevicePermission,
    DevicePlatform,
    DeviceSnapshot,
  } from '$lib/modules/agent-room/contracts/schemas/device.schema.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId }: { workspaceId: string } = $props();

  let snapshot = $state<DeviceSnapshot | null>(null);
  let loading = $state(true);
  let busyCommand = $state<string | null>(null);
  let selectedPlatform = $state<DevicePlatform>('ios');
  let selectedDeviceId = $state('');
  let detailsOpen = $state(false);
  let detailTab = $state('logs');
  let logs = $state('');
  let tree = $state('');
  let screenshotPath = $state('');
  let permissions = $state('');
  let selectedPermission = $state<DevicePermission>('notifications');
  let typeText = $state('');
  let installPath = $state('');
  let bundleId = $state('');
  let streamVersion = $state(0);
  let streamError = $state(false);
  let pointerStart = $state<{ x: number; y: number } | null>(null);
  let viewportElement = $state<HTMLElement | null>(null);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let streamWidth = $state(0);
  let streamHeight = $state(0);
  let viewportMode = $state<'fit' | 'custom'>('fit');
  let customViewportScale = $state(1);
  let confirmPhysicalOpen = $state(false);

  const session = $derived(snapshot?.session ?? null);
  const devices = $derived((snapshot?.devices ?? []).filter((device) => device.platform === selectedPlatform));
  const selectedDevice = $derived(devices.find((device) => device.id === selectedDeviceId) ?? devices[0] ?? null);
  const activeAvailability = $derived(snapshot?.platforms.find((platform) => platform.platform === selectedPlatform) ?? null);
  const streamUrl = $derived(session
    ? `/api/agent-room/workspaces/${workspaceId}/devices/stream?session=${encodeURIComponent(session.attachedAt)}&v=${streamVersion}`
    : '');
  const fittedViewportScale = $derived(fitDeviceViewportScale({
    contentWidth: streamWidth + 10,
    contentHeight: streamHeight + 10,
    viewportWidth,
    viewportHeight,
  }));
  const viewportScale = $derived(viewportMode === 'fit' ? fittedViewportScale : customViewportScale);
  const viewportZoomLabel = $derived(`${Math.round(viewportScale * 100)}%`);
  const streamImageStyle = $derived(streamWidth > 0 && streamHeight > 0
    ? `width: ${Math.max(1, Math.round(streamWidth * viewportScale))}px; height: ${Math.max(1, Math.round(streamHeight * viewportScale))}px;`
    : undefined);
  const permissionOptions = $derived.by(() => {
    const options: Array<{ value: DevicePermission; label: string }> = [
      { value: 'notifications', label: m['device.permission_notifications']() },
      { value: 'location', label: m['device.permission_location']() },
      { value: 'camera', label: m['device.permission_camera']() },
      { value: 'microphone', label: m['device.permission_microphone']() },
      { value: 'photos', label: m['device.permission_photos']() },
      { value: 'photos-add', label: m['device.permission_photos_add']() },
      { value: 'contacts', label: m['device.permission_contacts']() },
      { value: 'calendar', label: m['device.permission_calendar']() },
      { value: 'reminders', label: m['device.permission_reminders']() },
      { value: 'motion', label: m['device.permission_motion']() },
      { value: 'media-library', label: m['device.permission_media_library']() },
      { value: 'siri', label: m['device.permission_siri']() },
      { value: 'speech', label: m['device.permission_speech']() },
      { value: 'faceid', label: m['device.permission_faceid']() },
      { value: 'user-tracking', label: m['device.permission_user_tracking']() },
      { value: 'homekit', label: m['device.permission_homekit']() },
      { value: 'all', label: m['device.permission_all']() },
    ];
    if (selectedPlatform !== 'android') return options;
    const androidPermissions = new Set<DevicePermission>([
      'notifications', 'location', 'camera', 'microphone', 'photos', 'photos-add',
      'contacts', 'calendar', 'motion', 'media-library', 'speech', 'faceid', 'all',
    ]);
    return options.filter((option) => androidPermissions.has(option.value));
  });

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
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || 'device request failed');
    return payload.data as T;
  }

  function reconcile(next: DeviceSnapshot): void {
    snapshot = next;
    if (next.session) {
      selectedPlatform = next.session.platform;
    } else if (!next.platforms.some((platform) => platform.platform === selectedPlatform && platform.available)) {
      selectedPlatform = next.platforms.find((platform) => platform.available)?.platform ?? selectedPlatform;
    }
    const candidates = next.devices.filter((device) => device.platform === selectedPlatform);
    if (!candidates.some((device) => device.id === selectedDeviceId)) {
      selectedDeviceId = candidates.find((device) => device.state === 'booted')?.id ?? candidates[0]?.id ?? '';
    }
  }

  async function load(options: { quiet?: boolean } = {}): Promise<void> {
    if (!options.quiet) loading = true;
    try {
      reconcile(await api<DeviceSnapshot>(`/api/agent-room/workspaces/${workspaceId}/devices`));
    } catch {
      if (!options.quiet) toast.error(m['device.load_failed']());
    } finally {
      if (!options.quiet) loading = false;
    }
  }

  async function command(input: DeviceCommandInput): Promise<DeviceCommandResponse | null> {
    busyCommand = input.command;
    try {
      const response = await api<DeviceCommandResponse>(`/api/agent-room/workspaces/${workspaceId}/devices`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      reconcile(response.snapshot);
      streamError = false;
      if (response.result?.kind === 'logs') {
        logs = response.result.content;
        detailTab = 'logs';
        detailsOpen = true;
      } else if (response.result?.kind === 'tree') {
        tree = JSON.stringify(response.result.tree, null, 2);
        detailTab = 'tree';
        detailsOpen = true;
      } else if (response.result?.kind === 'screenshot') {
        screenshotPath = response.result.path;
        detailTab = 'screenshots';
        detailsOpen = true;
        toast.success(m['device.screenshot_saved']());
      } else if (response.result?.kind === 'permissions') {
        permissions = response.result.content;
        detailTab = 'permissions';
        detailsOpen = true;
      }
      return response;
    } catch {
      await load({ quiet: true });
      toast.error(m['device.command_failed']());
      return null;
    } finally {
      busyCommand = null;
    }
  }

  function requestStart(): void {
    if (selectedDevice?.physical) {
      confirmPhysicalOpen = true;
      return;
    }
    void start(false);
  }

  async function start(confirmPhysical: boolean): Promise<void> {
    const target = selectedDevice;
    if (!target) return;
    const response = await command({
      command: 'start',
      platform: target.platform,
      deviceId: target.id,
      confirmPhysical,
    });
    if (response?.snapshot.session) {
      confirmPhysicalOpen = false;
      streamWidth = 0;
      streamHeight = 0;
      streamVersion += 1;
      toast.success(m['device.attached']({ device: response.snapshot.session.deviceName }));
    }
  }

  async function restart(): Promise<void> {
    if (!session) return;
    const response = await command({ command: 'restart' });
    if (response) reconnectStream();
  }

  async function rotate(): Promise<void> {
    if (!session) return;
    const response = await command({
      command: 'rotate',
      orientation: session.orientation.startsWith('portrait') ? 'landscape_left' : 'portrait',
    });
    if (response) reconnectStream();
  }

  function reconnectStream(): void {
    streamWidth = 0;
    streamHeight = 0;
    streamError = false;
    streamVersion += 1;
  }

  function streamLoaded(eventOrWidth: Event | number, height?: number): void {
    if (typeof eventOrWidth === 'number') {
      streamWidth = eventOrWidth;
      streamHeight = height ?? 0;
    } else {
      const image = eventOrWidth.currentTarget as HTMLImageElement;
      streamWidth = image.naturalWidth;
      streamHeight = image.naturalHeight;
    }
    streamError = false;
  }

  function zoomViewport(direction: -1 | 1): void {
    customViewportScale = stepDeviceViewportScale(viewportScale, direction);
    viewportMode = 'custom';
  }

  function showActualSize(): void {
    customViewportScale = 1;
    viewportMode = 'custom';
  }

  async function sendText(): Promise<void> {
    const text = typeText.trim();
    if (!text) return;
    if (await command({ command: 'type', text })) typeText = '';
  }

  async function permissionCommand(action: 'list' | 'grant' | 'revoke' | 'reset'): Promise<void> {
    const targetBundle = bundleId.trim();
    if (action !== 'list' && !targetBundle) return;
    await command({
      command: 'permissions',
      action,
      permission: action === 'list' ? undefined : selectedPermission,
      bundleId: targetBundle || undefined,
    });
  }

  function normalizedPoint(event: PointerEvent, target: HTMLElement): { x: number; y: number } | null {
    if (!streamWidth || !streamHeight) return null;
    const rect = target.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  function pointerDown(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const point = normalizedPoint(event, target);
    if (!point) return;
    pointerStart = point;
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function pointerUp(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const end = normalizedPoint(event, target);
    const start = pointerStart;
    pointerStart = null;
    if (!start || !end) return;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance < 0.018) void command({ command: 'tap', x: end.x, y: end.y });
    else void command({ command: 'swipe', fromX: start.x, fromY: start.y, toX: end.x, toY: end.y, durationMs: 300 });
  }

  function availabilityLabel(): string {
    if (!activeAvailability) return m['device.status_checking']();
    const labels: Record<string, () => string> = {
      unsupported_os: m['device.unavailable_os'],
      unsupported_arch: m['device.unavailable_arch'],
      xcode_missing: m['device.xcode_missing'],
      runtime_missing: m['device.runtime_missing'],
      android_sdk_missing: m['device.android_sdk_missing'],
      android_device_missing: m['device.android_device_missing'],
      ready: m['device.ready'],
    };
    return (labels[activeAvailability.reason] ?? m['device.unavailable'])();
  }

  onMount(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden && snapshot?.session) void load({ quiet: true });
    }, 10_000);
    return () => window.clearInterval(timer);
  });

  $effect(() => {
    if (!permissionOptions.some((option) => option.value === selectedPermission)) {
      selectedPermission = 'notifications';
    }
  });

  $effect(() => {
    const element = viewportElement;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      viewportWidth = rect.width;
      viewportHeight = rect.height;
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<section class="device-panel grid h-full min-h-0 grid-rows-[42px_minmax(0,1fr)] bg-[var(--app-canvas)] text-[var(--app-text)]" data-testid="device-panel">
  <header class="flex min-w-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-2">
    <div class="flex h-7 shrink-0 items-center rounded-[5px] border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-0.5" aria-label={m['device.platform']()}>
      <button
        class={`grid size-6 place-items-center rounded-[3px] text-ui-xs font-semibold transition-colors ${selectedPlatform === 'ios' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`}
        aria-pressed={selectedPlatform === 'ios'}
        disabled={Boolean(session)}
        onclick={() => (selectedPlatform = 'ios')}
      >{m['device.platform_ios']()}</button>
      <button
        class={`grid h-6 min-w-8 place-items-center rounded-[3px] px-1 text-ui-xs font-semibold transition-colors ${selectedPlatform === 'android' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`}
        aria-pressed={selectedPlatform === 'android'}
        disabled={Boolean(session)}
        onclick={() => (selectedPlatform = 'android')}
      >{m['device.platform_android']()}</button>
    </div>

    {#if !session}
      <Select.Root type="single" value={selectedDeviceId} onValueChange={(value: string) => (selectedDeviceId = value)} disabled={!activeAvailability?.available || !devices.length}>
        <Select.Trigger size="sm" class="min-w-0 max-w-72 flex-1 border-[var(--app-border)] bg-[var(--app-surface-subtle)] text-xs" aria-label={m['device.choose_device']()}>
          {selectedDevice?.name ?? m['device.choose_device']()}
        </Select.Trigger>
        <Select.Content>
          {#each devices as device (device.id)}
            <Select.Item value={device.id} label={`${device.name} · ${device.runtime ?? ''}`} disabled={!device.available}>
              <span class="flex min-w-0 items-center gap-2">
                <span class={`size-1.5 rounded-full ${device.state === 'booted' ? 'bg-[var(--app-success)]' : 'bg-[var(--app-text-muted)]'}`}></span>
                <span class="truncate">{device.name}</span>
                <span class="truncate text-ui-xs text-[var(--app-text-muted)]">{device.runtime}</span>
                {#if device.physical}<span class="shrink-0 text-ui-xs text-[var(--app-warning)]">{m['device.physical']()}</span>{/if}
              </span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 shrink-0 rounded-[5px]" aria-label={m['device.refresh']()} disabled={loading || busyCommand !== null} onclick={() => void load()}><RefreshCw size={13} class={loading ? 'animate-spin' : ''} aria-hidden="true" /></Button>{/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['device.refresh']()}</Tooltip.Content>
      </Tooltip.Root>
      <Button size="sm" class="h-7 gap-1.5 rounded-[5px]" disabled={!selectedDevice?.available || busyCommand !== null} onclick={requestStart}>
        {#if busyCommand === 'start'}<LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{:else}<Play size={13} aria-hidden="true" />{/if}
        {m['device.start']()}
      </Button>
    {:else}
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <span class="size-1.5 shrink-0 rounded-full bg-[var(--app-success)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-success)_15%,transparent)]"></span>
        <span class="truncate text-xs font-medium">{session.deviceName}</span>
        <span class="hidden truncate text-ui-xs text-[var(--app-text-muted)] sm:inline">{devices.find((device) => device.id === session.deviceId)?.runtime ?? session.platform}</span>
      </div>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[5px]" aria-label={m['device.home']()} disabled={busyCommand !== null} onclick={() => void command({ command: 'button', button: 'home' })}><House size={14} aria-hidden="true" /></Button>{/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['device.home']()}</Tooltip.Content>
      </Tooltip.Root>
      {#if session.platform === 'android'}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[5px]" aria-label={m['device.back']()} disabled={busyCommand !== null} onclick={() => void command({ command: 'button', button: 'back' })}><ArrowLeft size={14} aria-hidden="true" /></Button>{/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{m['device.back']()}</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[5px]" aria-label={m['device.app_switcher']()} disabled={busyCommand !== null} onclick={() => void command({ command: 'button', button: 'app-switcher' })}><PanelsTopLeft size={14} aria-hidden="true" /></Button>{/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{m['device.app_switcher']()}</Tooltip.Content>
        </Tooltip.Root>
      {/if}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[5px]" aria-label={m['device.rotate']()} disabled={busyCommand !== null} onclick={rotate}><RotateCw size={14} aria-hidden="true" /></Button>{/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['device.rotate']()}</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[5px]" aria-label={m['device.pinch_in']()} disabled={busyCommand !== null} onclick={() => void command({ command: 'pinch', centerX: 0.5, centerY: 0.5, startDistance: 0.42, endDistance: 0.18, durationMs: 260 })}><ZoomOut size={14} aria-hidden="true" /></Button>{/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['device.pinch_in']()}</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[5px]" aria-label={m['device.pinch_out']()} disabled={busyCommand !== null} onclick={() => void command({ command: 'pinch', centerX: 0.5, centerY: 0.5, startDistance: 0.18, endDistance: 0.42, durationMs: 260 })}><ZoomIn size={14} aria-hidden="true" /></Button>{/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['device.pinch_out']()}</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[5px]" aria-label={m['device.restart']()} disabled={busyCommand !== null} onclick={restart}><RefreshCw size={14} class={busyCommand === 'start' || busyCommand === 'stop' ? 'animate-spin' : ''} aria-hidden="true" /></Button>{/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['device.restart']()}</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[5px] text-[var(--app-danger)]" aria-label={m['device.stop']()} disabled={busyCommand !== null} onclick={() => void command({ command: 'stop' })}><Power size={14} aria-hidden="true" /></Button>{/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['device.stop']()}</Tooltip.Content>
      </Tooltip.Root>
    {/if}

    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 shrink-0 rounded-[5px]" aria-label={m['device.details']()} aria-pressed={detailsOpen} onclick={() => (detailsOpen = !detailsOpen)}>{#if detailsOpen}<PanelRightClose size={14} aria-hidden="true" />{:else}<PanelRightOpen size={14} aria-hidden="true" />{/if}</Button>{/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>{m['device.details']()}</Tooltip.Content>
    </Tooltip.Root>
  </header>

  <div class={`device-layout relative grid min-h-0 min-w-0 ${detailsOpen ? 'grid-cols-[minmax(0,1fr)_minmax(260px,34%)]' : 'grid-cols-[minmax(0,1fr)]'}`}>
    <main bind:this={viewportElement} class="relative min-h-0 min-w-0 overflow-hidden bg-[var(--app-canvas)]">
      {#if loading}
        <div class="flex h-full items-center justify-center gap-2 p-3 text-xs text-[var(--app-text-muted)]"><LoaderCircle size={15} class="animate-spin" />{m['device.status_checking']()}</div>
      {:else if !session}
        <div class="mx-auto flex h-full max-w-sm flex-col items-center justify-center p-3 text-center sm:p-5">
          <div class="mx-auto grid size-12 place-items-center rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text-muted)] shadow-sm"><Smartphone size={23} strokeWidth={1.5} /></div>
          <h2 class="mt-4 text-sm font-semibold">{availabilityLabel()}</h2>
          <p class="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">{activeAvailability?.available ? m['device.select_prompt']() : m['device.setup_required']()}</p>
          {#if activeAvailability?.setupUrl && !activeAvailability.available}
            <a class="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-[var(--app-border)] bg-[var(--app-surface)] px-3 text-xs font-medium hover:bg-[var(--app-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]" href={activeAvailability.setupUrl} target="_blank" rel="noreferrer">
              {m['device.open_setup']()}<ExternalLink size={12} aria-hidden="true" />
            </a>
          {/if}
        </div>
      {:else}
        <div class="device-viewport-scroll absolute inset-0 overflow-auto overscroll-contain" data-testid="device-viewport-scroll">
          <div class="device-viewport-stage box-border flex min-h-full min-w-full p-3 pb-14">
            <div class="relative m-auto shrink-0 overflow-hidden rounded-[22px] bg-black p-[5px] shadow-[0_18px_50px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,255,255,0.12)]">
            {#if streamError}
              <div class="absolute inset-1 z-10 flex items-center justify-center rounded-[18px] bg-black/90 p-6 text-center">
                <div><p class="text-xs font-medium text-white">{m['device.stream_lost']()}</p><Button variant="secondary" size="sm" class="mt-3" onclick={reconnectStream}>{m['device.reconnect']()}</Button></div>
              </div>
            {/if}
            {#if session.platform === 'android'}
              <AndroidDeviceStream
                {streamUrl}
                alt={m['device.stream_alt']({ device: session.deviceName })}
                style={streamImageStyle}
                onloaded={(width, height) => streamLoaded(width, height)}
                onerror={() => (streamError = true)}
                onpointerdown={pointerDown}
                onpointerup={pointerUp}
                onpointercancel={() => (pointerStart = null)}
              />
            {:else}
              <img
                src={streamUrl}
                alt={m['device.stream_alt']({ device: session.deviceName })}
                class="block max-h-none max-w-none touch-none select-none rounded-[18px] object-contain"
                style={streamImageStyle}
                draggable="false"
                onload={streamLoaded}
                onerror={() => (streamError = true)}
                onpointerdown={pointerDown}
                onpointerup={pointerUp}
                onpointercancel={() => (pointerStart = null)}
              />
            {/if}
            </div>
          </div>
        </div>

        <div class="absolute bottom-2 right-2 z-10 flex h-8 items-center rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-0.5 shadow-lg" data-testid="device-viewport-controls">
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[4px]" aria-label={m['device.viewport_zoom_out']()} disabled={!streamWidth || viewportScale <= 0.25} onclick={() => zoomViewport(-1)}><Minus size={13} aria-hidden="true" /></Button>{/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{m['device.viewport_zoom_out']()}</Tooltip.Content>
          </Tooltip.Root>
          <output class="w-11 select-none text-center font-mono text-ui-xs text-[var(--app-text-soft)]" aria-label={m['device.viewport_zoom_level']({ percent: viewportZoomLabel })}>{viewportZoomLabel}</output>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="size-7 rounded-[4px]" aria-label={m['device.viewport_zoom_in']()} disabled={!streamWidth || viewportScale >= 2} onclick={() => zoomViewport(1)}><Plus size={13} aria-hidden="true" /></Button>{/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{m['device.viewport_zoom_in']()}</Tooltip.Content>
          </Tooltip.Root>
          <span class="mx-0.5 h-4 w-px bg-[var(--app-border)]"></span>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class={`size-7 rounded-[4px] ${viewportMode === 'fit' ? 'bg-[var(--app-surface-raised)]' : ''}`} aria-label={m['device.viewport_fit']()} aria-pressed={viewportMode === 'fit'} disabled={!streamWidth} onclick={() => (viewportMode = 'fit')}><Maximize2 size={13} aria-hidden="true" /></Button>{/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{m['device.viewport_fit']()}</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}<Button {...props} variant="ghost" size="sm" class={`h-7 min-w-8 rounded-[4px] px-1.5 font-mono text-ui-xs ${viewportMode === 'custom' && customViewportScale === 1 ? 'bg-[var(--app-surface-raised)]' : ''}`} aria-label={m['device.viewport_actual']()} aria-pressed={viewportMode === 'custom' && customViewportScale === 1} disabled={!streamWidth} onclick={showActualSize}>1:1</Button>{/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{m['device.viewport_actual']()}</Tooltip.Content>
          </Tooltip.Root>
        </div>

        {#if busyCommand && !['logs', 'tree', 'screenshot'].includes(busyCommand)}
          <div class="pointer-events-none absolute bottom-12 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 text-ui-xs font-medium text-white shadow-lg backdrop-blur-sm"><LoaderCircle size={11} class="animate-spin" />{m['device.sending']()}</div>
        {/if}
      {/if}
    </main>

    {#if detailsOpen}
      <aside class="device-details min-h-0 min-w-0 border-l border-[var(--app-border)] bg-[var(--app-surface)]" aria-label={m['device.details']()}>
        <Tabs.Root value={detailTab} onValueChange={(value: string) => (detailTab = value)} class="grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)]">
          <Tabs.List class="h-[38px] w-full justify-start overflow-x-auto rounded-none border-b border-[var(--app-border)] bg-transparent px-2">
            <Tabs.Trigger value="logs" class="h-7 gap-1.5 px-2 text-ui-xs"><ScrollText size={12} />{m['device.logs']()}</Tabs.Trigger>
            <Tabs.Trigger value="tree" class="h-7 gap-1.5 px-2 text-ui-xs"><ListTree size={12} />{m['device.tree']()}</Tabs.Trigger>
            <Tabs.Trigger value="screenshots" class="h-7 gap-1.5 px-2 text-ui-xs"><Camera size={12} />{m['device.screenshots']()}</Tabs.Trigger>
            <Tabs.Trigger value="permissions" class="h-7 gap-1.5 px-2 text-ui-xs"><ShieldCheck size={12} />{m['device.permissions']()}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="logs" class="min-h-0 overflow-auto p-3">
            <div class="mb-3 flex items-center justify-between gap-2"><span class="text-xs font-medium">{m['device.logs']()}</span><Button variant="outline" size="sm" class="h-7 gap-1.5 rounded-[5px] text-ui-xs" disabled={!session || busyCommand !== null} onclick={() => void command({ command: 'logs', minutes: 2 })}><RefreshCw size={11} class={busyCommand === 'logs' ? 'animate-spin' : ''} />{m['device.refresh']()}</Button></div>
            <pre class="min-h-36 whitespace-pre-wrap break-words rounded-[5px] border border-[var(--app-border)] bg-[var(--app-code-bg)] p-2 font-mono text-ui-xs leading-4 text-[var(--app-code-text)]">{logs || m['device.no_logs']()}</pre>
            <div class="mt-4 space-y-2 border-t border-[var(--app-border)] pt-3">
              <label class="text-ui-xs font-medium text-[var(--app-text-soft)]" for="device-type-text">{m['device.type_text']()}</label>
              <div class="flex gap-2"><Input id="device-type-text" bind:value={typeText} class="h-8 min-w-0 text-xs" onkeydown={(event: KeyboardEvent) => { if (event.key === 'Enter') void sendText(); }} /><Button size="sm" class="h-8 w-8 shrink-0 p-0" aria-label={m['device.send_text']()} disabled={!session || !typeText.trim() || busyCommand !== null} onclick={sendText}><Keyboard size={13} /></Button></div>
              <label class="block pt-2 text-ui-xs font-medium text-[var(--app-text-soft)]" for="device-install-path">{m['device.install_app']()}</label>
              <div class="flex gap-2"><Input id="device-install-path" bind:value={installPath} class="h-8 min-w-0 text-xs" placeholder={m['device.install_placeholder']()} /><Button size="sm" variant="outline" class="h-8 w-8 shrink-0 p-0" aria-label={m['device.install_app']()} disabled={!session || !installPath.trim() || busyCommand !== null} onclick={() => void command({ command: 'install', path: installPath.trim() })}><PackagePlus size={13} /></Button></div>
              <label class="block pt-2 text-ui-xs font-medium text-[var(--app-text-soft)]" for="device-bundle-id">{m['device.launch_app']()}</label>
              <div class="flex gap-2"><Input id="device-bundle-id" bind:value={bundleId} class="h-8 min-w-0 text-xs" placeholder={m['device.launch_placeholder']()} /><Button size="sm" variant="outline" class="h-8 w-8 shrink-0 p-0" aria-label={m['device.launch_app']()} disabled={!session || !bundleId.trim() || busyCommand !== null} onclick={() => void command({ command: 'launch', bundleId: bundleId.trim() })}><Play size={13} /></Button></div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="tree" class="min-h-0 overflow-auto p-3">
            <div class="mb-3 flex items-center justify-between gap-2"><span class="text-xs font-medium">{m['device.accessibility_tree']()}</span><Button variant="outline" size="sm" class="h-7 gap-1.5 rounded-[5px] text-ui-xs" disabled={!session || busyCommand !== null} onclick={() => void command({ command: 'tree' })}><RefreshCw size={11} class={busyCommand === 'tree' ? 'animate-spin' : ''} />{m['device.refresh']()}</Button></div>
            <pre class="min-h-36 whitespace-pre-wrap break-all rounded-[5px] border border-[var(--app-border)] bg-[var(--app-code-bg)] p-2 font-mono text-ui-xs leading-4 text-[var(--app-code-text)]">{tree || m['device.no_tree']()}</pre>
          </Tabs.Content>

          <Tabs.Content value="screenshots" class="min-h-0 overflow-auto p-3">
            <div class="mb-3 flex items-center justify-between gap-2"><span class="text-xs font-medium">{m['device.screenshots']()}</span><Button variant="outline" size="sm" class="h-7 gap-1.5 rounded-[5px] text-ui-xs" disabled={!session || busyCommand !== null} onclick={() => void command({ command: 'screenshot' })}><Camera size={11} />{m['device.capture']()}</Button></div>
            {#if screenshotPath}
              <img class="w-full rounded-[5px] border border-[var(--app-border)] bg-black object-contain" src={`/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(screenshotPath)}`} alt={m['device.latest_screenshot']()} />
              <p class="mt-2 break-all font-mono text-ui-xs leading-4 text-[var(--app-text-muted)]">{screenshotPath}</p>
            {:else}
              <div class="flex min-h-40 items-center justify-center rounded-[5px] border border-dashed border-[var(--app-border)] text-center text-xs text-[var(--app-text-muted)]">{m['device.no_screenshots']()}</div>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="permissions" class="min-h-0 overflow-auto p-3">
            <div class="space-y-3">
              <div>
                <label class="text-ui-xs font-medium text-[var(--app-text-soft)]" for="device-permission-bundle">{session?.platform === 'android' ? m['device.package_id']() : m['device.bundle_id']()}</label>
                <Input id="device-permission-bundle" bind:value={bundleId} class="mt-1 h-8 text-xs" placeholder={m['device.launch_placeholder']()} />
              </div>
              <div>
                <span class="text-ui-xs font-medium text-[var(--app-text-soft)]">{m['device.permission']()}</span>
                <Select.Root type="single" value={selectedPermission} onValueChange={(value: string) => (selectedPermission = value as DevicePermission)}>
                  <Select.Trigger size="sm" class="mt-1 h-8 w-full border-[var(--app-border)] bg-[var(--app-surface-subtle)] text-xs">
                    {permissionOptions.find((option) => option.value === selectedPermission)?.label ?? selectedPermission}
                  </Select.Trigger>
                  <Select.Content>
                    {#each permissionOptions as option (option.value)}
                      <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" class="h-8 rounded-[5px] text-ui-xs" disabled={!session || busyCommand !== null} onclick={() => void permissionCommand('list')}>{m['device.permission_list']()}</Button>
                <Button variant="outline" size="sm" class="h-8 rounded-[5px] text-ui-xs" disabled={!session || !bundleId.trim() || busyCommand !== null} onclick={() => void permissionCommand('grant')}>{m['device.permission_grant']()}</Button>
                <Button variant="outline" size="sm" class="h-8 rounded-[5px] text-ui-xs" disabled={!session || !bundleId.trim() || busyCommand !== null} onclick={() => void permissionCommand('revoke')}>{m['device.permission_revoke']()}</Button>
                <Button variant="outline" size="sm" class="h-8 rounded-[5px] text-ui-xs" disabled={!session || !bundleId.trim() || busyCommand !== null} onclick={() => void permissionCommand('reset')}>{m['device.permission_reset']()}</Button>
              </div>
              <pre class="min-h-36 whitespace-pre-wrap break-words rounded-[5px] border border-[var(--app-border)] bg-[var(--app-code-bg)] p-2 font-mono text-ui-xs leading-4 text-[var(--app-code-text)]">{permissions || m['device.no_permissions']()}</pre>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </aside>
    {/if}
  </div>
</section>

<AlertDialog.Root bind:open={confirmPhysicalOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Media><ShieldAlert aria-hidden="true" /></AlertDialog.Media>
      <AlertDialog.Title>{m['device.physical_confirm_title']()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m['device.physical_confirm_description']({ device: selectedDevice?.name ?? m['device.physical']() })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => void start(true)}>{m['device.physical_confirm_action']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .device-panel {
    container: device-panel / inline-size;
  }

  @container device-panel (max-width: 720px) {
    .device-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .device-details {
      position: absolute;
      inset: 0 0 0 auto;
      z-index: 20;
      width: min(320px, calc(100% - 36px));
      box-shadow: -16px 0 36px rgb(0 0 0 / 20%);
    }
  }
</style>
