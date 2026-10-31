/**
 * QR payload for a cleared invoice.
 *
 * Per the NRS IRN signing guide:
 *   message    = "{IRN}.{unix_seconds}"
 *   data       = { "irn": message, "certificate": <certificate> }
 *   ciphertext = RSA_encrypt(public_key, JSON(data))   // PKCS#1 v1.5
 *   payload    = base64(ciphertext)                    // this string goes into the QR
 *
 * The public key and certificate come from the taxpayer's NRS dashboard
 * ("Manage Cryptographic Keys"). This module never needs a private key.
 */
import { createPublicKey, publicEncrypt, constants } from 'node:crypto';

export interface QrKeys {
  /** PEM text, or base64 of the PEM text as the NRS key file ships it. */
  public_key: string;
  /** Certificate string exactly as issued (base64). */
  certificate: string;
}

export interface QrPayload {
  /** "{IRN}.{unix_seconds}" */
  message: string;
  /** The JSON that was encrypted. */
  dataJson: string;
  /** Base64 ciphertext. Encode this string as the QR code. */
  payload: string;
  publicKeyPem: string;
}

/** Accepts a PEM string or a base64-encoded PEM string and returns PEM. */
export function toPublicKeyPem(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('-----BEGIN')) return trimmed;
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
  if (decoded.includes('-----BEGIN')) return decoded;
  throw new Error(
    'The public key is neither PEM text nor base64 of a PEM file. Download the key file again from the NRS dashboard and pass its contents unchanged.',
  );
}

export function buildQrPayload(input: { irn: string; keys: QrKeys; timestamp?: number }): QrPayload {
  const ts = input.timestamp ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(ts) || ts <= 0) throw new Error('timestamp must be a positive integer of Unix seconds.');
  const message = `${input.irn}.${ts}`;
  const dataJson = JSON.stringify({ irn: message, certificate: input.keys.certificate });
  const publicKeyPem = toPublicKeyPem(input.keys.public_key);
  const key = createPublicKey(publicKeyPem);
  let ciphertext: Buffer;
  try {
    ciphertext = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(dataJson, 'utf8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/too large/i.test(msg)) {
      throw new Error(
        'The data is too large for this RSA key. A 2048-bit key fits about 245 bytes, so a long certificate string will not fit. Check you passed the certificate value, not the whole key file.',
      );
    }
    throw err;
  }
  return { message, dataJson, payload: ciphertext.toString('base64'), publicKeyPem };
}

/**
 * Renders the payload as a PNG. Requires the optional "qrcode" package:
 *   npm install qrcode
 */
export async function qrPng(payload: string, outFile: string): Promise<void> {
  let mod: { toFile: (file: string, text: string, opts?: unknown) => Promise<void> };
  try {
    mod = (await import('qrcode')) as unknown as typeof mod;
  } catch {
    throw new Error('PNG output needs the optional "qrcode" package. Run: npm install qrcode');
  }
  await mod.toFile(outFile, payload, { errorCorrectionLevel: 'H' });
}
