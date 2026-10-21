import { z } from 'zod';
import { SourceDatasetIdSchema, SourceFieldIdSchema } from './primitives.js';

/** A cell value. null = absent/blank cell. '' = an explicitly empty string. */
export const SourceValueSchema = z.string().nullable();
export type SourceValue = z.infer<typeof SourceValueSchema>;

/**
 * Row data for one dataset, kept apart from the model (the project never stores rows).
 * `fieldIds` gives the column order. Every row has one value per field id.
 */
export const SourceRowsSchema = z.strictObject({
  datasetId: SourceDatasetIdSchema,
  fieldIds: z.array(SourceFieldIdSchema),
  rows: z.array(z.array(SourceValueSchema)),
});
export type SourceRows = z.infer<typeof SourceRowsSchema>;
