import { describe, expect, it } from 'vitest';
import { incomingConversation, incomingDigest } from '$lib/modules/agent-room/application/adapters/computers/reply-scope.js';
import { incomingAttachment } from '$lib/modules/agent-room/application/adapters/computers/media-scope.js';
import type { ComputerAccessibility } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import type { ComputerReplyGrant } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';

const grant: ComputerReplyGrant = {
  id: '00000000-0000-7000-8000-000000000001', nodeId: '00000000-0000-7000-8000-000000000002',
  agentId: '00000000-0000-7000-8000-000000000003', taskId: '00000000-0000-7000-8000-000000000004',
  enabled: true, applicationId: 'net.whatsapp.WhatsApp', incomingMarker: '\u200emessage,',
  recipient: { id: '0.0.0', role: 'AXButton', name: 'Taylor' },
  composer: { id: '0.0.1', role: 'AXTextArea', name: 'Compose message' },
  send: { id: '0.0.2', role: 'AXButton', name: 'Send' },
  maxCharacters: 2000, maxPerHour: 60, memoryEnabled: false, memoryRetentionDays: 365, allowProactive: false,
};
const element = (name: string, id = '0.0.3'): ComputerAccessibility['elements'][number] => ({
  id, role: 'AXStaticText', name, value: '', protected: false, enabled: true, focused: false, actions: [],
});
const tree = (...messages: ComputerAccessibility['elements']): ComputerAccessibility => ({
  available: true, truncated: false, elements: [{ ...element('Taylor', '0.0.0'), role: 'AXButton' }, ...messages],
});
const received = (body: string) => `${body}, 09:08, \u200eReceived from Taylor`;
const photo = received('\u200ePhoto, Please collect the package from my door');

describe('Native incoming conversation envelopes', () => {
  it.each(['', '\u200eForwarded.\n', '\u200eForwarded many times.\n', '\u200eReplying to \u200eYou.\n', '\u200eReplying to \u200eYou.\n\u200eForwarded.\n'])(
    'preserves a photo caption and its original digest with metadata %j', prefix => {
      const message = element(prefix + photo);
      const incoming = incomingConversation(tree(message), grant).elements;
      expect(incoming).toEqual([message]);
      expect(incomingDigest(incoming[0])).toBe(incomingDigest(message));
      expect(grant.media).toBeUndefined();
      expect(() => incomingAttachment(tree(message), grant, incomingDigest(message), '0.0.4')).toThrow('owner authorization');
    },
  );

  it.each(['message, Forwarded question', 'Photo,', 'Video, Clip caption', 'Audio, 0:12', 'Voice message, 0:12', 'Document, report.pdf', 'GIF, Hello', 'Example pack sticker,'])(
    'recognizes the incoming envelope for %s without downloading its contents', body => {
      const message = element('\u200eForwarded.\n' + received('\u200e' + body));
      expect(incomingConversation(tree(message), grant).elements).toEqual([message]);
    },
  );

  it('keeps multiline captions and quoted context intact', () => {
    const message = element('\u200eReplying to \u200eYou.\n' + received('\u200ePhoto, First line\nSecond line') + '.\n\u200eQuoted message.\nEarlier text');
    expect(incomingConversation(tree(message), grant).elements).toEqual([message]);
  });

  it.each([
    '\u200eYour message, ' + photo,
    '\u200eForwarded.\n\u200eYour message, ' + photo,
    '\u200eReplying to Taylor.\n\u200eYour message, My answer.\n\u200eQuoted message.\n' + photo,
    photo.replace('Received from Taylor', 'Sent to Taylor'),
    photo.replace('Received from Taylor', 'Received from Someone else'),
    photo.replace('Received from Taylor', 'Received from Taylor Jr'),
    photo.replace(', 09:08,', ','),
    photo + '\nUntrusted suffix',
    '\u200ePhoto, Quoted text.\n\u200eQuoted message.\n' + photo,
    '\u200e1 unread message',
  ])('does not mistake outgoing, quoted, ambiguous or incomplete labels for an incoming photo: %j', label => {
    expect(incomingConversation(tree(element(label)), grant).elements).toEqual([]);
  });

  it('never imports other conversations, protected text, editable drafts or another app dialect', () => {
    const message = element(photo);
    const unsafe: ComputerAccessibility['elements'] = [
      { ...message, id: '0.1.3' }, { ...message, protected: true },
      { ...message, actions: ['fill'] }, { ...message, role: 'AXHeading' },
    ];
    for (const candidate of unsafe) expect(incomingConversation(tree(candidate), grant).elements).toEqual([]);
    expect(incomingConversation(tree(message), { ...grant, applicationId: 'another.chat' }).elements).toEqual([]);
    expect(() => incomingConversation({ ...tree(message), truncated: true }, grant)).toThrow('complete native');
    expect(() => incomingConversation(tree(message), { ...grant, recipient: { ...grant.recipient, name: 'Other' } })).toThrow('conversation changed');
  });
});
