import { describe, expect, it, vi } from 'vitest';
import { readCanvasDraft, writeCanvasDraft } from '$lib/components/agent-room/canvas/canvas-composer-drafts.js';

function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
  };
}

describe('Canvas prompt drafts', () => {
  it('shares pending sends across remounts and never clears a draft edited after submission', async () => {
    vi.stubGlobal('$state', <T>(value: T) => value);
    try {
      const { canvasComposerDraft } = await import('$lib/components/agent-room/canvas/canvas-composer-draft-state.svelte.js');
      const tab = storage();
      const original = canvasComposerDraft('pending-a', tab);
      original.text = 'First request';
      const submitted = original.capture();
      original.sending = true;
      original.save(tab);
      const remounted = canvasComposerDraft('pending-a', tab);
      expect(remounted).toBe(original);
      expect(remounted.sending).toBe(true);
      const other = canvasComposerDraft('pending-b', tab);
      other.text = 'Independent request';
      expect(other.sending).toBe(false);
      original.accept(submitted, tab);
      expect(remounted.text).toBe('');
      expect(other.text).toBe('Independent request');

      original.text = 'Same text';
      const next = original.capture();
      original.text = 'New draft';
      original.text = 'Same text';
      original.accept(next, tab);
      expect(remounted.text).toBe('Same text');
      expect(readCanvasDraft(tab, 'pending-a')).toBe('Same text');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restores each workspace independently and removes only a sent or emptied draft', () => {
    const tab = storage();
    writeCanvasDraft(tab, 'a', 'Plan A\nwith details');
    writeCanvasDraft(tab, 'b', 'Plan B');
    expect(readCanvasDraft(tab, 'a')).toBe('Plan A\nwith details');
    expect(readCanvasDraft(tab, 'b')).toBe('Plan B');
    writeCanvasDraft(tab, 'a', '');
    expect(readCanvasDraft(tab, 'a')).toBe('');
    expect(readCanvasDraft(tab, 'b')).toBe('Plan B');
    expect(readCanvasDraft(storage(), 'b')).toBe('');
  });

  it('bounds retained prompts without touching other browser settings', () => {
    const tab = storage();
    tab.setItem('orkestrai.activeWorkspaceId', 'owner-workspace');
    for (let i = 0; i < 25; i++) writeCanvasDraft(tab, `w${i}`, `Prompt ${i}`);
    expect(tab.length).toBe(21);
    expect(readCanvasDraft(tab, 'w24')).toBe('Prompt 24');
    expect(tab.getItem('orkestrai.activeWorkspaceId')).toBe('owner-workspace');
  });

  it('round-trips escaped multiline text and tolerates unavailable storage', () => {
    const tab = storage();
    const text = '\n'.repeat(150_000);
    writeCanvasDraft(tab, 'a', text);
    expect(readCanvasDraft(tab, 'a')).toBe(text);
    expect(readCanvasDraft(null, 'a')).toBe('');
    expect(() => writeCanvasDraft(null, 'a', 'Plan')).not.toThrow();
    const blocked = { ...tab, getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(readCanvasDraft(blocked, 'a')).toBe('');
    expect(() => writeCanvasDraft(blocked, 'a', 'Plan')).not.toThrow();
  });
});
