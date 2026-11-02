import { describe, expect, it, vi } from 'vitest';
import { executeMcpTool } from '../../packages/orkestrai-cli/src/mcp.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { bridgeBoardTaskSchema, updateBoardTaskSchema } from '$lib/modules/agent-room/contracts/schemas/taskSchemas.js';
import { LEADER_EXECUTION_CONTRACT } from '$lib/modules/agent-room/domain/leader-execution.js';
import { uuidv7 } from '@beeblock/svelar/support';
describe('execution bridge and documentation contracts',()=>{
  it('keeps dependency updates on the existing scoped task command path',async()=>{
    const bridge=vi.fn().mockResolvedValue({});const taskId=uuidv7(),dependencies=[uuidv7()];
    await executeMcpTool({bridge,findFreePort:async()=>0,selfAgent:null},'task_dependencies',{taskId,dependencies});
    expect(bridge).toHaveBeenCalledWith('PATCH',`/api/agent-room/bridge/tasks/${taskId}`,{dependencies});
    expect(bridgeBoardTaskSchema.parse({title:'work',dependencies}).dependencies).toEqual(dependencies);
    expect(updateBoardTaskSchema.safeParse({dependencies:['outside-workspace-path']}).success).toBe(false);
    expect(updateBoardTaskSchema.safeParse({dependencies:Array.from({length:65},()=>uuidv7())}).success).toBe(false);
  });
  it('exposes progressive help without hiding capabilities or dropping the common guidelines',async()=>{
    const guide=bridgeService.guide();expect(guide.sections.length).toBeGreaterThan(4);
    for(const section of guide.sections) expect(bridgeService.guide(section.id).text).toContain(section.title);
    expect(()=>bridgeService.guide('no such section')).toThrow();
    const discovery=bridgeService.bridgeDiscoveryContent();
    expect(discovery.length).toBeLessThan(5000);
    expect(discovery).toContain('karpathy-guidelines');expect(discovery).toContain('all agents');
    expect(discovery).toContain('All workspace features remain available');
    expect(discovery).toContain('specialists implement');expect(discovery).toContain('REFERENCE.md');
    const bridge=vi.fn().mockResolvedValue(guide);
    await executeMcpTool({bridge,findFreePort:async()=>0,selfAgent:null},'workspace_guide',{});
    expect(bridge).toHaveBeenCalledWith('GET','/api/agent-room/bridge/guide');
  });
  it('keeps implementation delegated while allowing an event-driven waiting turn',()=>{
    expect(LEADER_EXECUTION_CONTRACT).toContain('Do not assign implementation tasks to yourself');
    expect(LEADER_EXECUTION_CONTRACT).toContain('end this model turn while specialists execute');
    expect(LEADER_EXECUTION_CONTRACT).toContain('Ending a waiting turn does not end the delivery');
  });
});
