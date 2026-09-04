<script lang="ts">
  import { Copy, MoveRight, Network, RotateCcw, ShieldCheck } from '@lucide/svelte';
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
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m['canvas.transfer_title']()}</Dialog.Title>
      <Dialog.Description>{m['canvas.transfer_description']({ count: nodeCount })}</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <Tabs.Root value={mode} onValueChange={(value: string) => (mode = value as CanvasNodeTransferMode)}>
        <Tabs.List class="grid h-auto w-full grid-cols-2 p-1">
          <Tabs.Trigger value="copy" class="h-10 gap-2"><Copy size={15} />{m['canvas.transfer_copy']()}</Tabs.Trigger>
          <Tabs.Trigger value="move" class="h-10 gap-2"><MoveRight size={15} />{m['canvas.transfer_move']()}</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      <div class="space-y-2">
        <label for="canvas-transfer-destination" class="text-xs font-medium text-[var(--app-text)]">{m['canvas.transfer_destination']()}</label>
        <Select.Root type="single" value={destinationWorkspaceId} onValueChange={(value: string) => (destinationWorkspaceId = value)}>
          <Select.Trigger id="canvas-transfer-destination" class="w-full">
            {destination?.name ?? m['canvas.transfer_destination_placeholder']()}
          </Select.Trigger>
          <Select.Content>
            {#each destinations as workspace (workspace.id)}
              <Select.Item value={workspace.id}>{workspace.name}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="grid gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-canvas)] p-3 text-xs text-[var(--app-text-muted)]">
        <p class="flex items-start gap-2"><Network size={14} class="mt-0.5 shrink-0 text-[var(--app-secondary)]" /><span>{m['canvas.transfer_connections']({ count: connectionCount })}</span></p>
        <p class="flex items-start gap-2"><RotateCcw size={14} class="mt-0.5 shrink-0 text-[var(--app-warning)]" /><span>{m['canvas.transfer_runtime_reset']()}</span></p>
        <p class="flex items-start gap-2"><ShieldCheck size={14} class="mt-0.5 shrink-0 text-[var(--app-success)]" /><span>{m['canvas.transfer_security']()}</span></p>
      </div>

      {#if destinations.length === 0}<p class="text-xs text-[var(--app-warning)]" role="status">{m['canvas.transfer_no_destination']()}</p>{/if}
      {#if errorMessage}<p class="text-sm text-destructive" role="alert">{errorMessage}</p>{/if}
    </div>

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={onClose}>{m['dlg.cancel']()}</Button>
      <Button type="button" disabled={busy || !destinationWorkspaceId} onclick={submit}>
        {#if mode === 'copy'}<Copy size={15} />{:else}<MoveRight size={15} />{/if}
        {busy ? m['canvas.transfer_working']() : mode === 'copy' ? m['canvas.transfer_copy_action']() : m['canvas.transfer_move_action']()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
