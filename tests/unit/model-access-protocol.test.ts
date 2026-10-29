import { describe, expect, it } from 'vitest';
import { inferenceIdentity, inferenceEphemeral, inferenceNonce, inferenceFingerprint, signInference, verifyInference, inferencePairingMaterial, inferenceSessionMaterial, inferenceInvite, parseInferenceInvite, SecureInferenceChannel } from '@orkestrai/collaboration-protocol/inference';

const grantId = 'grant_private_123';
function pair() {
  const secret = inferenceNonce(), host = inferenceEphemeral(), guest = inferenceEphemeral();
  const common = { secret, grantId, sessionId: 'session_private_123', guestNonce: inferenceNonce(), hostNonce: inferenceNonce(), guestId: 'guest_private_123', hostId: 'host_private_123', revision: 2 };
  const hostMaterial = inferenceSessionMaterial({ ...common, privateKey: host.privateKey, remotePublicKey: guest.publicKey });
  const guestMaterial = inferenceSessionMaterial({ ...common, privateKey: guest.privateKey, remotePublicKey: host.publicKey });
  return { host: new SecureInferenceChannel({ role: 'host', grantId, localId: common.hostId, remoteId: common.guestId, material: hostMaterial }), guest: new SecureInferenceChannel({ role: 'guest', grantId, localId: common.guestId, remoteId: common.hostId, material: guestMaterial }), secret, hostMaterial, guestMaterial };
}
describe('inference-only protocol', () => {
  it('pins the owner identity and keeps the pairing secret out of the relay URL', () => {
    const identity = inferenceIdentity(), secret = inferenceNonce();
    const uri = inferenceInvite({ grantId, secret, ownerPublicKey: identity.publicKey, relayUrl: 'wss://relay.example/v1/inference' });
    expect(new URL(uri).search).not.toContain(secret);
    expect(parseInferenceInvite(uri)).toEqual({ grantId, secret, ownerPublicKey: identity.publicKey, relayUrl: 'wss://relay.example/v1/inference' });
    expect(() => parseInferenceInvite(uri.replace('?relay=', '?relay=bad&relay='))).toThrow();
    expect(() => inferenceInvite({ grantId, secret, ownerPublicKey: identity.publicKey, relayUrl: 'ws://external.example' })).toThrow();
  });
  it('signs identity and ephemeral keys with a domain-separated transcript', () => {
    const identity = inferenceIdentity(); const fields = [grantId, inferenceNonce(), inferenceEphemeral().publicKey];
    const signature = signInference(identity.privateKey, 'pair.request', fields);
    expect(verifyInference(identity.publicKey, signature, 'pair.request', fields)).toBe(true);
    expect(verifyInference(identity.publicKey, signature, 'pair.approved', fields)).toBe(false);
    expect(verifyInference(inferenceIdentity().publicKey, signature, 'pair.request', fields)).toBe(false);
    expect(inferenceFingerprint(identity.publicKey)).toMatch(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  });
  it('derives matching directional session keys, independent of the invitation key', () => {
    const { host, guest, hostMaterial, guestMaterial, secret } = pair();
    expect(hostMaterial).toEqual(guestMaterial);
    expect(hostMaterial.hostToGuestKey).not.toEqual(hostMaterial.guestToHostKey);
    expect(hostMaterial.keyId).not.toBe(inferencePairingMaterial(secret, grantId).keyId);
    expect(guest.decrypt(host.encrypt({ type: 'ping', at: 1 }))).toEqual({ type: 'ping', at: 1 });
    expect(host.decrypt(guest.encrypt({ type: 'pong', at: 1 }))).toEqual({ type: 'pong', at: 1 });
  });
  it('rejects replay, tampering, cross-room, cross-protocol and workspace commands', () => {
    const { host, guest } = pair(); const frame = host.encrypt({ type: 'ping', at: 1 });
    expect(() => guest.decrypt({ ...frame, shareId: 'another_grant' })).toThrow();
    expect(() => guest.decrypt({ ...frame, protocol: 'orkestrai-collaboration.v1' })).toThrow();
    expect(() => guest.decrypt({ ...frame, sequence: 20 })).toThrow();
    expect(() => guest.decrypt({ ...frame, ciphertext: frame.ciphertext.slice(0, -4) + 'aaaa' })).toThrow();
    expect(guest.decrypt(frame)).toEqual({ type: 'ping', at: 1 });
    expect(() => guest.decrypt(frame)).toThrow();
    expect(() => host.encrypt({ type: 'terminal.input', data: 'cat ~/.claude/.credentials.json' } as any)).toThrow();
    host.destroy(); expect(() => host.encrypt({ type: 'ping', at: 2 })).toThrow('INFERENCE_CHANNEL_CLOSED');
  });
});
