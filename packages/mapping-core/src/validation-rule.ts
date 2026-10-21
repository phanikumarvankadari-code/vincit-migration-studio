import { z } from 'zod';
import {
  TargetFieldIdSchema,
  TargetStructureIdSchema,
  ValidationRuleIdSchema,
} from './primitives.js';

export const ValidationScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('targetField'), targetFieldId: TargetFieldIdSchema }),
  z.strictObject({
    kind: z.literal('targetStructure'),
    targetStructureId: TargetStructureIdSchema,
  }),
]);
export type ValidationScope = z.infer<typeof ValidationScopeSchema>;

const base = {
  id: ValidationRuleIdSchema,
  scope: ValidationScopeSchema,
  severity: z.enum(['warning', 'error']),
};
const empty = z.strictObject({});

/** Initial closed set. New rule types are additive schema changes. */
export const ValidationRuleSchema = z.discriminatedUnion('ruleType', [
  z.strictObject({ ...base, ruleType: z.literal('required'), configuration: empty }),
  z.strictObject({ ...base, ruleType: z.literal('unique'), configuration: empty }),
  z.strictObject({
    ...base,
    ruleType: z.literal('maxLength'),
    configuration: z.strictObject({ max: z.number().int().nonnegative() }),
  }),
  z.strictObject({
    ...base,
    ruleType: z.literal('pattern'),
    configuration: z.strictObject({ pattern: z.string().min(1) }),
  }),
  z.strictObject({
    ...base,
    ruleType: z.literal('allowedValues'),
    configuration: z.strictObject({ values: z.array(z.string()).min(1) }),
  }),
]);
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;
