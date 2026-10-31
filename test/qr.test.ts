import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { buildQrPayload, toPublicKeyPem } from '../src/qr.ts';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const certificate = Buffer.from('example-certificate-bytes').toString('base64');

test('encrypts {irn.timestamp, certificate} with PKCS#1 v1.5 and base64-encodes it', () => {
  const out = buildQrPayload({ irn: 'INV001-94ND90NR-20261031', keys: { public_key: publicPem, certificate }, timestamp: 1731618237 });
  assert.equal(out.message, 'INV001-94ND90NR-20261031.1731618237');
  const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(out.payload, 'base64')).toString('utf8');
  assert.equal(plain, out.dataJson);
  assert.deepEqual(JSON.parse(plain), { irn: 'INV001-94ND90NR-20261031.1731618237', certificate });
});

test('accepts the public key as base64 of the PEM, as the NRS key file ships it', () => {
  const b64 = Buffer.from(publicPem, 'utf8').toString('base64');
  assert.equal(toPublicKeyPem(b64), publicPem.trim());
  const out = buildQrPayload({ irn: 'INV001-94ND90NR-20261031', keys: { public_key: b64, certificate }, timestamp: 1 });
  assert.ok(out.payload.length > 0);
});

test('explains an oversized payload', () => {
  const huge = 'x'.repeat(400);
  assert.throws(() => buildQrPayload({ irn: 'INV001-94ND90NR-20261031', keys: { public_key: publicPem, certificate: huge }, timestamp: 1 }), /too large/);
});

test('rejects garbage keys', () => {
  assert.throws(() => toPublicKeyPem('not a key'), /neither PEM/);
});
