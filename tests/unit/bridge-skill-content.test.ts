import { describe, expect, it } from 'vitest';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';

describe('bridge skill content', () => {
  it('renders the whole agent guide, including how to show images in Chat', () => {
    const content = bridgeService.bridgeSkillContent();
    expect(content.startsWith('---\nname: orkestrai-bridge')).toBe(true);
    expect(content).toContain('orkestrai post');
    expect(content).toContain('`![descrição](caminho/relativo/ao/workspace.png)`');
    expect(content).toContain('o app coloca a mesma imagem no Canvas, ao seu lado e conectada a você');
    expect(content).toContain('Focused delivery (all agents)');
    expect(content).toContain('karpathy-guidelines');
    expect(content).toContain('Resolve routine reversible choices autonomously');
    expect(content).toContain('use task_read / orkestrai task read');
  });
});
