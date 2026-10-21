import { z } from 'zod';
import { IsoDateTimeSchema, ProjectIdSchema } from './primitives.js';
import { SourceDefinitionSchema } from './source.js';
import { TargetDefinitionSchema } from './target.js';
import { MappingDefinitionSchema } from './mapping.js';
import { LookupDefinitionSchema, RoutineDefinitionSchema } from './library.js';

/** Draft workspace. Row data, snapshots and runs are not part of it. */
export const ProjectSchema = z.strictObject({
  id: ProjectIdSchema,
  name: z.string().min(1),
  businessEntity: z.string().min(1),
  sourceDefinitions: z.array(SourceDefinitionSchema),
  targetDefinition: TargetDefinitionSchema.optional(),
  mappingDefinition: MappingDefinitionSchema,
  routines: z.array(RoutineDefinitionSchema),
  lookups: z.array(LookupDefinitionSchema),
  projectState: z.enum(['draft', 'ready', 'approved']),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Project = z.infer<typeof ProjectSchema>;
