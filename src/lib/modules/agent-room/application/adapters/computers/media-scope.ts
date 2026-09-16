import type { ComputerAccessibility } from '../../../contracts/schemas/computer.schema.js';
import type { ComputerReplyGrant } from '../../../contracts/schemas/computer-reply.schema.js';
import { incomingConversation, incomingDigest, replyControl, scopedConversation } from './reply-scope.js';
import type { ComputerFileSelection } from './types.js';

export function verifiedPhotoSelection(selection: ComputerFileSelection['selectedFile'], expected: { path: string; targetId: string; applicationId: string }) {
  return selection !== undefined && selection.path === expected.path && selection.targetId === expected.targetId && selection.applicationId === expected.applicationId;
}

export function mediaRoute(grant: ComputerReplyGrant, contentType: string, requested: 'auto' | 'photo' | 'document' = 'auto') {
  if (!grant.media?.enabled) throw new Error('Native media is not authorized.');
  const presentation = requested === 'auto' ? contentType.startsWith('image/') ? 'photo' : 'document' : requested;
  if (presentation === 'document') return { grant, presentation };
  if (!contentType.startsWith('image/')) throw new Error('Photo delivery requires an image.');
  if (!grant.media.photo) throw new Error('Photo delivery requires owner-approved photo picker controls. It will not silently use Document.');
  return { grant: { ...grant, media: { ...grant.media, ...grant.media.photo, menu: grant.media.photo.menu } }, presentation };
}

export function incomingAttachment(tree: ComputerAccessibility, grant: ComputerReplyGrant, digest: string, downloadId: string) {
  const approved = grant.media?.receive;
  if (!grant.media?.enabled || !approved?.enabled) throw new Error('Receiving native media needs owner authorization.');
  const scope = scopedConversation(tree, grant);
  const messages = incomingConversation(tree, grant).elements;
  const matches = messages.filter(e => incomingDigest(e) === digest);
  if (matches.length !== 1) throw new Error('The incoming attachment message is missing or ambiguous.');
  const message = matches[0];
  const download = scope.elements.find(e => e.id === downloadId && e.role === approved.download.role && e.name === approved.download.name && !e.protected && e.enabled && e.actions.includes('press'));
  if (!download) throw new Error('The authorized Download control is missing.');
  const a = message.id.split('.'), b = download.id.split('.');
  let length = 0;
  while (a[length] !== undefined && a[length] === b[length]) length++;
  const parent = a.slice(0, length).join('.');
  const inside = (id: string) => id === parent || id.startsWith(parent + '.');
  // The owner header/composer must never be in the inferred message container.
  if (length < 3 || a.length - length > 1 || b.length - length > 1 || inside(grant.recipient.id) || inside(grant.composer.id) || messages.filter(e => inside(e.id)).length !== 1) throw new Error('Download does not belong uniquely to the incoming message.');
  const select = (e: typeof message) => ({ id: e.id, role: e.role, name: e.name, value: e.value });
  return { download: select(download), message: select(message) };
}

export function mediaControl(tree: ComputerAccessibility, grant: ComputerReplyGrant, kind: 'open' | 'send') {
  const expected = grant.media?.[kind];
  if (!grant.media?.enabled || !expected) throw new Error('Native attachment controls need owner authorization.');
  const matches = scopedConversation(tree, grant).elements.filter(e => e.role === expected.role && e.name === expected.name && !e.protected && e.enabled && e.actions.includes('press'));
  if (matches.length !== 1) throw new Error('The authorized attachment control is missing or ambiguous.');
  const { id, role, name, value } = matches[0];
  return { id, role, name, value };
}

export function attachmentPreview(tree: ComputerAccessibility, grant: ComputerReplyGrant, filename: string, selectedPhoto = false) {
  if (!tree.available || tree.truncated || !grant.media?.enabled) throw new Error('A complete authorized attachment preview is required.');
  if (!tree.elements.some(e => e.id === grant.recipient.id && e.role === grant.recipient.role && e.name === grant.recipient.name)) {
    // Standalone native previews replace the chat, not just its composer. Bind
    // the exact recipient and filename inside Send's own container; never use
    // a contact/sidebar match elsewhere in the application window.
    const buttons = tree.elements.filter(e => e.role === grant.media!.send.role && e.name === grant.media!.send.name && !e.protected && e.enabled && e.actions.includes('press'));
    if (buttons.length !== 1) throw new Error('The authorized attachment control is missing or ambiguous.');
    const send = buttons[0], parts = send.id.split('.');
    const parent = parts.slice(0, -1).join('.');
    if (parts.length < 4) throw new Error('Attachment preview must not span the whole window.');
    const scope = tree.elements.filter(e => e.id.startsWith(parent + '.'));
    const recipients = scope.filter(e => e.role === grant.recipient.role && e.name === grant.recipient.name && !e.protected && !e.actions.includes('fill') && e.id.split('.').length <= parts.length + 1);
    const files = scope.filter(e => e.id.split('.').length === parts.length && e.role === 'AXStaticText' && !e.protected && !e.actions.includes('fill') && (e.name === filename || e.value === filename));
    const composers = scope.filter(e => e.id.split('.').length === parts.length && !e.protected && e.enabled && e.actions.includes('fill') && /^(AXTextArea|AXTextField)$/.test(e.role));
    const selector = (e: typeof send) => ({ id: e.id, role: e.role, name: e.name, value: e.value });
    if (recipients.length !== 1 || composers.length !== 1 || composers[0].value !== '') throw new Error('The attachment preview recipient, file or empty caption is missing or ambiguous. Nothing was sent.');
    if (files.length === 1) return { send: selector(send), file: selector(files[0]), recipient: selector(recipients[0]), composer: selector(composers[0]), additionalGuards: [] };
    // WhatsApp's native photo preview omits the filename. Only a receipt from
    // this operation's verified file picker can bind that preview to our bytes.
    // Keep the exact recipient, empty caption, single photo and item count as
    // live AX guards; never infer a photo from a sidebar or a cached screenshot.
    const direct = scope.filter(e => e.id.split('.').length === parts.length && e.enabled && !e.protected && !e.actions.includes('fill'));
    const photos = direct.filter(e => e.role === 'AXGenericElement' && e.name === '\u200ePhoto');
    const counts = direct.filter(e => e.role === 'AXGenericElement' && e.name === '\u200e1 media item.');
    const otherFileLabel = direct.some(e => e.role === 'AXStaticText' && (e.name || e.value));
    if (selectedPhoto && grant.applicationId === 'net.whatsapp.WhatsApp' && files.length === 0 && !otherFileLabel && photos.length === 1 && counts.length === 1) {
      return { send: selector(send), file: selector(photos[0]), recipient: selector(recipients[0]), composer: selector(composers[0]), additionalGuards: [selector(counts[0])] };
    }
    throw new Error('The attachment preview file identity is missing or ambiguous. Nothing was sent.');
  }
  const scoped = scopedConversation(tree, grant);
  const send = mediaControl(tree, grant, 'send');
  const parent = send.id.split('.').slice(0, -1).join('.');
  // A filename in chat history is not evidence for the current attachment preview.
  const files = scoped.elements.filter(e => e.id.startsWith(parent + '.') && !e.protected && !e.actions.includes('fill') && (e.name === filename || e.value === filename));
  if (files.length !== 1) throw new Error('The attachment preview does not uniquely identify the staged file beside Send. Nothing was sent.');
  const { id, role, name, value } = files[0];
  return { send, file: { id, role, name, value }, recipient: grant.recipient, composer: replyControl(tree, grant, 'composer'), additionalGuards: [] };
}
