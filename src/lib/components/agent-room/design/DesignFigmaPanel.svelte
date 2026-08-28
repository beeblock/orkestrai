<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from 'svelte-sonner';
  import { Check, ClipboardCopy, ExternalLink, FolderOpen, KeyRound, Link2, LoaderCircle, RefreshCw, Shapes, ShieldCheck, Unlink2 } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type { DesignDocument, DesignFigmaLink } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import type { FigmaInspection } from '$lib/modules/agent-room/domain/design-figma.js';
  import type { FigmaSyncChange } from '$lib/modules/agent-room/application/services/DesignFigmaService.js';
  import * as m from '$lib/paraglide/messages.js';

  type DesktopBridge = {
    automationSecretStatus?: (key: string) => Promise<{ available: boolean; stored: boolean }>;
    saveAutomationSecret?: (key: string, value: string) => Promise<{ stored: boolean }>;
    deleteAutomationSecret?: (key: string) => Promise<{ deleted: boolean }>;
    openFigmaPluginFolder?: () => Promise<string>;
  };
  type Status = {
    secretKey: string;
    stored: boolean;
    connected: boolean;
    account: { handle: string; email: string; imgUrl: string | null } | null;
    error?: string;
    mcp: { url: string; managed: boolean; authentication: string };
  };
  type SyncPreview = { link: DesignFigmaLink; revision: number; changes: FigmaSyncChange[] };

  let { document, onDocumentChange, onSelectElements }: {
    document: DesignDocument;
    onDocumentChange: (document: DesignDocument) => void;
    onSelectElements: (elementIds: string[]) => void;
  } = $props();

  let status = $state<Status | null>(null);
  let loading = $state(true);
  let busy = $state('');
  let credential = $state('');
  let url = $state('');
  let inspection = $state<FigmaInspection | null>(null);
  let selectedNodeIds = $state<string[]>([]);
  let preview = $state<SyncPreview | null>(null);
  let resolutions = $state<Record<string, 'figma' | 'local' | 'delete'>>({});

  const desktop = typeof window === 'undefined'
    ? undefined
    : (window as typeof window & { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
  const secretKey = $derived(`automation:figma:${document.workspaceId}`);
  const pendingChanges = $derived(preview?.changes.filter((change) => change.state !== 'unchanged') ?? []);

  function headers(): HeadersInit {
    const csrf = getCsrfToken();
    return { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) };
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
    const payload = await response.json();
    if (response.status === 409 && payload.data) onDocumentChange(payload.data);
    if (!response.ok) throw new Error(payload.error ?? 'figma_request_failed');
    return payload.data as T;
  }

  async function loadStatus(showError = false) {
    loading = true;
    try {
      status = await api<Status>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/figma`);
      const secure = await desktop?.automationSecretStatus?.(secretKey).catch(() => null);
      if (status && secure) status.stored = secure.stored;
    } catch {
      if (showError) toast.error(m['design.figma_status_error']());
    } finally {
      loading = false;
    }
  }

  async function connect() {
    if (!credential.trim() || !desktop?.saveAutomationSecret) return;
    busy = 'credential';
    try {
      await desktop.saveAutomationSecret(secretKey, credential.trim());
      credential = '';
      await loadStatus();
      if (!status?.connected) throw new Error('invalid');
      toast.success(m['design.figma_connected']());
    } catch {
      toast.error(m['design.figma_connection_error']());
    } finally {
      busy = '';
    }
  }

  async function removeCredential() {
    if (!desktop?.deleteAutomationSecret) return;
    busy = 'credential';
    try {
      await desktop.deleteAutomationSecret(secretKey);
      status = status ? { ...status, stored: false, connected: false, account: null } : status;
      toast.success(m['design.figma_credential_removed']());
    } catch {
      toast.error(m['design.figma_connection_error']());
    } finally {
      busy = '';
    }
  }

  async function inspect() {
    if (!url.trim()) return;
    busy = 'inspect';
    inspection = null;
    try {
      inspection = await api<FigmaInspection>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/figma/inspect`, {
        method: 'POST', body: JSON.stringify({ url: url.trim() }),
      });
      const requested = inspection.requestedNodeId;
      selectedNodeIds = requested && inspection.nodes.some((node) => node.id === requested)
        ? [requested]
        : inspection.nodes.slice(0, 1).map((node) => node.id);
    } catch {
      toast.error(m['design.figma_inspect_error']());
    } finally {
      busy = '';
    }
  }

  function toggleNode(nodeId: string, checked: boolean) {
    selectedNodeIds = checked
      ? [...new Set([...selectedNodeIds, nodeId])]
      : selectedNodeIds.filter((id) => id !== nodeId);
  }

  async function importSelection() {
    if (!inspection || !selectedNodeIds.length) return;
    busy = 'import';
    try {
      const result = await api<{ document: DesignDocument; warnings: string[]; counts: Record<string, number> }>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/figma/import`, {
        method: 'POST',
        body: JSON.stringify({ url, sourceNodeIds: selectedNodeIds, baseRevision: document.revision, targetPageId: document.activePageId }),
      });
      onDocumentChange(result.document);
      inspection = null;
      selectedNodeIds = [];
      url = '';
      toast.success(m['design.figma_imported']({ count: String(result.counts.elements ?? 0) }));
      if (result.warnings.length) toast.warning(m['design.figma_import_warnings']({ count: String(result.warnings.length) }));
    } catch {
      toast.error(m['design.figma_import_error']());
    } finally {
      busy = '';
    }
  }

  async function inspectChanges(link: DesignFigmaLink) {
    busy = link.id;
    try {
      preview = await api<SyncPreview>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/figma/sync`, {
        method: 'POST', body: JSON.stringify({ linkId: link.id }),
      });
      resolutions = Object.fromEntries(preview.changes.map((change) => [change.nodeId, change.defaultResolution]));
    } catch {
      toast.error(m['design.figma_sync_preview_error']());
    } finally {
      busy = '';
    }
  }

  async function applySync() {
    if (!preview) return;
    const linkId = preview.link.id;
    busy = 'sync';
    try {
      const changes = pendingChanges.map((change) => ({ nodeId: change.nodeId, resolution: resolutions[change.nodeId] ?? change.defaultResolution }));
      const result = await api<{ document: DesignDocument; applied: number }>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/figma/sync`, {
        method: 'PATCH', body: JSON.stringify({ linkId: preview.link.id, baseRevision: document.revision, changes }),
      });
      onDocumentChange(result.document);
      preview = null;
      toast.success(m['design.figma_synced']({ count: String(result.applied) }));
      const linked = result.document.figmaLinks.find((candidate) => candidate.id === linkId);
      if (linked?.pendingPushNodeIds.length) toast.info(m['design.figma_pending_push_help']());
    } catch {
      toast.error(m['design.figma_sync_error']());
    } finally {
      busy = '';
    }
  }

  async function disconnect(link: DesignFigmaLink) {
    busy = link.id;
    try {
      const next = await api<DesignDocument>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/figma`, {
        method: 'DELETE', body: JSON.stringify({ linkId: link.id, baseRevision: document.revision }),
      });
      onDocumentChange(next);
      if (preview?.link.id === link.id) preview = null;
      toast.success(m['design.figma_disconnected']());
    } catch {
      toast.error(m['design.figma_disconnect_error']());
    } finally {
      busy = '';
    }
  }

  async function copyPluginConnection() {
    busy = 'plugin';
    try {
      const connection = await api<Record<string, string>>(`/api/agent-room/workspaces/${document.workspaceId}/designs/${document.nodeId}/figma/plugin`);
      await navigator.clipboard.writeText(JSON.stringify(connection, null, 2));
      toast.success(m['design.figma_plugin_connection_copied']());
    } catch {
      toast.error(m['design.figma_plugin_connection_error']());
    } finally {
      busy = '';
    }
  }

  async function openPluginFolder() {
    try {
      const error = await desktop?.openFigmaPluginFolder?.();
      if (error) throw new Error(error);
    } catch {
      toast.error(m['design.figma_plugin_open_error']());
    }
  }

  function reveal(link: DesignFigmaLink) {
    const ids = Object.values(link.mappings).filter((id) => document.elements.some((element) => element.id === id));
    if (ids.length) onSelectElements(ids);
  }

  function stateLabel(state: FigmaSyncChange['state']): string {
    if (state === 'added') return m['design.figma_state_added']();
    if (state === 'changed') return m['design.figma_state_changed']();
    if (state === 'local') return m['design.figma_state_local']();
    if (state === 'conflict') return m['design.figma_state_conflict']();
    if (state === 'removed') return m['design.figma_state_removed']();
    return m['design.figma_state_unchanged']();
  }

  onMount(() => void loadStatus());
</script>

<div class="flex h-full min-h-0 flex-col text-[11px]">
  <div class="space-y-2 border-b border-[var(--app-border)] p-2">
    <div class="flex flex-wrap items-center justify-between gap-1.5">
      <div class="flex min-w-0 items-center gap-2"><Shapes size={14} class="shrink-0 text-[var(--app-accent)]" /><span class="font-semibold text-[var(--app-text)]">{m['design.figma_official']()}</span></div>
      <Badge variant={status?.connected ? 'default' : 'outline'}>{status?.connected ? m['design.connected']() : m['design.disconnected']()}</Badge>
    </div>
    <div class="flex items-start gap-2 border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-2 text-[9px] leading-4 text-[var(--app-text-muted)]">
      <ShieldCheck size={13} class="mt-0.5 shrink-0 text-[var(--app-success)]" />
      <span>{m['design.figma_mcp_managed']()}</span>
      <a class="ml-auto shrink-0 text-[var(--app-accent)] hover:underline" href="https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Dev-Mode-MCP-Server" target="_blank" rel="noreferrer" aria-label={m['design.learn_more']()}><ExternalLink size={11} /></a>
    </div>
    {#if loading}<div class="grid h-12 place-items-center"><LoaderCircle size={15} class="animate-spin text-[var(--app-accent)]" /></div>
    {:else if status?.connected}
      <div class="flex items-center gap-2 border border-[var(--app-border)] p-2"><span class="grid size-6 shrink-0 place-items-center bg-[var(--app-success-soft)] text-[var(--app-success)]"><Check size={12} /></span><div class="min-w-0 flex-1"><p class="truncate font-medium text-[var(--app-text)]">{status.account?.handle}</p><p class="truncate text-[9px] text-[var(--app-text-muted)]">{status.account?.email}</p></div><Button variant="ghost" size="icon-sm" class="size-6" title={m['design.figma_remove_credential']()} aria-label={m['design.figma_remove_credential']()} onclick={() => void removeCredential()}><KeyRound size={11} /></Button></div>
    {:else}
      <p class="text-[9px] leading-4 text-[var(--app-text-muted)]">{desktop?.saveAutomationSecret ? m['design.figma_token_help']() : m['design.figma_desktop_required']()} {#if desktop?.saveAutomationSecret}<a class="text-[var(--app-accent)] hover:underline" href="https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens" target="_blank" rel="noreferrer">{m['design.figma_create_token']()}</a>{/if}</p>
      <div class="flex gap-1.5"><Input type="password" autocomplete="off" bind:value={credential} disabled={!desktop?.saveAutomationSecret} placeholder={m['design.figma_token_placeholder']()} /><Button size="sm" disabled={!credential.trim() || busy === 'credential' || !desktop?.saveAutomationSecret} onclick={() => void connect()}>{#if busy === 'credential'}<LoaderCircle size={12} class="animate-spin" />{:else}<Link2 size={12} />{/if}{m['design.connect']()}</Button></div>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if status?.connected}
      <section class="space-y-2 border-b border-[var(--app-border)] p-2">
        <div class="text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">{m['design.figma_import']()}</div>
        <div class="flex gap-1.5"><Input bind:value={url} placeholder={m['design.figma_url_placeholder']()} onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && void inspect()} /><Button variant="secondary" size="sm" disabled={!url.trim() || busy === 'inspect'} onclick={() => void inspect()}>{#if busy === 'inspect'}<LoaderCircle size={12} class="animate-spin" />{:else}<RefreshCw size={12} />{/if}{m['design.figma_inspect']()}</Button></div>
        {#if inspection}
          <div class="border border-[var(--app-border)]">
            <div class="border-b border-[var(--app-border)] px-2 py-1.5"><p class="truncate font-medium text-[var(--app-text)]">{inspection.fileName}</p><p class="text-[8px] text-[var(--app-text-muted)]">{m['design.figma_file_summary']({ components: String(inspection.components), styles: String(inspection.styles) })}</p></div>
            <div class="max-h-40 overflow-y-auto p-1">
              {#each inspection.nodes as node (node.id)}<label class="flex min-h-8 items-center gap-2 px-1.5 py-1 hover:bg-[var(--app-surface-raised)]"><Checkbox checked={selectedNodeIds.includes(node.id)} onCheckedChange={(checked: boolean | 'indeterminate') => toggleNode(node.id, checked === true)} /><div class="min-w-0 flex-1"><p class="truncate text-[10px] text-[var(--app-text)]">{node.name}</p><p class="truncate text-[8px] text-[var(--app-text-muted)]">{node.type}{node.pageName ? ` · ${node.pageName}` : ''}{node.width && node.height ? ` · ${Math.round(node.width)} x ${Math.round(node.height)}` : ''}</p></div></label>{/each}
            </div>
          </div>
          <Button class="w-full" size="sm" disabled={!selectedNodeIds.length || busy === 'import'} onclick={() => void importSelection()}>{#if busy === 'import'}<LoaderCircle size={12} class="animate-spin" />{:else}<Shapes size={12} />{/if}{m['design.figma_import_selected']({ count: String(selectedNodeIds.length) })}</Button>
        {/if}
      </section>
    {/if}

    <section class="space-y-2 border-b border-[var(--app-border)] p-2">
      <div><p class="text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">{m['design.figma_plugin_bridge']()}</p><p class="mt-1 text-[9px] leading-4 text-[var(--app-text-muted)]">{m['design.figma_plugin_help']()}</p></div>
      <div class="grid gap-1.5"><Button variant="outline" size="sm" disabled={!desktop?.openFigmaPluginFolder} onclick={() => void openPluginFolder()}><FolderOpen size={12} />{m['design.figma_plugin_folder']()}</Button><Button variant="secondary" size="sm" disabled={busy === 'plugin'} onclick={() => void copyPluginConnection()}>{#if busy === 'plugin'}<LoaderCircle size={12} class="animate-spin" />{:else}<ClipboardCopy size={12} />{/if}{m['design.figma_plugin_copy_connection']()}</Button></div>
    </section>

    <section class="space-y-2 p-2">
      <div class="text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">{m['design.figma_links']()}</div>
      {#if !document.figmaLinks.length}<div class="border border-dashed border-[var(--app-border)] p-3 text-[10px] leading-4 text-[var(--app-text-muted)]"><Shapes size={17} class="mb-2 text-[var(--app-accent)]" />{m['design.figma_links_empty']()}</div>{/if}
      {#each document.figmaLinks as link (link.id)}
        <div class="border border-[var(--app-border)] p-2">
          <div class="flex items-start gap-2"><Shapes size={12} class="mt-0.5 shrink-0 text-[var(--app-accent)]" /><button class="min-w-0 flex-1 text-left" onclick={() => reveal(link)}><span class="block truncate font-medium text-[var(--app-text)]">{link.fileName}</span><span class="block truncate text-[8px] text-[var(--app-text-muted)]">{m['design.figma_link_nodes']({ count: String(link.sourceNodeIds.length) })} · {new Date(link.syncedAt).toLocaleDateString()}</span></button>{#if link.pendingPushNodeIds.length}<Badge variant="outline" title={m['design.figma_pending_push_help']()}>{m['design.figma_pending_push']({ count: String(link.pendingPushNodeIds.length) })}</Badge>{/if}<a class="grid size-6 shrink-0 place-items-center text-[var(--app-text-muted)] hover:text-[var(--app-text)]" href={link.url} target="_blank" rel="noreferrer" title={m['design.figma_open']()} aria-label={m['design.figma_open']()}><ExternalLink size={11} /></a><Button variant="ghost" size="icon-sm" class="size-6" disabled={busy === link.id} title={m['design.figma_disconnect']()} aria-label={m['design.figma_disconnect']()} onclick={() => void disconnect(link)}><Unlink2 size={11} /></Button></div>
          <Button class="mt-2 w-full" variant="secondary" size="sm" disabled={Boolean(busy)} onclick={() => void inspectChanges(link)}>{#if busy === link.id}<LoaderCircle size={12} class="animate-spin" />{:else}<RefreshCw size={12} />{/if}{m['design.figma_check_changes']()}</Button>
        </div>
      {/each}
    </section>

    {#if preview}
      <section class="border-t border-[var(--app-border)] p-2">
        <div class="mb-2 flex items-center justify-between"><div><p class="font-semibold text-[var(--app-text)]">{m['design.figma_sync_review']()}</p><p class="text-[8px] text-[var(--app-text-muted)]">{preview.link.fileName}</p></div><Badge variant={pendingChanges.some((change) => change.state === 'conflict') ? 'destructive' : 'outline'}>{m['design.figma_changes_count']({ count: String(pendingChanges.length) })}</Badge></div>
        <div class="max-h-64 space-y-1 overflow-y-auto">
          {#if !pendingChanges.length}<p class="border border-dashed border-[var(--app-border)] p-3 text-center text-[10px] text-[var(--app-text-muted)]">{m['design.figma_up_to_date']()}</p>{/if}
          {#each pendingChanges as change (change.nodeId)}<div class="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-2 border border-[var(--app-border)] p-1.5"><div class="min-w-0"><p class="truncate text-[10px] text-[var(--app-text)]">{change.name}</p><p class={`text-[8px] ${change.state === 'conflict' ? 'text-[var(--app-danger)]' : 'text-[var(--app-text-muted)]'}`}>{stateLabel(change.state)}</p></div><NativeSelect.Root value={resolutions[change.nodeId] ?? change.defaultResolution} onchange={(event: Event) => (resolutions[change.nodeId] = (event.currentTarget as HTMLSelectElement).value as 'figma' | 'local' | 'delete')}><NativeSelect.Option value="figma">{m['design.figma_use_figma']()}</NativeSelect.Option><NativeSelect.Option value="local">{m['design.figma_keep_local']()}</NativeSelect.Option><NativeSelect.Option value="delete">{m['design.delete']()}</NativeSelect.Option></NativeSelect.Root></div>{/each}
        </div>
        <div class="mt-2 grid grid-cols-2 gap-1.5"><Button variant="outline" size="sm" onclick={() => (preview = null)}>{m['settings.cancel']()}</Button><Button size="sm" disabled={!pendingChanges.length || busy === 'sync'} onclick={() => void applySync()}>{#if busy === 'sync'}<LoaderCircle size={12} class="animate-spin" />{:else}<Check size={12} />{/if}{m['design.figma_apply_sync']()}</Button></div>
      </section>
    {/if}
  </div>
</div>
