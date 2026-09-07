<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { Image as ImageIcon, ImagePlus, X } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';

  export type ImageNodeData = {
    title: string;
    workspaceId: string;
    payload: { path?: string };
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
  const imageUrl = $derived(
    data.payload.path
      ? `/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(data.payload.path)}`
      : null
  );

  async function saveBlob(blob: Blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary);
    const ext = (blob.type.split('/').at(-1) ?? 'png').replace('jpeg', 'jpg');
    const path = `.orkestrai/images/${crypto.randomUUID()}.${ext}`;
    const response = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/fs/write-binary`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, base64 }),
    });
    if (!response.ok) return;
    data.onPayloadChange(id, { path });
  }

  function onFilePicked(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file && file.type.startsWith('image/')) void saveBlob(file);
    (event.target as HTMLInputElement).value = '';
  }

  async function handlePaste(event: ClipboardEvent) {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    const blob = item.getAsFile();
    if (blob) await saveBlob(blob);
  }
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-image"
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
    <HeaderIconButton class="node-action-btn" label={m['node.image_replace']()} onclick={() => fileInput.click()}>
      <ImagePlus size={13} />
    </HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['node.image_remove']()} danger onclick={() => data.onDelete(id)}>
      <X size={13} /></HeaderIconButton>
  {/snippet}

  <input bind:this={fileInput} type="file" accept="image/*" class="hidden-input" onchange={onFilePicked} />
  {#if imageUrl}
    <div class="image-body nodrag" onpaste={handlePaste} tabindex="-1" role="presentation">
      <img src={imageUrl} alt={data.title || m['img.alt_fallback']()} draggable="false" />
    </div>
  {:else}
    <button class="image-empty nodrag" onclick={() => fileInput.click()} onpaste={handlePaste}>
      <ImagePlus size={22} />
      <span>{m['node.image_empty']()}</span>
      <span class="hint">{m['node.image_empty_hint']()}</span>
    </button>
  {/if}
</NodeShell>

<style>
  .hidden-input {
    display: none;
  }

  .image-body {
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

  .image-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1.5px dashed color-mix(in srgb, var(--app-secondary) 42%, var(--app-border));
    border-radius: 8px;
    margin: 8px;
    background: color-mix(in srgb, var(--app-secondary) 6%, var(--app-surface));
    color: var(--app-text-soft);
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .image-empty:hover {
    background: color-mix(in srgb, var(--app-secondary) 12%, var(--app-surface));
    border-color: var(--app-secondary);
  }

  .image-empty .hint {
    font-size: 10.5px;
    opacity: 0.7;
  }
</style>
