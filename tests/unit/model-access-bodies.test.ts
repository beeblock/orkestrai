import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SecureInferenceChannel, inferencePairingMaterial, inferenceNonce } from '@orkestrai/collaboration-protocol/inference';
import { InferenceBodies, sendInferenceBody } from '$lib/modules/model-access/infrastructure/transport/InferenceBodies.js';
afterEach(()=>vi.useRealTimers());
describe('paced inference image bodies',()=>{
  it('keeps simultaneous upload and image return below the relay shared one-MiB wire budget',async()=>{
    vi.useFakeTimers({now:0});const grantId=randomUUID(),hostId=randomUUID(),guestId=randomUUID(),material=inferencePairingMaterial(inferenceNonce(),grantId);
    const host=new SecureInferenceChannel({role:'host',grantId,localId:hostId,remoteId:guestId,material});
    const guest=new SecureInferenceChannel({role:'guest',grantId,localId:guestId,remoteId:hostId,material});
    let began=0,bytes=0,maximum=0;
    const send=(channel:SecureInferenceChannel)=>async(message:any)=>{if(Date.now()-began>=1000){maximum=Math.max(maximum,bytes);began=Date.now();bytes=0;}bytes+=Buffer.byteLength(JSON.stringify(channel.encrypt(message)));maximum=Math.max(maximum,bytes);};
    const body=Buffer.alloc(1024*1024,7);const uploads=[sendInferenceBody(send(guest),randomUUID(),'inference',body),sendInferenceBody(send(host),randomUUID(),'tool.call',body)];
    await vi.runAllTimersAsync();await Promise.all(uploads);expect(maximum).toBeLessThan(1024*1024);host.destroy();guest.destroy();
  });
  it('gives a maximum sized paced body enough assembly time and clears its deadline',async()=>{
    vi.useFakeTimers();const failed=vi.fn();const bodies=new InferenceBodies(async()=>{},failed);const size=32*1024*1024;
    await bodies.receive({type:'body.start',requestId:randomUUID(),kind:'inference',size,chunks:Math.ceil(size/49152),sha256:'0'.repeat(64)});
    await vi.advanceTimersByTimeAsync(90000);expect(failed).not.toHaveBeenCalled();bodies.clear();await vi.runAllTimersAsync();expect(failed).not.toHaveBeenCalled();
  });
});
