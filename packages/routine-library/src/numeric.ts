import { z } from 'zod';
import {
  OnBlank,
  defineRoutine,
  fail,
  isBlank,
  ok,
  type BuiltInRoutine,
  type RoutineCall,
} from './kit.js';
import {
  divide,
  groupThousands,
  multiply,
  parseCanonical,
  roundTo,
  toCanonical,
  type Dec,
} from './decimal.js';

/**
 * Numbers travel as plain decimal text: optional minus, digits, optional "." and digits ("-1234.50").
 * All arithmetic is exact (BigInt based). Rounding is always explicit; halfUp rounds ties away from zero.
 * A blank (null or empty) stays blank unless onBlank is "error".
 */
const Rounding = z.enum(['halfUp', 'halfEven', 'down', 'up']).default('halfUp');
const decimals = z.number().int().min(0).max(100);
const canonical = z
  .string()
  .refine(
    (s) => parseCanonical(s) !== undefined,
    'must be a plain decimal number such as 12.50 or -3',
  );
const SEPARATORS = ['', '.', ',', ' ', "'", ' '] as const;
const sep = z.enum(SEPARATORS);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dec(value: string, what = 'value'): Dec | { error: string } {
  return (
    parseCanonical(value) ?? {
      error: `${what} "${value}" is not a plain decimal number. Use Parse Number first.`,
    }
  );
}
const isErr = (d: Dec | { error: string }): d is { error: string } => 'error' in d;

/** Second operand: a fixed number in the configuration, or another source value by position. */
function operand(
  cfg: { value?: string | undefined; fromInput?: number | undefined },
  call: RoutineCall,
  name: string,
): Dec | { error: string; blank?: true } {
  if (cfg.value !== undefined) return parseCanonical(cfg.value)!;
  const v = call.inputs[cfg.fromInput!];
  if (v === undefined)
    return { error: `Source value number ${cfg.fromInput} does not exist for ${name}.` };
  if (isBlank(v))
    return { error: `The ${name} (source value ${cfg.fromInput}) is blank.`, blank: true };
  return dec(v, name);
}
const oneOperand = (
  c: { value?: string | undefined; fromInput?: number | undefined },
  ctx: z.RefinementCtx,
): void => {
  if ((c.value === undefined) === (c.fromInput === undefined)) {
    ctx.addIssue({
      code: 'custom',
      message:
        'set exactly one of value (a fixed number) or fromInput (the position of another source value)',
    });
  }
};

export const numericRoutines = (): BuiltInRoutine[] => [
  defineRoutine({
    id: 'numeric.parse',
    name: 'Parse Number',
    description:
      'Reads a number written with explicit separators (for example 1.234,50 with decimalSeparator "," and thousandsSeparator ".") and gives plain decimal text (1234.50). trailingMinus reads 100- as -100. Exponents are not supported.',
    family: 'numeric',
    config: z
      .strictObject({
        decimalSeparator: z.enum(['.', ',']),
        thousandsSeparator: sep.default(''),
        trailingMinus: z.boolean().default(false),
        onBlank: OnBlank.default('null'),
      })
      .superRefine((c, ctx) => {
        if (c.thousandsSeparator === c.decimalSeparator)
          ctx.addIssue({
            code: 'custom',
            path: ['thousandsSeparator'],
            message: 'must differ from the decimal separator',
          });
      }),
    run: (cfg, { value }) => {
      if (isBlank(value))
        return cfg.onBlank === 'null'
          ? ok(null)
          : fail('NUMBER_BLANK', 'A number is required but the value is blank.');
      let s = value;
      let neg = false;
      if (cfg.trailingMinus && s.endsWith('-')) {
        neg = true;
        s = s.slice(0, -1);
      }
      const int =
        cfg.thousandsSeparator === ''
          ? '\\d+'
          : `(?:\\d{1,3}(?:${escapeRe(cfg.thousandsSeparator)}\\d{3})+|\\d+)`;
      const m = new RegExp(`^([+-]?)(${int})(?:${escapeRe(cfg.decimalSeparator)}(\\d+))?$`).exec(s);
      if (!m)
        return fail(
          'NUMBER_INVALID',
          `Cannot read "${value}" as a number (decimal separator "${cfg.decimalSeparator}"${cfg.thousandsSeparator ? `, thousands separator "${cfg.thousandsSeparator}"` : ''}).`,
        );
      if (neg && m[1] !== '') return fail('NUMBER_INVALID', `"${value}" has two minus signs.`);
      const intDigits = m[2]!
        .split(cfg.thousandsSeparator === '' ? /(?!)/ : cfg.thousandsSeparator)
        .join('');
      const d: Dec = {
        neg: neg || m[1] === '-',
        digits: BigInt(intDigits + (m[3] ?? '')),
        scale: (m[3] ?? '').length,
      };
      return ok(toCanonical(d));
    },
  }),
  defineRoutine({
    id: 'numeric.format',
    name: 'Format Number',
    description:
      'Writes plain decimal text with a chosen decimal separator, thousands separator and number of decimals (rounded as configured). trailingMinus writes -100 as 100-.',
    family: 'numeric',
    config: z
      .strictObject({
        decimals: decimals.optional(),
        rounding: Rounding,
        decimalSeparator: z.enum(['.', ',']).default('.'),
        thousandsSeparator: sep.default(''),
        trailingMinus: z.boolean().default(false),
        onBlank: OnBlank.default('null'),
      })
      .superRefine((c, ctx) => {
        if (c.thousandsSeparator === c.decimalSeparator)
          ctx.addIssue({
            code: 'custom',
            path: ['thousandsSeparator'],
            message: 'must differ from the decimal separator',
          });
      }),
    run: (cfg, { value }) => {
      if (isBlank(value))
        return cfg.onBlank === 'null'
          ? ok(null)
          : fail('NUMBER_BLANK', 'A number is required but the value is blank.');
      const d = dec(value);
      if (isErr(d)) return fail('NUMBER_INVALID', d.error);
      const r = cfg.decimals === undefined ? d : roundTo(d, cfg.decimals, cfg.rounding);
      const text = toCanonical({ ...r, neg: false });
      const [int = '', frac] = text.split('.');
      const body =
        groupThousands(int, cfg.thousandsSeparator) +
        (frac !== undefined ? cfg.decimalSeparator + frac : '');
      const negative = r.neg && r.digits !== 0n;
      return ok(negative ? (cfg.trailingMinus ? `${body}-` : `-${body}`) : body);
    },
  }),
  defineRoutine({
    id: 'numeric.round',
    name: 'Round',
    description:
      'Rounds to a number of decimals (padding with zeros if needed). halfUp rounds ties away from zero; halfEven rounds ties to the even digit; down cuts toward zero; up rounds away from zero.',
    family: 'numeric',
    config: z.strictObject({ decimals, rounding: Rounding, onBlank: OnBlank.default('null') }),
    run: (cfg, { value }) => {
      if (isBlank(value))
        return cfg.onBlank === 'null'
          ? ok(null)
          : fail('NUMBER_BLANK', 'A number is required but the value is blank.');
      const d = dec(value);
      return isErr(d)
        ? fail('NUMBER_INVALID', d.error)
        : ok(toCanonical(roundTo(d, cfg.decimals, cfg.rounding)));
    },
  }),
  defineRoutine({
    id: 'numeric.multiply',
    name: 'Multiply',
    description:
      'Multiplies by a fixed number or by another source value. The result is exact; set decimals to round it.',
    family: 'numeric',
    config: z
      .strictObject({
        value: canonical.optional(),
        fromInput: z.number().int().min(0).optional(),
        decimals: decimals.optional(),
        rounding: Rounding,
        onBlank: OnBlank.default('null'),
      })
      .superRefine(oneOperand),
    run: (cfg, call) => {
      if (isBlank(call.value))
        return cfg.onBlank === 'null'
          ? ok(null)
          : fail('NUMBER_BLANK', 'A number is required but the value is blank.');
      const a = dec(call.value);
      if (isErr(a)) return fail('NUMBER_INVALID', a.error);
      const b = operand(cfg, call, 'factor');
      if (isErr(b))
        return 'blank' in b && cfg.onBlank === 'null' ? ok(null) : fail('NUMBER_INVALID', b.error);
      const product = multiply(a, b);
      return ok(
        toCanonical(
          cfg.decimals === undefined ? product : roundTo(product, cfg.decimals, cfg.rounding),
        ),
      );
    },
  }),
  defineRoutine({
    id: 'numeric.divide',
    name: 'Divide',
    description:
      'Divides by a fixed number or by another source value, giving a result with the chosen number of decimals. Division by zero is an error on that row, never a crash.',
    family: 'numeric',
    config: z
      .strictObject({
        value: canonical.optional(),
        fromInput: z.number().int().min(0).optional(),
        decimals,
        rounding: Rounding,
        onBlank: OnBlank.default('null'),
      })
      .superRefine(oneOperand),
    run: (cfg, call) => {
      if (isBlank(call.value))
        return cfg.onBlank === 'null'
          ? ok(null)
          : fail('NUMBER_BLANK', 'A number is required but the value is blank.');
      const a = dec(call.value);
      if (isErr(a)) return fail('NUMBER_INVALID', a.error);
      const b = operand(cfg, call, 'divisor');
      if (isErr(b))
        return 'blank' in b && cfg.onBlank === 'null' ? ok(null) : fail('NUMBER_INVALID', b.error);
      const q = divide(a, b, cfg.decimals, cfg.rounding);
      return q
        ? ok(toCanonical(q))
        : fail('NUMBER_DIVIDE_BY_ZERO', `Cannot divide ${call.value} by zero.`);
    },
  }),
];
