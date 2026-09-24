<script lang="ts">
  import { toast } from '@beeblock/svelar/ui';
  import {
    AtSign,
    Check,
    CheckCircle2,
    CircleDot,
    GitBranch,
    MessageCircle,
    Plus,
    Scale,
    Send,
    UserRound,
    UsersRound,
    X,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import type {
    DesignCollaborator,
    DesignDocument,
    DesignElement,
    DesignOperation,
    DesignProposal,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import type { DesignCollaborationSnapshot } from '$lib/modules/agent-room/application/services/DesignCollaborationService.js';
  import * as m from '$lib/paraglide/messages.js';
  import NodeEmptyState from '$lib/components/agent-room/canvas/NodeEmptyState.svelte';

  let {
    document,
    selected,
    participant,
    collaboration,
    followParticipantId,
    saving,
    makeId,
    onApply,
    onFollow,
    onPreview,
    onOpenCouncil,
    onCreateFloor,
  }: {
    document: DesignDocument;
    selected: DesignElement | null;
    participant: DesignCollaborator;
    collaboration: DesignCollaborationSnapshot | null;
    followParticipantId: string | null;
    saving: boolean;
    makeId: () => string;
    onApply: (operations: DesignOperation[], summary: string) => Promise<boolean>;
    onFollow: (participantId: string | null) => void;
    onPreview: (elementId: string | null, changes: Partial<DesignElement> | null) => void;
    onOpenCouncil: (proposal: DesignProposal) => void;
    onCreateFloor: (proposal: DesignProposal) => Promise<void>;
  } = $props();

  let commentBody = $state('');
  let replies = $state<Record<string, string>>({});
  let proposalOpen = $state(false);
  let proposalTitle = $state('');
  let proposalDescription = $state('');
  let proposalX = $state(0);
  let proposalY = $state(0);
  let proposalWidth = $state(1);
  let proposalHeight = $state(1);
  let proposalOpacity = $state(100);
  let proposalFill = $state('#ffffff');

  const pageComments = $derived(document.comments
    .filter((comment) => comment.pageId === document.activePageId)
    .sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || b.updatedAt.localeCompare(a.updatedAt)));
  const pendingProposals = $derived(document.proposals.filter((proposal) => proposal.status === 'pending'));
  const otherPresences = $derived((collaboration?.presences ?? []).filter((presence) => presence.participant.id !== participant.id));
  const ownLease = $derived(collaboration?.leases.find((lease) => lease.participantId === participant.id) ?? null);

  function mentionedIds(body: string): string[] {
    return (collaboration?.presences ?? [])
      .filter((presence) => body.toLocaleLowerCase().includes(`@${presence.participant.name}`.toLocaleLowerCase()))
      .map((presence) => presence.participant.id);
  }

  function mention(name: string, target: 'comment' | string): void {
    if (target === 'comment') commentBody = `${commentBody}${commentBody && !commentBody.endsWith(' ') ? ' ' : ''}@${name} `;
    else replies = { ...replies, [target]: `${replies[target] ?? ''}${replies[target] && !replies[target].endsWith(' ') ? ' ' : ''}@${name} ` };
  }

  async function addComment(): Promise<void> {
    const body = commentBody.trim();
    if (!body) return;
    const now = new Date().toISOString();
    const ok = await onApply([{
      kind: 'add-design-comment',
      comment: {
        id: makeId(),
        pageId: document.activePageId,
        elementId: selected?.id ?? null,
        x: selected ? selected.x + selected.width / 2 : null,
        y: selected ? selected.y + selected.height / 2 : null,
        status: 'open',
        messages: [{ id: makeId(), author: participant, body, mentions: mentionedIds(body), createdAt: now }],
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        resolvedBy: null,
      },
    }], m['design.comment_add']());
    if (ok) commentBody = '';
  }

  async function reply(commentId: string): Promise<void> {
    const body = (replies[commentId] ?? '').trim();
    if (!body) return;
    const ok = await onApply([{
      kind: 'add-design-comment-message',
      commentId,
      message: { id: makeId(), author: participant, body, mentions: mentionedIds(body), createdAt: new Date().toISOString() },
    }], m['design.comment_reply']());
    if (ok) replies = { ...replies, [commentId]: '' };
  }

  async function setCommentStatus(commentId: string, status: 'open' | 'resolved'): Promise<void> {
    await onApply([{ kind: 'set-design-comment-status', commentId, status, actor: participant }], status === 'resolved' ? m['design.comment_resolve']() : m['design.comment_reopen']());
  }

  function solidFill(element: DesignElement): string {
    const fill = element.fills.find((paint) => paint.type === 'solid');
    return fill?.type === 'solid' ? fill.color : /^#[0-9a-f]{6}$/i.test(element.fill) ? element.fill : '#ffffff';
  }

  function startProposal(): void {
    if (!selected) {
      toast.info(m['design.proposal_layer_required']());
      return;
    }
    proposalOpen = true;
    proposalTitle = '';
    proposalDescription = '';
    proposalX = selected.x;
    proposalY = selected.y;
    proposalWidth = selected.width;
    proposalHeight = selected.height;
    proposalOpacity = Math.round(selected.opacity * 100);
    proposalFill = solidFill(selected);
    updatePreview();
  }

  function proposalChanges(): Partial<DesignElement> {
    return {
      x: proposalX,
      y: proposalY,
      width: Math.max(1, proposalWidth),
      height: Math.max(1, proposalHeight),
      opacity: Math.max(0, Math.min(1, proposalOpacity / 100)),
      fills: [{ type: 'solid', color: proposalFill, opacity: 1, visible: true }],
      fill: 'transparent',
    };
  }

  function updatePreview(): void {
    if (proposalOpen && selected) onPreview(selected.id, proposalChanges());
  }

  function cancelProposal(): void {
    proposalOpen = false;
    onPreview(null, null);
  }

  async function submitProposal(): Promise<void> {
    if (!selected || !proposalTitle.trim()) return;
    const now = new Date().toISOString();
    const proposed: DesignOperation = { kind: 'update', elementId: selected.id, changes: proposalChanges() };
    const ok = await onApply([{
      kind: 'add-design-proposal',
      proposal: {
        id: makeId(),
        title: proposalTitle.trim(),
        description: proposalDescription.trim(),
        author: participant,
        baseRevision: document.revision,
        operations: [proposed],
        status: 'pending',
        floorId: null,
        councilId: null,
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
        decidedBy: null,
        decisionNote: null,
      },
    }], m['design.proposal_submit']());
    if (ok) cancelProposal();
  }

  async function decideProposal(proposalId: string, status: 'approved' | 'rejected'): Promise<void> {
    await onApply([{
      kind: 'decide-design-proposal',
      proposalId,
      status,
      actor: participant,
      note: null,
    }], status === 'approved' ? m['design.proposal_approve']() : m['design.proposal_reject']());
  }

  function proposalStatus(status: DesignProposal['status']): string {
    if (status === 'approved') return m['design.proposal_approved']();
    if (status === 'rejected') return m['design.proposal_rejected']();
    return m['design.proposal_pending']();
  }

  function operationLabel(operation: Record<string, unknown>): string {
    const kind = String(operation.kind ?? 'change');
    if (kind === 'create') return m['design.proposal_operation_create']();
    const elementId = typeof operation.elementId === 'string' ? operation.elementId : null;
    const name = elementId ? document.elements.find((element) => element.id === elementId)?.name ?? elementId.slice(0, 8) : '';
    if (kind === 'update') return m['design.proposal_operation_update']({ name });
    if (kind === 'delete') return m['design.proposal_operation_delete']({ name });
    return m['design.proposal_operation_other']({ kind });
  }
</script>

{#snippet sectionHeader(Icon: typeof UsersRound, title: string, meta: string)}
  <div class="mb-2.5 flex items-center gap-2"><Icon size={15} class="shrink-0 text-[var(--app-text-soft)]" /><h3 class="text-ui-lg font-semibold">{title}</h3><span class="ml-auto shrink-0 text-ui-xs tabular-nums text-[var(--app-text-muted)]">{meta}</span></div>
{/snippet}

<div class="h-full overflow-y-auto text-ui-sm" data-testid="design-collaboration-panel">
  <section class="border-b border-[var(--app-border)] p-4">
    {@render sectionHeader(UsersRound, m['design.collaboration_people'](), m['design.collaboration_live']({ count: String((collaboration?.presences.length ?? 1)) }))}
    <div class="space-y-1">
      <div class="flex min-h-9 items-center gap-2.5 rounded-lg bg-[var(--app-hover)] px-2.5">
        <span class="size-2.5 shrink-0 rounded-full shadow-[0_0_0_2px_var(--app-surface)]" style:background={participant.color}></span>
        <span class="min-w-0 flex-1 truncate text-ui-md font-medium">{participant.name}</span>
        <span class="text-ui-xs text-[var(--app-text-muted)]">{m['design.collaboration_you']()}</span>
        {#if ownLease}<CircleDot size={12} class="text-[var(--app-success)]" aria-label={m['design.collaboration_protected']()} />{/if}
      </div>
      {#each otherPresences as presence (presence.participant.id)}
        <button type="button" class={`flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-150 hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] ${followParticipantId === presence.participant.id ? 'bg-[var(--app-active)]' : ''}`} aria-pressed={followParticipantId === presence.participant.id} onclick={() => onFollow(followParticipantId === presence.participant.id ? null : presence.participant.id)}>
          <span class="size-2.5 shrink-0 rounded-full" style:background={presence.participant.color}></span>
          <span class="min-w-0 flex-1 truncate text-ui-md font-medium">{presence.participant.name}</span>
          <span class="text-ui-xs text-[var(--app-text-muted)]">{followParticipantId === presence.participant.id ? m['design.collaboration_stop_following']() : m['design.collaboration_follow']()}</span>
        </button>
      {/each}
    </div>
    {#if collaboration?.leaseConflict}
      <p class="mt-2 flex items-center gap-1.5 rounded-lg bg-[var(--app-warning-soft)] px-2.5 py-2 text-ui-sm"><CircleDot size={12} class="shrink-0 text-[var(--app-warning)]" />{m['design.collaboration_editing_by']({ name: collaboration.leaseConflict.participantName })}</p>
    {:else if ownLease}
      <p class="mt-2 text-ui-xs text-[var(--app-text-muted)]">{m['design.collaboration_protected']()}</p>
    {/if}
    {#if followParticipantId}
      {@const followed = otherPresences.find((presence) => presence.participant.id === followParticipantId)}
      {#if followed}<Button class="mt-2 w-full" variant="outline" size="sm" onclick={() => onFollow(null)}><UserRound size={13} />{m['design.collaboration_following']({ name: followed.participant.name })}<X size={13} /></Button>{/if}
    {/if}
  </section>

  <section class="border-b border-[var(--app-border)] p-4">
    {@render sectionHeader(MessageCircle, m['design.comments'](), m['design.comments_open_count']({ count: String(pageComments.filter((comment) => comment.status === 'open').length) }))}
    <div class="space-y-2 rounded-xl bg-[var(--app-surface-raised)] p-2.5 shadow-[var(--app-shadow-border)]">
      <p class="truncate text-ui-xs text-[var(--app-text-muted)]">{selected ? m['design.comment_layer']({ name: selected.name }) : m['design.comment_page']()}</p>
      <Textarea class="min-h-20 resize-y text-ui-md md:text-ui-md" bind:value={commentBody} placeholder={m['design.comment_placeholder']()} aria-label={m['design.comment_placeholder']()} />
      {#if otherPresences.length}<div class="flex flex-wrap items-center gap-1"><span class="mr-1 flex items-center gap-1 text-ui-xs text-[var(--app-text-muted)]"><AtSign size={12} />{m['design.comment_mentions']()}</span>{#each otherPresences.slice(0, 5) as presence}<button type="button" class="rounded-full bg-[var(--app-hover)] px-2 py-0.5 text-ui-xs text-[var(--app-text-soft)] transition-colors duration-150 hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]" onclick={() => mention(presence.participant.name, 'comment')}>{presence.participant.name}</button>{/each}</div>{/if}
      <div class="flex justify-end"><Button size="sm" disabled={saving || !commentBody.trim()} onclick={addComment}><Send size={13} />{m['design.comment_add']()}</Button></div>
    </div>
    <div class="mt-4 space-y-3">
      {#each pageComments as comment (comment.id)}
        <article class={`border-l-2 pl-3 transition-opacity duration-150 ${comment.status === 'resolved' ? 'border-[var(--app-success)] opacity-70' : 'border-[var(--app-border-strong)]'}`}>
          <div class="mb-1 flex items-center gap-2"><span class="min-w-0 truncate text-ui-xs text-[var(--app-text-muted)]">{comment.elementId ? m['design.comment_layer']({ name: document.elements.find((element) => element.id === comment.elementId)?.name ?? '—' }) : m['design.comment_page']()}</span>{#if comment.status === 'resolved'}<span class="ml-auto shrink-0 rounded-full bg-[var(--app-success-soft)] px-2 py-0.5 text-ui-xs text-[var(--app-success)]">{m['design.comment_resolved']()}</span>{/if}</div>
          <div class="space-y-2">{#each comment.messages as message (message.id)}<div><div class="flex items-center gap-1.5 text-ui-sm"><span class="size-2 shrink-0 rounded-full" style:background={message.author.color}></span><strong class="font-semibold">{message.author.name}</strong></div><p class="mt-1 whitespace-pre-wrap break-words text-ui-md leading-5 text-[var(--app-text-soft)]">{message.body}</p></div>{/each}</div>
          <div class="mt-2 flex gap-1"><Input class="h-7 min-w-0 text-ui-md md:text-ui-md" value={replies[comment.id] ?? ''} placeholder={m['design.comment_reply_placeholder']()} aria-label={m['design.comment_reply_placeholder']()} oninput={(event: Event) => replies = { ...replies, [comment.id]: (event.currentTarget as HTMLInputElement).value }} /><Button size="icon-sm" variant="ghost" class="size-7 text-[var(--app-text-soft)] hover:text-[var(--app-text)]" aria-label={m['design.comment_reply']()} title={m['design.comment_reply']()} disabled={saving || !(replies[comment.id] ?? '').trim()} onclick={() => reply(comment.id)}><Send size={13} /></Button></div>
          <Button class="mt-1 h-7 px-1.5 text-ui-sm text-[var(--app-text-soft)]" variant="ghost" onclick={() => setCommentStatus(comment.id, comment.status === 'open' ? 'resolved' : 'open')}>{#if comment.status === 'open'}<CheckCircle2 size={13} />{m['design.comment_resolve']()}{:else}<CircleDot size={13} />{m['design.comment_reopen']()}{/if}</Button>
        </article>
      {:else}<NodeEmptyState compact icon={MessageCircle} title={m['design.comments_empty']()} />{/each}
    </div>
  </section>

  <section class="p-4">
    {@render sectionHeader(Scale, m['design.proposals'](), m['design.proposals_pending_count']({ count: String(pendingProposals.length) }))}
    {#if !proposalOpen}<Button class="mb-3 w-full" variant="outline" size="sm" disabled={!selected} onclick={startProposal}><Plus size={13} />{m['design.proposal_new']()}</Button>
    {:else}
      <div class="mb-3 space-y-2 rounded-xl bg-[var(--app-surface-raised)] p-2.5 shadow-[var(--app-shadow-border)]">
        <Input class="h-7 text-ui-md md:text-ui-md" bind:value={proposalTitle} maxlength={180} placeholder={m['design.proposal_title_placeholder']()} aria-label={m['design.proposal_title_placeholder']()} />
        <Textarea class="min-h-16 resize-y text-ui-md md:text-ui-md" bind:value={proposalDescription} maxlength={4000} placeholder={m['design.proposal_description_placeholder']()} aria-label={m['design.proposal_description_placeholder']()} />
        <div class="grid grid-cols-2 gap-x-1.5 gap-y-2"><label class="space-y-1"><span class="block text-ui-xs text-[var(--app-text-muted)]">X</span><Input class="h-7 text-ui-md tabular-nums md:text-ui-md" type="number" bind:value={proposalX} oninput={updatePreview} /></label><label class="space-y-1"><span class="block text-ui-xs text-[var(--app-text-muted)]">Y</span><Input class="h-7 text-ui-md tabular-nums md:text-ui-md" type="number" bind:value={proposalY} oninput={updatePreview} /></label><label class="space-y-1"><span class="block text-ui-xs text-[var(--app-text-muted)]">W</span><Input class="h-7 text-ui-md tabular-nums md:text-ui-md" type="number" min="1" bind:value={proposalWidth} oninput={updatePreview} /></label><label class="space-y-1"><span class="block text-ui-xs text-[var(--app-text-muted)]">H</span><Input class="h-7 text-ui-md tabular-nums md:text-ui-md" type="number" min="1" bind:value={proposalHeight} oninput={updatePreview} /></label><label class="space-y-1"><span class="block text-ui-xs text-[var(--app-text-muted)]">{m['design.proposal_opacity']()}</span><Input class="h-7 text-ui-md tabular-nums md:text-ui-md" type="number" min="0" max="100" bind:value={proposalOpacity} oninput={updatePreview} /></label><label class="space-y-1"><span class="block text-ui-xs text-[var(--app-text-muted)]">{m['design.proposal_fill']()}</span><Input class="h-7 cursor-pointer p-0.5" type="color" bind:value={proposalFill} oninput={updatePreview} /></label></div>
        <div class="grid grid-cols-2 gap-1.5"><Button variant="outline" size="sm" onclick={cancelProposal}><X size={13} />{m['design.proposal_cancel']()}</Button><Button size="sm" disabled={!proposalTitle.trim() || saving} onclick={submitProposal}><Send size={13} />{m['design.proposal_submit']()}</Button></div>
      </div>
    {/if}
    <div class="space-y-2">
      {#each document.proposals.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) as proposal (proposal.id)}
        <article class="rounded-xl bg-[var(--app-surface-raised)] p-3 shadow-[var(--app-shadow-border)]">
          <div class="flex items-start gap-2"><span class="mt-1.5 size-2 shrink-0 rounded-full" style:background={proposal.author.color}></span><div class="min-w-0 flex-1"><h4 class="truncate text-ui-md font-semibold">{proposal.title}</h4><p class="text-ui-xs text-[var(--app-text-muted)]">{proposal.author.name}</p></div><span class={`shrink-0 rounded-full px-2 py-0.5 text-ui-xs font-medium ${proposal.status === 'approved' ? 'bg-[var(--app-success-soft)] text-[var(--app-success)]' : proposal.status === 'rejected' ? 'bg-[var(--app-danger-soft)] text-[var(--app-danger)]' : 'bg-[var(--app-hover)] text-[var(--app-text-soft)]'}`}>{proposalStatus(proposal.status)}</span></div>
          {#if proposal.description}<p class="mt-2 whitespace-pre-wrap text-ui-sm leading-5 text-[var(--app-text-soft)]">{proposal.description}</p>{/if}
          <div class="mt-2 space-y-1 rounded-lg bg-[var(--app-hover)] p-2">{#each proposal.operations as operation}<p class="flex items-center gap-1.5 text-ui-sm text-[var(--app-text-soft)]"><CircleDot size={11} class="shrink-0 text-[var(--app-text-muted)]" />{operationLabel(operation)}</p>{/each}</div>
          {#if proposal.floorId}<p class="mt-2 flex items-center gap-1 text-ui-xs text-[var(--app-text-muted)]"><GitBranch size={12} /><span class="font-mono">{proposal.floorId.slice(0, 8)}</span></p>{/if}
          {#if proposal.status === 'pending'}
            <div class="mt-2.5 grid grid-cols-2 gap-1.5"><Button size="sm" onclick={() => decideProposal(proposal.id, 'approved')}><Check size={13} />{m['design.proposal_approve']()}</Button><Button variant="outline" size="sm" onclick={() => decideProposal(proposal.id, 'rejected')}><X size={13} />{m['design.proposal_reject']()}</Button></div>
            <div class="mt-1.5 grid grid-cols-2 gap-1.5"><Button variant="ghost" size="sm" class="min-w-0 px-1 text-ui-sm" onclick={() => onOpenCouncil(proposal)}><Scale size={13} /><span class="truncate">{m['design.proposal_open_council']()}</span></Button><Button variant="ghost" size="sm" class="min-w-0 px-1 text-ui-sm" disabled={Boolean(proposal.floorId)} onclick={() => onCreateFloor(proposal)}><GitBranch size={13} /><span class="truncate">{m['design.proposal_parallel_floor']()}</span></Button></div>
          {/if}
        </article>
      {:else}<NodeEmptyState compact icon={Scale} title={m['design.proposals_empty']()} />{/each}
    </div>
  </section>
</div>
