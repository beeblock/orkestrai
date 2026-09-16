import { describe, expect, it, vi } from 'vitest';
import { openNativeConversation } from '$lib/modules/agent-room/application/adapters/computers/conversation-navigation.js';
import type { ComputerAccessibility } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';

function fixture() {
  const element = (id: string, role: string, name: string, actions: ('press' | 'fill')[] = []) => ({ id, role, name, value: '', enabled: true, protected: false, focused: false, actions });
  const header = element('0.0.2.0', 'AXButton', 'Taylor', ['press']);
  const composer = element('0.0.2.1', 'AXTextArea', 'Compose message', ['fill']);
  const send = element('0.0.2.2', 'AXButton', 'Send', ['press']);
  const identity = { recipient: header, composer, send };
  const search = element('0.0.1.0', 'AXStaticText', '\u200eSearch', ['press']);
  const group = element('0.0.1.1', 'AXGroup', 'Search results');
  const result = element('0.0.1.1.0', 'AXButton', 'Taylor', ['press']);
  const tree: ComputerAccessibility = { available: true, truncated: false, elements: [search, { ...header, name: 'Another contact' }, { ...composer, value: 'Human draft, do not touch' }, send] };
  const io = {
    read: vi.fn(async () => structuredClone(tree)),
    press: vi.fn(async (control) => {
      if (control.id === search.id) tree.elements[0].focused = true;
      if (control.id === result.id) tree.elements[1] = header;
    }),
    search: vi.fn(async () => { tree.elements.push(group, result); }),
  };
  return { identity, tree, io, result, group, search, header };
}

describe('Native conversation navigation', () => {
  it('searches the approved contact from another conversation and verifies its header without sending', async () => {
    const f = fixture();
    const tree = await openNativeConversation(f.identity, f.io);
    expect(tree.elements[1].name).toBe('Taylor');
    expect(f.io.search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: f.search.id }), 'Taylor');
    expect(f.io.press.mock.calls.map(([c]) => c.id)).toEqual([f.search.id, f.result.id]);
    expect(tree.elements[2].value).toBe('Human draft, do not touch');
  });
  it('does no navigation when the verified conversation is already open', async () => {
    const f = fixture(); f.tree.elements[1] = f.header;
    await openNativeConversation(f.identity, f.io);
    expect(f.io.press).not.toHaveBeenCalled(); expect(f.io.search).not.toHaveBeenCalled();
  });
  it('opens an existing exact result without typing another query', async () => {
    const f = fixture(); f.tree.elements.push(f.group, f.result);
    await openNativeConversation(f.identity, f.io);
    expect(f.io.search).not.toHaveBeenCalled();
    expect(f.io.press).toHaveBeenCalledOnce();
  });
  it.each(['truncated', 'protected-search', 'duplicate-search', 'no-focus', 'existing-query', 'duplicate-result'])('fails closed for %s', async kind => {
    const f = fixture();
    if (kind === 'truncated') f.tree.truncated = true;
    if (kind === 'protected-search') f.tree.elements[0].protected = true;
    if (kind === 'duplicate-search') f.tree.elements.push({ ...f.search, id: '0.0.1.9' });
    if (kind === 'no-focus') f.io.press.mockImplementation(async () => {});
    if (kind === 'existing-query') f.tree.elements[0].value = 'Existing query';
    if (kind === 'duplicate-result') f.tree.elements.push(f.group, f.result, { ...f.result, id: '0.0.1.1.5' });
    await expect(openNativeConversation(f.identity, f.io)).rejects.toThrow();
    expect(f.io.search).not.toHaveBeenCalled();
    expect(f.io.press.mock.calls.some(([c]) => c.id === f.result.id)).toBe(false);
  });
  it.each(['partial-name', 'message-body', 'outside-results', 'changed-header'])('never mistakes %s for the approved contact', async kind => {
    const f = fixture();
    if (kind === 'partial-name') f.result.name = 'Taylor Work';
    if (kind === 'message-body') f.result.actions = [];
    if (kind === 'outside-results') f.group.name = 'Message history';
    if (kind === 'changed-header') f.io.press.mockImplementation(async c => { if (c.id === f.search.id) f.tree.elements[0].focused = true; });
    await expect(openNativeConversation(f.identity, f.io)).rejects.toThrow();
    if (kind !== 'changed-header') expect(f.io.press.mock.calls.some(([c]) => c.id === f.result.id)).toBe(false);
  });
});
