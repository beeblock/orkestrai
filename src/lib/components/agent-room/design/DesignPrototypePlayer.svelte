<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArrowLeft,
    Eye,
    EyeOff,
    Maximize2,
    Play,
    RefreshCw,
    Scaling,
    Share2,
    X,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type {
    DesignDocument,
    DesignElement,
    DesignPrototypeInteraction,
    DesignPrototypeTransition,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import {
    applyMotionTracks,
    defaultPrototypeFlow,
    designDescendantIds,
    easingToCss,
    prototypeFrameElements,
  } from '$lib/modules/agent-room/domain/design-prototype.js';
  import { resolveDesignElements } from '$lib/modules/agent-room/domain/design-variables.js';
  import * as m from '$lib/paraglide/messages.js';
  import DesignRenderer from './DesignRenderer.svelte';

  let {
    document,
    workspaceId,
    flowId = null,
    onClose,
    onShare,
  }: {
    document: DesignDocument;
    workspaceId: string;
    flowId?: string | null;
    onClose: () => void;
    onShare: (flowId: string) => void | Promise<void>;
  } = $props();

  type OverlayState = {
    frameId: string;
    interaction: DesignPrototypeInteraction;
  };

  let root = $state<HTMLElement>();
  let viewport = $state<HTMLElement>();
  let activeFlowId = $state('');
  let currentFrameId = $state('');
  let history = $state<string[]>([]);
  let overlays = $state<OverlayState[]>([]);
  let activeModes = $state<Record<string, string>>({});
  let elapsedMs = $state(0);
  let viewportWidth = $state(900);
  let viewportHeight = $state(700);
  let hotspotsVisible = $state(false);
  let fillStage = $state(false);
  let animationFrame = 0;
  let enteredAt = 0;
  let delayedTimers: ReturnType<typeof setTimeout>[] = [];
  const hoverRuns = new Map<string, number>();

  const flows = $derived([...document.prototypeFlows].sort((left, right) => left.order - right.order));
  const activeFlow = $derived(flows.find((flow) => flow.id === activeFlowId) ?? defaultPrototypeFlow(document));
  const currentFrame = $derived(document.elements.find((element) => element.id === currentFrameId && element.type === 'frame') ?? null);
  const frameElements = $derived(currentFrame ? prototypeFrameElements(document, currentFrame.id) : []);
  const frameIds = $derived(new Set(frameElements.map((element) => element.id)));
  const fixedIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const element of frameElements) {
      let current: DesignElement | undefined = element;
      while (current && current.id !== currentFrame?.id) {
        if (current.prototypeFixed) {
          for (const id of designDescendantIds(document, current.id)) ids.add(id);
          break;
        }
        current = current.parentId ? document.elements.find((candidate) => candidate.id === current?.parentId) : undefined;
      }
    }
    return ids;
  });
  const resolvedFrameElements = $derived.by(() => {
    const resolved = resolveDesignElements({ ...document, activeVariableModes: activeModes }, frameElements);
    return applyMotionTracks(document, resolved, elapsedMs);
  });
  const scrollingElements = $derived(resolvedFrameElements.filter((element) => !fixedIds.has(element.id)));
  const fixedElements = $derived(resolvedFrameElements.filter((element) => fixedIds.has(element.id)));
  const contentBounds = $derived.by(() => {
    if (!currentFrame) return { width: 1, height: 1 };
    const children = scrollingElements.filter((element) => element.id !== currentFrame.id && element.visible);
    const right = Math.max(currentFrame.x + currentFrame.width, ...children.map((element) => element.x + element.width));
    const bottom = Math.max(currentFrame.y + currentFrame.height, ...children.map((element) => element.y + element.height));
    return { width: Math.max(currentFrame.width, right - currentFrame.x), height: Math.max(currentFrame.height, bottom - currentFrame.y) };
  });
  const fitScale = $derived.by(() => {
    if (!currentFrame) return 1;
    const availableWidth = Math.max(240, viewportWidth - 80);
    const availableHeight = Math.max(240, viewportHeight - 80);
    const fit = Math.min(availableWidth / currentFrame.width, availableHeight / currentFrame.height);
    return fillStage ? Math.max(0.1, Math.min(2, Math.max(availableWidth / currentFrame.width, availableHeight / currentFrame.height))) : Math.max(0.1, Math.min(1.5, fit));
  });
  const currentInteractions = $derived(document.prototypeInteractions.filter((interaction) => frameIds.has(interaction.sourceElementId)));
  const hotspotElements = $derived(resolvedFrameElements.filter((element) => currentInteractions.some((interaction) => interaction.sourceElementId === element.id)));

  function clearDelayedInteractions() {
    for (const timer of delayedTimers) clearTimeout(timer);
    delayedTimers = [];
  }

  function startMotion() {
    cancelAnimationFrame(animationFrame);
    enteredAt = performance.now();
    const frame = () => {
      elapsedMs = performance.now() - enteredAt;
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
  }

  function scheduleDelayedInteractions() {
    clearDelayedInteractions();
    for (const interaction of currentInteractions.filter((candidate) => candidate.trigger.type === 'after-delay')) {
      delayedTimers.push(setTimeout(() => void runInteraction(interaction), interaction.trigger.delayMs));
    }
  }

  function transitionKeyframes(transition: DesignPrototypeTransition): Keyframe[] {
    if (transition.type === 'instant') return [];
    if (transition.type === 'dissolve' || transition.type === 'smart-animate') return [{ opacity: 0 }, { opacity: 1 }];
    const distance = transition.type === 'push' ? 48 : 24;
    const axis = transition.direction === 'left' || transition.direction === 'right' ? 'X' : 'Y';
    const sign = transition.direction === 'left' || transition.direction === 'up' ? 1 : -1;
    return [
      { opacity: transition.type === 'slide' ? 0 : 0.6, transform: `translate${axis}(${distance * sign}px)` },
      { opacity: 1, transform: 'translate(0, 0)' },
    ];
  }

  async function animateEntry(transition: DesignPrototypeTransition) {
    if (transition.type === 'instant' || transition.durationMs <= 0) return;
    await tick();
    const stage = root?.querySelector<HTMLElement>('[data-prototype-current]');
    stage?.animate(transitionKeyframes(transition), {
      duration: transition.durationMs,
      easing: easingToCss(transition.easing),
      fill: 'both',
    });
  }

  function enterFrame(frameId: string, transition?: DesignPrototypeTransition, addHistory = true) {
    if (!document.elements.some((element) => element.id === frameId && element.type === 'frame')) return;
    if (addHistory && currentFrameId && currentFrameId !== frameId) history = [...history, currentFrameId].slice(-100);
    currentFrameId = frameId;
    overlays = [];
    viewport?.scrollTo({ left: 0, top: 0 });
    startMotion();
    scheduleDelayedInteractions();
    if (transition) void animateEntry(transition);
  }

  function startFlow(nextFlowId: string) {
    const flow = flows.find((candidate) => candidate.id === nextFlowId) ?? defaultPrototypeFlow(document);
    if (!flow) return;
    activeFlowId = flow.id;
    history = [];
    overlays = [];
    activeModes = { ...document.activeVariableModes };
    hotspotsVisible = document.presentation.showHotspots;
    enterFrame(flow.startFrameId, undefined, false);
  }

  function goBack() {
    if (overlays.length) {
      overlays = overlays.slice(0, -1);
      return;
    }
    const previous = history.at(-1);
    if (!previous) return;
    history = history.slice(0, -1);
    enterFrame(previous, undefined, false);
  }

  async function runInteraction(interaction: DesignPrototypeInteraction) {
    const action = interaction.action;
    if (action.type === 'navigate') {
      enterFrame(action.targetFrameId, interaction.transition);
      return;
    }
    if (action.type === 'open-overlay') {
      overlays = [...overlays, { frameId: action.targetFrameId, interaction }].slice(-8);
      await tick();
      const target = root?.querySelector<HTMLElement>('[data-prototype-overlay]:last-of-type');
      target?.animate(transitionKeyframes(interaction.transition), {
        duration: interaction.transition.durationMs,
        easing: easingToCss(interaction.transition.easing),
        fill: 'both',
      });
      return;
    }
    if (action.type === 'close-overlay') {
      overlays = overlays.slice(0, -1);
      return;
    }
    if (action.type === 'back') {
      goBack();
      return;
    }
    if (action.type === 'scroll-to') {
      const target = document.elements.find((element) => element.id === action.targetElementId);
      if (target && currentFrame) viewport?.scrollTo({ top: Math.max(0, (target.y - currentFrame.y) * fitScale), left: Math.max(0, (target.x - currentFrame.x) * fitScale), behavior: 'smooth' });
      return;
    }
    activeModes = { ...activeModes, [action.collectionId]: action.modeId };
  }

  function eventInteraction(event: Event, trigger: 'click' | 'hover' | 'press') {
    const target = (event.target as Element | null)?.closest<SVGGElement>('[data-design-element]');
    if (!target) return;
    const interaction = document.prototypeInteractions.find((candidate) => candidate.sourceElementId === target.dataset.designElement && candidate.trigger.type === trigger);
    if (!interaction) return;
    if (trigger === 'hover') {
      const previous = hoverRuns.get(interaction.id) ?? 0;
      if (Date.now() - previous < 500) return;
      hoverRuns.set(interaction.id, Date.now());
    }
    event.preventDefault();
    event.stopPropagation();
    void runInteraction(interaction);
  }

  function prototypeKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') eventInteraction(event, 'click');
  }

  function overlayFrame(overlay: OverlayState): DesignElement | null {
    return document.elements.find((element) => element.id === overlay.frameId && element.type === 'frame') ?? null;
  }

  function overlayElements(overlay: OverlayState): DesignElement[] {
    return resolveDesignElements({ ...document, activeVariableModes: activeModes }, prototypeFrameElements(document, overlay.frameId));
  }

  function overlayPosition(overlay: OverlayState): string {
    const action = overlay.interaction.action;
    if (action.type !== 'open-overlay') return 'place-items-center';
    if (action.position === 'top') return 'place-items-start justify-items-center';
    if (action.position === 'right') return 'place-items-center justify-items-end';
    if (action.position === 'bottom') return 'place-items-end justify-items-center';
    if (action.position === 'left') return 'place-items-center justify-items-start';
    return 'place-items-center';
  }

  async function toggleFullscreen() {
    if (globalThis.document.fullscreenElement) await globalThis.document.exitFullscreen();
    else await root?.requestFullscreen();
  }

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      viewportWidth = entry.contentRect.width;
      viewportHeight = entry.contentRect.height;
    });
    if (root) observer.observe(root);
    startFlow(flowId ?? document.presentation.defaultFlowId ?? flows[0]?.id ?? '');
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
      clearDelayedInteractions();
    };
  });
</script>

<div bind:this={root} class="fixed inset-0 z-[180] grid grid-rows-[48px_minmax(0,1fr)] bg-[#101012] text-white" data-design-prototype-player>
  <header class="flex min-w-0 items-center gap-1 border-b border-white/10 bg-[#17171a] px-2 shadow-lg">
    <div class="flex min-w-0 items-center gap-2 px-1">
      <span class="grid size-7 shrink-0 place-items-center rounded-md bg-white/10 text-[#a991ff]"><Play size={14} fill="currentColor" /></span>
      <div class="hidden min-w-0 sm:block"><p class="truncate text-ui-sm font-semibold">{document.name}</p><p class="text-ui-xs text-white/45">{m['design.prototype_presenting']()}</p></div>
    </div>
    <span class="mx-1 h-5 w-px bg-white/10"></span>
    <NativeSelect.Root class="h-8 w-[min(210px,32vw)] border-white/10 bg-white/5 text-ui-sm text-white" value={activeFlowId} onchange={(event: Event) => startFlow((event.currentTarget as HTMLSelectElement).value)} aria-label={m['design.prototype_flow']()}>
      {#each flows as flow}<NativeSelect.Option value={flow.id}>{flow.name}</NativeSelect.Option>{/each}
    </NativeSelect.Root>
    <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10 hover:text-white" disabled={!history.length && !overlays.length} aria-label={m['design.prototype_back']()} title={m['design.prototype_back']()} onclick={goBack}><ArrowLeft size={14} /></Button>
    <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10 hover:text-white" aria-label={m['design.prototype_restart']()} title={m['design.prototype_restart']()} onclick={() => activeFlow && startFlow(activeFlow.id)}><RefreshCw size={14} /></Button>
    <div class="flex-1"></div>
    <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10 hover:text-white" aria-pressed={hotspotsVisible} aria-label={m['design.prototype_hotspots']()} title={m['design.prototype_hotspots']()} onclick={() => (hotspotsVisible = !hotspotsVisible)}>{#if hotspotsVisible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}</Button>
    <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10 hover:text-white" aria-pressed={fillStage} aria-label={m['design.prototype_fill']()} title={m['design.prototype_fill']()} onclick={() => (fillStage = !fillStage)}><Scaling size={14} /></Button>
    <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10 hover:text-white" aria-label={m['design.prototype_fullscreen']()} title={m['design.prototype_fullscreen']()} onclick={() => void toggleFullscreen()}><Maximize2 size={14} /></Button>
    <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10 hover:text-white" aria-label={m['design.prototype_share']()} title={m['design.prototype_share']()} onclick={() => activeFlowId && void onShare(activeFlowId)}><Share2 size={14} /></Button>
    <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10 hover:text-white" aria-label={m['design.prototype_close']()} title={m['design.prototype_close']()} onclick={onClose}><X size={16} /></Button>
  </header>

  <main class="relative grid min-h-0 place-items-center overflow-hidden p-5" style:background={document.presentation.background}>
    {#if currentFrame}
      <div
        data-prototype-current
        class={`relative overflow-hidden bg-white ${document.presentation.showDeviceFrame ? 'rounded-[18px] shadow-[0_28px_80px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.14)]' : ''}`}
        style:width={`${currentFrame.width * fitScale}px`}
        style:height={`${currentFrame.height * fitScale}px`}
      >
        <div
          bind:this={viewport}
          class={`${currentFrame.prototypeOverflow === 'vertical' ? 'overflow-y-auto overflow-x-hidden' : currentFrame.prototypeOverflow === 'horizontal' ? 'overflow-x-auto overflow-y-hidden' : currentFrame.prototypeOverflow === 'both' ? 'overflow-auto' : 'overflow-hidden'} size-full`}
        >
          <svg
            width={contentBounds.width * fitScale}
            height={contentBounds.height * fitScale}
            viewBox={`${currentFrame.x} ${currentFrame.y} ${contentBounds.width} ${contentBounds.height}`}
            class={document.presentation.showCursor ? '[&_g[data-design-element]]:cursor-pointer' : 'cursor-none'}
            role="button"
            tabindex="0"
            aria-label={currentFrame.name}
            onclick={(event) => eventInteraction(event, 'click')}
            onpointerdown={(event) => eventInteraction(event, 'press')}
            onpointerover={(event) => eventInteraction(event, 'hover')}
            onkeydown={prototypeKeydown}
          >
            <DesignRenderer elements={scrollingElements} assets={document.assets} {workspaceId} />
            {#if hotspotsVisible}
              {#each hotspotElements.filter((element) => !fixedIds.has(element.id)) as element (element.id)}
                <rect x={element.x} y={element.y} width={element.width} height={element.height} rx={Math.max(4, element.cornerRadius)} fill="#8b5cf61a" stroke="#a78bfa" stroke-width="2" stroke-dasharray="6 4" pointer-events="none" vector-effect="non-scaling-stroke" />
              {/each}
            {/if}
          </svg>
        </div>
        {#if fixedElements.length}
          <svg
            class={`absolute inset-0 size-full ${document.presentation.showCursor ? '[&_g[data-design-element]]:cursor-pointer' : 'cursor-none'}`}
            viewBox={`${currentFrame.x} ${currentFrame.y} ${currentFrame.width} ${currentFrame.height}`}
            role="button"
            tabindex="0"
            aria-label={currentFrame.name}
            onclick={(event) => eventInteraction(event, 'click')}
            onpointerdown={(event) => eventInteraction(event, 'press')}
            onpointerover={(event) => eventInteraction(event, 'hover')}
            onkeydown={prototypeKeydown}
          >
            <DesignRenderer elements={fixedElements} assets={document.assets} {workspaceId} />
          </svg>
        {/if}

        {#each overlays as overlay, index (overlay.interaction.id)}
          {@const frame = overlayFrame(overlay)}
          {#if frame && overlay.interaction.action.type === 'open-overlay'}
            <div
              data-prototype-overlay
              class={`absolute inset-0 grid p-4 ${overlayPosition(overlay)}`}
              style:background={`${overlay.interaction.action.backgroundColor}${Math.round(overlay.interaction.action.backgroundOpacity * 255).toString(16).padStart(2, '0')}`}
              role="presentation"
              onclick={(event) => { if (event.target === event.currentTarget && overlay.interaction.action.type === 'open-overlay' && overlay.interaction.action.dismissOnOutside) overlays = overlays.slice(0, index); }}
            >
              <svg
                class="max-h-full max-w-full overflow-hidden rounded-lg shadow-2xl"
                width={Math.min(frame.width * fitScale, currentFrame.width * fitScale - 32)}
                height={Math.min(frame.height * fitScale, currentFrame.height * fitScale - 32)}
                viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
                role="button"
                tabindex="0"
                aria-label={frame.name}
                onclick={(event) => eventInteraction(event, 'click')}
                onpointerdown={(event) => eventInteraction(event, 'press')}
                onpointerover={(event) => eventInteraction(event, 'hover')}
                onkeydown={prototypeKeydown}
              ><DesignRenderer elements={overlayElements(overlay)} assets={document.assets} {workspaceId} /></svg>
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="max-w-sm text-center"><Play size={30} class="mx-auto text-white/30" /><p class="mt-3 text-sm font-medium">{m['design.prototype_empty_title']()}</p><p class="mt-1 text-xs leading-5 text-white/50">{m['design.prototype_empty_body']()}</p></div>
    {/if}
  </main>
</div>
