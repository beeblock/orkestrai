<script lang="ts">
  import { toast } from '@beeblock/svelar/ui';
  import { FolderKey, LoaderCircle, RefreshCw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as m from '$lib/paraglide/messages.js';

  type DesktopBridge = {
    platform: 'darwin' | 'win32' | 'linux';
    pickDirectory: () => Promise<string | null>;
  };

  let {
    workingDir,
    onRetry,
  }: {
    workingDir: string;
    onRetry: () => void | Promise<void>;
  } = $props();

  let busy = $state(false);
  const desktop = typeof window === 'undefined'
    ? undefined
    : (window as unknown as { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
  const canAuthorize = desktop?.platform === 'darwin';

  function normalizedPath(value: string): string {
    return value.replace(/\/+$/, '');
  }

  async function retry(): Promise<void> {
    busy = true;
    try {
      await onRetry();
    } finally {
      busy = false;
    }
  }

  async function authorize(): Promise<void> {
    if (!desktop || !canAuthorize) return;
    busy = true;
    try {
      const selected = await desktop.pickDirectory();
      if (!selected) return;
      if (normalizedPath(selected) !== normalizedPath(workingDir)) {
        toast.error(m['workspace_access.wrong_folder']());
        return;
      }
      await onRetry();
    } finally {
      busy = false;
    }
  }
</script>

<section
  class="w-full rounded-md border border-[color-mix(in_srgb,var(--app-warning)_55%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-warning)_9%,var(--app-surface))] p-3 text-[var(--app-text)] shadow-lg"
  role="alert"
>
  <div class="flex items-start gap-3">
    <span class="grid size-9 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--app-warning)_15%,transparent)] text-[var(--app-warning)]">
      <FolderKey size={18} />
    </span>
    <div class="min-w-0 flex-1">
      <h2 class="text-xs font-semibold">{m['workspace_access.title']()}</h2>
      <p class="mt-1 text-[11px] leading-5 text-[var(--app-text-muted)]">
        {canAuthorize ? m['workspace_access.body_macos']() : m['workspace_access.body_other']()}
      </p>
      <code class="mt-2 block break-all rounded-[4px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2 py-1.5 text-[10px] text-[var(--app-text-soft)]">{workingDir}</code>
      <div class="mt-3 flex flex-wrap gap-2">
        {#if canAuthorize}
          <Button size="sm" disabled={busy} onclick={() => void authorize()}>
            {#if busy}<LoaderCircle size={14} class="animate-spin" />{:else}<FolderKey size={14} />{/if}
            {m['workspace_access.authorize']()}
          </Button>
        {/if}
        <Button size="sm" variant="outline" disabled={busy} onclick={() => void retry()}>
          <RefreshCw size={14} />
          {m['workspace_access.retry']()}
        </Button>
      </div>
    </div>
  </div>
</section>
