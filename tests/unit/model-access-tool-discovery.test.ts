import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MCP_TOOLS } from '../../packages/orkestrai-cli/src/mcp.js';
import { guestToolProxy } from '$lib/modules/model-access/infrastructure/providers/GuestToolProxy.js';
describe('delegated native tool discovery',()=>{
  it('exposes every current/future guest operation on demand without loading the full registry into every model turn',async()=>{
    const call=vi.fn(async()=>({callId:randomUUID(),success:true,content:[{type:'text',text:'guest result'}]}));
    const proxy=await guestToolProxy({request:{tools:[...MCP_TOOLS,{name:'future_feature',description:'Manage a newly shipped future feature.',inputSchema:{type:'object'},internal:false},{name:'imagegen_store',description:'Internal',inputSchema:{type:'object'},internal:true}]},signal:new AbortController().signal,callTool:call} as any);
    const request=async(method:string,params?:unknown)=>fetch(proxy.url,{method:'POST',headers:{authorization:`Bearer ${proxy.token}`},body:JSON.stringify({method,params})});
    try{
      const visible=await(await request('tools/list')).json();expect(visible.tools.map((tool:any)=>tool.name)).toEqual(['orkestrai_tool_search','orkestrai_tool_call']);
      expect(JSON.stringify(visible).length).toBeLessThan(2500);
      const search=await(await request('tools/call',{name:'orkestrai_tool_search',arguments:{query:'future_feature'}})).json();
      expect(JSON.parse(search.content[0].text).tools[0].name).toBe('future_feature');
      const answer=await(await request('tools/call',{name:'orkestrai_tool_call',arguments:{name:'future_feature',arguments:{value:3}}})).json();expect(answer.content[0].text).toBe('guest result');expect(call).toHaveBeenCalledWith('future_feature',{value:3});
      expect((await request('tools/call',{name:'imagegen_store',arguments:{}})).status).toBe(400);
      expect((await request('tools/call',{name:'orkestrai_tool_call',arguments:{name:'imagegen_store',arguments:{}}})).status).toBe(400);
      expect((await fetch(proxy.url,{method:'POST',body:JSON.stringify({method:'tools/list'})})).status).toBe(403);
    } finally{proxy.close();}
  });
});
