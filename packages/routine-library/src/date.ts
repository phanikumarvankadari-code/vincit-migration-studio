import { z } from 'zod';
import { OnBlank, defineRoutine, fail, isBlank, ok, type BuiltInRoutine } from './kit.js';

/** Dates travel as ISO 8601 text (YYYY-MM-DD). Every other layout is configured, never guessed. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number =>
  [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
const pad = (n: number, w: number): string => String(n).padStart(w, '0');

function validParts(y: number, m: number, d: number): string | undefined {
  if (y < 1 || y > 9999) return `year ${y} is out of range (1 to 9999)`;
  if (m < 1 || m > 12) return `month ${m} is not valid`;
  if (d < 1 || d > daysIn(y, m)) return `day ${d} does not exist in month ${m} of ${y}`;
  return undefined;
}

function parseIso(s: string): { y: number; m: number; d: number } | undefined {
  const m = ISO.exec(s);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return validParts(y, mo, d) === undefined ? { y, m: mo, d } : undefined;
}
const isoDate = z
  .string()
  .refine((s) => parseIso(s) !== undefined, 'must be a valid date as YYYY-MM-DD');

type Token = 'YYYY' | 'YY' | 'MMM' | 'MM' | 'M' | 'DD' | 'D';
type Part = { lit: string } | { tok: Token };
const TOKENS = /YYYY|YY|MMM|MM|M|DD|D/g;
const isYear = (t: Token) => t === 'YYYY' || t === 'YY';
const isMonth = (t: Token) => t === 'MMM' || t === 'MM' || t === 'M';
const isDay = (t: Token) => t === 'DD' || t === 'D';

/** Splits a layout such as "M/D/YY" into tokens and literals, and checks that it is complete and unambiguous. */
function compile(format: string): { parts: Part[] } | { error: string } {
  const out: Part[] = [];
  let last = 0;
  for (const m of format.matchAll(TOKENS)) {
    if (m.index > last) out.push({ lit: format.slice(last, m.index) });
    out.push({ tok: m[0] as Token });
    last = m.index + m[0].length;
  }
  if (last < format.length) out.push({ lit: format.slice(last) });
  const toks = out.flatMap((p) => ('tok' in p ? [p.tok] : []));
  if (
    toks.filter(isYear).length !== 1 ||
    toks.filter(isMonth).length !== 1 ||
    toks.filter(isDay).length !== 1
  ) {
    return {
      error: `format "${format}" must contain exactly one year (YYYY or YY), one month (MM, M or MMM) and one day (DD or D)`,
    };
  }
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!;
    const b = out[i]!;
    if (
      'tok' in a &&
      'tok' in b &&
      (a.tok === 'M' || a.tok === 'D' || b.tok === 'M' || b.tok === 'D')
    ) {
      return {
        error: `format "${format}" is ambiguous: M or D next to another part needs a separator`,
      };
    }
  }
  return { parts: out };
}

const layout = (
  config: { format: string; twoDigitYearPivot?: number | undefined; locale?: 'en' | undefined },
  ctx: z.RefinementCtx,
): void => {
  const c = compile(config.format);
  if ('error' in c) {
    ctx.addIssue({ code: 'custom', path: ['format'], message: c.error });
    return;
  }
  const toks = c.parts.flatMap((p) => ('tok' in p ? [p.tok] : []));
  if (toks.includes('YY') && config.twoDigitYearPivot === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['twoDigitYearPivot'],
      message:
        'is required when the format uses a two-digit year (YY): years up to the pivot are 20xx, larger years are 19xx',
    });
  }
  if (toks.includes('MMM') && config.locale === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['locale'],
      message: 'is required when the format uses month names (MMM). Only "en" is supported',
    });
  }
};

const FormatConfig = z.strictObject({
  format: z.string().min(1),
  twoDigitYearPivot: z.number().int().min(0).max(99).optional(),
  locale: z.literal('en').optional(),
});

type Read = { iso: string } | { code: string; message: string };
const bad = (code: string, message: string): Read => ({ code, message });

/** Reads text in an explicit layout and gives an ISO date, or the reason it is not one. */
function readDate(value: string, format: string, pivot: number | undefined): Read {
  const compiled = compile(format) as { parts: Part[] };
  const source = compiled.parts
    .map((p) => {
      if ('lit' in p) return p.lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return {
        YYYY: '(\\d{4})',
        YY: '(\\d{2})',
        MMM: '([A-Za-z]{3})',
        MM: '(\\d{2})',
        M: '(\\d{1,2})',
        DD: '(\\d{2})',
        D: '(\\d{1,2})',
      }[p.tok];
    })
    .join('');
  const m = new RegExp(`^${source}$`).exec(value);
  const where = `Cannot read "${value}" as a date with the layout ${format}`;
  if (!m) return bad('DATE_INVALID_FORMAT', `${where}.`);
  let year = 0;
  let month = 0;
  let day = 0;
  let g = 1;
  for (const p of compiled.parts) {
    if (!('tok' in p)) continue;
    const text = m[g++]!;
    if (p.tok === 'YYYY') year = Number(text);
    else if (p.tok === 'YY') year = (Number(text) <= pivot! ? 2000 : 1900) + Number(text);
    else if (p.tok === 'MMM')
      month = MONTHS.findIndex((n) => n.toLowerCase() === text.toLowerCase()) + 1;
    else if (isMonth(p.tok)) month = Number(text);
    else day = Number(text);
  }
  if (month === 0) return bad('DATE_INVALID', `${where}: "${m[0]}" is not a month name.`);
  const problem = validParts(year, month, day);
  if (problem) return bad('DATE_INVALID', `${where}: ${problem}.`);
  return { iso: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` };
}

/** Writes an ISO date (already valid) in an explicit layout. */
function writeDate(d: { y: number; m: number; d: number }, format: string): string {
  const compiled = compile(format) as { parts: Part[] };
  return compiled.parts
    .map((p) => {
      if ('lit' in p) return p.lit;
      switch (p.tok) {
        case 'YYYY':
          return pad(d.y, 4);
        case 'YY':
          return pad(d.y % 100, 2);
        case 'MMM':
          return MONTHS[d.m - 1]!;
        case 'MM':
          return pad(d.m, 2);
        case 'M':
          return String(d.m);
        case 'DD':
          return pad(d.d, 2);
        default:
          return String(d.d);
      }
    })
    .join('');
}

const parseDate = defineRoutine({
  id: 'date.parse',
  name: 'Parse Date',
  description:
    'Reads text in an explicit layout (for example M/D/YY) and gives an ISO date (YYYY-MM-DD). No layout is guessed. Two-digit years need a pivot. specialValues maps exact inputs, such as 12/31/99, to a fixed ISO date or to blank.',
  family: 'date',
  config: FormatConfig.extend({
    specialValues: z.record(z.string(), z.union([isoDate, z.null()])).optional(),
    onBlank: OnBlank.default('null'),
  }).superRefine(layout),
  run: (cfg, { value }) => {
    if (isBlank(value))
      return cfg.onBlank === 'null'
        ? ok(null)
        : fail('DATE_BLANK', 'A date is required but the value is blank.');
    const special = cfg.specialValues?.[value];
    if (special !== undefined) return ok(special);
    const read = readDate(value, cfg.format, cfg.twoDigitYearPivot);
    return 'iso' in read ? ok(read.iso) : fail(read.code, read.message);
  },
});

const formatDate = defineRoutine({
  id: 'date.format',
  name: 'Format Date',
  description:
    'Writes an ISO date (YYYY-MM-DD) in an explicit layout such as YYYYMMDD or DD.MM.YYYY. YY writes the last two digits of the year.',
  family: 'date',
  config: z
    .strictObject({
      format: z.string().min(1),
      locale: z.literal('en').optional(),
      onBlank: OnBlank.default('null'),
    })
    .superRefine((c, ctx) => {
      const compiled = compile(c.format);
      if ('error' in compiled)
        ctx.addIssue({ code: 'custom', path: ['format'], message: compiled.error });
      else if (
        compiled.parts.some((p) => 'tok' in p && p.tok === 'MMM') &&
        c.locale === undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['locale'],
          message: 'is required when the format uses month names (MMM). Only "en" is supported',
        });
      }
    }),
  run: (cfg, { value }) => {
    if (isBlank(value))
      return cfg.onBlank === 'null'
        ? ok(null)
        : fail('DATE_BLANK', 'A date is required but the value is blank.');
    const d = parseIso(value);
    if (!d)
      return fail('DATE_INVALID', `"${value}" is not an ISO date (YYYY-MM-DD). Parse it first.`);
    return ok(writeDate(d, cfg.format));
  },
});

const defaultDate = defineRoutine({
  id: 'date.default',
  name: 'Default Date',
  description:
    'Replaces a blank (null or empty) with a fixed ISO date. Any other value passes through unchanged.',
  family: 'date',
  config: z.strictObject({ value: isoDate }),
  run: (cfg, { value }) => (isBlank(value) ? ok(cfg.value) : ok(value)),
});

const sapZeroDate = defineRoutine({
  id: 'date.sapZeroToNull',
  name: 'SAP Zero Date to Null',
  description:
    'Turns an "empty" SAP date (only zeros and separators, such as 00000000 or 00.00.0000) into null. Everything else, including blanks, passes through unchanged.',
  family: 'date',
  config: z.strictObject({}),
  run: (_cfg, { value }) =>
    value !== null && /^[0\-./ ]+$/.test(value) && value.includes('0') ? ok(null) : ok(value),
});

const validateDate = defineRoutine({
  id: 'date.validate',
  name: 'Date Validation',
  description:
    'Checks that the value is a real ISO date, optionally within min and max. Valid values pass through unchanged; invalid ones are an error.',
  family: 'date',
  config: z.strictObject({
    min: isoDate.optional(),
    max: isoDate.optional(),
    onBlank: OnBlank.default('null'),
  }),
  run: (cfg, { value }) => {
    if (isBlank(value))
      return cfg.onBlank === 'null'
        ? ok(null)
        : fail('DATE_BLANK', 'A date is required but the value is blank.');
    if (!parseIso(value))
      return fail('DATE_INVALID', `"${value}" is not a valid ISO date (YYYY-MM-DD).`);
    if (cfg.min !== undefined && value < cfg.min)
      return fail('DATE_OUT_OF_RANGE', `${value} is before the earliest allowed date ${cfg.min}.`);
    if (cfg.max !== undefined && value > cfg.max)
      return fail('DATE_OUT_OF_RANGE', `${value} is after the latest allowed date ${cfg.max}.`);
    return ok(value);
  },
});

/** Accepts the common lowercase spelling (yyyyMMdd, dd.MM.yyyy) as well as the uppercase one. */
const normalizeLayout = (f: string): string =>
  f.replace(/yyyy/g, 'YYYY').replace(/yy/g, 'YY').replace(/dd/g, 'DD').replace(/d/g, 'D');

const InvalidValueBehavior = z.enum(['blank', 'keep', 'error']);

const convertDate = defineRoutine({
  id: 'date.convert',
  name: 'Date Format',
  description:
    'Reads a date in the input layout and writes it in the output layout (for example yyyyMMdd to yyyy-MM-dd). Dates are checked against the calendar. specialValues maps exact inputs, such as 00000000, to a fixed output or to blank. A blank value stays blank. invalidValueBehavior says what happens to a value that is not a real date: blank, keep the original, or error.',
  family: 'date',
  config: z
    .strictObject({
      inputFormat: z.string().min(1),
      outputFormat: z.string().min(1),
      twoDigitYearPivot: z.number().int().min(0).max(99).optional(),
      locale: z.literal('en').optional(),
      invalidValueBehavior: InvalidValueBehavior.default('error'),
      specialValues: z.record(z.string(), z.string()).optional(),
    })
    .superRefine((c, ctx) => {
      const inp = compile(normalizeLayout(c.inputFormat));
      if ('error' in inp)
        ctx.addIssue({ code: 'custom', path: ['inputFormat'], message: inp.error });
      else {
        const toks = inp.parts.flatMap((p) => ('tok' in p ? [p.tok] : []));
        if (toks.includes('YY') && c.twoDigitYearPivot === undefined)
          ctx.addIssue({
            code: 'custom',
            path: ['twoDigitYearPivot'],
            message: 'is required when the input format uses a two-digit year (YY)',
          });
        if (toks.includes('MMM') && c.locale === undefined)
          ctx.addIssue({
            code: 'custom',
            path: ['locale'],
            message: 'is required when the format uses month names (MMM). Only "en" is supported',
          });
      }
      const out = compile(normalizeLayout(c.outputFormat));
      if ('error' in out)
        ctx.addIssue({ code: 'custom', path: ['outputFormat'], message: out.error });
      else if (out.parts.some((p) => 'tok' in p && p.tok === 'MMM') && c.locale === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['locale'],
          message: 'is required when the format uses month names (MMM). Only "en" is supported',
        });
    }),
  run: (cfg, { value }) => {
    if (isBlank(value)) return ok(null);
    const special = cfg.specialValues?.[value];
    if (special !== undefined) return ok(special === '' ? null : special);
    const read = readDate(value, normalizeLayout(cfg.inputFormat), cfg.twoDigitYearPivot);
    if (!('iso' in read)) {
      if (cfg.invalidValueBehavior === 'blank') return ok(null);
      if (cfg.invalidValueBehavior === 'keep') return ok(value);
      return fail(read.code, read.message);
    }
    return ok(writeDate(parseIso(read.iso)!, normalizeLayout(cfg.outputFormat)));
  },
});

export const dateRoutines = (): BuiltInRoutine[] => [
  parseDate,
  formatDate,
  convertDate,
  defaultDate,
  sapZeroDate,
  validateDate,
];
