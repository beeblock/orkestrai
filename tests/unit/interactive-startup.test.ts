import { describe, expect, it } from 'vitest';
import { interactiveStartupGuard, InteractiveStartupGuard } from '$lib/modules/agent-room/application/adapters/interactive-startup.ts';

const trust = 'Accessing workspace: /workspace\r\nQuick safety check: Is this a project you created or one you trust?\r\n\u276f No, exit\r\n  Yes, I trust this folder\r\nEnter to confirm';

describe('interactive startup confirmation', () => {
  it('recognizes the current Claude trust prompt across ANSI/chunk boundaries', () => {
    const guard = new InteractiveStartupGuard();
    const output = `\x1b[32m${trust}\x1b[0m`;
    for (const character of output) guard.observe(character);
    expect(guard.canAcceptMessages).toBe(false);
    guard.observe('   ');
    expect(guard.canAcceptMessages).toBe(false);
  });

  it('requires a human decision and a real composer, not a quiet or cleared screen', () => {
    const guard = new InteractiveStartupGuard();
    guard.observe(trust);
    guard.observe('\x1b[2J? for shortcuts');
    expect(guard.canAcceptMessages).toBe(false);
    guard.humanInput('\x1b[B');
    expect(guard.canAcceptMessages).toBe(false);
    guard.humanInput('\r');
    guard.observe('\x1b[2JLoading...');
    expect(guard.canAcceptMessages).toBe(false);
    guard.observe('\x1b[2J\u276f \r\n? for shortcuts');
    expect(guard.canAcceptMessages).toBe(true);
  });

  it('does not treat a redrawn trust menu or a second confirmation as acceptance', () => {
    const guard = new InteractiveStartupGuard();
    guard.observe(trust);
    guard.humanInput('\r');
    guard.observe(`\x1b[2J${trust}`);
    expect(guard.canAcceptMessages).toBe(false);
    guard.humanInput('\r');
    guard.observe('\x1b[2JBypass Permissions mode\r\nNo, exit\r\nYes, I accept');
    expect(guard.canAcceptMessages).toBe(false);
    guard.humanInput('\r');
    guard.observe('\x1b[2Jbypass permissions on (shift+tab to cycle)');
    expect(guard.canAcceptMessages).toBe(true);
  });

  it('waits through slow bootstrap and recognizes an already trusted composer', () => {
    const guard = new InteractiveStartupGuard();
    guard.observe('Loading Claude...');
    expect(guard.canAcceptMessages).toBe(false);
    guard.observe('\r\n? for shortcuts');
    expect(guard.canAcceptMessages).toBe(true);
    guard.observe(trust); // Quoted task content is not another startup dialog.
    expect(guard.canAcceptMessages).toBe(true);
  });

  it('recognizes an empty composer with shortcut hints hidden', () => {
    const guard = new InteractiveStartupGuard();
    guard.observe('\x1b[2JClaude Code\r\n\u276f \r\n');
    expect(guard.canAcceptMessages).toBe(true);
  });

  it('keeps other providers and plain shells on their existing delivery contract', () => {
    expect(interactiveStartupGuard('claude')).toBeInstanceOf(InteractiveStartupGuard);
    for (const provider of ['codex', 'kimi', 'cursor', 'custom-provider', null, undefined]) {
      expect(interactiveStartupGuard(provider)).toBeNull();
    }
  });
});
