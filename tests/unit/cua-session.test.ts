import { describe, expect, it, vi } from 'vitest';
import type { WindowStateOutput } from '@trycua/cua-driver';
import { CuaComputerSession, bindCuaStructure, cuaObservation, cuaWindowTarget, type CuaClipboardText } from '$lib/modules/agent-room/application/adapters/computers/cua-session.js';

const target = { pid: 42, windowId: 80n };
function state(value = ''): WindowStateOutput {
  return { ...target, elementsComplete: true, snapshotId: 's12345678', images: [], elements: [
    { elementIndex: 0n, role: 'AXWindow', depth: 0 },
    { elementIndex: 1n, role: 'AXGroup', depth: 1, parentIndex: 0n },
    { elementIndex: 2n, role: 'AXStaticText', label: 'Taylor', depth: 2, parentIndex: 1n, elementToken: 'header' },
    { elementIndex: 3n, role: 'AXTextArea', label: 'Message', value, depth: 2, parentIndex: 1n, elementToken: 'composer' },
    { elementIndex: 4n, role: 'AXButton', label: 'Send', depth: 2, parentIndex: 1n, elementToken: 'send', actions: ['AXPress'] },
  ] };
}
function fixture() {
  let current = state();
  const driver = {
    listApps: vi.fn(async () => ({ apps: [{ pid: 42, bundleId: 'test.chat', running: true }] })),
    listWindows: vi.fn(async () => ({ windows: [{ ...target }] })),
    getWindowState: vi.fn(async () => current),
    callTool: vi.fn(async (_name: string, _args: string) => ({ isError: false, degraded: false, action: { effect: 0 } })),
  };
  const session = new CuaComputerSession(driver as never);
  const tree = cuaObservation(current, target).tree;
  const input = { command: 'interact' as const, targetId: '42:cg:80', action: 'fill' as const,
    element: { ...tree.elements[3], value: '' }, guards: [tree.elements[2]], text: 'Hello Taylor' };
  return { driver, session, input, setState: (next: WindowStateOutput) => { current = next; } };
}

describe('Cua native adapter boundary', () => {
  it('binds native contact search and exact result selection without typing into the message composer', async () => {
    const f = fixture();
    let canonical = cuaObservation(state(), target).tree;
    const identity = { recipient: canonical.elements[2], composer: canonical.elements[3], send: canonical.elements[4] };
    canonical.elements[2].name = 'Other contact';
    identity.recipient = { ...identity.recipient, name: 'Taylor' };
    const search = { id: '0.8.0', role: 'AXStaticText', name: 'Search', value: '', protected: false, enabled: true, focused: false, actions: ['press'] };
    const group = { ...search, id: '0.8.1', role: 'AXGroup', name: 'Search results', actions: [] };
    const result = { ...search, id: '0.8.1.0', role: 'AXButton', name: 'Taylor' };
    canonical.elements.push(search as never);
    f.driver.getWindowState.mockImplementation(async () => ({ ...target, snapshotId: 'search', images: [], elementsComplete: false,
      elements: canonical.elements.map((e, i) => ({ elementIndex: BigInt(i), depth: 0, role: e.role, label: e.name, value: e.value, elementToken: e.id, actions: e.actions.includes('press') ? ['AXPress'] : [] })) }));
    f.driver.callTool.mockImplementation(async (tool, input) => {
      const args = JSON.parse(input);
      if (tool === 'click' && args.element_token === search.id) search.focused = true;
      if (tool === 'type_text') { expect(args.element_token).toBe(search.id); expect(args.text).toBe('Taylor'); canonical.elements.push(group as never, result as never); }
      if (tool === 'click' && args.element_token === result.id) canonical.elements[2].name = 'Taylor';
      return { isError: false, degraded: false, action: { effect: 0 } };
    });
    const session = new CuaComputerSession(f.driver as never, undefined, async () => structuredClone(canonical));
    const after = await session.openConversation('42:cg:80', 'test.chat', identity);
    expect(after.elements[2].name).toBe('Taylor');
    expect(f.driver.callTool.mock.calls.map(([tool]) => tool)).toEqual(['click', 'type_text', 'click']);
    expect(after.elements[3].value).toBe('');
  });
  it('preserves canonical recipient hierarchy when the real macOS SDK exports an incomplete actionable projection', async () => {
    const f = fixture(), raw = state();
    raw.elementsComplete = false;
    raw.elements = raw.elements!.filter(element => element.role !== 'AXGroup').map(element => ({ ...element, parentIndex: element.elementIndex ? 0n : undefined }));
    f.setState(raw);
    let canonical = cuaObservation(state(), target).tree;
    const reader = vi.fn(async () => canonical);
    const session = new CuaComputerSession(f.driver as never, undefined, reader);
    expect(await session.read('42:cg:80', 'test.chat')).toEqual(canonical);
    expect(f.driver.getWindowState).not.toHaveBeenCalled();
    f.driver.callTool.mockImplementation(async () => {
      canonical = cuaObservation(state('Hello Taylor'), target).tree;
      return { isError: false, degraded: false, action: { effect: 0 } };
    });
    expect((await session.interact(f.input, 'test.chat', { background: true })).elements[3].value).toBe('Hello Taylor');
    expect(JSON.parse(f.driver.callTool.mock.calls[0][1]).element_token).toBe('composer');
    expect(reader).toHaveBeenCalledWith('42:cg:80', 'test.chat');
    expect(cuaObservation(raw, target).tree.truncated).toBe(true);
  });
  it.each(['canonical-truncated', 'projected-truncated', 'canonical-duplicate', 'projected-duplicate', 'changed-recipient', 'changed-draft'])('refuses unsafe canonical-to-SDK binding: %s', async kind => {
    const f = fixture(), raw = state(), canonical = cuaObservation(state(), target).tree;
    raw.elementsComplete = false;
    if (kind === 'canonical-truncated') canonical.truncated = true;
    if (kind === 'projected-truncated') raw.truncated = true;
    if (kind === 'canonical-duplicate') canonical.elements.push({ ...canonical.elements[3], id: '0.8' });
    if (kind === 'projected-duplicate') raw.elements!.push({ ...raw.elements![3], elementIndex: 7n, elementToken: 'another' });
    if (kind === 'changed-recipient') raw.elements![2].label = 'Someone else';
    if (kind === 'changed-draft') raw.elements![3].value = 'Human draft';
    f.setState(raw);
    const session = new CuaComputerSession(f.driver as never, undefined, async () => canonical);
    await expect(session.interact(f.input, 'test.chat', { background: true })).rejects.toMatchObject({ inputAttempted: false });
    expect(f.driver.callTool).not.toHaveBeenCalled();
  });
  it('does not manufacture hierarchy or completeness from a projected tree alone', () => {
    const raw = state(); raw.elementsComplete = false;
    const result = bindCuaStructure(raw, target, cuaObservation(state(), target).tree);
    expect(result.bindings.has('0.9999.1.2.4')).toBe(true);
    expect(() => bindCuaStructure(raw, target, { available: false, truncated: false, elements: [] })).toThrow();
  });
  it('preserves exact native window ids and rejects unsupported references', () => {
    expect(cuaWindowTarget('42:cg:80')).toEqual(target);
    for (const value of ['42:1', '0:cg:80', '42:cg:9007199254740993', '4294967296:cg:80']) expect(() => cuaWindowTarget(value)).toThrow();
  });
  it('retains hierarchy in a separate namespace without leaking protected values or tokens', () => {
    const raw = state();
    raw.elements!.push({ elementIndex: 5n, parentIndex: 1n, depth: 2, role: 'AXSecureTextField', label: 'private label', value: 'secret', elementToken: 'secret-token' });
    const result = cuaObservation(raw, target);
    expect(result.tree.elements[3].id).toBe('0.9999.1.2.4');
    expect(JSON.stringify(result.tree)).not.toMatch(/secret|private label|composer/);
    expect(result.tree.elements[5]).toMatchObject({ protected: true, name: '', value: '', actions: [] });
  });
  it.each(['cycle', 'duplicate', 'orphan', 'wrong-window', 'degraded', 'oversized', 'token-collision'])('rejects an invalid native tree: %s', kind => {
    const raw = state();
    if (kind === 'cycle') raw.elements![0].parentIndex = 1n;
    if (kind === 'duplicate') raw.elements!.push(raw.elements![0]);
    if (kind === 'orphan') raw.elements![0].parentIndex = 99n;
    if (kind === 'wrong-window') raw.windowId = 81n;
    if (kind === 'degraded') raw.degraded = true;
    if (kind === 'oversized') raw.elements![2].label = 'x'.repeat(2001);
    if (kind === 'token-collision') raw.elements![4].elementToken = 'composer';
    expect(() => cuaObservation(raw, target)).toThrow();
  });
  it('observes an exact background window without screenshots, focus or mutation', async () => {
    const f = fixture();
    expect((await f.session.read('42:cg:80', 'test.chat')).elements).toHaveLength(5);
    expect(f.driver.getWindowState).toHaveBeenCalledWith(expect.objectContaining({ ...target, includeScreenshot: false, maxElements: 500 }));
    expect(f.driver.callTool).not.toHaveBeenCalled();
  });
  it('does not leak native transport diagnostics from observation', async () => {
    const f = fixture();
    f.driver.getWindowState.mockRejectedValue(new Error('secret-token and private chat'));
    await expect(f.session.read('42:cg:80', 'test.chat')).rejects.toMatchObject({ inputAttempted: false, message: 'The native observation is unavailable. No input was attempted.' });
  });
  it('uses one full-text native call with zero character delay and no implicit Enter', async () => {
    const f = fixture();
    f.driver.callTool.mockImplementation(async () => { f.setState(state('Hello Taylor')); return { isError: false, degraded: false, action: { effect: 0 } }; });
    expect((await f.session.interact(f.input, 'test.chat', { background: true })).elements[3].value).toBe('Hello Taylor');
    expect(f.driver.callTool).toHaveBeenCalledOnce();
    expect(f.driver.callTool).toHaveBeenCalledWith('type_text', JSON.stringify({ pid: 42, window_id: 80, element_token: 'composer', delivery_mode: 'background', text: 'Hello Taylor', delay_ms: 0 }));
  });
  it('uses foreground only when the existing caller explicitly authorizes it', async () => {
    const f = fixture();
    f.driver.callTool.mockImplementation(async () => { f.setState(state('Hello Taylor')); return { isError: false, degraded: false, action: { effect: 0 } }; });
    await f.session.interact(f.input, 'test.chat', { background: false });
    expect(JSON.parse(f.driver.callTool.mock.calls[0][1]).delivery_mode).toBe('foreground');
  });
  it.each([false, true])('confirms an editor shifted by an inserted Send sibling (paste=%s)', async paste => {
    const f = fixture(), text = paste ? 'First answer\nSecond answer' : 'Hello Taylor';
    const clipboard: CuaClipboardText = async (_text, deliver) => ({ used: true, result: await deliver() });
    const session = new CuaComputerSession(f.driver as never, clipboard);
    f.driver.callTool.mockImplementation(async () => {
      const after = state(text);
      after.elements![3].elementIndex = 5n;
      f.setState(after);
      return { isError: false, degraded: false, action: { effect: paste ? 2 : 0 } };
    });
    const after = await session.interact({ ...f.input, text }, 'test.chat', { background: false });
    expect(after.elements[3]).toMatchObject({ id: '0.9999.1.2.6', value: text });
    expect(f.driver.callTool).toHaveBeenCalledOnce();
  });
  it.each(['duplicate', 'outside-parent', 'protected', 'disabled', 'changed-recipient', 'changed-text'])('rejects unsafe relocated draft confirmation: %s', async kind => {
    const f = fixture();
    f.driver.callTool.mockImplementation(async () => {
      const after = state('Hello Taylor');
      after.elements![3].elementIndex = 5n;
      if (kind === 'duplicate') after.elements!.push({ ...after.elements![3], elementIndex: 6n, elementToken: 'duplicate' });
      if (kind === 'outside-parent') after.elements![3].parentIndex = 0n;
      if (kind === 'protected') after.elements![3].role = 'AXSecureTextField';
      if (kind === 'disabled') after.elements![3].enabled = false;
      if (kind === 'changed-recipient') after.elements![2].label = 'Someone else';
      if (kind === 'changed-text') after.elements![3].value = 'Human edit';
      f.setState(after);
      return { isError: false, degraded: false, action: { effect: 0 } };
    });
    await expect(f.session.interact(f.input, 'test.chat', { background: false })).rejects.toMatchObject({ inputAttempted: true, code: kind === 'changed-recipient' ? 'recipient_changed' : 'draft_unconfirmed' });
    expect(f.driver.callTool).toHaveBeenCalledOnce();
  });
  it('types a long single-line reply directly instead of changing the transport at 64 characters', async () => {
    const f = fixture(), text = 'A complete reply with accents: voc\u00ea, cora\u00e7\u00e3o. '.repeat(12);
    const clipboard = vi.fn();
    const session = new CuaComputerSession(f.driver as never, clipboard);
    f.driver.callTool.mockImplementation(async () => { f.setState(state(text)); return { isError: false, degraded: false, action: { effect: 0 } }; });
    const after = await session.interact({ ...f.input, text }, 'test.chat', { background: false });
    expect(after.elements[3].value).toBe(text);
    expect(clipboard).not.toHaveBeenCalled();
    expect(f.driver.callTool).toHaveBeenCalledExactlyOnceWith('type_text', expect.any(String));
    expect(JSON.parse(f.driver.callTool.mock.calls[0][1])).toMatchObject({ element_token: 'composer', text, delay_ms: 0, delivery_mode: 'foreground' });
  });
  it('pastes a complete multiline native draft with one SDK action and no Return', async () => {
    const f = fixture(), text = 'First answer\nSecond answer';
    const calls = vi.fn();
    const clipboard: CuaClipboardText = async (text, deliver) => { calls(text, deliver); return { used: true, result: await deliver() }; };
    const session = new CuaComputerSession(f.driver as never, clipboard);
    f.driver.callTool.mockImplementation(async () => { f.setState(state(text)); return { isError: false, degraded: false, action: { effect: 2 } }; });
    const after = await session.interact({ ...f.input, text }, 'test.chat', { background: false });
    expect(after.elements[3].value).toBe(text);
    expect(calls).toHaveBeenCalledWith(text, expect.any(Function));
    expect(f.driver.callTool).toHaveBeenCalledOnce();
    expect(JSON.parse(f.driver.callTool.mock.calls[0][1])).toMatchObject({ element_token: 'composer', keys: ['cmd', 'v'], delivery_mode: 'foreground' });
  });
  it('rejects a literal paste key without replaying input or pressing Send', async () => {
    const f = fixture();
    const clipboard: CuaClipboardText = async (_text, deliver) => ({ used: true, result: await deliver() });
    const session = new CuaComputerSession(f.driver as never, clipboard);
    f.driver.callTool.mockImplementation(async () => { f.setState(state('v')); return { isError: false, degraded: false, action: { effect: 2 } }; });
    // Advance only the bounded confirmation deadline, not native operations.
    let clock = 0;
    const time = vi.spyOn(Date, 'now').mockImplementation(() => clock += 3000);
    try {
      await expect(session.interact({ ...f.input, text: 'First answer\nSecond answer' }, 'test.chat', { background: false })).rejects.toMatchObject({ inputAttempted: true, code: 'draft_unconfirmed' });
      expect(f.driver.callTool).toHaveBeenCalledExactlyOnceWith('hotkey', expect.any(String));
    } finally { time.mockRestore(); }
  });
  it('never pastes after contact/draft changes, or into unverified web content', async () => {
    const f = fixture(), clipboard = vi.fn();
    const session = new CuaComputerSession(f.driver as never, clipboard);
    const raw = state(); raw.elements![3].inWebContent = true; f.setState(raw);
    await expect(session.interact({ ...f.input, text: 'One\nTwo' }, 'test.chat', { background: false })).rejects.toMatchObject({ inputAttempted: false });
    expect(clipboard).not.toHaveBeenCalled();
    raw.elements![3].inWebContent = false;
    raw.elements![2].label = 'Another person';
    await expect(session.interact({ ...f.input, text: 'One\nTwo' }, 'test.chat', { background: false })).rejects.toMatchObject({ inputAttempted: false });
    expect(clipboard).not.toHaveBeenCalled();
    expect(f.driver.callTool).not.toHaveBeenCalled();
  });
  it('keeps a changed recipient after paste classified as attempted, never a retryable preflight refusal', async () => {
    const f = fixture();
    const clipboard: CuaClipboardText = async (_text, deliver) => ({ used: true, result: await deliver() });
    const session = new CuaComputerSession(f.driver as never, clipboard);
    f.driver.callTool.mockImplementation(async () => {
      const raw = state('One\nTwo'); raw.elements![2].label = 'Changed recipient'; f.setState(raw);
      return { isError: false, degraded: false, action: { effect: 2 } };
    });
    await expect(session.interact({ ...f.input, text: 'One\nTwo' }, 'test.chat', { background: false })).rejects.toMatchObject({ inputAttempted: true });
    expect(f.driver.callTool).toHaveBeenCalledOnce();
  });
  it.each(['recipient', 'draft', 'application', 'window', 'multiline', 'truncated'])('does not mutate after a changed precondition: %s', kind => {
    const f = fixture();
    const raw = state();
    if (kind === 'recipient') raw.elements![2].label = 'Someone else';
    if (kind === 'draft') raw.elements![3].value = 'human draft';
    if (kind === 'application') f.driver.listApps.mockResolvedValue({ apps: [] });
    if (kind === 'window') f.driver.listWindows.mockResolvedValue({ windows: [] });
    if (kind === 'multiline') f.input.text = 'Hello\nSend it';
    if (kind === 'truncated') raw.truncated = true;
    f.setState(raw);
    return expect(f.session.interact(f.input, 'test.chat', { background: true })).rejects.toMatchObject({ inputAttempted: false }).then(() => expect(f.driver.callTool).not.toHaveBeenCalled());
  });
  it.each([1, 2, 3, 4])('never trusts an unconfirmed text effect or retries it (%s)', async effect => {
    const f = fixture();
    f.driver.callTool.mockImplementation(async () => { f.setState(state('Hello Taylor')); return { isError: false, degraded: false, action: { effect } }; });
    await expect(f.session.interact(f.input, 'test.chat', { background: true })).rejects.toMatchObject({ inputAttempted: true, code: 'effect_unconfirmed' });
    expect(f.driver.callTool).toHaveBeenCalledOnce();
  });
  it('returns a fresh native tree after press without inventing delivery', async () => {
    const f = fixture();
    f.setState(state('Hello Taylor'));
    const tree = cuaObservation(state('Hello Taylor'), target).tree;
    f.driver.callTool.mockImplementation(async () => { f.setState(state()); return { isError: false, degraded: false, action: { effect: 2 } }; });
    const result = await f.session.interact({ command: 'interact', targetId: '42:cg:80', action: 'press', element: tree.elements[4], guards: [tree.elements[2], tree.elements[3]] }, 'test.chat', { background: false });
    expect(result.elements[3].value).toBe('');
    expect(result).not.toHaveProperty('delivered');
  });
  it('redacts native failures and prevents concurrent snapshot invalidation', async () => {
    const f = fixture();
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    f.driver.callTool.mockImplementation(async () => { await hold; throw new Error('private message secret-token'); });
    const pending = f.session.interact(f.input, 'test.chat', { background: true });
    await vi.waitFor(() => expect(f.driver.callTool).toHaveBeenCalledOnce());
    await expect(f.session.read('42:cg:80', 'test.chat')).rejects.toMatchObject({ inputAttempted: false });
    release();
    await expect(pending).rejects.toThrow('did not confirm');
    expect(f.driver.getWindowState).toHaveBeenCalledOnce();
  });
});
