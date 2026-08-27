<script lang="ts">
  import {
    FileCode2,
    FolderTree,
    Gauge,
    GitCompareArrows,
    Globe2,
    Image as ImageIcon,
    Sparkles,
    Repeat2,
    SquareKanban,
    SquareTerminal,
    StickyNote,
    Workflow,
    Activity,
    GitPullRequestArrow,
    Smartphone,
    Palette,
    Workflow as AutomationIcon,
    Braces,
    Route,
    BookMarked,
    MessageSquareText,
  } from '@lucide/svelte';
  import type { CanvasNodeType } from '$lib/modules/agent-room/domain/types.js';

  let { type, size = 14 }: { type: CanvasNodeType; size?: number } = $props();
</script>

{#if type === 'terminal'}<SquareTerminal {size} aria-hidden="true" />
{:else if type === 'tasks'}<SquareKanban {size} aria-hidden="true" />
{:else if type === 'note'}<StickyNote {size} aria-hidden="true" />
{:else if type === 'portal'}<Globe2 {size} aria-hidden="true" />
{:else if type === 'apiClient'}<Braces {size} aria-hidden="true" />
{:else if type === 'fileTree'}<FolderTree {size} aria-hidden="true" />
{:else if type === 'editor'}<FileCode2 {size} aria-hidden="true" />
{:else if type === 'diff'}<GitCompareArrows {size} aria-hidden="true" />
{:else if type === 'image'}<ImageIcon {size} aria-hidden="true" />
{:else if type === 'imageWorkflow'}<Sparkles {size} aria-hidden="true" />
{:else if type === 'flow'}<Workflow {size} aria-hidden="true" />
{:else if type === 'loop'}<Repeat2 {size} aria-hidden="true" />
{:else if type === 'usage'}<Gauge {size} aria-hidden="true" />
{:else if type === 'controlCenter'}<Activity {size} aria-hidden="true" />
{:else if type === 'reviewCenter'}<GitPullRequestArrow {size} aria-hidden="true" />
{:else if type === 'workstreams'}<Route {size} aria-hidden="true" />
{:else if type === 'memory'}<BookMarked {size} aria-hidden="true" />
{:else if type === 'annotations'}<MessageSquareText {size} aria-hidden="true" />
{:else if type === 'device'}<Smartphone {size} aria-hidden="true" />
{:else if type === 'design'}<Palette {size} aria-hidden="true" />
{:else if type === 'automation'}<AutomationIcon {size} aria-hidden="true" />
{/if}
