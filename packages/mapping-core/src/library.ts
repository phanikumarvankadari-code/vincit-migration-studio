import { z } from 'zod';
import {
  ConstantValueSchema,
  DataTypeSchema,
  JsonValueSchema,
  LookupIdSchema,
  RoutineIdSchema,
} from './primitives.js';

/** Custom JavaScript is stored as data only. The core never executes it (SPEC-019). */
export const JavaScriptDefinitionSchema = z.strictObject({
  code: z.string().min(1),
  declaredLookupIds: z.array(LookupIdSchema),
});
export type JavaScriptDefinition = z.infer<typeof JavaScriptDefinitionSchema>;

export const RoutineDefinitionSchema = z.strictObject({
  id: RoutineIdSchema,
  name: z.string().min(1),
  scope: z.enum(['builtIn', 'shared', 'project']),
  version: z.string().min(1),
  description: z.string().optional(),
  javascript: JavaScriptDefinitionSchema.optional(),
});
export type RoutineDefinition = z.infer<typeof RoutineDefinitionSchema>;

export const LookupDefinitionSchema = z.strictObject({
  id: LookupIdSchema,
  name: z.string().min(1),
  keyDatatype: DataTypeSchema,
  valueDatatype: DataTypeSchema,
  entries: z.array(z.strictObject({ key: z.string(), value: ConstantValueSchema.shape.value })),
});
export type LookupDefinition = z.infer<typeof LookupDefinitionSchema>;

export const MissingValueBehaviorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('error') }),
  z.strictObject({ kind: z.literal('warning') }),
  z.strictObject({ kind: z.literal('keepSource') }),
  z.strictObject({ kind: z.literal('null') }),
  z.strictObject({ kind: z.literal('default'), value: ConstantValueSchema }),
]);
export type MissingValueBehavior = z.infer<typeof MissingValueBehaviorSchema>;

/** A lookup used as the primary operation of a mapping. */
export const LookupReferenceSchema = z.strictObject({
  lookupId: LookupIdSchema,
  configuration: z.record(z.string(), JsonValueSchema),
  missingValue: MissingValueBehaviorSchema,
});
export type LookupReference = z.infer<typeof LookupReferenceSchema>;

export const RoutineReferenceSchema = z.strictObject({
  kind: z.literal('routine'),
  routineId: RoutineIdSchema,
  version: z.string().min(1).optional(),
  configuration: z.record(z.string(), JsonValueSchema),
  order: z.number().int().nonnegative(),
  onError: z.enum(['stop', 'continue']),
});
export type RoutineReference = z.infer<typeof RoutineReferenceSchema>;

/** A lookup applied as a step inside a transformation chain. */
export const LookupStepSchema = z.strictObject({
  kind: z.literal('lookup'),
  lookupId: LookupIdSchema,
  configuration: z.record(z.string(), JsonValueSchema),
  missingValue: MissingValueBehaviorSchema,
  order: z.number().int().nonnegative(),
});
export type LookupStep = z.infer<typeof LookupStepSchema>;

export const TransformationStepSchema = z.discriminatedUnion('kind', [
  RoutineReferenceSchema,
  LookupStepSchema,
]);
export type TransformationStep = z.infer<typeof TransformationStepSchema>;
