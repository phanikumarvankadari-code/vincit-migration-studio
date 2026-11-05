import { z } from 'zod';
import {
  IsoDateTimeSchema,
  RunIdSchema,
  SnapshotIdSchema,
  SourceDatasetIdSchema,
  TargetStructureIdSchema,
} from './primitives.js';
import { SourceLocationSchema } from './source.js';
import { DiagnosticSchema } from './diagnostics.js';

export const RunDefinitionSchema = z.strictObject({
  id: RunIdSchema,
  snapshotId: SnapshotIdSchema,
  runType: z.enum(['test', 'full']),
  inputs: z.array(
    z.strictObject({ datasetId: SourceDatasetIdSchema, location: SourceLocationSchema }),
  ),
  sample: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('firstRows'), count: z.number().int().positive() }),
      /** Evenly spaced rows across the dataset, so a sample is not just the top of the file. */
      z.strictObject({ kind: z.literal('spread'), count: z.number().int().positive() }),
      z.strictObject({ kind: z.literal('all') }),
    ])
    .optional(),
});
export type RunDefinition = z.infer<typeof RunDefinitionSchema>;

export const RunResultSchema = z.strictObject({
  runId: RunIdSchema,
  status: z.enum(['completed', 'completedWithErrors', 'failed', 'cancelled']),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  inputRecordCounts: z.record(SourceDatasetIdSchema, z.number().int().nonnegative()),
  outputRecordCounts: z.record(TargetStructureIdSchema, z.number().int().nonnegative()),
  warningCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  generatedFiles: z
    .array(
      z.strictObject({
        /** output: rows that passed; errors: rows that did not (with reasons); diagnostics: every problem; summary: the run summary. */
        kind: z.enum(['output', 'errors', 'diagnostics', 'summary']),
        targetStructureId: TargetStructureIdSchema.optional(),
        fileName: z.string().min(1),
        format: z.enum(['csv', 'xlsx', 'xml', 'json']),
      }),
    )
    .optional(),
  diagnostics: z.array(DiagnosticSchema),
});
export type RunResult = z.infer<typeof RunResultSchema>;
