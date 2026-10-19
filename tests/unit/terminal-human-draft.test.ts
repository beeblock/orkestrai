import { describe, expect, it } from 'vitest';
import { trackHumanDraft, type HumanDraft } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { isConversationalPrompt } from '$lib/modules/agent-room/application/services/TerminalMirrorService.js';

describe('owner lines typed into an agent terminal', () => {
  it('returns each submitted line across chunks, applying edits', () => {
    const draft: HumanDraft = { text: '', paste: false };
    expect(trackHumanDraft(draft, 'Tem dois agentes')).toEqual([]);
    expect(trackHumanDraft(draft, ' bloqueadoz\x7fs?\r')).toEqual(['Tem dois agentes bloqueados?']);
    expect(trackHumanDraft(draft, 'apaga isso\x15de novo\r')).toEqual(['de novo']);
    expect(draft.text).toBe('');
  });

  it('keeps pasted line breaks and ignores arrows, focus and mouse reports', () => {
    const draft: HumanDraft = { text: '', paste: false };
    expect(trackHumanDraft(draft, '\x1b[200~linha 1\rlinha 2\x1b[201~')).toEqual([]);
    expect(trackHumanDraft(draft, '\x1b[A\x1b[I\x1b[<64;10;5M fim\r')).toEqual(['linha 1\nlinha 2 fim']);
    expect(trackHumanDraft(draft, 'um\x1b\rdois\r')).toEqual(['um\ndois']);
  });

  it('treats menu answers and slash commands as terminal controls', () => {
    expect(isConversationalPrompt('Por que ainda estão bloqueados?')).toBe(true);
    for (const control of ['1', '2', 'y', 'n', 'sim', 'não', '/model', '  ']) expect(isConversationalPrompt(control)).toBe(false);
  });
});

describe('a page loaded while messages arrive live', async () => {
  const { mergeLoaded } = await import('$lib/components/agent-room/chat/chat-timeline.js');
  const message = (id: string, createdAt: string) => ({ id, workspaceId: 'w', channel: 'dm:a', authorKind: 'owner', authorNodeId: null, kind: 'text', body: id, meta: {}, replyToId: null, answeredAt: null, createdAt }) as never;
  it('keeps a message that arrived between the request and the response', () => {
    const loaded = [message('a', '2026-10-19T19:00:00.000Z'), message('b', '2026-10-19T19:00:05.000Z')];
    const merged = mergeLoaded(loaded, [message('c', '2026-10-19T19:00:09.000Z'), message('old', '2026-10-19T18:00:00.000Z'), message('b', '2026-10-19T19:00:05.000Z')]);
    expect(merged.map((entry: { id: string }) => entry.id)).toEqual(['a', 'b', 'c']);
  });
});
