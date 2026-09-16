import type { ComputerReplyGrant } from '../../../contracts/schemas/computer-reply.schema.js';
import type { ComputerAccessibility, ComputerStepInput } from '../../../contracts/schemas/computer.schema.js';

export type ConversationIdentity = Pick<ComputerReplyGrant, 'recipient' | 'composer' | 'send'>;

export function conversationRoot(grant: ConversationIdentity): string {
  const parts = [grant.recipient.id, grant.composer.id, grant.send.id].map(id => id.split('.'));
  let length = 0;
  while (parts.every(path => path[length] !== undefined && path[length] === parts[0][length])) length++;
  const root = parts[0].slice(0, length).join('.');
  if (length < 2 || parts.some(path => path.length <= length)) throw new Error('Choose distinct controls inside one conversation, not the whole window.');
  return root;
}

export function conversationIsOpen(tree: ComputerAccessibility, grant: ConversationIdentity): boolean {
  if (!tree.available || tree.truncated) throw new Error('A complete native conversation is required for automatic replies.');
  const root = conversationRoot(grant);
  const elements = tree.elements.filter(e => e.id.startsWith(root + '.'));
  const header = elements.filter(e => e.role === grant.recipient.role && e.name === grant.recipient.name);
  return header.length === 1 && header[0].id === grant.recipient.id && !header[0].protected && !header[0].actions.includes('fill');
}

export function scopedConversation(tree: ComputerAccessibility, grant: ConversationIdentity): ComputerAccessibility {
  if (!conversationIsOpen(tree, grant)) throw new Error('The approved conversation changed; automatic replies are paused.');
  const root = conversationRoot(grant);
  return { ...tree, elements: tree.elements.filter(e => e.id.startsWith(root + '.')) };
}

export function validateReplyInteraction(input: ComputerStepInput, grant: ComputerReplyGrant, tree: ComputerAccessibility, verifiedPartialDraft?: string): 'draft' | 'send' {
  const scoped = scopedConversation(tree, grant);
  if (input.command !== 'interact') throw new Error('Automatic conversation access requires guarded native controls, not coordinates or keyboard shortcuts.');
  const hasRecipient = input.guards.some(g => g.id === grant.recipient.id && g.role === grant.recipient.role && g.name === grant.recipient.name && (g.value === undefined || g.value === ''));
  const find = (control: ComputerReplyGrant['composer']) => {
    const matches = scoped.elements.filter(e => e.role === control.role && e.name === control.name && e.enabled && !e.protected);
    if (matches.length !== 1) throw new Error('Conversation control is missing or ambiguous.');
    return matches[0];
  };
  const composer = find(grant.composer);
  const selectorMatches = (s: { id: string; role: string; name: string }, e: typeof composer) => s.id === e.id && s.role === e.role && s.name === e.name;
  if (!hasRecipient) throw new Error('The approved recipient guard is required.');
  if (input.action === 'fill') {
    const expected = verifiedPartialDraft ?? '';
    if (!selectorMatches(input.element, composer) || input.element.value !== expected || composer.value !== expected || !input.text?.trim() || !input.text.startsWith(expected) || input.text.length > grant.maxCharacters || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.text)) throw new Error('Automatic replies require an empty composer and bounded plain text. Existing drafts are preserved.');
    return 'draft';
  }
  const send = find(grant.send);
  if (!selectorMatches(input.element, send) || !composer.value.trim() || composer.value.length > grant.maxCharacters || !input.guards.some(g => selectorMatches(g, composer) && g.value === composer.value)) throw new Error('Automatic sending requires the approved Send control and the complete current draft guard.');
  return 'send';
}

export function incomingConversation(tree: ComputerAccessibility, grant: ComputerReplyGrant): ComputerAccessibility {
  const scoped = scopedConversation(tree, grant);
  const incoming = (label: string) => {
    if (label.startsWith(grant.incomingMarker)) return true;
    if (grant.media?.enabled && grant.media.receive?.enabled && grant.media.receive.incomingMarkers.some(marker => label.startsWith(marker))) return true;
    // WhatsApp AX prepends reply metadata before the actual incoming message.
    // Only strip the observed native prefix, never search an outgoing/quoted body.
    if (grant.applicationId !== 'net.whatsapp.WhatsApp') return false;
    const prefix = label.match(/^\u200eReplying to [^\n]{1,2000}\.\n/);
    return Boolean(prefix && label.slice(prefix[0].length).startsWith(grant.incomingMarker));
  };
  // Ignore receipts, our replies, the composer, and other conversations.
  return { ...scoped, elements: scoped.elements.filter(e => !e.protected && !e.actions.includes('fill') && e.id !== grant.recipient.id && incoming(e.name || e.value)) };
}

export function incomingDigest(element: ComputerAccessibility['elements'][number]): string {
  // Native indices move as new messages arrive; content and its exposed timestamp do not.
  return createHash('sha256').update(JSON.stringify({ role: element.role, name: element.name, value: element.value })).digest('hex');
}

export function replyControl(tree: ComputerAccessibility, grant: ComputerReplyGrant, kind: 'composer' | 'send') {
  const expected = grant[kind];
  const matches = scopedConversation(tree, grant).elements.filter(e => e.role === expected.role && e.name === expected.name && e.enabled && !e.protected);
  if (matches.length !== 1) throw new Error('Conversation control is missing or ambiguous.');
  const { id, role, name, value } = matches[0];
  return { id, role, name, value };
}

export function replyMessage(tree: ComputerAccessibility, grant: ComputerReplyGrant, digest: string, queued = false) {
  const incoming = incomingConversation(tree, grant).elements;
  const matches = incoming.filter(e => incomingDigest(e) === digest);
  if (matches.length !== 1 || !queued && incomingDigest(incoming[incoming.length - 1]) !== digest) throw new Error('The incoming message is stale, missing or ambiguous. Read the current conversation before replying.');
  const { id, role, name, value } = matches[0];
  return { id, role, name, value };
}
import { createHash } from 'node:crypto';
