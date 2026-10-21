import { z } from 'zod';
import {
  DataTypeSchema,
  RelationshipIdSchema,
  SourceDatasetIdSchema,
  TargetDefinitionIdSchema,
  TargetFieldIdSchema,
  TargetStructureIdSchema,
} from './primitives.js';

export const TargetFieldSchema = z.strictObject({
  id: TargetFieldIdSchema,
  targetStructureId: TargetStructureIdSchema,
  displayName: z.string().min(1),
  technicalName: z.string().min(1).optional(),
  datatype: DataTypeSchema,
  nativeType: z.string().min(1).optional(),
  length: z.number().int().nonnegative().optional(),
  decimals: z.number().int().nonnegative().optional(),
  required: z.boolean(),
  isKey: z.boolean(),
  description: z.string().optional(),
  /** Group heading from a structure definition file (for example "Address"). */
  group: z.string().optional(),
  /** Original importance text from the definition (for example "mandatory for sheet"). */
  importance: z.string().optional(),
});
export type TargetField = z.infer<typeof TargetFieldSchema>;

/** Which source dataset drives the rows of a structure. Semantics are finalised in SPEC-013. */
export const RowGenerationSchema = z.strictObject({
  driverDatasetId: SourceDatasetIdSchema,
  viaRelationshipIds: z.array(RelationshipIdSchema).optional(),
});
export type RowGeneration = z.infer<typeof RowGenerationSchema>;

/** Links a child structure to its parent through key field pairs. */
export const ParentLinkSchema = z.strictObject({
  parentStructureId: TargetStructureIdSchema,
  keys: z
    .array(
      z.strictObject({ childFieldId: TargetFieldIdSchema, parentFieldId: TargetFieldIdSchema }),
    )
    .min(1),
});
export type ParentLink = z.infer<typeof ParentLinkSchema>;

export const TargetStructureSchema = z.strictObject({
  id: TargetStructureIdSchema,
  targetDefinitionId: TargetDefinitionIdSchema,
  name: z.string().min(1),
  displayName: z.string().min(1),
  technicalName: z.string().min(1).optional(),
  /** Original importance text of the structure (for example "mandatory"). */
  importance: z.string().optional(),
  fields: z.array(TargetFieldSchema),
  generation: RowGenerationSchema.optional(),
  parent: ParentLinkSchema.optional(),
});
export type TargetStructure = z.infer<typeof TargetStructureSchema>;

export const TargetDefinitionSchema = z.strictObject({
  id: TargetDefinitionIdSchema,
  name: z.string().min(1),
  structures: z.array(TargetStructureSchema),
});
export type TargetDefinition = z.infer<typeof TargetDefinitionSchema>;
