import { describe, expect, it } from 'vitest';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';

describe('bridge skill content', () => {
  it('renders the whole agent guide, including how to show images in Chat', () => {
    const content = bridgeService.bridgeSkillContent();
    expect(content.startsWith('---\nname: orkestrai-bridge')).toBe(true);
    expect(content).toContain('orkestrai post');
    expect(content).toContain('`![descrição](caminho/relativo/ao/workspace.png)`');
    expect(content).toContain('a Conversa exibe o mesmo arquivo que aparece no Canvas');
  });
});
