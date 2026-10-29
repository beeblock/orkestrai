import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApproveModelAccessRequest, ReviseModelAccessRequest, ModelAccessActionRequest } from '$lib/modules/model-access/interface/http/requests/ModelAccessRequest.js';
function event(body:unknown){const url=new URL('http://127.0.0.1/api/model-access/'+randomUUID());return {url,params:{id:url.pathname.split('/').at(-1)},request:new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),locals:{}} as any;}
describe('model access Svelar FormRequest route contracts',()=>{
  it('validates the route id and returns only strict action body fields',async()=>{
    expect(await ModelAccessActionRequest.validate(event({action:'invite'}))).toEqual({action:'invite'});
    expect(await ModelAccessActionRequest.validate(event({action:'revoke',revision:2}))).toEqual({action:'revoke',revision:2});
    await expect(ModelAccessActionRequest.validate(event({action:'invite',extra:'forbidden'}))).rejects.toThrow();
    const invalid=event({action:'invite'});invalid.params.id='invalid';await expect(ModelAccessActionRequest.validate(invalid)).rejects.toThrow();
  });
  it('keeps approval and policy edits compatible with their shared strict schemas',async()=>{
    const approval={revision:1,guestId:randomUUID(),fingerprint:'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD',approved:true};
    expect(await ApproveModelAccessRequest.validate(event(approval))).toEqual(approval);
    const edit={revision:1,name:'Edited access',expiresInMinutes:60,offerings:[{providerId:'codex',profileId:null,models:null,efforts:null,images:true}],concurrency:1,requestsPerMinute:10,maxRequests:null};
    expect(await ReviseModelAccessRequest.validate(event(edit))).toEqual(edit);
  });
});
