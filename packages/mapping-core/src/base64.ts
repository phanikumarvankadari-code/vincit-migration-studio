const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (with padding) of bytes. Pure TypeScript: no Buffer or btoa. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]!;
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : ALPHABET[c & 63]!;
  }
  return out;
}

/** Bytes of standard base64 text. Characters outside the alphabet (such as line breaks) are ignored. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => {
      const ch = clean[i + k];
      return ch === undefined ? -1 : ALPHABET.indexOf(ch);
    });
    if (o < out.length) out[o++] = (n[0]! << 2) | (n[1]! >> 4);
    if (n[2]! >= 0 && o < out.length) out[o++] = ((n[1]! & 15) << 4) | (n[2]! >> 2);
    if (n[3]! >= 0 && o < out.length) out[o++] = ((n[2]! & 3) << 6) | n[3]!;
  }
  return out;
}
