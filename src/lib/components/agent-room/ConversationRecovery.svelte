<script lang="ts">
  import { RotateCcw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Select from '$lib/components/ui/select';
  import type { ComputerReplyGrant } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
  import type { ComputerCommandInput, ComputerCommandResult, ComputerWindow } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  let { grant, windows, command, disabled, media = false }: { grant: ComputerReplyGrant; windows: ComputerWindow[]; disabled: boolean; media?: boolean; command: (input: ComputerCommandInput) => Promise<ComputerCommandResult | null> } = $props();
  let review = $state<Extract<ComputerCommandResult, { kind: 'reply_recovery' | 'media_recovery' }> | null>(null);
  let busy = $state(false);
  let open = $state(false);
  let windowId = $state('');
  const text = m as unknown as Record<string, () => string>;
  const targets = $derived(windows.filter(w => w.appId === grant.applicationId));
  const targetId = $derived(windowId ? targets.find(w => w.id === windowId)?.id ?? '' : targets.length === 1 ? targets[0].id : '');
  const kind = $derived(media ? 'media_recovery' : 'reply_recovery');
  const label = $derived(media ? 'companion.media_recovery' : 'companion.recovery');
  $effect(() => { grant.id; kind; targetId; review = null; open = false; });
  async function inspect() {
    if (!targetId) return;
    const inspectedTarget = targetId;
    const inspectedGrant = grant.id;
    const inspectedKind = kind;
    busy = true;
    try {
      if (media && !await command({ command: 'focus', windowId: inspectedTarget })) return;
      const result = await command({ command: inspectedKind, grantId: inspectedGrant, targetId: inspectedTarget });
      if ((result?.kind === 'reply_recovery' || result?.kind === 'media_recovery') && result.kind === kind && result.grantId === grant.id && result.targetId === targetId) { review = result; open = result.state === 'available'; }
    } finally { busy = false; }
  }
  async function repair() {
    if (!review?.actionId || review.grantId !== grant.id || review.targetId !== targetId || review.kind !== kind) return;
    const inspected = review;
    busy = true;
    try {
      if (media && !await command({ command: 'focus', windowId: inspected.targetId })) return;
      const input = inspected.kind === 'media_recovery'
        ? { command: 'media_recovery' as const, grantId: inspected.grantId, targetId: inspected.targetId, actionId: inspected.actionId!, expectedRequestDigest: inspected.requestDigest! }
        : { command: 'reply_recovery' as const, grantId: inspected.grantId, targetId: inspected.targetId, actionId: inspected.actionId!, expectedDraftHash: inspected.draftHash };
      const result = await command(input);
      if ((result?.kind === 'reply_recovery' || result?.kind === 'media_recovery') && result.kind === kind && result.grantId === grant.id && result.targetId === targetId) { review = result; open = false; }
    } finally { busy = false; }
  }
</script>
<div class="space-y-2 pb-3 text-xs" data-testid={media ? 'media-recovery' : 'conversation-recovery'}>
  {#if targets.length > 1 || (windowId && !targetId)}
    <label class="block min-w-0 space-y-1">
      <span>{m['computer.capture_target']()}</span>
      <Select.Root type="single" value={targetId} onValueChange={(value: string) => { windowId = value; }}>
        <Select.Trigger class="w-full min-w-0" disabled={disabled || busy} aria-label={m['computer.capture_target']()}>
          <span class="truncate">{targets.find(w => w.id === targetId)?.title || targets.find(w => w.id === targetId)?.id || m['computer.choose_target']()}</span>
        </Select.Trigger>
        <Select.Content>{#each targets as target}<Select.Item value={target.id}>{target.title || target.appName} · {target.id}</Select.Item>{/each}</Select.Content>
      </Select.Root>
    </label>
  {/if}
  <Button size="sm" variant="outline" disabled={disabled || busy || !grant.enabled || (media && !grant.media?.enabled) || !targetId} onclick={inspect}><RotateCcw size={13} aria-hidden="true" />{text[label]()}</Button>
  {#if review && review.grantId === grant.id}<p role="status" class="leading-5 text-[var(--app-text-muted)]">{text[`${label}_${review.state}`]()}</p>{/if}
</div>
<AlertDialog.Root bind:open><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{text[label]()}</AlertDialog.Title><AlertDialog.Description>{text[`${label}_confirm`]()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel disabled={busy}>{text['companion.cancel']()}</AlertDialog.Cancel><Button disabled={busy} onclick={repair}>{text[`${label}_resume`]()}</Button></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
