<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { botWorkflowProgressSchema } from '$lib/modules/agent-room/contracts/schemas/bot-workflow.schema.js';
  import { botApi } from './bot-api.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, nodeId, meta }: { workspaceId: string; nodeId: string; meta: Record<string, unknown> } = $props();
  let busy = $state(false), error = $state('');
  const parsed = $derived(botWorkflowProgressSchema.safeParse(meta.botWorkflow));
  const progress = $derived(parsed.success ? parsed.data : null);
  const runState = $derived(progress?.state);
  const active = $derived(runState === 'queued' || runState === 'running' || runState === 'waiting');
  const label = $derived(runState === 'completed' ? m['bots.workflow_complete']() : runState === 'failed' ? m['bots.workflow_failed']() : runState === 'cancelled' ? m['bots.workflow_cancelled']() : runState === 'running' ? m['bots.workflow_running']() : m['bots.workflow_waiting']());
  async function cancel() {
    if (!progress?.id || busy) return;
    busy = true; error = '';
    try { await botApi(`/api/agent-room/workspaces/${workspaceId}/bots`, { command: 'workflow_cancel', nodeId, sourceId: progress.id }); }
    catch { error = m['bots.error'](); }
    finally { busy = false; }
  }
</script>
{#if progress?.id}
  <div class="mt-2 grid gap-1 border-t border-[var(--app-border)] pt-2 text-xs" data-testid="bot-workflow-progress" aria-live="polite">
    <p>{label} · {m['bots.workflow_progress']({ done: Math.min(progress.index ?? 0, 8), total: Math.min(progress.total ?? 0, 8) })}</p>
    {#if active}<Button type="button" size="sm" variant="outline" class="justify-self-start" disabled={busy} onclick={cancel}>{m['bots.workflow_stop']()}</Button><p class="text-[var(--app-text-muted)]">{m['bots.workflow_stop_hint']()}</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
  </div>
{/if}
