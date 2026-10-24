import { describe, expect, it } from 'vitest';
import { piAdapter } from '$lib/modules/agent-room/application/adapters/PiAdapter.js';
import { ohMyPiAdapter } from '$lib/modules/agent-room/application/adapters/OhMyPiAdapter.js';
import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
import type { AgentRunRequest } from '$lib/modules/agent-room/domain/types.js';

describe.each([piAdapter, ohMyPiAdapter])('$displayName current contracts', adapter => {
  const request = (allowWrites: boolean) => ({ agent: adapter.id, prompt: 'Private prompt', workingDirectory: '/tmp', allowWrites } as AgentRunRequest);

  it('implements runner metadata and isolates noninteractive sessions', () => {
    expect(adapter.runMetadata(request(false))).toEqual({ permissionMode: 'read-only-tools' });
    expect(adapter.runMetadata(request(true)).permissionMode).toMatch(/^(default|yolo)$/);
    expect(adapter.buildCommand(request(true)).args).toContain('--no-session');
    expect(JSON.stringify(adapter.buildCommand(request(true)).displayArgs)).not.toContain('Private prompt');
  });

  it('selects only native read tools for requests without write authorization', () => {
    const spec = adapter.buildCommand(request(false));
    expect(spec.args).toContain('--no-extensions');
    const tools = spec.args[spec.args.indexOf('--tools') + 1].split(',');
    expect(tools).toContain('read');
    expect(tools).not.toContain('bash');
    expect(tools).not.toContain('write');
    expect(tools).not.toContain('edit');
    expect(spec.args).not.toContain('yolo');
    if (adapter === piAdapter) expect(spec.args).toContain('--no-mcp');
  });

  it('does not mistake an unfinished assistant event for the final answer', () => {
    const end = { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Complete' }] } };
    const start = { type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: 'Unfinished' }] } };
    expect(adapter.parseOutput(JSON.stringify(start)).content).toBe('');
    expect(adapter.parseOutput([end, start].map(item => JSON.stringify(item)).join('\n')).content).toBe('Complete');
  });

  it('does not choose a neighboring agent session and has setup on every supported OS', () => {
    expect(adapter.supportsResume).toBe(false);
    expect(adapter.resumeArgs('neighboring-agent')).toBeNull();
    expect(adapter.resumeArgs()).toBeNull();
    for (const platform of ['darwin', 'linux', 'windows'] as const) expect(adapter.setup.installCommands?.[platform]).toBeTruthy();
    expect(providerIcons[adapter.id]).toBeTruthy();
  });
});
