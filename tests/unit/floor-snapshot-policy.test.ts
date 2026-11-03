import { describe, expect, it } from 'vitest';
import { isFloorRuntimePath } from '$lib/modules/agent-room/infrastructure/FloorSnapshotPolicy.js';

describe('Floor runtime exclusions preserve authored workspace content', () => {
  it.each(['.orkestrai/floors/old/game.bin', 'game/.orkestrai/floors/old/.orkestrai/floors/nested/a',
    '.Orkestrai\\Floors\\old\\a', '.orkestrai/reviews/revision/source.ts', '.orkestrai/bin/orkestrai',
    '.orkestrai/workspace.json', 'game/.orkestrai/runtime.json'])('excludes runtime state: %s', path => {
    expect(isFloorRuntimePath(path)).toBe(true);
  });
  it.each(['.orkestrai/roles/qa/role.json', '.orkestrai/skills/qa/SKILL.md', '.orkestrai/designs/source.json',
    '.orkestrai/images/approved.png', '.orkestrai/knowledge/brief.md', '.orkestrai/roles/qa/workspace.json',
    '.orkestrai/bin/project-helper.sh',
    '.claude/skills/custom/SKILL.md', '.agents/skills/custom/SKILL.md', 'generated/art.png'])('preserves source and intentionally versioned artifacts: %s', path => {
    expect(isFloorRuntimePath(path)).toBe(false);
  });
});
