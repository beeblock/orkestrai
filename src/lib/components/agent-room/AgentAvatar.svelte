<script lang="ts">
  import { agentColor, agentInitials } from './agent-identity.js';

  let { nodeId, title, size = 20 }: { nodeId: string; title: string; size?: number } = $props();

  const color = $derived(agentColor(nodeId));
  const initials = $derived(agentInitials(title));
</script>

<span
  class="agent-avatar"
  aria-hidden="true"
  style={`--avatar-size:${size}px;--avatar-bg:${color.bg};--avatar-ink:${color.ink}`}
>{initials}</span>

<style>
  .agent-avatar {
    width: var(--avatar-size);
    height: var(--avatar-size);
    flex: none;
    display: inline-grid;
    place-items: center;
    border-radius: calc(var(--avatar-size) * 0.3);
    background: var(--avatar-bg);
    color: var(--avatar-ink);
    font-size: max(11px, calc(var(--avatar-size) * 0.4));
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
    user-select: none;
  }
</style>
