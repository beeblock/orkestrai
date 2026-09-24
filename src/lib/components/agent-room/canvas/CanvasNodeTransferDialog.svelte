<script lang="ts">
  import { CircleAlert, Copy, LoaderCircle, MoveRight, Network, RotateCcw, ShieldCheck, TriangleAlert } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import type { CanvasNodeTransferMode, Workspace } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let { open, sourceWorkspaceId, workspaces, nodeCount, connectionCount, onTransfer, onClose }: {
    open: boolean;
    sourceWorkspaceId: string;
    workspaces: Workspace[];
    nodeCount: number;
    connectionCount: number;
    onTransfer: (destinationWorkspaceId: string, mode: CanvasNodeTransferMode) => Promise<void>;
    onClose: () => void;
  } = $props();

  // Abas com o visual do SegmentedControl (trilho neutro, pilula elevada).
  const segmentTab = 'h-8 gap-2 rounded-md text-[13px] data-[state=active]:bg-[var(--app-surface-raised)] data-[state=active]:text-[var(--app-text)] data-[state=active]:shadow-[var(--app-shadow-border)] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[var(--app-surface-raised)] dark:data-[state=active]:text-[var(--app-text)]';

  let destinationWorkspaceId = $state('');
  let mode = $state<CanvasNodeTransferMode>('copy');
  let busy = $state(false);
  let errorMessage = $state('');
  let wasOpen = false;
  const destinations = $derived(workspaces.filter((workspace) => workspace.id !== sourceWorkspaceId));
  const destination = $derived(destinations.find((workspace) => workspace.id === destinationWorkspaceId) ?? null);

  $effect(() => {
    if (open && !wasOpen) {
      destinationWorkspaceId = destinations[0]?.id ?? '';
      mode = 'copy';
      errorMessage = '';
    }
    wasOpen = open;
  });

  function transferError(error: unknown): string {
    const code = error instanceof Error ? error.message : '';
    const messages: Record<string, () => string> = {
      canvas_transfer_invalid_request: m['canvas.transfer_error_invalid_request'],
      canvas_transfer_same_workspace: m['canvas.transfer_error_same_workspace'],
      canvas_transfer_workspace_not_found: m['canvas.transfer_error_workspace_not_found'],
      canvas_transfer_node_not_found: m['canvas.transfer_error_node_not_found'],
      canvas_transfer_workflow_running: m['canvas.transfer_error_workflow_running'],
      canvas_transfer_singleton_exists: m['canvas.transfer_error_singleton_exists'],
      canvas_transfer_active_routine: m['canvas.transfer_error_active_routine'],
      canvas_transfer_asset_missing: m['canvas.transfer_error_asset_missing'],
      canvas_transfer_asset_invalid: m['canvas.transfer_error_asset_invalid'],
    };
    return messages[code]?.() ?? m['canvas.transfer_error_failed']();
  }

  async function submit() {
    if (!destinationWorkspaceId || busy) return;
    busy = true;
    errorMessage = '';
    try {
      await onTransfer(destinationWorkspaceId, mode);
      onClose();
    } catch (error) {
      errorMessage = transferError(error);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="sm:max-w-[500px]">
    <Dialog.Header>
      <Dialog.Title>{m['canvas.transfer_title']()}</Dialog.Title>
      <Dialog.Description>{m['canvas.transfer_description']({ count: nodeCount })}</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-5">
      <div class="grid gap-3">
        <!-- Copiar/mover: abas com o visual do controle segmentado. -->
        <Tabs.Root value={mode} onValueChange={(value: string) => (mode = value as CanvasNodeTransferMode)}>
          <Tabs.List class="grid h-9 w-full grid-cols-2 rounded-lg bg-[var(--app-hover)] p-0.5">
            <Tabs.Trigger value="copy" class={segmentTab}><Copy size={14} aria-hidden="true" />{m['canvas.transfer_copy']()}</Tabs.Trigger>
            <Tabs.Trigger value="move" class={segmentTab}><MoveRight size={14} aria-hidden="true" />{m['canvas.transfer_move']()}</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>

        <div class="grid gap-1.5">
          <label for="canvas-transfer-destination" class="text-ui-lg font-medium">{m['canvas.transfer_destination']()}</label>
          <Select.Root type="single" value={destinationWorkspaceId} onValueChange={(value: string) => (destinationWorkspaceId = value)}>
            <Select.Trigger id="canvas-transfer-destination" class="w-full" disabled={destinations.length === 0}>
              <span class="truncate">{destination?.name ?? m['canvas.transfer_destination_placeholder']()}</span>
            </Select.Trigger>
            <Select.Content>
              {#each destinations as workspace (workspace.id)}
                <Select.Item value={workspace.id}>{workspace.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>

      <!-- O que acontece: lista neutra; a cor fica so no icone. -->
      <ul class="grid gap-2.5 text-ui-md leading-snug text-[var(--app-text-soft)]">
        <li class="flex items-start gap-2.5"><Network size={14} class="mt-px shrink-0 text-[var(--app-secondary)]" aria-hidden="true" /><span class="text-pretty">{m['canvas.transfer_connections']({ count: connectionCount })}</span></li>
        <li class="flex items-start gap-2.5"><RotateCcw size={14} class="mt-px shrink-0 text-[var(--app-warning)]" aria-hidden="true" /><span class="text-pretty">{m['canvas.transfer_runtime_reset']()}</span></li>
        <li class="flex items-start gap-2.5"><ShieldCheck size={14} class="mt-px shrink-0 text-[var(--app-success)]" aria-hidden="true" /><span class="text-pretty">{m['canvas.transfer_security']()}</span></li>
      </ul>

      {#if destinations.length === 0}<p class="flex items-start gap-2 rounded-lg bg-[var(--app-warning-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-text)]" role="status"><TriangleAlert size={14} class="mt-px shrink-0 text-[var(--app-warning)]" aria-hidden="true" /><span>{m['canvas.transfer_no_destination']()}</span></p>{/if}
      {#if errorMessage}<p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{errorMessage}</span></p>{/if}
    </div>

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={onClose}>{m['dlg.cancel']()}</Button>
      <Button type="button" disabled={busy || !destinationWorkspaceId} onclick={submit}>
        {#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{:else if mode === 'copy'}<Copy size={15} aria-hidden="true" />{:else}<MoveRight size={15} aria-hidden="true" />{/if}
        {busy ? m['canvas.transfer_working']() : mode === 'copy' ? m['canvas.transfer_copy_action']() : m['canvas.transfer_move_action']()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
