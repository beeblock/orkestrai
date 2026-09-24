<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { Image as ImageIcon, ImagePlus, Columns2, LoaderCircle, WandSparkles, X } from '@lucide/svelte';
  import CreativeAssetActionDialog from '../CreativeAssetActionDialog.svelte';
  import CreativeAssetReviewDialog from '../CreativeAssetReviewDialog.svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import * as m from '$lib/paraglide/messages.js';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';

  export type ImageNodeData = {
    title: string;
    workspaceId: string;
    payload: { path?: string; characterId?: string; characterDigest?: string };
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onPayloadChange: (id: string, partial: Record<string, unknown>) => void;
    connections?: Array<{ edgeId: string; targetId: string; targetTitle: string; targetType: string; direction: 'out' | 'in' }>;
    onJumpToNode?: (id: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: ImageNodeData }>();

  let fileInput: HTMLInputElement;
  let reviewing = $state(false);
  let editing = $state(false);
  let dragActive = $state(false);
  let uploading = $state(false);
  const imageUrl = $derived(
    data.payload.path
      ? `/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(data.payload.path)}`
      : null
  );

  async function saveBlob(blob: Blob) {
    if (data.payload.characterId && data.payload.characterDigest) return;
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary);
    const ext = (blob.type.split('/').at(-1) ?? 'png').replace('jpeg', 'jpg');
    const path = `.orkestrai/images/${crypto.randomUUID()}.${ext}`;
    const response = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/fs/write-binary`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}) },
      body: JSON.stringify({ path, base64 }),
    });
    if (!response.ok) return;
    data.onPayloadChange(id, { path });
  }

  // Mesmo saveBlob para escolher, colar e soltar; so marca o envio para o
  // usuario ver que algo esta acontecendo ate a imagem aparecer.
  async function importImage(blob: Blob) {
    uploading = true;
    try {
      await saveBlob(blob);
    } finally {
      uploading = false;
    }
  }

  function onFilePicked(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file && file.type.startsWith('image/')) void importImage(file);
    (event.target as HTMLInputElement).value = '';
  }

  async function handlePaste(event: ClipboardEvent) {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    const blob = item.getAsFile();
    if (blob) await importImage(blob);
  }

  // Soltar arquivo no no vazio: o canvas ignora drops sobre nos, entao a
  // zona de soltar trata o arquivo aqui com o mesmo fluxo do seletor.
  function carriesFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  function onDragOver(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dragActive = true;
  }

  function onDragLeave(event: DragEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    dragActive = false;
  }

  function onDrop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragActive = false;
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith('image/'));
    if (file) void importImage(file);
  }
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-image"
  deferOffscreen
  accent="var(--app-secondary)"
  minWidth={220}
  minHeight={160}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<ImageIcon size={13} />{/snippet}
  {#snippet title()}{data.title || m['node.image']()}{/snippet}
  {#snippet actions()}
    {#if imageUrl}<HeaderIconButton class="node-action-btn" label={m['creative_edit.title']()} onclick={() => editing = true}><WandSparkles size={13} /></HeaderIconButton>{/if}
    {#if imageUrl}<HeaderIconButton class="node-action-btn" label={m['creative_review.title']()} onclick={() => reviewing = true}><Columns2 size={13} /></HeaderIconButton>{/if}
    {#if !data.payload.characterId || !data.payload.characterDigest}<HeaderIconButton class="node-action-btn" label={m['node.image_replace']()} onclick={() => fileInput.click()}>
      <ImagePlus size={13} />
    </HeaderIconButton>{/if}
    <HeaderIconButton class="node-action-btn" label={m['node.image_remove']()} danger onclick={() => data.onDelete(id)}>
      <X size={13} /></HeaderIconButton>
  {/snippet}

  <input bind:this={fileInput} type="file" accept="image/*" class="hidden-input" onchange={onFilePicked} />
  {#if imageUrl}
    <div class="image-body nodrag" onpaste={handlePaste} tabindex="-1" role="presentation">
      <img class="img-outline" src={imageUrl} alt={data.title || m['img.alt_fallback']()} draggable="false" loading="lazy" decoding="async" />
      {#if uploading}
        <span class="image-status" role="status"><LoaderCircle size={13} class="animate-spin" />{m['node.image_uploading']()}</span>
      {/if}
    </div>
  {:else}
    <button
      class="image-drop nodrag"
      class:drag-active={dragActive}
      aria-busy={uploading}
      onclick={() => fileInput.click()}
      onpaste={handlePaste}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
    >
      <span class="image-drop-icon" aria-hidden="true">
        {#if uploading}<LoaderCircle size={17} class="animate-spin" />{:else}<ImagePlus size={17} />{/if}
      </span>
      <span class="image-drop-title">
        {uploading ? m['node.image_uploading']() : dragActive ? m['node.image_drop_active']() : m['node.image_drop_title']()}
      </span>
      <span class="image-drop-hint">{m['node.image_drop_hint']()}</span>
    </button>
  {/if}
</NodeShell>
<CreativeAssetReviewDialog bind:open={reviewing} workspaceId={data.workspaceId} initialNodeId={id} onOpenNode={data.onJumpToNode} />
<CreativeAssetActionDialog bind:open={editing} workspaceId={data.workspaceId} nodeId={id} onOpenNode={data.onJumpToNode} />

<style>
  .hidden-input {
    display: none;
  }

  .image-body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--app-canvas);
  }

  .image-body img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
  }

  /* Status flutuante sobre a imagem enquanto a troca e enviada. */
  .image-status {
    position: absolute;
    left: 50%;
    bottom: 10px;
    translate: -50% 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-overlay);
    color: var(--app-text-soft);
    font-size: 11.5px;
    white-space: nowrap;
  }

  /*
   * Zona de soltar: tracejado neutro em repouso, tom do no ao apontar e
   * contorno cheio durante o arraste (a mudanca de borda e o sinal estatico,
   * o leve levantar do icone e so reforco).
   */
  .image-drop {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 8px;
    padding: 16px;
    border: 1.5px dashed color-mix(in srgb, var(--app-border-strong) 85%, transparent);
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-soft);
    text-align: center;
    cursor: pointer;
    transition:
      border-color var(--duration-quick) ease-out,
      background-color var(--duration-quick) ease-out;
  }

  .image-drop > * {
    pointer-events: none;
  }

  .image-drop:hover {
    border-color: color-mix(in srgb, var(--app-secondary) 55%, var(--app-border-strong));
    background: color-mix(in srgb, var(--app-secondary) 5%, transparent);
  }

  .image-drop.drag-active {
    border-style: solid;
    border-color: var(--app-secondary);
    background: color-mix(in srgb, var(--app-secondary) 10%, transparent);
  }

  .image-drop:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .image-drop[aria-busy='true'] {
    cursor: progress;
  }

  .image-drop-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    margin-bottom: 4px;
    border-radius: 9px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    transition:
      background-color var(--duration-quick) ease-out,
      color var(--duration-quick) ease-out,
      transform var(--duration-fast) var(--ease-smooth-out);
  }

  .image-drop:hover .image-drop-icon,
  .image-drop.drag-active .image-drop-icon {
    background: var(--app-secondary-soft);
    color: var(--app-secondary);
  }

  .image-drop.drag-active .image-drop-icon {
    transform: translateY(calc(var(--distance-micro) * -1));
  }

  .image-drop-title {
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    text-wrap: balance;
  }

  .image-drop-hint {
    max-width: 32ch;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
    text-wrap: pretty;
  }
</style>
