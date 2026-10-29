import { describe, expect, it } from 'vitest';
import { parseLatestTurnBoundary } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';
const start='2026-10-29T12:00:00.000Z', end='2026-10-29T12:00:01.000Z';
const user={type:'user',timestamp:start,message:{role:'user',content:[{type:'text',text:'Inspect the workspace.'}]}};
const placeholder={type:'assistant',timestamp:start,message:{role:'assistant',content:[],stop_reason:'tool_use'}};
const tool={type:'guest-tool',timestamp:start,name:'canvas_list',summary:'Read completed.'};
const done={type:'assistant',timestamp:end,message:{role:'assistant',content:[{type:'text',text:''}],stop_reason:'end_turn'}};
const jsonl=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).join('\n');
describe('managed guest agent composer boundary',()=>{
  it('releases inbox delivery after an explicit tool-only turn, without requiring answer text',()=>{
    expect(parseLatestTurnBoundary('orkestrai-jsonl',jsonl([user,placeholder,tool,done]))).toEqual({ready:true,startedAt:Date.parse(start),finishedAt:Date.parse(end)});
  });
  it('keeps a new or still-running turn blocked even after an earlier completed answer',()=>{
    expect(parseLatestTurnBoundary('orkestrai-jsonl',jsonl([user,done,{...user,timestamp:end},placeholder,tool])).ready).toBe(false);
    expect(parseLatestTurnBoundary('orkestrai-jsonl',jsonl([user,placeholder,tool])).ready).toBe(false);
  });
});
