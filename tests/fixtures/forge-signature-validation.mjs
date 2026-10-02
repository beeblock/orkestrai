import assert from 'node:assert/strict';
import { constants, createHash, generateKeyPairSync, privateEncrypt } from 'node:crypto';

// Independent parser regression for CVE-2026-85393. Keys are ephemeral and
// never written or logged. This constructs malformed signed blocks to test
// parsing, not a private-key-free exploit or a claim about every RSA scheme.
export function verifyForgeSignatureValidation(forge) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 });
  const key = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
  const digest = createHash('sha256').update('Orkestrai RSA parser regression').digest();
  const { asn1 } = forge;
  const value = (type, constructed, contents) => asn1.create(asn1.Class.UNIVERSAL, type, constructed, contents);
  const oid = () => value(asn1.Type.OID, false, asn1.oidToDer(forge.pki.oids.sha256).getBytes());
  const parameter = () => value(asn1.Type.NULL, false, '');
  const garbage = () => value(asn1.Type.OCTETSTRING, false, 'unexpected nested data');
  const signature = (algorithm) => {
    const info = value(asn1.Type.SEQUENCE, true, [value(asn1.Type.SEQUENCE, true, algorithm), value(asn1.Type.OCTETSTRING, false, digest.toString('latin1'))]);
    const der = Buffer.from(asn1.toDer(info).getBytes(), 'latin1');
    const padding = Buffer.alloc(256 - der.length - 3, 0xff);
    assert.ok(padding.length >= 8);
    const encoded = Buffer.concat([Buffer.from([0, 1]), padding, Buffer.from([0]), der]);
    return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, encoded).toString('latin1');
  };
  for (const algorithm of [[oid()], [oid(), parameter()]]) {
    const signed = signature(algorithm);
    assert.equal(key.verify(digest.toString('latin1'), signed), true);
    assert.equal(key.verify(createHash('sha256').update('different message').digest('latin1'), signed), false);
  }
  for (const algorithm of [[oid(), garbage()], [oid(), parameter(), garbage()], [oid(), parameter(), garbage(), garbage()], [oid(), value(asn1.Type.NULL, false, 'unexpected bytes')], [oid(), value(asn1.Type.NULL, false, '\u0000')]]) {
    const signed = signature(algorithm);
    assert.throws(() => key.verify(digest.toString('latin1'), signed), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
  }
  // Postman's existing private-key import path must remain available.
  const imported = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const message = forge.md.sha256.create().update('compatible private-key import');
  assert.equal(key.verify(message.digest().getBytes(), imported.sign(message)), true);
  return { validSignatures: 2, rejectedMalformedSignatures: 5, privateKeyImport: 'passed' };
}
