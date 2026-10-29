import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { guestAgentSelection } from '$lib/modules/model-access/application/services/GuestAgentSelection.js';
import { runModelAccessAgent } from '../../packages/orkestrai-cli/src/model-access-agent.js';

function fixture() {
  const connection = {id:randomUUID(),status:'active',state:'connected',policy:{offerings:[{id:randomUUID(),models:['allowed'],efforts:['high'],availableModels:[{value:'allowed',efforts:['high']}]}]}} as any;
  const model = `${connection.id}/${connection.policy.offerings[0].id}/allowed`;
  return {connection,model};
}
describe('guest agent model identity and input', () => {
  it('inherits the leader selection, then pins the exact selected access across restart', () => {
    const {connection,model} = fixture();
    expect(guestAgentSelection({},{} as any,{model,effort:'high'} as any,[connection])).toMatchObject({value:model,effort:'high'});
    expect(guestAgentSelection({},{} as any,undefined,[connection])).toMatchObject({value:model,effort:'high'});
    expect(() => guestAgentSelection({model,effort:'high'},{} as any,undefined,[{...connection,state:'offline'},fixture().connection])).toThrow('POLICY_DENIED');
  });
  it('requires an explicit selection when several accounts are available and rejects forbidden effort', () => {
    const {connection,model} = fixture();
    expect(() => guestAgentSelection({},{} as any,undefined,[connection,fixture().connection])).toThrow('SELECT_MODEL');
    expect(() => guestAgentSelection({model,effort:'low'},{} as any,undefined,[connection])).toThrow('POLICY_DENIED');
  });
  it('uses the server-resolved model and preserves split UTF-8 and bracketed multiline paste', async () => {
    const input = new PassThrough(), requests:any[] = []; const {model}=fixture();
    let ready!:() => void, submitted!:() => void;
    const started = new Promise<void>(resolve => ready=resolve), finished = new Promise<void>(resolve => submitted=resolve);
    const run = runModelAccessAgent([], {input,write:value => {if(value.includes('❯')) ready();},request:async body => {
      requests.push(body);
      if(body.operation === 'turn') submitted();
      return new Response(JSON.stringify({event:'configured',text:JSON.stringify({model,effort:'high'})})+'\n');
    }});
    await started;
    input.write('\x1b[200~'); const bytes=Buffer.from('ação\nsegunda linha');
    for(const byte of bytes) input.write(Buffer.from([byte]));
    input.write('\x1b[201~\r'); await finished; input.end(); await run;
    expect(requests).toHaveLength(2); expect(requests[1]).toMatchObject({model,effort:'high',prompt:'ação\nsegunda linha'});
  });
});
