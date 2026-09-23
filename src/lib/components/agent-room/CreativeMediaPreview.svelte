<script lang="ts">
  import { FileImage, Film, Music2, Maximize2 } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { mediaInputUrl, type CreativeMediaInput } from './creative-media-presentation.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, source }: { workspaceId: string; source: CreativeMediaInput } = $props();
  let open = $state(false), failed = $state(false);
  const url = $derived(source.path ? mediaInputUrl(workspaceId, source.path) : undefined);
  const audio = $derived(source.mimeType?.startsWith('audio/'));
  $effect(() => { url; failed = false; });
</script>

{#if url}
  <div class="flex min-w-0 items-center gap-3" data-testid="creative-media-preview">
    <Button variant="outline" class="relative h-24 w-28 shrink-0 overflow-hidden p-1" title={m['creative.media_preview']()} aria-label={m['creative.media_preview']()} onclick={() => open = true}>
      {#if source.type === 'image' && !failed}<img src={url} alt={source.title} loading="lazy" decoding="async" class="size-full object-contain" onerror={() => failed = true} />
      {:else if audio}<Music2 size={26} />{:else if source.type === 'video'}<Film size={26} />{:else}<FileImage size={26} />{/if}
      <Maximize2 size={13} class="absolute right-1 bottom-1 rounded-sm bg-app-surface text-[var(--app-text)]" />
    </Button>
    <div class="min-w-0 flex-1"><p class="break-words text-xs font-medium">{source.title}</p>{#if failed}<p role="status" class="mt-1 text-xs text-[var(--app-warning)]">{m['creative.media_preview_unavailable']()}</p>{/if}</div>
  </div>
  <Dialog.Root bind:open>
    <Dialog.Content class="flex max-h-[85dvh] w-[min(900px,calc(100vw-32px))] max-w-none flex-col overflow-hidden sm:max-w-none">
      <Dialog.Header><Dialog.Title class="break-words pr-6">{source.title}</Dialog.Title><Dialog.Description class="break-all">{source.path}</Dialog.Description></Dialog.Header>
      <div class="flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {#if source.type === 'image' && !failed}<img src={url} alt={source.title} class="max-h-[65dvh] max-w-full object-contain" onerror={() => failed = true} />
        {:else if audio}<audio src={url} controls preload="none" class="w-full"></audio>
        {:else if source.type === 'video'}<video src={url} controls playsinline preload="metadata" class="max-h-[65dvh] max-w-full"><track kind="captions" /></video>
        {:else}<p role="status" class="py-8 text-sm text-[var(--app-text-muted)]">{m['creative.media_preview_unavailable']()}</p>{/if}
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/if}
