import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { MAC_ACCESSIBILITY_SCRIPT } from '$lib/modules/agent-room/application/adapters/computers/mac-accessibility.js';
import { parseAccessibility } from '$lib/modules/agent-room/application/adapters/computers/accessibility.js';
import { computerCommandSchema } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { semanticChanges, semanticObservation } from '$lib/modules/agent-room/application/services/ComputerObservationService.js';
import { MCP_TOOLS } from '../../packages/orkestrai-cli/src/mcp.js';

function nativeFixture(appId = 'com.example.qa') {
  const header = { AXRole: 'AXStaticText', AXTitle: 'QA recipient', AXValue: '', AXEnabled: true };
  const draft = { AXRole: 'AXTextField', AXTitle: 'Message', AXValue: '', AXEnabled: true, AXFocused: false, fill: true };
  const send = { AXRole: 'AXButton', AXTitle: 'Send', AXValue: '', AXEnabled: false, press: true };
  const password = { AXRole: 'AXTextField', AXSubrole: 'AXSecureTextField', AXTitle: 'hidden-name', AXValue: 'never-read-this', AXChildren: [{ AXRole: 'AXStaticText', AXValue: 'nested-secret' }] };
  const window = { AXRole: 'AXWindow', AXTitle: 'QA', AXPosition: { x: 0, y: 0 }, AXSize: { width: 500, height: 300 }, AXChildren: [header, draft, send, password] };
  const root = { AXWindows: [window], AXFocusedWindow: window, AXFocusedUIElement: draft };
  const effects: string[] = [];
  const reads: string[] = [];
  const applicationQueries: string[] = [];
  let focusedPid = 42;
  let focusedBounds = [0, 0];
  let beforeAction = false;
  let selected = false;
  let interruptTyping = false;
  let afterTyping: (() => void) | undefined;
  const posted: any[] = [];
  const shortcuts = { keystroke: (_key: string, _options: unknown) => {} };
  const box = (value: any): any => ({ boxed: value, count: value?.length, objectAtIndex: (i: number) => value[i] });
  const unbox = (value: any) => value?.boxed ?? value;
  const $ = Object.assign((value: any) => typeof value === 'string' ? { toString: () => value, dataUsingEncoding: () => ({ bytes: value }) } : value, {
    NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: null } },
    NSString: { alloc: { initWithDataEncoding: (data: string) => ({ js: data }) } }, NSUTF8StringEncoding: 4,
    AXIsProcessTrusted: () => true,
    CGPreflightPostEventAccess: () => true,
    NSMutableData: { dataWithLength: () => { const data = {}; return { bytes: data, mutableBytes: data }; } },
    AXValueGetValue: (value: unknown, _type: number, data: object) => { Object.assign(data, unbox(value)); return true; },
    NSValue: { valueWithBytesObjCType: (bytes: object) => ({ pointValue: bytes, sizeValue: bytes }) },
    CGEventCreateKeyboardEvent: (_source: unknown, key: number, down: boolean) => ({ key, down }),
    CGEventSetFlags: (event: any, flags: number) => { event.flags = flags; },
    CGEventKeyboardSetUnicodeString: (event: any, _units: number, text: string) => { event.text = text; },
    kCGEventFlagMaskCommand: 1,
    kCGEventFlagMaskShift: 2,
    kCGHIDEventTap: 0,
    CGEventPost: (_tap: number, _event: any) => {},
    CGEventPostToPid: (pid: number, event: any) => {
      posted.push({ pid, ...event });
      if (!event.down) return;
      if (event.flags === 1) { selected = true; return; }
      if (event.key === 51) { draft.AXValue = ''; return; }
      const typed = event.key === 36 && event.flags === 2 ? '\n' : event.text;
      if (event.text?.includes('\n') || event.key === 36 && event.flags !== 2) { effects.push('unexpected-send'); draft.AXValue = ''; return; }
      draft.AXValue = (selected ? '' : draft.AXValue) + typed;
      selected = false; send.AXEnabled = Boolean(draft.AXValue); effects.push('text');
      afterTyping?.();
      if (interruptTyping) focusedPid = 99;
    },
    NSRunningApplication: { runningApplicationWithProcessIdentifier: () => ({ isNil: () => false, bundleIdentifier: { js: appId } }) },
    NSWorkspace: { sharedWorkspace: { get frontmostApplication() { return { processIdentifier: focusedPid }; } } },
    CGWindowListCopyWindowInfo: (options: number) => box([{ kCGWindowOwnerPID: 42, kCGWindowNumber: 9, kCGWindowName: 'QA', kCGWindowBounds: { X: options ? focusedBounds[0] : 0, Y: options ? focusedBounds[1] : 0, Width: 500, Height: 300 } }]),
    AXUIElementCreateApplication: () => root, AXUIElementSetMessagingTimeout: () => 0,
    AXUIElementCopyAttributeValue: (element: any, name: string, out: any[]) => {
      if (element?.boxed) throw new Error('Ref has incompatible type');
      if (element === password) reads.push(name);
      if (!(name in element)) return -1;
      out[0] = box(element[name]); return 0;
    },
    AXUIElementCopyActionNames: (element: any, out: any[]) => { out[0] = box(element.press ? ['AXPress'] : []); return 0; },
    AXUIElementIsAttributeSettable: (element: any, _key: string, out: any[]) => { out[0] = Boolean(element.fill); if (beforeAction) focusedPid = 99; return 0; },
    AXUIElementSetAttributeValue: (element: any, key: string, value: any) => {
      element[key] = String(key) === 'AXValue' ? String(value) : value;
      effects.push(String(key) === 'AXFocused' ? 'focus' : 'fill');
      if (String(key) === 'AXValue') { send.AXEnabled = Boolean(element[key]); afterTyping?.(); }
      return 0;
    },
    AXUIElementPerformAction: (_element: any) => { effects.push('press'); return 0; }, CFEqual: (a: any, b: any) => unbox(a) === b,
  });
  const run = (extra: object = {}) => {
    $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile = JSON.stringify({ targetId: '42:cg:9', appId, ...extra }) as never;
    const Application = (name: string) => { applicationQueries.push(name); return { ...shortcuts, applicationProcesses: { whose: () => () => [{ frontmost: () => focusedPid === 42, windows: () => [{ name: () => 'QA', position: () => focusedBounds, size: () => [500, 300] }] }] } }; };
    return JSON.parse(runInNewContext(`${MAC_ACCESSIBILITY_SCRIPT}; run()`, { $, Application, ObjC: { import: () => {}, bindFunction: () => {}, castRefToObject: (v: any) => v?.boxed?.AXRole || v?.boxed?.filePathURL ? v.boxed : v, deepUnwrap: unbox }, Ref: () => [], Date, JSON, delay: () => {} }));
  };
  return { run, $, root, box, unbox, header, draft, send, window, effects, reads, applicationQueries, posted, shortcuts, onText: (callback: () => void) => { afterTyping = callback; }, blur: () => { focusedPid = 99; }, moveWindow: () => { focusedBounds = [50, 30]; }, stealDuringCheck: () => { beforeAction = true; }, stealDuringTyping: () => { interruptTyping = true; } };
}

describe('bounded native accessibility', () => {
  it('keeps the focused document identity when an app-owned popover is above it', () => {
    const f = nativeFixture();
    const original = f.$.CGWindowListCopyWindowInfo;
    f.$.CGWindowListCopyWindowInfo = (options: number) => f.box([{ kCGWindowOwnerPID: 42, kCGWindowNumber: 10, kCGWindowLayer: 0, kCGWindowBounds: { X: 10, Y: 10, Width: 100, Height: 50 } }, ...f.unbox(original(options))]);
    expect(f.run().error).toBeUndefined();
    f.root.AXFocusedWindow = { ...f.window, AXTitle: 'Another conversation' };
    expect(f.run({ action: 'fill', text: 'Approved', element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [] })).toEqual({ error: 'focus_changed', inputAttempted: false });
  });

  it('reads a background window without focusing, typing, clicking or reading password values', () => {
    const f = nativeFixture();
    f.blur();
    const result = f.run();
    expect(result.available).toBe(true);
    expect(result.elements.find((e: any) => e.id === '0.0').name).toBe('QA recipient');
    expect(f.effects).toEqual([]);
    expect(f.posted).toEqual([]);
    expect(f.reads).not.toContain('AXValue');
    expect(f.applicationQueries).toEqual([]);
    expect(f.$.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier).toBe(99);
  });

  it('matches a same-title window by native bounds, not its accessibility array position', () => {
    const f = nativeFixture();
    f.root.AXWindows.unshift({ ...f.window, AXPosition: { x: 600, y: 0 }, AXChildren: [] });
    const result = f.run();
    expect(result.available).toBe(true);
    expect(result.elements.some((e: { name: string }) => e.name === 'QA recipient')).toBe(true);
    f.root.AXWindows[0].AXPosition = { x: 0, y: 0 };
    expect(f.run()).toEqual({ error: 'ambiguous_window' });
    expect(f.effects).toEqual([]);
    expect(f.applicationQueries).toEqual([]);
  });

  it('rejects missing native window geometry instead of guessing from a title', () => {
    const f = nativeFixture();
    delete (f.window as Partial<typeof f.window>).AXPosition;
    expect(f.run()).toEqual({ error: 'ambiguous_window' });
    expect(f.effects).toEqual([]);
  });

  it('keeps reading the bound window when foreground changes during traversal', () => {
    const f = nativeFixture();
    f.stealDuringCheck();
    expect(f.run()).toMatchObject({ available: true, truncated: false });
    expect(f.effects).toEqual([]);
    expect(f.posted).toEqual([]);
  });

  it.each(['closed', 'replaced'])('rejects a %s target during a background read', (change) => {
    const f = nativeFixture();
    f.blur();
    const original = f.$.CGWindowListCopyWindowInfo;
    let reads = 0;
    f.$.CGWindowListCopyWindowInfo = (options: number) => {
      if (++reads < 3) return original(options);
      return f.box(change === 'closed' ? [] : [{ kCGWindowOwnerPID: 99, kCGWindowNumber: 9, kCGWindowName: 'QA' }]);
    };
    expect(f.run()).toEqual({ error: 'target_changed' });
    expect(f.effects).toEqual([]);
  });

  it('still rejects a background mutation before touching the editor', () => {
    const f = nativeFixture();
    f.blur();
    expect(f.run({ action: 'fill', text: 'Approved', element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [] })).toEqual({ error: 'focus_changed', inputAttempted: false });
    expect(f.effects).toEqual([]);
    expect(f.posted).toEqual([]);
  });

  it.each(['com.example.qa', 'com.example.browser'])('fills a directed background control without global input in %s', (appId) => {
    const f = nativeFixture(appId);
    f.blur();
    const globalInput = [] as unknown[];
    f.$.CGEventPost = (...args) => { globalInput.push(args); };
    const result = f.run({ background: true, action: 'fill', text: 'Approved text', element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }] });
    expect(result.error).toBeUndefined();
    expect(f.draft.AXValue).toBe('Approved text');
    expect(f.posted.every(e => e.pid === 42)).toBe(true);
    expect(globalInput).toEqual([]);
    expect(f.effects).not.toContain('focus');
    expect(f.$.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier).toBe(99);
  });

  it('presses the guarded native control while another application has focus', () => {
    const f = nativeFixture(); f.blur(); f.send.AXEnabled = true;
    expect(f.run({ background: true, action: 'press', element: { id: '0.2', role: 'AXButton', name: 'Send' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }] }).error).toBeUndefined();
    expect(f.effects).toEqual(['press']);
    expect(f.posted).toEqual([]);
    expect(f.$.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier).toBe(99);
  });

  it('selects an inactive app editor through its AX action without global activation', () => {
    const f = nativeFixture(); f.blur();
    f.root.AXFocusedUIElement = { AXRole: 'AXGroup' } as never;
    Object.assign(f.draft, { press: true });
    f.$.AXUIElementSetAttributeValue = () => 0;
    f.$.AXUIElementPerformAction = (element: any) => {
      expect(element).toBe(f.draft);
      f.root.AXFocusedUIElement = f.draft; f.draft.AXFocused = true;
      f.effects.push('editor-press'); return 0;
    };
    expect(f.run({ background: true, action: 'fill', text: 'Approved', element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }] })).toMatchObject({ available: true });
    expect(f.effects[0]).toBe('editor-press');
    expect(f.draft.AXValue).toBe('Approved');
    expect(f.$.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier).toBe(99);
  });

  it('reports a background editor that discards input without claiming success or pressing Send', () => {
    const f = nativeFixture(); f.blur();
    const attempted: unknown[] = [];
    f.$.CGEventPostToPid = (_pid, event) => { attempted.push(event); };
    expect(f.run({ background: true, action: 'fill', text: 'Approved', element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }] })).toEqual({ error: 'background_input_unavailable', inputAttempted: true });
    expect(attempted).toHaveLength(2);
    expect(f.draft.AXValue).toBe('');
    expect(f.effects).toEqual([]);
  });

  it.each(['recipient', 'window', 'sheet'])('rejects a changed %s for directed input without touching the editor', (change) => {
    const f = nativeFixture(); f.blur();
    if (change === 'recipient') f.header.AXTitle = 'Another contact';
    if (change === 'window') f.$.CGWindowListCopyWindowInfo = () => f.box([]);
    if (change === 'sheet') f.window.AXChildren.push({ AXRole: 'AXSheet' } as never);
    expect(f.run({ background: true, action: 'fill', text: 'Approved', element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }] }).error).toBeDefined();
    expect(f.effects).toEqual([]);
    expect(f.posted).toEqual([]);
  });

  it('does not let directed input bypass the foreground guard for file dialogs', () => {
    const f = nativeFixture(); f.blur();
    expect(f.run({ background: true, file: { path: '/tmp/test.png' } })).toEqual({ error: 'focus_changed' });
    expect(f.effects).toEqual([]);
  });

  it.each(['recipient', 'editor', 'window'])('stops directed typing when its %s changes mid-action', (change) => {
    const f = nativeFixture(); f.blur();
    f.onText(() => {
      if (change === 'recipient') f.header.AXTitle = 'Another contact';
      if (change === 'editor') f.root.AXFocusedUIElement = { ...f.draft };
      if (change === 'window') f.$.CGWindowListCopyWindowInfo = () => f.box([]);
    });
    const result = f.run({ background: true, action: 'fill', text: 'Approved long message that requires more than one native event', element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }] });
    expect(result.error).toBeDefined();
    expect(f.posted.filter(e => e.down)).toHaveLength(1);
    expect(result.inputAttempted).toBe(true);
    expect(f.effects).toEqual(['text']);
    expect(f.effects).not.toContain('press');
    expect(f.effects).not.toContain('unexpected-send');
    expect(f.$.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier).toBe(99);
  });

  it('focuses only the verified editor with AXPress when AXFocused is not settable', () => {
    const f = nativeFixture();
    Object.assign(f.draft, { press: true });
    f.$.AXUIElementSetAttributeValue = () => -25205;
    f.$.AXUIElementPerformAction = (element: any) => { expect(element).toBe(f.draft); f.draft.AXFocused = true; f.effects.push('focus-press'); return 0; };
    const result = f.run({ element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }], action: 'fill', text: 'Approved message' });
    expect(result.error).toBeUndefined();
    expect(f.draft.AXValue).toBe('Approved message');
    expect(f.effects[0]).toBe('focus-press');
    expect(f.effects).not.toContain('unexpected-send');
  });
  it.each([false, true])('opens an attached native file sheet and verifies the full URL (modern modal=%s)', (modern) => {
    const fixture = nativeFixture();
    const popover = modern;
    const path = '/private/staging/report.pdf';
    const field = { AXRole: 'AXTextField', AXValue: '', AXFocused: true };
    const selected = { AXRole: 'AXTextField', AXURL: modern ? { filePathURL: { URLByResolvingSymlinksInPath: { path: { js: path } } } } : 'file://' + path, AXSelected: true };
    const goButton = { AXRole: 'AXButton', AXEnabled: true, action: () => { panel.AXChildren = modern ? [{ AXRole: 'AXScrollArea', AXContents: [{ AXRole: 'AXList', AXSelectedChildren: [selected] }] }] : [selected]; } };
    const go = { AXRole: 'AXSheet', AXChildren: [field], ...(modern ? {} : { AXDefaultButton: goButton }) };
    const initialChildren = [...fixture.window.AXChildren];
    const confirm = { AXRole: 'AXButton', AXEnabled: true, action: () => { fixture.window.AXChildren = [...initialChildren]; } };
    const panel = { AXRole: 'AXSheet', AXChildren: [] as any[], ...(modern ? {} : { AXDefaultButton: confirm }) };
    const fileButton = { AXRole: 'AXButton', AXTitle: 'File', AXEnabled: true };
    fixture.shortcuts.keystroke = (key, options) => { expect(key).toBe('g'); expect(options).toEqual({ using: ['command down', 'shift down'] }); panel.AXChildren.push(go); };
    const menu = { AXRole: 'AXGroup', AXChildren: [fileButton] };
    fixture.send.AXTitle = 'Attach'; fixture.send.AXEnabled = true;
    fixture.$.AXUIElementPerformAction = (element: any) => {
      if (element?.boxed) throw new Error('Ref has incompatible type');
      const target = element;
      if (target === fixture.send) { if (modern) fixture.window.AXChildren = []; fixture.window.AXChildren.push((popover ? menu : panel) as never); fixture.effects.push('attach'); }
      else if (target === fileButton) { fixture.window.AXChildren.pop(); fixture.window.AXChildren.push(panel as never); fixture.effects.push('file-menu'); }
      else { target.action(); fixture.effects.push(target === goButton ? 'go' : 'select-file'); }
      return 0;
    };
    fixture.$.CGEventPost = (tap: number, event: any) => {
      expect(tap).toBe(fixture.$.kCGHIDEventTap);
      if (!event.down) return;
      if (event.key === 5 && event.flags === 3) panel.AXChildren.push(go);
      else if (event.key === 0 && event.flags === 1) field.AXValue = '';
      else if (event.text) field.AXValue += event.text;
      else if (event.key === 36 && modern) {
        if (panel.AXChildren.includes(go)) { goButton.action(); fixture.effects.push('go'); }
        else { confirm.action(); fixture.effects.push('select-file'); }
      }
    };
    fixture.$.AXUIElementSetAttributeValue = (element: any, key: string, value: any) => { element[String(key)] = String(value); return 0; };
    const result = fixture.run({ guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }], file: { path, open: { id: '0.2', role: 'AXButton', name: 'Attach' }, ...(popover ? { menu: { id: '0.4.0', role: 'AXButton', name: 'File' } } : {}) } });
    expect(result.error).toBeUndefined();
    expect(field.AXValue).toBe(path);
    expect(fixture.effects).toEqual(popover ? ['attach', 'file-menu', 'go', 'select-file'] : ['attach', 'go', 'select-file']);
    expect(fixture.draft.AXValue).toBe('');
  });

  it('does not open a picker while the recipient changed or a sheet was already open', () => {
    const fixture = nativeFixture(); fixture.send.AXEnabled = true;
    const request = { guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }], file: { path: '/tmp/report.pdf', open: { id: '0.2', role: 'AXButton', name: 'Send' } } };
    fixture.header.AXTitle = 'Wrong recipient';
    expect(fixture.run(request)).toEqual({ error: 'element_changed' });
    fixture.header.AXTitle = 'QA recipient';
    fixture.window.AXChildren.push({ AXRole: 'AXSheet' } as never);
    expect(fixture.run(request)).toEqual({ error: 'file_dialog_already_open' });
    expect(fixture.effects).toHaveLength(0);
  });
  it('reads controls without images and never reads a secure value or subtree', () => {
    const fixture = nativeFixture();
    const tree = parseAccessibility(fixture.run());
    expect(tree.elements.find((e) => e.id === '0.1')).toMatchObject({ name: 'Message', actions: ['fill'], value: '' });
    expect(JSON.stringify(tree)).not.toMatch(/never-read-this|hidden-name|nested-secret/);
    expect(fixture.reads).not.toContain('AXValue');
    expect(fixture.reads).not.toContain('AXChildren');
    expect(fixture.effects).toEqual([]);
  });

  it('fills only the exact draft and rejects a changed recipient before effects', () => {
    const fixture = nativeFixture();
    const input = { element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }], action: 'fill', text: 'Full reply with accents: ol\u00e1' };
    const filled = fixture.run(input);
    expect(filled.elements.find((e: any) => e.id === '0.1').value).toBe(input.text);
    expect(fixture.effects[0]).toBe('focus');
    expect(fixture.effects).not.toContain('fill');
    expect(fixture.send.AXEnabled).toBe(true);
    expect(fixture.posted.every(e => e.pid === 42)).toBe(true);
    const previousEffects = [...fixture.effects];
    expect(fixture.run(input)).toEqual({ error: 'element_changed', inputAttempted: false });
    fixture.draft.AXValue = ''; fixture.header.AXTitle = 'Wrong recipient';
    expect(fixture.run(input)).toEqual({ error: 'element_changed', inputAttempted: false });
    fixture.header.AXTitle = 'QA recipient';
    fixture.draft.AXValue = 'x'.repeat(20001);
    expect(fixture.run({ ...input, element: { ...input.element, value: 'x'.repeat(20000) } })).toEqual({ error: 'element_changed', inputAttempted: false });
    expect(fixture.effects).toEqual(previousEffects);
  });

  it('checks full draft and focus immediately before native publication', () => {
    const fixture = nativeFixture();
    const input = { element: { id: '0.2', role: 'AXButton', name: 'Send' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }, { id: '0.1', role: 'AXTextField', name: 'Message', value: 'Approved text' }], action: 'press' };
    fixture.draft.AXValue = 'Someone edited this';
    expect(fixture.run(input)).toEqual({ error: 'element_changed', inputAttempted: false });
    fixture.draft.AXValue = 'Approved text'; fixture.stealDuringCheck();
    fixture.send.AXEnabled = true;
    expect(fixture.run(input)).toEqual({ error: 'focus_changed', inputAttempted: false });
    expect(fixture.effects).toEqual([]);
  });

  it('replaces only a matching draft using editor events and never submits with Return', () => {
    const fixture = nativeFixture();
    fixture.draft.AXValue = 'Existing exact draft';
    const input = { element: { id: '0.1', role: 'AXTextField', name: 'Message', value: fixture.draft.AXValue }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }], action: 'fill', text: 'Updated ol\u00e1 \ud83d\ude80' };
    expect(fixture.run(input).elements.find((e: any) => e.id === '0.1').value).toBe(input.text);
    expect(fixture.posted.filter(e => e.down && e.text).map(e => e.text).join('')).toBe(input.text);
    expect(fixture.posted.some(e => e.key === 36)).toBe(false);
    expect(fixture.effects).not.toContain('press');
  });

  it('stops the remaining text if focus changes during native delivery', () => {
    const fixture = nativeFixture(); fixture.stealDuringTyping();
    const input = { element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }], action: 'fill', text: 'a'.repeat(80) };
    expect(fixture.run(input)).toEqual({ error: 'focus_changed', inputAttempted: true });
    expect(fixture.draft.AXValue).toBe('a'.repeat(20));
    expect(fixture.effects).not.toContain('press');
  });

  it('fills multiline chat drafts without submitting any line', () => {
    const fixture = nativeFixture(); fixture.draft.AXRole = 'AXTextArea';
    const text = 'Shopping list:\n\nRice\nBeans\nCoffee';
    const input = { element: { id: '0.1', role: 'AXTextArea', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }], action: 'fill', text };
    expect(fixture.run(input).elements.find((e: any) => e.id === '0.1').value).toBe(text);
    expect(fixture.effects).not.toContain('unexpected-send');
    expect(fixture.effects).not.toContain('press');
    expect(fixture.posted.filter(e => e.key === 36).every(e => e.flags === 2)).toBe(true);
    expect(fixture.posted.some(e => e.text?.includes('\n'))).toBe(false);
  });

  it('rejects multiline input into single-line controls and navigation control characters before typing', () => {
    for (const text of ['one\ntwo', 'one\rtwo', 'one\ttwo']) {
      const fixture = nativeFixture();
      expect(fixture.run({ element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [], action: 'fill', text })).toEqual({ error: 'action_unavailable', inputAttempted: false });
      expect(fixture.posted).toHaveLength(0);
    }
  });

  it.each([false, true])('accepts only the exact planned native list continuation (divergent=%s)', (divergent) => {
    const fixture = nativeFixture('net.whatsapp.WhatsApp'); fixture.draft.AXRole = 'AXTextArea';
    fixture.onText(() => {
      if (fixture.draft.AXValue.endsWith('\n')) {
        const last = fixture.draft.AXValue.slice(0,-1).split('\n').pop()!.match(/^(\d+)\. /);
        if (last) fixture.draft.AXValue += `${Number(last[1])+1}. \u2060${divergent ? 'manual edit' : ''}`;
      }
    });
    const text = Array.from({ length: 10 }, (_, i) => `${i+1}. Answer ${i+1}`).join('\n');
    const result = fixture.run({ element: { id: '0.1', role: 'AXTextArea', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXStaticText', name: 'QA recipient' }], action: 'fill', text });
    if (divergent) expect(result).toEqual({ error: 'element_changed', inputAttempted: true });
    else expect(result.elements.find((e: any) => e.id === '0.1').value).toBe(text);
    expect(fixture.effects).not.toContain('unexpected-send');
    expect(fixture.effects).not.toContain('press');
  });

  it('does not canonicalize invisible characters outside known list markers or other apps', () => {
    for (const appId of ['com.example.qa', 'net.whatsapp.WhatsApp']) {
      const fixture = nativeFixture(appId); fixture.draft.AXRole = 'AXTextArea';
      fixture.draft.AXValue = 'a\u2060b\n2. \u2060';
      expect(fixture.run().elements.find((e: any) => e.id === '0.1').value).toBe(appId === 'net.whatsapp.WhatsApp' ? 'a\u2060b\n2. ' : fixture.draft.AXValue);
    }
  });

  it.each([false, true])('rebinds only unique message guards when the growing editor virtualizes siblings (ambiguous=%s)', (ambiguous) => {
    const fixture = nativeFixture(); fixture.draft.AXRole = 'AXTextArea'; fixture.header.AXRole = 'AXButton';
    const incoming = { AXRole: 'AXStaticText', AXTitle: 'Exact incoming text, time and sender', AXValue: '', AXEnabled: true };
    const older = { ...incoming, AXTitle: 'Older message' };
    const list = { AXRole: 'AXGroup', AXChildren: [older, incoming] };
    fixture.window.AXChildren.push(list as never);
    let resized = false;
    fixture.onText(() => {
      if (!resized && fixture.draft.AXValue.includes('\n')) { resized = true; list.AXChildren = ambiguous ? [incoming, older, { ...incoming }] : [incoming]; }
    });
    const text = 'First paragraph.\n\nSecond paragraph with no accidental submission.';
    const result = fixture.run({ element: { id: '0.1', role: 'AXTextArea', name: 'Message', value: '' }, guards: [{ id: '0.0', role: 'AXButton', name: 'QA recipient' }, { id: '0.4.1', role: 'AXStaticText', name: incoming.AXTitle, value: '' }], action: 'fill', text });
    if (ambiguous) { expect(result).toEqual({ error: 'element_changed', inputAttempted: true }); expect(fixture.draft.AXValue).toBe('First paragraph.\n'); }
    else expect(fixture.draft.AXValue).toBe(text);
    expect(fixture.effects).not.toContain('unexpected-send');
    expect(fixture.effects).not.toContain('press');
  });

  it('rejects a different or moved foreground window without relying on AX proxy equality', () => {
    const fixture = nativeFixture();
    fixture.moveWindow();
    expect(fixture.run()).toMatchObject({ available: true });
    expect(fixture.run({ action: 'fill', text: 'Approved', element: { id: '0.1', role: 'AXTextField', name: 'Message', value: '' }, guards: [] })).toEqual({ error: 'focus_changed', inputAttempted: false });
    expect(fixture.effects).toEqual([]);
  });

  it('bounds externally supplied native trees and compares only content, not focus flicker', () => {
    const fixture = nativeFixture();
    const tree = parseAccessibility(fixture.run());
    const old = semanticObservation(tree);
    tree.elements[0].focused = !tree.elements[0].focused;
    expect(semanticChanges(old, semanticObservation(tree))).toEqual([]);
    tree.elements[1].value = 'New message';
    expect(semanticChanges(old, semanticObservation(tree))).toHaveLength(1);
    expect(() => parseAccessibility({ ...tree, elements: [...tree.elements, tree.elements[0]] })).toThrow('Ambiguous');
    expect(() => parseAccessibility({ ...tree, elements: Array(501).fill(tree.elements[0]) })).toThrow();
  });

  it('publishes exact per-command batch schemas instead of the permissive field soup', () => {
    const alternatives = MCP_TOOLS.find((tool: any) => tool.name === 'computer_batch')!.inputSchema.properties.steps.items.properties.input.oneOf;
    const screenshot = alternatives.find((input: any) => input.properties.command.const === 'screenshot');
    const click = alternatives.find((input: any) => input.properties.command.const === 'click');
    expect(screenshot.required).toEqual(expect.arrayContaining(['target', 'targetId']));
    expect(screenshot.properties).not.toHaveProperty('space');
    expect(click.required).toContain('space');
    expect(click.properties).not.toHaveProperty('target');
    expect(click.additionalProperties).toBe(false);
    const valid = computerCommandSchema.safeParse({ command: 'batch', steps: [{ input: { command: 'read', targetId: 'window' } }, { input: { command: 'screenshot', target: 'window', targetId: 'window' } }] });
    expect(valid.success).toBe(true);
  });
});
