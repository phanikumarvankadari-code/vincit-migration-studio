import { z } from 'zod';
import { IsoDateTimeSchema, ProjectIdSchema, SnapshotIdSchema } from './primitives.js';
import { SourceDefinitionSchema } from './source.js';
import { TargetDefinitionSchema } from './target.js';
import { MappingDefinitionSchema } from './mapping.js';
import { LookupDefinitionSchema, RoutineDefinitionSchema } from './library.js';

/** Immutable and self-contained: every reference resolves inside the snapshot. No row data. */
export const MappingSnapshotSchema = z.strictObject({
  id: SnapshotIdSchema,
  projectId: ProjectIdSchema,
  name: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  modelSchemaVersion: z.number().int().positive(),
  mappingDefinition: MappingDefinitionSchema,
  targetDefinition: TargetDefinitionSchema,
  sourceSchemas: z.array(SourceDefinitionSchema),
  routines: z.array(RoutineDefinitionSchema),
  lookups: z.array(LookupDefinitionSchema),
});
export type MappingSnapshot = z.infer<typeof MappingSnapshotSchema>;
