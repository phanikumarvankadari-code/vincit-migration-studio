/** UTF-8 bytes of a string, written by hand so the library needs no DOM or Node typings. */
export function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

/** SHA-1 (RFC 3174). Used only for name-based UUIDs (RFC 4122 version 5), not for security. */
export function sha1(message: readonly number[]): number[] {
  const bytes = [...message, 0x80];
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bits = message.length * 8;
  const hi = Math.floor(bits / 0x100000000);
  const lo = bits >>> 0;
  bytes.push(
    (hi >>> 24) & 255,
    (hi >>> 16) & 255,
    (hi >>> 8) & 255,
    hi & 255,
    (lo >>> 24) & 255,
    (lo >>> 16) & 255,
    (lo >>> 8) & 255,
    lo & 255,
  );

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] =
        ((bytes[i + t * 4]! << 24) |
          (bytes[i + t * 4 + 1]! << 16) |
          (bytes[i + t * 4 + 2]! << 8) |
          bytes[i + t * 4 + 3]!) >>>
        0;
    }
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1);
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) [f, k] = [(b & c) | (~b & d), 0x5a827999];
      else if (t < 40) [f, k] = [b ^ c ^ d, 0x6ed9eba1];
      else if (t < 60) [f, k] = [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
      else [f, k] = [b ^ c ^ d, 0xca62c1d6];
      const temp = (rotl(a!, 5) + (f >>> 0) + e! + k + w[t]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b!, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a!) >>> 0;
    h1 = (h1 + b!) >>> 0;
    h2 = (h2 + c!) >>> 0;
    h3 = (h3 + d!) >>> 0;
    h4 = (h4 + e!) >>> 0;
  }
  return [h0, h1, h2, h3, h4].flatMap((h) => [
    (h >>> 24) & 255,
    (h >>> 16) & 255,
    (h >>> 8) & 255,
    h & 255,
  ]);
}

const hex = (b: number): string => b.toString(16).padStart(2, '0');

export function formatUuid(bytes: readonly number[]): string {
  const h = bytes.slice(0, 16).map(hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const parseUuidBytes = (uuid: string): number[] =>
  (uuid.replace(/-/g, '').match(/../g) ?? []).map((x) => parseInt(x, 16));

/** RFC 4122 version 5: SHA-1 of namespace bytes followed by the name bytes. */
export function uuidV5(namespace: string, name: string): string {
  const b = sha1([...parseUuidBytes(namespace), ...utf8(name)]).slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return formatUuid(b);
}

/** RFC 4122 version 4 from 16 random bytes supplied by the caller. */
export function uuidV4(random: ArrayLike<number>): string {
  const b = Array.from({ length: 16 }, (_, i) => random[i]! & 255);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  return formatUuid(b);
}
