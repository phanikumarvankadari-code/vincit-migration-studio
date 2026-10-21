import { z } from 'zod';
import {
  DataTypeSchema,
  SourceDatasetIdSchema,
  SourceDefinitionIdSchema,
  SourceFieldIdSchema,
} from './primitives.js';

/** Where a source lives. The core never dereferences it. */
export const SourceLocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('localFile'), path: z.string().min(1) }),
  z.strictObject({ kind: z.literal('uri'), uri: z.string().min(1) }),
]);
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const SourceFieldSchema = z.strictObject({
  id: SourceFieldIdSchema,
  datasetId: SourceDatasetIdSchema,
  displayName: z.string().min(1),
  technicalName: z.string().min(1).optional(),
  datatype: DataTypeSchema,
  nativeType: z.string().min(1).optional(),
  length: z.number().int().nonnegative().optional(),
  nullable: z.boolean().optional(),
  isKey: z.boolean().optional(),
  /** Data-dictionary reference info, when a dictionary is applied. */
  reference: z
    .strictObject({
      rollName: z.string().min(1).optional(),
      checkTable: z.string().min(1).optional(),
    })
    .optional(),
});
export type SourceField = z.infer<typeof SourceFieldSchema>;

export const SourceDatasetSchema = z.strictObject({
  id: SourceDatasetIdSchema,
  sourceId: SourceDefinitionIdSchema,
  name: z.string().min(1),
  displayName: z.string().min(1),
  fields: z.array(SourceFieldSchema),
});
export type SourceDataset = z.infer<typeof SourceDatasetSchema>;

export const SourceDefinitionSchema = z.strictObject({
  id: SourceDefinitionIdSchema,
  name: z.string().min(1),
  sourceType: z.enum(['csv', 'xlsx']),
  location: SourceLocationSchema,
  fingerprint: z
    .strictObject({
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      sizeBytes: z.number().int().nonnegative(),
    })
    .optional(),
  datasets: z.array(SourceDatasetSchema),
});
export type SourceDefinition = z.infer<typeof SourceDefinitionSchema>;
