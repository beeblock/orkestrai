<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from 'svelte-sonner';
  import { BookOpen, Download, LoaderCircle, RefreshCw, Share2, Trash2, Unlink2 } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import type { DesignDocument, DesignOperation } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import type { DesignLibrarySummary } from '$lib/modules/agent-room/application/services/DesignLibraryService.js';
  import * as m from '$lib/paraglide/messages.js';

  type WorkspaceSummary = { id: string; name: string };

  let {
    document,
    onApply,
    onDocumentChange,
  }: {
    document: DesignDocument;
    onApply: (operations: DesignOperation[], summary: string, inverse: DesignOperation[]) => Promise<boolean>;
    onDocumentChange: (document: DesignDocument) => void;
  } = $props();

  let libraries = $state<DesignLibrarySummary[]>([]);
  let workspaces = $state<WorkspaceSummary[]>([]);
  let loading = $state(true);
  let busyId = $state('');
  let libraryName = $state('');
  let allowedWorkspaceIds = $state<string[]>([]);
  let initializedDocumentId = $state('');

  const ownLibrary = $derived(libraries.find((library) => library.sourceWorkspaceId === document.workspaceId && library.sourceNodeId === document.nodeId) ?? null);

  $effect(() => {
    if (initializedDocumentId === document.id) return;
    initializedDocumentId = document.id;
    libraryName = document.name;
    allowedWorkspaceIds = [];
  });

  function csrfHeaders(): HeadersInit {
    const token = getCsrfToken();
    return { 'content-type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
  }

  async function load() {
    loading = true;
    try {
      const [libraryResponse, workspaceResponse] = await Promise.all([
        fetch(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/libraries`),
        fetch('/api/agent-room/workspaces'),
      ]);
      const libraryPayload = await libraryResponse.json();
      const workspacePayload = await workspaceResponse.json();
      if (!libraryResponse.ok) throw new Error(libraryPayload.error ?? 'libraries');
      libraries = libraryPayload.data ?? [];
      workspaces = (workspacePayload.data ?? []).map((workspace: WorkspaceSummary) => ({ id: workspace.id, name: workspace.name }));
      const source = libraries.find((library) => library.sourceWorkspaceId === document.workspaceId && library.sourceNodeId === document.nodeId);
      if (source) {
        libraryName = source.name;
        allowedWorkspaceIds = [...source.allowedWorkspaceIds];
      }
    } catch {
      toast.error(m['design.library_load_error']());
    } finally {
      loading = false;
    }
  }

  async function publish() {
    if (!libraryName.trim()) return;
    busyId = 'publish';
    try {
      const response = await fetch(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/libraries`, {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ libraryId: ownLibrary?.id ?? null, name: libraryName.trim(), description: '', allowedWorkspaceIds }),
      });
      if (!response.ok) throw new Error('publish');
      toast.success(ownLibrary ? m['design.library_updated']() : m['design.library_published']());
      await load();
    } catch {
      toast.error(m['design.library_publish_error']());
    } finally {
      busyId = '';
    }
  }

  async function importLibrary(library: DesignLibrarySummary) {
    busyId = library.id;
    try {
      const response = await fetch(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/libraries/${library.id}`, {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ baseRevision: document.revision }),
      });
      const payload = await response.json();
      if (response.status === 409 && payload.data) {
        onDocumentChange(payload.data);
        throw new Error('conflict');
      }
      if (!response.ok || !payload.data?.document) throw new Error('import');
      onDocumentChange(payload.data.document);
      toast.success(payload.data.synced ? m['design.library_synced']() : m['design.library_imported']());
      await load();
    } catch {
      toast.error(m['design.library_import_error']());
    } finally {
      busyId = '';
    }
  }

  async function removeLibrary(library: DesignLibrarySummary) {
    busyId = library.id;
    try {
      const response = await fetch(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/libraries/${library.id}`, {
        method: 'DELETE',
        headers: csrfHeaders(),
      });
      if (!response.ok) throw new Error('remove');
      toast.success(m['design.library_removed']());
      await load();
    } catch {
      toast.error(m['design.library_remove_error']());
    } finally {
      busyId = '';
    }
  }

  function toggleWorkspace(workspaceId: string, checked: boolean) {
    allowedWorkspaceIds = checked ? [...new Set([...allowedWorkspaceIds, workspaceId])] : allowedWorkspaceIds.filter((id) => id !== workspaceId);
  }

  async function detachLibrary(library: DesignLibrarySummary) {
    const link = document.libraryLinks.find((candidate) => candidate.id === library.id);
    if (!link) return;
    const operations: DesignOperation[] = [];
    const inverse: DesignOperation[] = [{ kind: 'add-library-link', link }];
    for (const collection of document.variableCollections.filter((candidate) => candidate.libraryId === library.id)) {
      operations.push({ kind: 'update-variable-collection', collectionId: collection.id, changes: { libraryId: null, librarySourceId: null } });
      inverse.push({ kind: 'update-variable-collection', collectionId: collection.id, changes: { libraryId: library.id, librarySourceId: collection.librarySourceId } });
    }
    for (const variable of document.variables.filter((candidate) => candidate.libraryId === library.id)) {
      operations.push({ kind: 'update-variable', variableId: variable.id, changes: { libraryId: null, librarySourceId: null } });
      inverse.push({ kind: 'update-variable', variableId: variable.id, changes: { libraryId: library.id, librarySourceId: variable.librarySourceId } });
    }
    for (const set of document.componentSets.filter((candidate) => candidate.libraryId === library.id)) {
      operations.push({ kind: 'update-component-set', componentSetId: set.id, changes: { libraryId: null, librarySourceId: null } });
      inverse.push({ kind: 'update-component-set', componentSetId: set.id, changes: { libraryId: library.id, librarySourceId: set.librarySourceId } });
    }
    for (const component of document.components.filter((candidate) => candidate.libraryId === library.id)) {
      operations.push({ kind: 'update-component', componentId: component.id, changes: { libraryId: null, librarySourceId: null, updatedAt: new Date().toISOString() } });
      inverse.push({ kind: 'update-component', componentId: component.id, changes: { libraryId: library.id, librarySourceId: component.librarySourceId, updatedAt: component.updatedAt } });
    }
    operations.push({ kind: 'delete-library-link', libraryId: library.id });
    await onApply(operations, m['design.operation_detach_library']({ name: library.name }), inverse);
  }

  onMount(() => void load());
</script>

<div class="flex h-full min-h-0 flex-col text-ui-sm">
  <div class="space-y-2 border-b border-[var(--app-border)] p-2">
    <div class="flex items-center justify-between"><span class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['design.publish_library']()}</span><Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.refresh_libraries']()} onclick={() => void load()}><RefreshCw size={12} class={loading ? 'animate-spin' : ''} /></Button></div>
    <Input bind:value={libraryName} aria-label={m['design.library_name']()} placeholder={m['design.library_name']()} />
    {#if workspaces.length > 1}
      <div class="max-h-24 space-y-1 overflow-y-auto border border-[var(--app-border)] p-1.5">
        {#each workspaces.filter((workspace) => workspace.id !== document.workspaceId) as workspace (workspace.id)}
          <label class="flex h-6 items-center gap-2 px-1 text-ui-xs"><Checkbox checked={allowedWorkspaceIds.includes(workspace.id)} onCheckedChange={(checked: boolean | 'indeterminate') => toggleWorkspace(workspace.id, checked === true)} /><span class="truncate">{workspace.name}</span></label>
        {/each}
      </div>
    {/if}
    <Button class="w-full" variant="secondary" size="sm" disabled={busyId === 'publish' || (!document.components.length && !document.variables.length)} onclick={() => void publish()}>{#if busyId === 'publish'}<LoaderCircle size={13} class="animate-spin" />{:else}<Share2 size={13} />{/if}{ownLibrary ? m['design.update_library']() : m['design.publish_library']()}</Button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-2">
    <div class="mb-2 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['design.available_libraries']()}</div>
    {#if loading}<div class="grid h-24 place-items-center"><LoaderCircle size={16} class="animate-spin text-[var(--app-accent)]" /></div>
    {:else if !libraries.length}<div class="border border-dashed border-[var(--app-border)] p-3 text-ui-xs leading-4 text-[var(--app-text-muted)]"><BookOpen size={17} class="mb-2 text-[var(--app-accent)]" />{m['design.libraries_empty']()}</div>
    {:else}<div class="space-y-1.5">
      {#each libraries as library (library.id)}
        {@const link = document.libraryLinks.find((candidate) => candidate.id === library.id)}
        <div class="border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-2">
          <div class="flex items-start gap-2"><BookOpen size={13} class="mt-0.5 shrink-0 text-[var(--app-accent)]" /><div class="min-w-0 flex-1"><p class="truncate font-medium text-[var(--app-text)]">{library.name}</p><p class="truncate text-ui-xs text-[var(--app-text-muted)]">{library.sourceWorkspaceName} · {library.components} {m['design.components']()} · {library.variables} {m['design.tokens']()}</p></div>{#if link}<Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.detach_library']()} title={m['design.detach_library']()} onclick={() => void detachLibrary(library)}><Unlink2 size={11} /></Button>{/if}{#if library.sourceWorkspaceId === document.workspaceId && library.sourceNodeId === document.nodeId}<Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.remove_library']()} onclick={() => void removeLibrary(library)}><Trash2 size={11} /></Button>{/if}</div>
          {#if library.sourceNodeId !== document.nodeId}<Button class="mt-2 w-full" variant={link ? 'outline' : 'secondary'} size="sm" disabled={busyId === library.id || Boolean(link && link.sourceRevision >= library.sourceRevision)} onclick={() => void importLibrary(library)}>{#if busyId === library.id}<LoaderCircle size={12} class="animate-spin" />{:else if link}<RefreshCw size={12} />{:else}<Download size={12} />{/if}{link ? (link.sourceRevision >= library.sourceRevision ? m['design.library_current']() : m['design.sync_library']()) : m['design.import_library']()}</Button>{/if}
        </div>
      {/each}
    </div>{/if}
  </div>
</div>
