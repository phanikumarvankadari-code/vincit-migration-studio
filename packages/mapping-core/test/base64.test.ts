import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../src/index.js';

describe('base64', () => {
  it.each(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'])('round-trips %j', (t) => {
    const bytes = new TextEncoder().encode(t);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });
  it('round-trips all byte values and ignores line breaks', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(fromBase64(toBase64(bytes).replace(/(.{20})/g, '$1\n')))).toEqual(
      Array.from(bytes),
    );
  });
});
