import { describe, expect, it } from 'vitest';
import { updateOrkestraiGitExclude } from '$lib/modules/agent-room/infrastructure/bridge-git-exclude.js';

describe('bridge git excludes', () => {
  it('unhides user-owned files from the exact legacy block', () => {
    const current = [
      '# local excludes',
      '.orkestrai/',
      '.claude/skills/orkestrai/',
      '.cline/skills/orkestrai/',
      '.devin/skills/orkestrai/',
      '.agents/skills/orkestrai/',
      '.mcp.json',
      '.cursor/mcp.json',
      '.cline/mcp.json',
      '.devin/mcp_config.json',
      '.agents/mcp_config.json',
      'opencode.json',
      'AGENTS.md',
      '',
    ].join('\r\n');

    const next = updateOrkestraiGitExclude(current);

    expect(next).toContain('.orkestrai/');
    expect(next.split(/\r?\n/)).not.toContain('.orkestrai/');
    expect(next).toContain('!**/.orkestrai/roles/');
    expect(next).not.toContain('.mcp.json');
    expect(next).not.toContain('AGENTS.md');
    expect(next).toContain('\r\n');
  });

  it('preserves independently maintained excludes outside the legacy block', () => {
    const current = '# mine\nAGENTS.md\n';
    const next = updateOrkestraiGitExclude(current);
    expect(next).toContain('# mine\nAGENTS.md\n');
  });

  it('keeps independent owner-wide exclusions and is idempotent', () => {
    const owner = '# Explicit owner exclusions\n.orkestrai/\nAGENTS.md\n';
    const next = updateOrkestraiGitExclude(owner);
    expect(next).toContain(owner);
    expect(updateOrkestraiGitExclude(next)).toBe(next);
  });

  it('migrates the old generated-only block without removing adjacent owner rules', () => {
    const owner = '# Owner\nprivate-art/\n';
    const old = '.orkestrai/\n.claude/skills/orkestrai/\n.cline/skills/orkestrai/\n.devin/skills/orkestrai/\n.agents/skills/orkestrai/\n';
    const next = updateOrkestraiGitExclude(owner + old + 'secrets.local\n');
    expect(next).toContain(owner);
    expect(next).toContain('secrets.local\n');
    expect(next.split('\n')).not.toContain('.orkestrai/');
    expect(next).toContain('!**/.orkestrai/designs/');
  });
});
