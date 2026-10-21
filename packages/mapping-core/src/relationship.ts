import { z } from 'zod';
import { RelationshipIdSchema, SourceDatasetIdSchema, SourceFieldIdSchema } from './primitives.js';

export const CardinalitySchema = z.enum(['oneToOne', 'oneToMany', 'manyToOne', 'manyToMany']);
export const JoinTypeSchema = z.enum(['inner', 'left']);
export const RelationshipStatusSchema = z.enum(['suggested', 'confirmed', 'rejected']);

export const RelationshipKeySchema = z.strictObject({
  leftFieldId: SourceFieldIdSchema,
  rightFieldId: SourceFieldIdSchema,
});

export const RelationshipSchema = z.strictObject({
  id: RelationshipIdSchema,
  leftDatasetId: SourceDatasetIdSchema,
  rightDatasetId: SourceDatasetIdSchema,
  keys: z.array(RelationshipKeySchema).min(1),
  cardinality: CardinalitySchema,
  joinType: JoinTypeSchema,
  status: RelationshipStatusSchema,
});

export type Cardinality = z.infer<typeof CardinalitySchema>;
export type JoinType = z.infer<typeof JoinTypeSchema>;
export type RelationshipStatus = z.infer<typeof RelationshipStatusSchema>;
export type RelationshipKey = z.infer<typeof RelationshipKeySchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
