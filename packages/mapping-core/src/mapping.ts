import { z } from 'zod';
import {
  ConstantValueSchema,
  FieldMappingIdSchema,
  MappingDefinitionIdSchema,
  RoutineIdSchema,
  LookupIdSchema,
  SourceDatasetIdSchema,
  SourceFieldIdSchema,
  TargetFieldIdSchema,
  TargetStructureIdSchema,
} from './primitives.js';
import {
  JavaScriptDefinitionSchema,
  LookupReferenceSchema,
  TransformationStepSchema,
} from './library.js';
import { RelationshipSchema } from './relationship.js';
import { ValidationRuleSchema } from './validation-rule.js';

export const MappingTypeSchema = z.enum([
  'direct',
  'constant',
  'lookup',
  'conditional',
  'routine',
  'javascript',
]);
export type MappingType = z.infer<typeof MappingTypeSchema>;
export const MappingStatusSchema = z.enum(['mapped', 'needsReview', 'unmapped', 'error']);
export type MappingStatus = z.infer<typeof MappingStatusSchema>;

export const SourceReferenceSchema = z.strictObject({
  datasetId: SourceDatasetIdSchema,
  fieldId: SourceFieldIdSchema,
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

export const ValueOperandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('field'),
    datasetId: SourceDatasetIdSchema,
    fieldId: SourceFieldIdSchema,
  }),
  z.strictObject({ kind: z.literal('constant'), constant: ConstantValueSchema }),
  z.strictObject({ kind: z.literal('current') }),
]);
export type ValueOperand = z.infer<typeof ValueOperandSchema>;

export type ConditionExpr =
  | {
      op: 'compare';
      operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
      left: ValueOperand;
      right: ValueOperand;
    }
  | { op: 'in'; operand: ValueOperand; values: z.infer<typeof ConstantValueSchema>[] }
  | { op: 'isEmpty'; operand: ValueOperand }
  | { op: 'and' | 'or'; conditions: ConditionExpr[] }
  | { op: 'not'; condition: ConditionExpr };

/** Minimal closed condition language. SPEC-012 may extend it. */
export const ConditionExprSchema: z.ZodType<ConditionExpr> = z.lazy(() =>
  z.union([
    z.strictObject({
      op: z.literal('compare'),
      operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
      left: ValueOperandSchema,
      right: ValueOperandSchema,
    }),
    z.strictObject({
      op: z.literal('in'),
      operand: ValueOperandSchema,
      values: z.array(ConstantValueSchema).min(1),
    }),
    z.strictObject({ op: z.literal('isEmpty'), operand: ValueOperandSchema }),
    z.strictObject({ op: z.enum(['and', 'or']), conditions: z.array(ConditionExprSchema).min(1) }),
    z.strictObject({ op: z.literal('not'), condition: ConditionExprSchema }),
  ]),
);

export const ConditionalDefinitionSchema = z.strictObject({
  rules: z.array(z.strictObject({ when: ConditionExprSchema, then: ValueOperandSchema })).min(1),
  otherwise: ValueOperandSchema.optional(),
});
export type ConditionalDefinition = z.infer<typeof ConditionalDefinitionSchema>;

const base = {
  id: FieldMappingIdSchema,
  targetStructureId: TargetStructureIdSchema,
  targetFieldId: TargetFieldIdSchema,
  sourceReferences: z.array(SourceReferenceSchema),
  transformations: z.array(TransformationStepSchema),
  status: MappingStatusSchema,
};

/** Discriminated on mappingType. The primary operation, then an ordered transformation chain. */
export const FieldMappingSchema = z.discriminatedUnion('mappingType', [
  z.strictObject({ ...base, mappingType: z.literal('direct') }),
  z.strictObject({ ...base, mappingType: z.literal('constant'), constant: ConstantValueSchema }),
  z.strictObject({ ...base, mappingType: z.literal('lookup'), lookup: LookupReferenceSchema }),
  z.strictObject({
    ...base,
    mappingType: z.literal('conditional'),
    conditional: ConditionalDefinitionSchema,
  }),
  z.strictObject({ ...base, mappingType: z.literal('routine') }),
  z.strictObject({
    ...base,
    mappingType: z.literal('javascript'),
    javascript: JavaScriptDefinitionSchema,
  }),
]);
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const MappingDefinitionSchema = z.strictObject({
  id: MappingDefinitionIdSchema,
  mappings: z.array(FieldMappingSchema),
  relationships: z.array(RelationshipSchema),
  /** Pinned routines used by this mapping. */
  routineReferences: z.array(
    z.strictObject({ routineId: RoutineIdSchema, version: z.string().min(1) }),
  ),
  lookupReferences: z.array(z.strictObject({ lookupId: LookupIdSchema })),
  validationRules: z.array(ValidationRuleSchema),
});
export type MappingDefinition = z.infer<typeof MappingDefinitionSchema>;
