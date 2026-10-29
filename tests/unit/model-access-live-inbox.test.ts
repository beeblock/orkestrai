import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ModelAccessBridgeController } from '$lib/modules/model-access/interface/http/controllers/ModelAccessBridgeController.js';
import { guestAgentService } from '$lib/modules/model-access/application/services/GuestAgentService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';

afterEach(()=>vi.restoreAllMocks());
describe('guest bridge inbox parity',()=>{
  it.each([0,2])('reads pending inbox only when the authenticated bridge advertises %s messages',async pending=>{
    const workspaceId=randomUUID(),nodeId=randomUUID();
    vi.spyOn(bridgeService,'resolveWorkspaceByToken').mockResolvedValue({id:workspaceId,workingDir:'/isolated/project'} as any);
    vi.spyOn(ptySessionManager,'resolveBridgeAgent').mockReturnValue(nodeId);
    vi.spyOn(autonomyPolicyService,'runWindow').mockResolvedValue({allowed:true} as any);
    const fetch=vi.fn(async(path:string,options:RequestInit)=>{
      expect(new Headers(options.headers).get('x-orkestrai-agent-token')).toBe('test-live-token');
      expect(new Headers(options.headers).get('authorization')).toBe('Bearer test-workspace-token');
      if(path.endsWith('/inbox')) return Response.json({data:{items:[{messageId:'new-message',content:'New owner request'}],remaining:0}});
      return Response.json({data:{agents:[]}}, {headers: pending ? {'x-orkestrai-inbox':String(pending)} : {}});
    });
    const execute=vi.spyOn(guestAgentService,'run').mockImplementation(async(_dto,context)=>{
      expect(await context.bridge('GET','/api/agent-room/bridge/list')).toEqual({agents:[]});
      expect(await context.readInbox!()).toEqual(pending ? {items:[{messageId:'new-message',content:'New owner request'}],remaining:0} : null);
      expect(await context.readInbox!()).toBeNull();
    });
    const url=new URL('http://127.0.0.1/api/agent-room/bridge/model-access/agent');
    const request=new Request(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-workspace-token','x-orkestrai-agent-token':'test-live-token'},body:JSON.stringify({operation:'open',sessionId:randomUUID()})});
    const response=await new ModelAccessBridgeController().agent({url,request,fetch,locals:{},params:{}});
    expect(response.status).toBe(200);
    await response.text();
    expect(execute).toHaveBeenCalledOnce();
    // An assertion thrown inside run is converted to a safe stream error.
    await expect(execute.mock.results[0].value).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(pending ? 2 : 1);
  });
});
