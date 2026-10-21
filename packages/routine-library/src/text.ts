import { z } from 'zod';
import { defineRoutine, fail, ok, parts, type BuiltInRoutine } from './kit.js';

/**
 * Text routines count and cut by Unicode code points, so emoji and accented letters are not split.
 * (Combining sequences made of several code points are not treated as one character.)
 * Unless stated, a null value stays null.
 */
const cps = (s: string): string[] => Array.from(s);
const oneCodePoint = z.string().refine((s) => cps(s).length === 1, 'must be exactly one character');
const MAX_LENGTH = 1_000_000;
const length = z.number().int().min(0).max(MAX_LENGTH);

export const textRoutines = (): BuiltInRoutine[] => [
  defineRoutine({
    id: 'text.trim',
    name: 'Trim',
    description:
      'Removes white space (including non-breaking spaces) from both ends, or from the start or the end only.',
    family: 'text',
    config: z.strictObject({ mode: z.enum(['both', 'start', 'end']).default('both') }),
    run: (cfg, { value }) =>
      value === null
        ? ok(null)
        : ok(
            cfg.mode === 'both'
              ? value.trim()
              : cfg.mode === 'start'
                ? value.trimStart()
                : value.trimEnd(),
          ),
  }),
  defineRoutine({
    id: 'text.upper',
    name: 'Uppercase',
    description:
      'Changes letters to capitals using Unicode rules that do not depend on the computer language setting (so "ß" becomes "SS").',
    family: 'text',
    config: z.strictObject({}),
    run: (_c, { value }) => ok(value === null ? null : value.toUpperCase()),
  }),
  defineRoutine({
    id: 'text.lower',
    name: 'Lowercase',
    description:
      'Changes letters to small letters using Unicode rules that do not depend on the computer language setting.',
    family: 'text',
    config: z.strictObject({}),
    run: (_c, { value }) => ok(value === null ? null : value.toLowerCase()),
  }),
  defineRoutine({
    id: 'text.concat',
    name: 'Concatenate',
    description:
      'Joins the current value and the other source values of the mapping with a separator. With skipBlank (default), blank parts are left out so no separator is left dangling; if every part is blank the result is null.',
    family: 'text',
    config: z.strictObject({
      separator: z.string().default(''),
      skipBlank: z.boolean().default(true),
    }),
    run: (cfg, call) => {
      const all = parts(call);
      const used = cfg.skipBlank
        ? all.filter((p): p is string => p !== null && p !== '')
        : all.map((p) => p ?? '');
      return ok(used.length === 0 ? null : used.join(cfg.separator));
    },
  }),
  defineRoutine({
    id: 'text.replace',
    name: 'Replace',
    description:
      'Replaces exact text (no patterns) with other text, everywhere (default) or only the first match.',
    family: 'text',
    config: z.strictObject({
      find: z.string().min(1),
      replaceWith: z.string(),
      all: z.boolean().default(true),
    }),
    run: (cfg, { value }) => {
      if (value === null) return ok(null);
      if (cfg.all) return ok(value.split(cfg.find).join(cfg.replaceWith));
      const i = value.indexOf(cfg.find);
      return ok(
        i < 0 ? value : value.slice(0, i) + cfg.replaceWith + value.slice(i + cfg.find.length),
      );
    },
  }),
  defineRoutine({
    id: 'text.substring',
    name: 'Substring',
    description:
      'Takes part of the text, starting at a 0-based position, for a given length (or to the end). A start beyond the end gives an empty string.',
    family: 'text',
    config: z.strictObject({ start: length, length: length.optional() }),
    run: (cfg, { value }) => {
      if (value === null) return ok(null);
      const c = cps(value);
      return ok(
        c.slice(cfg.start, cfg.length === undefined ? undefined : cfg.start + cfg.length).join(''),
      );
    },
  }),
  ...(['left', 'right'] as const).map((side) =>
    defineRoutine({
      id: side === 'left' ? 'text.leftPad' : 'text.rightPad',
      name: side === 'left' ? 'Left Pad' : 'Right Pad',
      description: `Fills the text up to a length with a padding character on the ${side}. Text that is already long enough is kept (or is an error with onTooLong "error").`,
      family: 'text',
      config: z.strictObject({
        length,
        pad: oneCodePoint.default(' '),
        onTooLong: z.enum(['keep', 'error']).default('keep'),
      }),
      run: (cfg, { value }) => {
        if (value === null) return ok(null);
        const n = cps(value).length;
        if (n > cfg.length) {
          return cfg.onTooLong === 'keep'
            ? ok(value)
            : fail(
                'TEXT_TOO_LONG',
                `"${value}" has ${n} characters but the pad length is ${cfg.length}.`,
              );
        }
        const fill = cfg.pad.repeat(cfg.length - n);
        return ok(side === 'left' ? fill + value : value + fill);
      },
    }),
  ),
  defineRoutine({
    id: 'text.maxLength',
    name: 'Maximum Length',
    description:
      'Enforces a maximum number of characters: longer text is an error (default) or is cut off (truncate).',
    family: 'text',
    config: z.strictObject({ length, onTooLong: z.enum(['error', 'truncate']).default('error') }),
    run: (cfg, { value }) => {
      if (value === null) return ok(null);
      const c = cps(value);
      if (c.length <= cfg.length) return ok(value);
      return cfg.onTooLong === 'truncate'
        ? ok(c.slice(0, cfg.length).join(''))
        : fail(
            'TEXT_TOO_LONG',
            `"${value}" has ${c.length} characters but at most ${cfg.length} are allowed.`,
          );
    },
  }),
  defineRoutine({
    id: 'text.nullHandling',
    name: 'Null and Empty Handling',
    description:
      'Says exactly what to do with a null, an empty string, and a string of only spaces. Each setting is a replacement text or null; leave a setting out to keep that kind of value as it is.',
    family: 'text',
    config: z.strictObject({
      nullTo: z.string().nullable().optional(),
      emptyTo: z.string().nullable().optional(),
      whitespaceTo: z.string().nullable().optional(),
    }),
    run: (cfg, { value }) => {
      if (value === null) return ok(cfg.nullTo !== undefined ? cfg.nullTo : null);
      if (value === '') return ok(cfg.emptyTo !== undefined ? cfg.emptyTo : value);
      if (value.trim() === '') return ok(cfg.whitespaceTo !== undefined ? cfg.whitespaceTo : value);
      return ok(value);
    },
  }),
];
