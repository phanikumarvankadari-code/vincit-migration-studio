import { z } from 'zod';
import { OnBlank, defineRoutine, fail, isBlank, ok, parts, type BuiltInRoutine } from './kit.js';
import { uuidV4, uuidV5 } from './sha1.js';

export const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidString = z
  .string()
  .regex(UUID, 'must be a UUID such as 123e4567-e89b-12d3-a456-426614174000');

export interface IdentifierOptions {
  /** Source of randomness for UUID v4 (for example crypto.getRandomValues). Without it, v4 reports an error. */
  randomBytes?: (length: number) => ArrayLike<number>;
}

export const identifierRoutines = (options: IdentifierOptions = {}): BuiltInRoutine[] => [
  defineRoutine({
    id: 'id.preserveUuid',
    name: 'Preserve UUID',
    description:
      'Keeps an existing UUID as it is (optionally lower-cased). A value that is not a UUID is an error.',
    family: 'identifier',
    config: z.strictObject({
      lowercase: z.boolean().default(false),
      onBlank: OnBlank.default('null'),
    }),
    run: (cfg, { value }) => {
      if (isBlank(value))
        return cfg.onBlank === 'null'
          ? ok(null)
          : fail('UUID_BLANK', 'A UUID is required but the value is blank.');
      if (!UUID.test(value)) return fail('UUID_INVALID', `"${value}" is not a UUID.`);
      return ok(cfg.lowercase ? value.toLowerCase() : value);
    },
  }),
  defineRoutine({
    id: 'id.uuidV4',
    name: 'Generate UUID v4',
    description:
      'Makes a random UUID. This routine is deliberately NOT repeatable: every run gives new values. With keepExisting, a value that already is a UUID is kept.',
    family: 'identifier',
    config: z.strictObject({ keepExisting: z.boolean().default(false) }),
    run: (cfg, { value }) => {
      if (cfg.keepExisting && value !== null && UUID.test(value)) return ok(value);
      if (!options.randomBytes)
        return fail(
          'ROUTINE_RANDOM_UNAVAILABLE',
          'No source of randomness is configured, so a random UUID cannot be made.',
        );
      return ok(uuidV4(options.randomBytes(16)));
    },
  }),
  defineRoutine({
    id: 'id.deterministicUuid',
    name: 'Deterministic UUID',
    description:
      'Makes a name-based UUID (version 5) from the key values and a namespace UUID. The same keys always give the same UUID; different keys give different UUIDs. All source values of the mapping form the key (first the current value). The optional salt separates identifier spaces.',
    family: 'identifier',
    config: z.strictObject({
      namespace: uuidString,
      salt: z.string().optional(),
      onBlank: OnBlank.default('error'),
    }),
    run: (cfg, call) => {
      const key = parts(call);
      if (key.some(isBlank)) {
        return cfg.onBlank === 'null'
          ? ok(null)
          : fail('UUID_KEY_BLANK', 'A key value is blank, so no identifier can be made from it.');
      }
      return ok(uuidV5(cfg.namespace, JSON.stringify([cfg.salt ?? '', ...key])));
    },
  }),
  defineRoutine({
    id: 'id.fixed',
    name: 'Fixed Identifier',
    description:
      'Always gives the configured identifier. With mustBeUuid, the configured value is checked to be a UUID.',
    family: 'identifier',
    config: z
      .strictObject({ value: z.string().min(1), mustBeUuid: z.boolean().default(false) })
      .superRefine((c, ctx) => {
        if (c.mustBeUuid && !UUID.test(c.value))
          ctx.addIssue({
            code: 'custom',
            path: ['value'],
            message: 'must be a UUID because mustBeUuid is on',
          });
      }),
    run: (cfg) => ok(cfg.value),
  }),
  defineRoutine({
    id: 'id.prefix',
    name: 'Prefix Identifier',
    description:
      'Puts fixed text in front of the value. A blank stays blank (or is an error with onBlank "error").',
    family: 'identifier',
    config: z.strictObject({ value: z.string().min(1), onBlank: OnBlank.default('null') }),
    run: (cfg, { value }) =>
      isBlank(value)
        ? cfg.onBlank === 'null'
          ? ok(null)
          : fail('ID_BLANK', 'The value is blank.')
        : ok(cfg.value + value),
  }),
  defineRoutine({
    id: 'id.suffix',
    name: 'Suffix Identifier',
    description:
      'Puts fixed text after the value. A blank stays blank (or is an error with onBlank "error").',
    family: 'identifier',
    config: z.strictObject({ value: z.string().min(1), onBlank: OnBlank.default('null') }),
    run: (cfg, { value }) =>
      isBlank(value)
        ? cfg.onBlank === 'null'
          ? ok(null)
          : fail('ID_BLANK', 'The value is blank.')
        : ok(value + cfg.value),
  }),
];
