import type { Hasher } from '../ports.ts';

/** Uses WebCrypto (available in Node 18+ and browsers). */
export const webCryptoHasher: Hasher = {
  async sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
};
