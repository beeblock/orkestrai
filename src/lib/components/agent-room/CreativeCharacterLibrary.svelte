<script lang="ts">
  import { untrack } from 'svelte';
  import { BookUser, Plus, X, GripVertical, RefreshCw, Settings2 } from '@lucide/svelte';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import * as m from '$lib/paraglide/messages.js';
  import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
  import { creativeApi, creativeError } from './creative-media-client.js';
  import { CHARACTER_DRAG_TYPE } from './character-drag.js';
  import CreativeCharacterDialog from './CreativeCharacterDialog.svelte';

  let { workspaceId, busy = false, overlay = false, onPlace, onClose }: { workspaceId: string; busy?: boolean; overlay?: boolean; onPlace: (character: CreativeCharacter) => void; onClose: () => void } = $props();
  let records = $state<Array<CreativeCharacter & { workspaceName: string }>>([]), query = $state(''), loading = $state(true), error = $state(''), editing = $state(false);
  let sequence = 0;
  const filtered = $derived(records.filter(item => `${item.definition.name} ${item.workspaceName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  async function load() {
    const current = ++sequence, workspace = workspaceId;
    loading = true; records = []; error = '';
    try {
      const result = await creativeApi<typeof records>(`/api/agent-room/workspaces/${workspace}/creative-media/characters`, 'POST', { command: 'library' });
      if (current === sequence && workspace === workspaceId) records = result;
    } catch (cause) { if (current === sequence) error = (cause as Error).message; }
    finally { if (current === sequence) loading = false; }
  }
  $effect(() => { const workspace = workspaceId; untrack(() => { if (workspace) void load(); }); });
  function drag(event: DragEvent, character: CreativeCharacter) {
    if (busy || !event.dataTransfer) { event.preventDefault(); return; }
    event.dataTransfer.setData(CHARACTER_DRAG_TYPE, JSON.stringify({ id: character.id, sourceWorkspaceId: character.workspaceId }));
    event.dataTransfer.effectAllowed = 'copy';
  }
</script>

<svelte:window onkeydowncapture={(event) => {
  if (event.key !== 'Escape' || editing || event.defaultPrevented) return;
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return;
  event.preventDefault(); onClose();
}} />

<aside data-testid="character-library" aria-label={m['creative.characters']()} class={`flex min-h-0 flex-col overflow-hidden border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text)] ${overlay ? 'absolute inset-y-3 right-3 z-[46] w-[min(340px,calc(100%-24px))] rounded-lg border shadow-xl' : 'relative w-[min(340px,45%)] shrink-0 border-l'}`}>
  <header class="flex min-h-12 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-3"><BookUser size={16} /><h2 class="min-w-0 flex-1 text-sm font-semibold">{m['creative.characters']()}</h2><Button size="icon-sm" variant="ghost" aria-label={m['creative.character_manage']()} title={m['creative.character_manage']()} onclick={() => editing = true}><Settings2 size={15} /></Button><Button size="icon-sm" variant="ghost" aria-label={m['creative.close']()} title={m['creative.close']()} onclick={onClose}><X size={15} /></Button></header>
  <div class="shrink-0 p-3"><Input aria-label={m['creative.character_search']()} placeholder={m['creative.character_search']()} bind:value={query} /></div>
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
    {#if loading}<p role="status" class="text-xs text-[var(--app-text-muted)]">{m['creative.loading']()}</p>{:else if error}<p role="alert" class="text-xs text-destructive">{creativeError(error)}</p><Button variant="outline" onclick={load}><RefreshCw size={14} />{m['creative.refresh']()}</Button>{:else if !filtered.length}<p class="py-4 text-sm text-[var(--app-text-muted)]">{m['creative.character_empty']()}</p><Button variant="outline" onclick={() => editing = true}><Plus size={14} />{m['creative.character_new']()}</Button>{:else}
      <ul class="space-y-3">{#each filtered as character (character.id)}
        <li draggable={!busy} ondragstart={(event) => drag(event, character)} class="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-surface-raised)]" data-character-id={character.id}>
          <div class="relative aspect-[4/3] cursor-grab bg-[var(--app-canvas)] active:cursor-grabbing"><img class="size-full object-contain" draggable="false" src={`/api/agent-room/workspaces/${character.workspaceId}/fs/raw?path=${encodeURIComponent(character.definition.images[0])}`} alt={character.definition.name} /><GripVertical size={18} class="absolute right-2 top-2 rounded bg-[var(--app-surface)] p-0.5 text-[var(--app-text)]" /></div>
          <div class="space-y-2 p-2.5"><div class="flex items-baseline gap-2"><strong class="min-w-0 flex-1 break-words text-sm">{character.definition.name}</strong><span class="shrink-0 text-xs text-[var(--app-text-muted)]">v{character.version}</span></div><p class="truncate text-xs text-[var(--app-text-muted)]" title={character.workspaceName}>{character.workspaceName}</p><Button class="w-full" size="sm" variant="outline" disabled={busy} onclick={() => onPlace(character)}><Plus size={14} />{m['creative.character_place']()}</Button></div>
        </li>
      {/each}</ul>
    {/if}
  </div>
  {#if busy}<p role="status" class="shrink-0 border-t border-[var(--app-border)] p-3 text-xs">{m['creative.character_importing']()}</p>{/if}
</aside>
<CreativeCharacterDialog bind:open={editing} {workspaceId} onSaved={load} />
