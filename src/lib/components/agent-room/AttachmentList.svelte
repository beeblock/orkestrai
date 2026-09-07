<script lang="ts">
  import { File, FileImage, FileText, Link, X } from '@lucide/svelte';
  import type { WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';
  import { attachmentHref } from './workspace-attachments.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    workspaceId,
    attachments,
    compact = false,
    onRemove,
  }: {
    workspaceId: string;
    attachments: WorkspaceAttachment[];
    compact?: boolean;
    onRemove?: (attachment: WorkspaceAttachment) => void | Promise<void>;
  } = $props();

  function iconKind(attachment: WorkspaceAttachment): 'link' | 'image' | 'pdf' | 'file' {
    if (attachment.kind === 'link') return 'link';
    if (attachment.mimeType?.startsWith('image/')) return 'image';
    if (attachment.mimeType === 'application/pdf') return 'pdf';
    return 'file';
  }
</script>

{#if attachments.length}
  <div class={`flex min-w-0 flex-wrap gap-1 ${compact ? '' : 'px-2 py-1.5'}`} aria-label={m['attachment.list_label']()}>
    {#each attachments as attachment (attachment.id)}
      <span class="group inline-flex h-6 min-w-0 max-w-48 items-center gap-1 rounded-[4px] border border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-1.5 text-ui-xs text-[var(--app-text-soft)]">
        {#if iconKind(attachment) === 'link'}<Link size={11} aria-hidden="true" />
        {:else if iconKind(attachment) === 'image'}<FileImage size={11} aria-hidden="true" />
        {:else if iconKind(attachment) === 'pdf'}<FileText size={11} aria-hidden="true" />
        {:else}<File size={11} aria-hidden="true" />{/if}
        <a
          class="min-w-0 truncate hover:text-[var(--app-text)] hover:underline"
          href={attachmentHref(workspaceId, attachment)}
          target="_blank"
          rel="noopener noreferrer"
          title={attachment.path ?? attachment.url ?? attachment.name}
        >{attachment.name}</a>
        {#if onRemove}
          <button
            type="button"
            class="grid size-4 shrink-0 place-items-center rounded-[3px] text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-accent)]"
            aria-label={m['attachment.remove']({ name: attachment.name })}
            onclick={() => void onRemove?.(attachment)}
          >
            <X size={10} aria-hidden="true" />
          </button>
        {/if}
      </span>
    {/each}
  </div>
{/if}
