import { z } from 'zod';

const id = <B extends string>() => z.string().min(1).brand<B>();

export const ProjectIdSchema = id<'ProjectId'>();
export const SourceDefinitionIdSchema = id<'SourceDefinitionId'>();
export const SourceDatasetIdSchema = id<'SourceDatasetId'>();
export const SourceFieldIdSchema = id<'SourceFieldId'>();
export const RelationshipIdSchema = id<'RelationshipId'>();
export const TargetDefinitionIdSchema = id<'TargetDefinitionId'>();
export const TargetStructureIdSchema = id<'TargetStructureId'>();
export const TargetFieldIdSchema = id<'TargetFieldId'>();
export const MappingDefinitionIdSchema = id<'MappingDefinitionId'>();
export const FieldMappingIdSchema = id<'FieldMappingId'>();
export const RoutineIdSchema = id<'RoutineId'>();
export const LookupIdSchema = id<'LookupId'>();
export const ValidationRuleIdSchema = id<'ValidationRuleId'>();
export const SnapshotIdSchema = id<'SnapshotId'>();
export const RunIdSchema = id<'RunId'>();

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type SourceDefinitionId = z.infer<typeof SourceDefinitionIdSchema>;
export type SourceDatasetId = z.infer<typeof SourceDatasetIdSchema>;
export type SourceFieldId = z.infer<typeof SourceFieldIdSchema>;
export type RelationshipId = z.infer<typeof RelationshipIdSchema>;
export type TargetDefinitionId = z.infer<typeof TargetDefinitionIdSchema>;
export type TargetStructureId = z.infer<typeof TargetStructureIdSchema>;
export type TargetFieldId = z.infer<typeof TargetFieldIdSchema>;
export type MappingDefinitionId = z.infer<typeof MappingDefinitionIdSchema>;
export type FieldMappingId = z.infer<typeof FieldMappingIdSchema>;
export type RoutineId = z.infer<typeof RoutineIdSchema>;
export type LookupId = z.infer<typeof LookupIdSchema>;
export type ValidationRuleId = z.infer<typeof ValidationRuleIdSchema>;
export type SnapshotId = z.infer<typeof SnapshotIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;

/** UTC ISO-8601 string. The model never uses Date objects. */
export const IsoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'expected UTC ISO-8601 date-time')
  .brand<'IsoDateTime'>();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const DataTypeSchema = z.enum([
  'string',
  'integer',
  'decimal',
  'boolean',
  'date',
  'dateTime',
  'time',
  'uuid',
  'unknown',
]);
export type DataType = z.infer<typeof DataTypeSchema>;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/**
 * A typed constant. Value representation by datatype:
 * integer -> safe integer number; decimal/date/dateTime/time/uuid/string -> string; boolean -> boolean.
 * null is allowed for any datatype.
 */
export const ConstantValueSchema = z
  .strictObject({
    datatype: DataTypeSchema,
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .superRefine((c, ctx) => {
    if (c.value === null) return;
    const ok =
      c.datatype === 'integer'
        ? typeof c.value === 'number' && Number.isSafeInteger(c.value)
        : c.datatype === 'boolean'
          ? typeof c.value === 'boolean'
          : c.datatype === 'unknown'
            ? true
            : typeof c.value === 'string';
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `value does not match datatype ${c.datatype}`,
      });
    }
  });
export type ConstantValue = z.infer<typeof ConstantValueSchema>;

export const SeveritySchema = z.enum(['info', 'warning', 'error']);
export type Severity = z.infer<typeof SeveritySchema>;
