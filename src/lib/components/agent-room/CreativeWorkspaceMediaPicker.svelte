<script lang="ts">
  import { ArrowLeft, Folder, FolderOpen, FileImage, Film, Music2 } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { creativeApi } from './creative-media-client.js';
  import { mediaFileKind, mediaSlotKind } from './creative-media-presentation.js';
  import type { FsEntry } from '$lib/modules/agent-room/application/services/FilesystemService.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, pointer, onSelect }: { workspaceId: string; pointer: string; onSelect: (path: string) => void } = $props();
  let open = $state(false), directory = $state(''), query = $state(''), loading = $state(false), failed = $state(false);
  let entries = $state<FsEntry[]>([]);
  let limit = $state(200);
  let sequence = 0;
  const filtered = $derived(entries.filter(entry => (entry.type === 'directory' || mediaFileKind(entry.name) === mediaSlotKind(pointer) || (mediaSlotKind(pointer) === 'file' && mediaFileKind(entry.name) !== 'file')) && entry.name.toLowerCase().includes(query.toLowerCase())));
  const visible = $derived(filtered.slice(0, limit));
  $effect(() => { query; directory; limit = 200; });
  function changeOpen(next: boolean) {
    if (next === open) return;
    open = next;
    // A polling refresh can replace parent props while the picker is open.
    // Load the root only on an explicit open, not in a reactive effect.
    if (next) void load('');
    else sequence++;
  }

  async function load(path: string) {
    const stamp = ++sequence;
    loading = true; failed = false; query = ''; entries = []; directory = path;
    try {
      const result = await creativeApi<FsEntry[]>(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/fs/list?path=${encodeURIComponent(path)}`);
      if (stamp !== sequence) return;
      entries = result.filter(entry => typeof entry.name === 'string' && entry.name.length <= 255 && !/[\\/\u0000]/.test(entry.name) && !['.', '..'].includes(entry.name));
    } catch { if (stamp === sequence) failed = true; }
    finally { if (stamp === sequence) loading = false; }
  }
  function choose(entry: FsEntry) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.type === 'directory') void load(path);
    else { onSelect(path); changeOpen(false); }
  }
</script>

<Popover.Root {open} onOpenChange={changeOpen}>
  <Popover.Trigger>
    {#snippet child({ props })}<Button {...props} variant="outline" size="sm" class="max-w-full"><FolderOpen size={14} />{m['creative.media_browse']()}</Button>{/snippet}
  </Popover.Trigger>
  <Popover.Content align="start" collisionPadding={12} class="min-h-0 w-[min(360px,calc(100vw-24px))] max-h-(--bits-popover-content-available-height) gap-0 overflow-hidden p-0!">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-2">
      <Button variant="ghost" size="icon-sm" disabled={!directory || loading} aria-label={m['creative.media_parent']()} title={m['creative.media_parent']()} onclick={() => void load(directory.split('/').slice(0, -1).join('/'))}><ArrowLeft size={14} /></Button>
      <span class="min-w-0 truncate text-xs" title={directory}>{directory || m['creative.media_project']()}</span>
    </div>
    <Command.Root shouldFilter={false} class="h-auto min-h-0 flex-1">
      <Command.Input bind:value={query} placeholder={m['creative.search_media']()} />
      <Command.List class="min-h-0 max-h-64 flex-1">
        {#if loading}<p role="status" class="p-3 text-xs">{m['creative.loading']()}</p>
        {:else if failed}<p role="alert" class="p-3 text-xs text-destructive">{m['workbench_files.error']()}</p>
        {:else}
          <Command.Empty>{m['creative.no_inputs']()}</Command.Empty>
          <Command.Group value="project-media">
            {#each visible as entry (entry.name)}<Command.Item value={entry.name} onSelect={() => choose(entry)}>
              {#if entry.type === 'directory'}<Folder size={15} />{:else if mediaFileKind(entry.name) === 'audio'}<Music2 size={15} />{:else if mediaFileKind(entry.name) === 'video'}<Film size={15} />{:else}<FileImage size={15} />{/if}
              <span class="min-w-0 truncate">{entry.name}</span>
            </Command.Item>{/each}
          </Command.Group>
        {/if}
      </Command.List>
      {#if visible.length < filtered.length}<Button class="shrink-0" size="sm" variant="ghost" onclick={() => limit += 200}>{m['creative.more_models']({ count: filtered.length - visible.length })}</Button>{/if}
    </Command.Root>
  </Popover.Content>
</Popover.Root>
