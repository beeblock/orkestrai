<script lang="ts">
  import HeaderIconButton from './HeaderIconButton.svelte';

  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { z } from 'zod';
  import MarkdownView from '../MarkdownView.svelte';
  import * as Form from '$lib/components/ui/form';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import { BookOpen, Check, FolderOpen, Pencil, Plus, ScanSearch, Search, Trash2, X } from '@lucide/svelte';
  import type { Workspace } from '$lib/modules/agent-room/domain/types.js';
  import type { AgentRole } from '$lib/modules/agent-room/application/services/RoleService.js';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';

  type BuiltinRole = {
    id: string;
    name: string;
    description: string;
    category: 'leadership' | 'engineering' | 'quality' | 'operations';
    color: string;
    prompt: string;
  };

  type Props = {
    workspace: Workspace;
    onClose: () => void;
    api: <T>(path: string, init?: RequestInit) => Promise<T>;
  };

  let { workspace, onClose, api }: Props = $props();

  let roles = $state<AgentRole[]>([]);
  let errorMessage = $state('');
  let infoMessage = $state('');
  let catalog = $state<BuiltinRole[]>([]);
  let activeTab = $state<'workspace' | 'catalog'>('workspace');
  let catalogQuery = $state('');
  let catalogCategory = $state<'all' | BuiltinRole['category']>('all');
  let installingRoleId = $state<string | null>(null);
  /** Slug da role em edicao (null = criando nova). */
  let editingSlug = $state<string | null>(null);

  const filteredCatalog = $derived(catalog.filter((role) => {
    const needle = catalogQuery.trim().toLocaleLowerCase(localeState.current);
    return (catalogCategory === 'all' || role.category === catalogCategory)
      && (!needle || `${role.name} ${role.description}`.toLocaleLowerCase(localeState.current).includes(needle));
  }));

  function categoryLabel(category: 'all' | BuiltinRole['category']): string {
    if (category === 'leadership') return m['roles.category_leadership']();
    if (category === 'engineering') return m['roles.category_engineering']();
    if (category === 'quality') return m['roles.category_quality']();
    if (category === 'operations') return m['roles.category_operations']();
    return m['roles.category_all']();
  }

  const roleFormSchema = z.object({
    name: z.string().trim().min(1, m['roles.error_name_required']()),
    color: z.string().trim().default('#7C4DFF'),
    prompt: z.string().trim().min(1, m['roles.error_prompt_required']()),
  });
  // Cast por causa do zod aninhado do superforms (4.x) vs zod 3.25 do app.
  const schema = roleFormSchema as unknown as Parameters<typeof zod>[0];

  const form = superForm(defaults({ name: '', color: '#7C4DFF', prompt: '' }, zod(schema)), {
    SPA: true,
    validators: zod(schema),
    async onUpdate({ form: f }) {
      if (!f.valid) return;
      errorMessage = '';
      try {
        // Renomear muda o slug: remove a antiga antes de salvar a nova.
        if (editingSlug) {
          const currentSlug = f.data.name.trim().toLowerCase().replace(/\s+/g, '-');
          if (currentSlug !== editingSlug) {
            await api(`/api/agent-room/workspaces/${workspace.id}/roles/${editingSlug}`, { method: 'DELETE' }).catch(() => {});
          }
        }
        await api(`/api/agent-room/workspaces/${workspace.id}/roles`, {
          method: 'POST',
          body: JSON.stringify(f.data),
        });
        $formData.name = '';
        $formData.prompt = '';
        editingSlug = null;
        await refresh();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : m['roles.error_save']();
      }
    },
  });

  const { form: formData, enhance } = form;

  // Editor markdown: aba Escrever (textarea) x Preview (renderizado).
  let promptTab = $state<'edit' | 'preview'>('edit');

  function startEdit(role: AgentRole) {
    editingSlug = role.slug;
    $formData.name = role.name;
    $formData.color = role.color;
    $formData.prompt = role.prompt;
  }

  function cancelEdit() {
    editingSlug = null;
    $formData.name = '';
    $formData.color = '#7C4DFF';
    $formData.prompt = '';
  }

  async function refresh() {
    roles = await api<AgentRole[]>(`/api/agent-room/workspaces/${workspace.id}/roles`);
  }

  async function refreshCatalog() {
    catalog = await api<BuiltinRole[]>(`/api/agent-room/workspaces/${workspace.id}/roles/catalog?locale=${encodeURIComponent(localeState.current)}`);
  }

  async function installRole(role: BuiltinRole) {
    installingRoleId = role.id;
    errorMessage = '';
    try {
      await api(`/api/agent-room/workspaces/${workspace.id}/roles/catalog/${role.id}`, {
        method: 'POST',
        body: JSON.stringify({ locale: localeState.current }),
      });
      infoMessage = m['roles.catalog_installed']({ name: role.name });
      await refresh();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['roles.catalog_error']();
    } finally {
      installingRoleId = null;
    }
  }

  async function discover(fromDir?: string) {
    errorMessage = '';
    infoMessage = '';
    try {
      const result = await api<{ imported: number; roles: AgentRole[] }>(
        `/api/agent-room/workspaces/${workspace.id}/roles/discover`,
        { method: 'POST', body: JSON.stringify({ fromDir }) }
      );
      infoMessage = result.imported
        ? m['roles.imported']({ count: result.imported })
        : fromDir ? m['roles.none_found_in_folder']() : m['roles.none_found']();
      await refresh();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['roles.error_discover']();
    }
  }

  const desktop = typeof window !== 'undefined'
    ? (window as unknown as { orkestraiDesktop?: { pickDirectory: () => Promise<string | null> } }).orkestraiDesktop
    : undefined;

  async function discoverFromFolder() {
    if (!desktop) return;
    const dir = await desktop.pickDirectory();
    if (dir) await discover(dir);
  }

  async function remove(role: AgentRole) {
    await api(`/api/agent-room/workspaces/${workspace.id}/roles/${role.slug}`, { method: 'DELETE' });
    await refresh();
  }

  $effect(() => {
    localeState.current;
    void Promise.all([refresh(), refreshCatalog()]);
  });
</script>

<aside class="side-panel">
  <header class="panel-header">
    <h3>{m['roles.title']()}</h3>
    <div class="panel-header-actions">
      <HeaderIconButton label={m['roles.discover']()} class="node-action-btn" side="left" onclick={() => discover()}><ScanSearch size={14} /></HeaderIconButton>
      {#if desktop}
        <HeaderIconButton label={m['roles.discover_from_folder']()} class="node-action-btn" side="left" onclick={discoverFromFolder}><FolderOpen size={14} /></HeaderIconButton>
      {/if}
      <HeaderIconButton label={m['roles.close']()} class="node-action-btn" side="left" onclick={onClose}><X size={14} /></HeaderIconButton>
    </div>
  </header>

  <p class="hint">
    {m['roles.hint_1']()}
    <code>.orkestrai/roles/</code> {m['roles.hint_2']()}
    <strong>markdown</strong> {m['roles.hint_3']()}
  </p>

  <Tabs.Root bind:value={activeTab} class="w-full">
    <Tabs.List class="grid w-full grid-cols-2 bg-[var(--app-surface-raised)]">
      <Tabs.Trigger value="workspace">{m['roles.tab_workspace']()}</Tabs.Trigger>
      <Tabs.Trigger value="catalog"><BookOpen size={13} />{m['roles.tab_catalog']()}</Tabs.Trigger>
    </Tabs.List>
  </Tabs.Root>

  {#if activeTab === 'catalog'}
    <div class="grid gap-2" data-tour="role-catalog">
      <label class="relative">
        <Search class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]" size={14} />
        <Input bind:value={catalogQuery} aria-label={m['roles.catalog_search_aria']()} placeholder={m['roles.catalog_search']()} class="border-[var(--app-border)] bg-[var(--app-surface-subtle)] pl-9 text-[var(--app-text)] placeholder:text-[var(--app-text-muted)]" />
      </label>
      <Select.Root type="single" value={catalogCategory} onValueChange={(value: string) => (catalogCategory = value as typeof catalogCategory)}>
        <Select.Trigger class="w-full border-[var(--app-border)] bg-[var(--app-surface-subtle)] text-[var(--app-text-soft)]">{categoryLabel(catalogCategory)}</Select.Trigger>
        <Select.Content>
          <Select.Item value="all">{m['roles.category_all']()}</Select.Item>
          <Select.Item value="leadership">{m['roles.category_leadership']()}</Select.Item>
          <Select.Item value="engineering">{m['roles.category_engineering']()}</Select.Item>
          <Select.Item value="quality">{m['roles.category_quality']()}</Select.Item>
          <Select.Item value="operations">{m['roles.category_operations']()}</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
    <div class="grid gap-2">
      {#each filteredCatalog as role (role.id)}
        {@const installed = roles.some((current) => current.name === role.name)}
        <article class="rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-3 transition-colors hover:border-[var(--app-border-strong)]">
          <div class="flex items-start gap-2">
            <span class="mt-1 size-2.5 shrink-0 rounded-full" style:background={role.color}></span>
            <div class="min-w-0 flex-1">
              <h4 class="m-0 text-xs font-semibold text-[var(--app-text)]">{role.name}</h4>
              <p class="mt-1 text-ui-xs leading-4 text-[var(--app-text-muted)]">{role.description}</p>
              <p class="mt-2 text-ui-xs font-medium uppercase tracking-normal text-[var(--app-text-muted)]">{categoryLabel(role.category)}</p>
            </div>
            <Button
              variant={installed ? 'secondary' : 'outline'}
              size="icon-sm"
              disabled={installed || installingRoleId === role.id}
              aria-label={installed ? m['roles.catalog_already_installed']({ name: role.name }) : m['roles.catalog_add_named']({ name: role.name })}
              onclick={() => installRole(role)}
            >
              {#if installed}<Check size={13} />{:else}<Plus size={13} />{/if}
            </Button>
          </div>
        </article>
      {:else}
        <p class="py-8 text-center text-xs text-[var(--app-text-muted)]">{m['roles.catalog_empty']()}</p>
      {/each}
    </div>
  {:else}

  {#each roles as role (role.slug)}
    <div class="role-item" class:editing={editingSlug === role.slug}>
      <span class="role-color" style:background={role.color}></span>
      <div class="role-info">
        <strong>{role.name}</strong>
        <small>{role.slug} · {m['roles.char_count']({ count: role.prompt.length })}</small>
      </div>
      <HeaderIconButton label={m['roles.edit']()} class="node-action-btn" side="left" onclick={() => (editingSlug === role.slug ? cancelEdit() : startEdit(role))}><Pencil size={13} /></HeaderIconButton>
      <HeaderIconButton label={m['roles.delete']()} class="node-action-btn" danger side="left" onclick={() => remove(role)}><Trash2 size={13} /></HeaderIconButton>
    </div>
  {/each}
  {#if roles.length === 0}
    <p class="empty">{m['roles.empty']()}</p>
  {/if}

  {#if infoMessage}
    <p class="info">{infoMessage}</p>
  {/if}
  {#if errorMessage}
    <p class="text-sm text-destructive">{errorMessage}</p>
  {/if}

  <form method="POST" use:enhance class="role-form">
    {#if editingSlug}
      <p class="editing-hint">{m['roles.editing']({ slug: editingSlug })} — <button type="button" class="link-btn" onclick={cancelEdit}>{m['settings.cancel']()}</button></p>
    {/if}
    <Form.Field {form} name="name">
      <Form.Control>
        {#snippet children({ props })}
          <Form.Label>{m['roles.name_label']()}</Form.Label>
          <Input {...props} bind:value={$formData.name} placeholder={m['ph.role_name']()} />
        {/snippet}
      </Form.Control>
      <Form.FieldErrors />
    </Form.Field>

    <Form.Field {form} name="prompt">
      <Form.Control>
        {#snippet children({ props })}
          <div class="prompt-head">
            <Form.Label>{m['roles.prompt_label']()}</Form.Label>
            <div class="prompt-tabs" role="tablist">
              <button type="button" class:active={promptTab === 'edit'} role="tab" onclick={() => (promptTab = 'edit')}>{m['roles.tab_write']()}</button>
              <button type="button" class:active={promptTab === 'preview'} role="tab" onclick={() => (promptTab = 'preview')}>{m['roles.tab_preview']()}</button>
            </div>
          </div>
          {#if promptTab === 'edit'}
            <Textarea {...props} bind:value={$formData.prompt} rows={8} placeholder={m['roles.prompt_ph']()} />
          {:else}
            <div class="md-preview">
              {#if $formData.prompt.trim()}
                <MarkdownView content={$formData.prompt} />
              {:else}
                <span class="md-empty">{m['roles.preview_empty']()}</span>
              {/if}
            </div>
          {/if}
        {/snippet}
      </Form.Control>
      <Form.FieldErrors />
    </Form.Field>

    <Button type="submit" size="sm">{editingSlug ? m['settings.save']() : m['roles.save']()}</Button>
  </form>
  {/if}
</aside>

<style>
  .side-panel {
    width: 380px;
    flex-shrink: 0;
    border-left: 1px solid var(--app-border);
    background: var(--app-sidebar);
    padding: 14px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--app-text-muted);
  }

  .panel-header-actions {
    display: flex;
    gap: 2px;
  }

  .hint {
    margin: 0;
    font-size: 10px;
    color: var(--app-text-muted);
    line-height: 1.5;
  }

  .role-item {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    padding: 8px;
    background: var(--app-surface-subtle);
  }

  .role-color {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .role-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .role-info small {
    color: var(--app-text-muted);
    font-size: 10px;
  }

  .empty {
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .info {
    color: var(--app-success);
    font-size: 11px;
  }

  .role-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 1px solid var(--app-border);
    padding-top: 10px;
  }
  .editing-hint {
    margin: 0;
    font-size: 11px;
    color: var(--app-warning);
  }

  .link-btn {
    border: none;
    background: transparent;
    color: var(--app-secondary);
    cursor: pointer;
    font-size: 11px;
    padding: 0;
    text-decoration: underline;
  }

  .role-item.editing {
    border-color: var(--app-accent);
  }

  .prompt-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .prompt-tabs {
    display: inline-flex;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    overflow: hidden;
  }

  .prompt-tabs button {
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 10px;
    padding: 3px 10px;
    cursor: pointer;
  }

  .prompt-tabs button.active {
    background: var(--app-accent-soft);
    color: var(--app-text);
  }

  .md-preview {
    min-height: 160px;
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-surface-subtle);
    padding: 10px 12px;
    font-size: 12px;
    line-height: 1.55;
    color: var(--app-text-soft);
  }

  .md-preview :global(h1), .md-preview :global(h2), .md-preview :global(h3) {
    color: var(--app-text);
    font-size: 13px;
    margin: 10px 0 4px;
  }

  .md-preview :global(h1:first-child), .md-preview :global(h2:first-child), .md-preview :global(h3:first-child) {
    margin-top: 0;
  }

  .md-preview :global(p) { margin: 6px 0; }
  .md-preview :global(ul), .md-preview :global(ol) { padding-left: 18px; margin: 6px 0; }
  .md-preview :global(li) { margin: 2px 0; }

  .md-preview :global(code) {
    background: var(--app-surface-raised);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 11px;
  }

  .md-preview :global(pre) {
    background: var(--app-canvas);
    border: 1px solid var(--app-border);
    border-radius: 8px;
    padding: 8px 10px;
    overflow-x: auto;
    margin: 8px 0;
  }

  .md-preview :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .md-preview :global(blockquote) {
    border-left: 3px solid var(--app-accent);
    margin: 8px 0;
    padding: 2px 10px;
    color: var(--app-text-soft);
  }

  .md-preview :global(a) { color: var(--app-secondary); }
  .md-preview :global(strong) { color: var(--app-text); }

  .md-empty {
    font-size: 11px;
    color: var(--app-text-muted);
    font-style: italic;
  }
</style>
