<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { ArrowUp, Plus, Trash2 } from '@lucide/svelte';
  import type { BotWorkflow } from '$lib/modules/agent-room/contracts/schemas/bot-workflow.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  let { value = $bindable(null), agents, excludedId }: { value?: BotWorkflow | null; agents: Array<{ id: string; title: string }>; excludedId?: string } = $props();
  const targets = $derived(agents.filter(agent => agent.id !== excludedId));
  function add() { if (value && value.steps.length < 8) value = { ...value, steps: [...value.steps, { nodeId: targets[0]?.id ?? '', instructions: '' }] }; }
  function move(index: number) { if (!value || index < 1) return; const steps = [...value.steps]; [steps[index-1], steps[index]] = [steps[index], steps[index-1]]; value = { ...value, steps }; }
</script>
<section class="grid min-w-0 gap-3 rounded-lg border border-[var(--app-border)] p-3" data-testid="bot-workflow-editor">
  <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm font-medium">{m['bots.workflow_title']()}</h3>
    <Button type="button" size="sm" variant="outline" disabled={!value && !targets.length} onclick={() => { value = value ? null : { trigger: '/task', acknowledgment: m['bots.workflow_ack_default'](), steps: [{ nodeId: targets[0]?.id ?? '', instructions: '' }] }; }}>
      {value ? m['bots.workflow_disable']() : m['bots.workflow_enable']()}
    </Button>
  </div>
  <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.workflow_hint']()}</p>
  {#if !targets.length}<p class="text-xs text-[var(--app-text-muted)]">{m['bots.workflow_no_agents']()}</p>{/if}
  {#if value}
    <label class="grid gap-1 text-sm">{m['bots.workflow_trigger']()}<Input bind:value={value.trigger} placeholder="/task" maxlength={40} required /></label>
    <label class="grid gap-1 text-sm">{m['bots.workflow_ack']()}<Textarea bind:value={value.acknowledgment} rows={2} maxlength={500} required /></label>
    <ol class="grid gap-3">
      {#each value.steps as step, index}
        <li class="grid min-w-0 gap-2 rounded-md bg-[var(--app-surface)] p-2">
          <div class="flex min-w-0 items-center gap-2"><span class="shrink-0 text-xs">{index + 1}</span>
            <Select.Root type="single" value={step.nodeId} onValueChange={id => { if (value) value.steps[index].nodeId = id; }}>
              <Select.Trigger class="min-w-0 flex-1" aria-label={m['bots.workflow_agent']({ step: index + 1 })}><span class="truncate">{targets.find(agent => agent.id === step.nodeId)?.title ?? m['bots.workflow_choose_agent']()}</span></Select.Trigger>
              <Select.Content>{#each targets as target}<Select.Item value={target.id}>{target.title}</Select.Item>{/each}</Select.Content>
            </Select.Root>
            <Button type="button" size="icon" variant="ghost" disabled={index === 0} aria-label={m['bots.workflow_move_up']()} onclick={() => move(index)}><ArrowUp size={15} /></Button>
            <Button type="button" size="icon" variant="ghost" disabled={value.steps.length === 1} aria-label={m['bots.workflow_remove_step']()} onclick={() => { if (value) value = { ...value, steps: value.steps.filter((_, i) => i !== index) }; }}><Trash2 size={15} /></Button>
          </div>
          <label class="grid gap-1 text-sm">{m['bots.workflow_step_instructions']({ step: index + 1 })}<Textarea bind:value={step.instructions} rows={3} maxlength={6000} required /></label>
        </li>
      {/each}
    </ol>
    <Button type="button" size="sm" variant="outline" class="justify-self-start" disabled={value.steps.length >= 8 || !targets.length} onclick={add}><Plus size={15} />{m['bots.workflow_add_step']()}</Button>
  {/if}
</section>
