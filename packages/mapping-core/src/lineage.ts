import { z } from 'zod';
import {
  FieldMappingIdSchema,
  SourceDatasetIdSchema,
  SourceFieldIdSchema,
  TargetFieldIdSchema,
} from './primitives.js';

/** One step on the way from source values to a target value. */
export const LineageStepSchema = z.strictObject({
  kind: z.enum(['source', 'constant', 'lookup', 'condition', 'routine', 'javascript']),
  /** Lookup, routine or condition identifier when there is one. */
  ref: z.string().optional(),
  input: z.string().nullable(),
  output: z.string().nullable(),
  note: z.string().optional(),
});
export type LineageStep = z.infer<typeof LineageStepSchema>;

/** Where one target value came from: source cells (with their row numbers) and the steps applied. */
export const CellLineageSchema = z.strictObject({
  targetFieldId: TargetFieldIdSchema,
  fieldMappingId: FieldMappingIdSchema,
  sources: z.array(
    z.strictObject({
      datasetId: SourceDatasetIdSchema,
      fieldId: SourceFieldIdSchema,
      /** 1-based data row in the dataset, header excluded. Absent when no row matched. */
      sourceRow: z.number().int().positive().optional(),
      value: z.string().nullable(),
    }),
  ),
  steps: z.array(LineageStepSchema),
});
export type CellLineage = z.infer<typeof CellLineageSchema>;
