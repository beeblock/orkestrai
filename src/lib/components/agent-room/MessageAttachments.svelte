<script lang="ts" module>
  import type { WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';

  /** The attachments kept on a stored message, ignoring anything malformed. */
  export function messageAttachments(meta: Record<string, unknown>): WorkspaceAttachment[] {
    if (!Array.isArray(meta.attachments)) return [];
    return meta.attachments.filter((value): value is WorkspaceAttachment => {
      const item = value as Partial<WorkspaceAttachment> | null;
      return Boolean(item) && typeof item?.id === 'string' && typeof item.name === 'string'
        && ((item.kind === 'file' && typeof item.path === 'string') || (item.kind === 'link' && typeof item.url === 'string'));
    });
  }
</script>

<script lang="ts">
  import AttachmentList from './AttachmentList.svelte';
  import { attachmentHref } from './workspace-attachments.js';
  import { isRasterWorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';

  /** Images the owner sent show as thumbnails; PDFs, other files and links as chips. */
  let { workspaceId, attachments }: { workspaceId: string; attachments: WorkspaceAttachment[] } = $props();

  const images = $derived(attachments.filter(isRasterWorkspaceAttachment));
  const others = $derived(attachments.filter((attachment) => !isRasterWorkspaceAttachment(attachment)));
</script>

{#if images.length}
  <div class="images">
    {#each images as image (image.id)}
      <a href={attachmentHref(workspaceId, image)} target="_blank" rel="noopener noreferrer" title={image.name}>
        <img src={attachmentHref(workspaceId, image)} alt={image.name} loading="lazy" />
      </a>
    {/each}
  </div>
{/if}
{#if others.length}<AttachmentList {workspaceId} attachments={others} compact />{/if}

<style>
  .images {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 4px 0;
  }

  .images a {
    display: block;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--app-border);
  }

  .images img {
    display: block;
    max-width: min(240px, 100%);
    max-height: 180px;
    object-fit: cover;
  }

  .images a:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
