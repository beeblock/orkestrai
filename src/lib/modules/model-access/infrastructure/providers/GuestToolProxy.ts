import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { InferenceProviderRun } from './InferenceProvider.js';
import { parseInferenceJson } from '../../contracts/schemas/model-access.schema.js';

export async function guestToolProxy(input: InferenceProviderRun) {
  const token = randomBytes(32).toString('base64url');
  const tools = new Map(input.request.tools.map(tool => [tool.name, tool]));
  const publicTools = [...tools.values()].filter(tool => !tool.internal);
  const compact = publicTools.length > 32;
  const discovery = [
    {name:'orkestrai_tool_search',description:'Discover ANY native Orkestrai capability on the GUEST: tasks, inbox, agents, notes, knowledge, Canvas, Shells, Portals, devices, image/video workflows, designs and integrations. Search a short phrase or exact tool name to obtain its current validated schema. New features appear automatically. Use orkestrai_tool_call with the returned name and arguments.',inputSchema:{type:'object',additionalProperties:false,properties:{query:{type:'string',maxLength:300}},required:['query']}},
    {name:'orkestrai_tool_call',description:'Execute a native Orkestrai tool on the GUEST using its exact name and arguments from orkestrai_tool_search. Uses the same authenticated CLI/MCP dispatcher and guest policy checks. No host terminal/files or owner credentials are available.',inputSchema:{type:'object',additionalProperties:false,properties:{name:{type:'string',maxLength:96},arguments:{type:'object'}},required:['name','arguments']}},
  ];
  const visible = compact ? [...publicTools.filter(tool => ['exec_command','read_file','write_file','copy_file','view_image','imagegen'].includes(tool.name)),...discovery] : publicTools;
  let active = 0;
  const server = http.createServer(async (request, response) => {
    const auth = Buffer.from(request.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${token}`);
    if (request.method !== 'POST' || request.url !== '/mcp' || auth.length !== expected.length || !timingSafeEqual(auth, expected) || input.signal.aborted) { response.writeHead(403); response.end(); return; }
    if (++active > 8) { active--; response.writeHead(429); response.end(); return; }
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { size += chunk.length; if (size > 256 * 1024) throw new Error('INFERENCE_TOOL_LIMIT'); chunks.push(chunk); }
      const value = parseInferenceJson(Buffer.concat(chunks)) as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      let result: unknown;
      if (value.method === 'tools/list') result = { tools: visible.map(tool => {const {internal:_internal,...definition}=tool as typeof publicTools[number];return definition;}) };
      else if (compact && value.method === 'tools/call' && value.params?.name === 'orkestrai_tool_search') {
        const query=value.params.arguments?.query;
        if(typeof query!=='string' || !query.trim() || query.length>300)throw new Error('INFERENCE_TOOL_ARGUMENTS');
        const words=query.toLowerCase().split(/[\s_-]+/).filter(Boolean);
        const ranked=publicTools.map(tool=>({tool,score:words.reduce((score,word)=>score+(tool.name.toLowerCase().includes(word)?5:0)+(tool.description.toLowerCase().includes(word)?1:0),0)})).filter(item=>item.score).sort((a,b)=>b.score-a.score).slice(0,8).map(({tool:{internal:_internal,...tool}})=>tool);
        result={content:[{type:'text',text:JSON.stringify({tools:ranked,callWith:'orkestrai_tool_call'})}]};
      }
      else if (compact && value.method === 'tools/call' && value.params?.name === 'orkestrai_tool_call') {
        const args=value.params.arguments, name=args?.name, parameters=args?.arguments;
        if(typeof name!=='string' || !tools.has(name) || tools.get(name)?.internal || !parameters || typeof parameters!=='object' || Array.isArray(parameters))throw new Error('INFERENCE_TOOL_DENIED');
        const answer=await input.callTool(name,parameters as Record<string,unknown>);
        result={isError:!answer.success,content:answer.content.map(part=>part.type==='text'?part:{type:'image',mimeType:part.mime,data:part.data})};
      }
      else if (value.method === 'tools/call' && value.params?.name && tools.has(value.params.name) && !tools.get(value.params.name)?.internal) {
        const args = value.params.arguments ?? {};
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('INFERENCE_TOOL_ARGUMENTS');
        const answer = await input.callTool(value.params.name, args);
        result = { isError: !answer.success, content: answer.content.map(part => part.type === 'text' ? part : { type: 'image', mimeType: part.mime, data: part.data }) };
      } else throw new Error('INFERENCE_TOOL_DENIED');
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result));
    } catch { response.writeHead(400); response.end(JSON.stringify({ error: 'INFERENCE_TOOL_FAILED' })); }
    finally { active--; }
  });
  server.requestTimeout = 10 * 60_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('INFERENCE_PROXY_FAILED');
  return { url: `http://127.0.0.1:${address.port}/mcp`, token, close: () => { server.closeAllConnections(); server.close(); } };
}
