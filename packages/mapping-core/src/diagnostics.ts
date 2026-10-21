import { z } from 'zod';
import {
  FieldMappingIdSchema,
  RoutineIdSchema,
  SeveritySchema,
  SourceDatasetIdSchema,
  SourceFieldIdSchema,
  TargetFieldIdSchema,
  TargetStructureIdSchema,
} from './primitives.js';

export const DiagnosticSchema = z.strictObject({
  severity: SeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  datasetId: SourceDatasetIdSchema.optional(),
  /** 1-based data row number, header excluded. */
  sourceRow: z.number().int().positive().optional(),
  /** 1-based row in the output of targetStructureId. Absent for rows that were not produced. */
  targetRow: z.number().int().positive().optional(),
  sourceFieldId: SourceFieldIdSchema.optional(),
  sourceValue: z.string().nullable().optional(),
  targetStructureId: TargetStructureIdSchema.optional(),
  targetFieldId: TargetFieldIdSchema.optional(),
  fieldMappingId: FieldMappingIdSchema.optional(),
  routineId: RoutineIdSchema.optional(),
  technicalDetails: z.string().optional(),
  /** Location inside a model document, for example "mappingDefinition.mappings[2].targetFieldId". */
  path: z.string().optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Diagnostic[] };
