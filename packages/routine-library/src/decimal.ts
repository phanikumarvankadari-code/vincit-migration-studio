/** Exact decimal numbers on BigInt, so there is no floating point error. value = sign * digits / 10^scale. */
export interface Dec {
  neg: boolean;
  digits: bigint;
  scale: number;
}

export type Rounding = 'halfUp' | 'halfEven' | 'down' | 'up';

const CANONICAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);

export function parseCanonical(s: string): Dec | undefined {
  const m = CANONICAL.exec(s);
  if (!m) return undefined;
  const frac = m[3] ?? '';
  return { neg: m[1] === '-', digits: BigInt(m[2]! + frac), scale: frac.length };
}

export function toCanonical(d: Dec): string {
  let s = d.digits.toString();
  if (d.scale > 0) {
    s = s.padStart(d.scale + 1, '0');
    s = `${s.slice(0, -d.scale)}.${s.slice(-d.scale)}`;
  }
  return d.neg && d.digits !== 0n ? `-${s}` : s;
}

/** Divides a non-negative numerator by a positive denominator and rounds the result. */
function divRound(num: bigint, den: bigint, mode: Rounding, neg: boolean): bigint {
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  switch (mode) {
    case 'down':
      return q;
    case 'up':
      return q + 1n;
    case 'halfUp':
      return r * 2n >= den ? q + 1n : q;
    default: {
      void neg;
      const twice = r * 2n;
      return twice > den || (twice === den && q % 2n === 1n) ? q + 1n : q;
    }
  }
}

/** Rounds to `scale` decimals (adds zeros if the number has fewer). halfUp rounds ties away from zero. */
export function roundTo(d: Dec, scale: number, mode: Rounding): Dec {
  if (scale >= d.scale) return { neg: d.neg, digits: d.digits * pow10(scale - d.scale), scale };
  return { neg: d.neg, digits: divRound(d.digits, pow10(d.scale - scale), mode, d.neg), scale };
}

export const multiply = (a: Dec, b: Dec): Dec => ({
  neg: a.neg !== b.neg,
  digits: a.digits * b.digits,
  scale: a.scale + b.scale,
});

/** a / b rounded to `scale` decimals. Returns undefined when b is zero. */
export function divide(a: Dec, b: Dec, scale: number, mode: Rounding): Dec | undefined {
  if (b.digits === 0n) return undefined;
  const num = a.digits * pow10(b.scale + scale);
  const den = b.digits * pow10(a.scale);
  return { neg: a.neg !== b.neg, digits: divRound(num, den, mode, a.neg !== b.neg), scale };
}

/** Groups the integer digits (for example 1234567 with "," gives 1,234,567). */
export function groupThousands(int: string, sep: string): string {
  if (sep === '') return int;
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}
