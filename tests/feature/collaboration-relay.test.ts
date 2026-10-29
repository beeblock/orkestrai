import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { COLLABORATION_PROTOCOL } from '@orkestrai/collaboration-protocol';
import { INFERENCE_PROTOCOL } from '@orkestrai/collaboration-protocol/inference';
import { createRelayServer } from '../../packages/orkestrai-relay/src/server.mjs';

let relay: ReturnType<typeof createRelayServer> | null = null;

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, COLLABORATION_PROTOCOL, { perMessageDeflate: false });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      if (typeof data === 'string') return resolve(data);
      if (data instanceof ArrayBuffer) return resolve(Buffer.from(data).toString('utf8'));
      if (Array.isArray(data)) return resolve(Buffer.concat(data).toString('utf8'));
      return resolve(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8'));
    });
    socket.once('error', reject);
  });
}

afterEach(async () => {
  await relay?.close();
  relay = null;
});

describe('opaque collaboration relay', () => {
  it('isolates inference rooms from workspace sharing and refuses a mismatched protocol', async () => {
    relay=createRelayServer();const address=await relay.listen(0,'127.0.0.1');if(!address || typeof address==='string')throw new Error('address');
    const base=`ws://127.0.0.1:${address.port}`;
    const workspace=await connect(`${base}/v1/connect?share=same_room&peer=host_same&role=host`);
    const host=new WebSocket(`${base}/v1/inference?share=same_room&peer=host_same&role=host`,INFERENCE_PROTOCOL);
    await new Promise<void>((resolve,reject)=>{host.once('open',()=>resolve());host.once('error',reject);});
    const guest=new WebSocket(`${base}/v1/inference?share=same_room&peer=guest_same&role=guest`,INFERENCE_PROTOCOL);
    await new Promise<void>((resolve,reject)=>{guest.once('open',()=>resolve());guest.once('error',reject);});
    let leaked=0;workspace.on('message',()=>leaked++);
    const frame=JSON.stringify({protocol:INFERENCE_PROTOCOL,shareId:'same_room',senderDeviceId:'guest_same',recipientPeerId:'host_same',keyId:'opaque_key_identifier_01',sequence:1,nonce:'AAAAAAAAAAAAAAAA',ciphertext:'opaqueEncryptedPayloadValue'});
    const received=nextMessage(host);guest.send(frame);expect(await received).toBe(frame);expect(leaked).toBe(0);
    await expect(connect(`${base}/v1/inference?share=wrong_room&peer=host_wrong&role=host`)).rejects.toThrow(/426/);
    workspace.close();guest.close();host.close();
  });
  it('forwards a valid opaque envelope without plaintext inspection', async () => {
    relay = createRelayServer();
    const address = await relay.listen(0, '127.0.0.1');
    if (!address || typeof address === 'string') throw new Error('Relay address was not assigned.');
    const base = `ws://127.0.0.1:${address.port}/v1/connect?share=share_relay_test&peer=`;
    const host = await connect(`${base}host_device_01&role=host`);
    const guest = await connect(`${base}guest_device_01&role=guest`);
    const frame = JSON.stringify({
      protocol: COLLABORATION_PROTOCOL,
      shareId: 'share_relay_test',
      senderDeviceId: 'guest_device_01',
      recipientPeerId: 'host_device_01',
      keyId: 'opaque_key_identifier_01',
      sequence: 1,
      nonce: 'AAAAAAAAAAAAAAAA',
      ciphertext: 'opaqueEncryptedPayloadValue',
    });
    const received = nextMessage(host);
    guest.send(frame);
    expect(await received).toBe(frame);
    expect(relay.metrics.framesForwarded).toBe(1);
    host.close();
    guest.close();
  });

  it('rejects browser origins unless explicitly allowlisted', async () => {
    relay = createRelayServer();
    const address = await relay.listen(0, '127.0.0.1');
    if (!address || typeof address === 'string') throw new Error('Relay address was not assigned.');
    const url = `ws://127.0.0.1:${address.port}/v1/connect?share=share_relay_test&peer=host_device_01&role=host`;
    await expect(new Promise((resolve, reject) => {
      const socket = new WebSocket(url, COLLABORATION_PROTOCOL, { origin: 'https://attacker.example' });
      socket.once('open', resolve);
      socket.once('error', reject);
    })).rejects.toThrow(/403/);
  });

  it('accepts the installed app loopback origin and configured web origins', async () => {
    relay = createRelayServer({ allowedOrigins: 'https://orkestrai.app' });
    const address = await relay.listen(0, '127.0.0.1');
    if (!address || typeof address === 'string') throw new Error('Relay address was not assigned.');
    const base = `ws://127.0.0.1:${address.port}/v1/connect?share=share_relay_test&peer=`;

    const desktop = new WebSocket(`${base}host_device_01&role=host`, COLLABORATION_PROTOCOL, {
      origin: 'http://127.0.0.1:49152',
    });
    await new Promise<void>((resolve, reject) => {
      desktop.once('open', resolve);
      desktop.once('error', reject);
    });
    desktop.close();

    await new Promise<void>((resolve) => desktop.once('close', () => resolve()));
    const web = new WebSocket(`${base}host_device_02&role=host`, COLLABORATION_PROTOCOL, {
      origin: 'https://orkestrai.app',
    });
    await new Promise<void>((resolve, reject) => {
      web.once('open', resolve);
      web.once('error', reject);
    });
    web.close();
  });
});
