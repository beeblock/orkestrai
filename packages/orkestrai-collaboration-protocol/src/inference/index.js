import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, sign, verify } from 'node:crypto';
import { INFERENCE_PROTOCOL, MAX_INFERENCE_FRAME_BYTES, MAX_INFERENCE_PLAINTEXT_BYTES, inferenceEnvelopeSchema, inferenceMessageSchema, inferenceIdSchema } from './common.js';
export * from './common.js';

/** @param {string} value @param {number} size */
function fixed(value, size) { const bytes = Buffer.from(value, 'base64url'); if (bytes.length !== size || bytes.toString('base64url') !== value) throw new Error('INFERENCE_INVALID_KEY'); return bytes; }
/** @param {string} value @param {'ed25519'|'x25519'} algorithm */
function publicKey(value, algorithm) {
  const result = createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' });
  if (result.asymmetricKeyType !== algorithm) throw new Error('INFERENCE_INVALID_KEY'); return result;
}
/** @param {'ed25519'|'x25519'} algorithm */
function keys(algorithm) {
  const pair = algorithm === 'ed25519' ? generateKeyPairSync('ed25519') : generateKeyPairSync('x25519');
  return { publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'), privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url') };
}
export const inferenceIdentity = () => keys('ed25519');
export const inferenceEphemeral = () => keys('x25519');
export const inferenceNonce = () => randomBytes(32).toString('base64url');
/** @param {string} value */
export function inferenceFingerprint(value) { publicKey(value, 'ed25519'); return createHash('sha256').update(Buffer.from(value, 'base64url')).digest('hex').slice(0, 32).toUpperCase().match(/.{4}/g).join('-'); }
/** @param {string} purpose @param {unknown[]} fields */
const transcript = (purpose, fields) => Buffer.from(JSON.stringify([INFERENCE_PROTOCOL, purpose, ...fields]));
/** @param {string} privateDer @param {string} purpose @param {unknown[]} fields */
export function signInference(privateDer, purpose, fields) { return sign(null, transcript(purpose, fields), createPrivateKey({ key: Buffer.from(privateDer, 'base64url'), format: 'der', type: 'pkcs8' })).toString('base64url'); }
/** @param {string} publicDer @param {string} signature @param {string} purpose @param {unknown[]} fields */
export function verifyInference(publicDer, signature, purpose, fields) {
  try { return verify(null, transcript(purpose, fields), publicKey(publicDer, 'ed25519'), fixed(signature, 64)); } catch { return false; }
}
/** @param {Buffer} secret @param {unknown[]} fields */
function material(secret, fields) {
  const salt = createHash('sha256').update(transcript('channel', fields)).digest();
  const hostToGuestKey = Buffer.from(hkdfSync('sha256', secret, salt, `${INFERENCE_PROTOCOL}:host-to-guest`, 32));
  const guestToHostKey = Buffer.from(hkdfSync('sha256', secret, salt, `${INFERENCE_PROTOCOL}:guest-to-host`, 32));
  return { hostToGuestKey, guestToHostKey, keyId: createHash('sha256').update(hostToGuestKey).update(guestToHostKey).digest('base64url').slice(0, 24) };
}
/** @param {string} secret @param {string} grantId */
export function inferencePairingMaterial(secret, grantId) { inferenceIdSchema.parse(grantId); return material(fixed(secret, 32), ['pairing', grantId]); }
/** @param {{privateKey:string,remotePublicKey:string,secret:string,grantId:string,sessionId:string,guestNonce:string,hostNonce:string,guestId:string,hostId:string,revision:number}} input */
export function inferenceSessionMaterial(input) {
  const shared = diffieHellman({ privateKey: createPrivateKey({ key: Buffer.from(input.privateKey, 'base64url'), type: 'pkcs8', format: 'der' }), publicKey: publicKey(input.remotePublicKey, 'x25519') });
  try { return material(Buffer.concat([shared, fixed(input.secret, 32)]), ['session', input.grantId, input.sessionId, input.guestNonce, input.hostNonce, input.guestId, input.hostId, input.revision]); }
  finally { shared.fill(0); }
}
/** @param {Record<string,any>} envelope */
const aad = envelope => transcript('frame', [envelope.protocol, envelope.shareId, envelope.senderDeviceId, envelope.recipientPeerId, envelope.keyId, envelope.sequence, envelope.nonce]);

export class SecureInferenceChannel {
  #sendKey; #receiveKey; #sent = 0; #received = 0; #destroyed = false;
  /** @param {{role:'host'|'guest',grantId:string,localId:string,remoteId:string|null,material:{hostToGuestKey:Buffer,guestToHostKey:Buffer,keyId:string}}} input */
  constructor(input) {
    if (!['host', 'guest'].includes(input.role)) throw new Error('INFERENCE_INVALID_ROLE');
    this.grantId = inferenceIdSchema.parse(input.grantId); this.localId = inferenceIdSchema.parse(input.localId);
    this.remoteId = input.remoteId ? inferenceIdSchema.parse(input.remoteId) : null; this.keyId = input.material.keyId;
    this.#sendKey = Buffer.from(input.role === 'host' ? input.material.hostToGuestKey : input.material.guestToHostKey);
    this.#receiveKey = Buffer.from(input.role === 'host' ? input.material.guestToHostKey : input.material.hostToGuestKey);
  }
  /** @param {unknown} message @param {string|null} [recipient] */
  encrypt(message, recipient = this.remoteId) {
    if (this.#destroyed) throw new Error('INFERENCE_CHANNEL_CLOSED');
    const plain = Buffer.from(JSON.stringify(inferenceMessageSchema.parse(message)));
    if (plain.length > MAX_INFERENCE_PLAINTEXT_BYTES) throw new Error('INFERENCE_FRAME_LIMIT');
    const envelope = { protocol: INFERENCE_PROTOCOL, shareId: this.grantId, senderDeviceId: this.localId, recipientPeerId: recipient,
      keyId: this.keyId, sequence: this.#sent + 1, nonce: randomBytes(12).toString('base64url'), ciphertext: '' };
    const cipher = createCipheriv('aes-256-gcm', this.#sendKey, fixed(envelope.nonce, 12)); cipher.setAAD(aad(envelope));
    envelope.ciphertext = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString('base64url');
    if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_INFERENCE_FRAME_BYTES) throw new Error('INFERENCE_FRAME_LIMIT');
    this.#sent = envelope.sequence; return envelope;
  }
  /** @param {unknown} input */
  decrypt(input) {
    if (this.#destroyed) throw new Error('INFERENCE_CHANNEL_CLOSED');
    const envelope = inferenceEnvelopeSchema.parse(input);
    if (envelope.shareId !== this.grantId || envelope.keyId !== this.keyId || envelope.senderDeviceId === this.localId
      || (this.remoteId && envelope.senderDeviceId !== this.remoteId) || (envelope.recipientPeerId !== null && envelope.recipientPeerId !== this.localId)
      || envelope.sequence <= this.#received || Buffer.byteLength(JSON.stringify(envelope)) > MAX_INFERENCE_FRAME_BYTES) throw new Error('INFERENCE_INVALID_FRAME');
    const bytes = Buffer.from(envelope.ciphertext, 'base64url');
    if (bytes.length < 16 || bytes.length - 16 > MAX_INFERENCE_PLAINTEXT_BYTES) throw new Error('INFERENCE_FRAME_LIMIT');
    const decipher = createDecipheriv('aes-256-gcm', this.#receiveKey, fixed(envelope.nonce, 12)); decipher.setAAD(aad(envelope)); decipher.setAuthTag(bytes.subarray(-16));
    const plain = Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]);
    const result = inferenceMessageSchema.parse(JSON.parse(plain.toString('utf8')));
    this.#received = envelope.sequence; return result;
  }
  destroy() { this.#destroyed = true; this.#sendKey.fill(0); this.#receiveKey.fill(0); }
}
