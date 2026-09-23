<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import KnowledgeView from './KnowledgeView.svelte';
  import * as m from '$lib/paraglide/messages.js';

  let { open = $bindable(false), workspaceId, onJumpToNode }: { open?: boolean; workspaceId: string; onJumpToNode?: (id: string) => void } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[min(820px,88vh)] w-[94vw] max-w-[1120px] flex-col overflow-hidden p-0 pt-8 sm:max-w-[1120px]">
    <Dialog.Title class="sr-only">{m['knowledge.title']()}</Dialog.Title>
    <div class="min-h-0 flex-1"><KnowledgeView {workspaceId} onJumpToNode={(id) => { open = false; onJumpToNode?.(id); }} /></div>
  </Dialog.Content>
</Dialog.Root>
