import {
  validateProject,
  type FieldMapping,
  type LookupDefinition,
  type Project,
  type Relationship,
  type SourceDefinition,
  type TargetStructure,
} from '@mms/mapping-core';
import { builtInRoutineDefinitions } from '@mms/routine-library';

/**
 * Pure edits of the canonical project. Every function returns a new project and never changes its input.
 * The UI calls these through the state reducer; nothing about mapping semantics lives in the UI.
 */

const touch = (p: Project, at: string): Project => ({
  ...p,
  updatedAt: at as Project['updatedAt'],
});

/** All field IDs of the project's source datasets, with their dataset. */
export function sourceFieldIndex(sources: readonly SourceDefinition[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sources)
    for (const d of s.datasets) for (const f of d.fields) out.set(f.id, d.id);
  return out;
}

/** Routines and lookups the mappings use, kept in step with the project's definitions and manifests. */
export function normalizeManifests(project: Project): Project {
  const md = project.mappingDefinition;
  const usedRoutines = new Set<string>();
  const usedLookups = new Set<string>();
  for (const m of md.mappings) {
    if (m.mappingType === 'lookup') usedLookups.add(m.lookup.lookupId);
    if (m.mappingType === 'javascript')
      m.javascript.declaredLookupIds.forEach((l) => usedLookups.add(l));
    for (const t of m.transformations) {
      if (t.kind === 'routine') usedRoutines.add(t.routineId);
      else usedLookups.add(t.lookupId);
    }
  }
  const builtIns = new Map(builtInRoutineDefinitions().map((d) => [d.id as string, d]));
  const routines = [...usedRoutines].sort().flatMap((id) => {
    const existing = project.routines.find((r) => r.id === id);
    const def = existing ?? builtIns.get(id);
    return def ? [def] : [];
  });
  return {
    ...project,
    routines,
    mappingDefinition: {
      ...md,
      routineReferences: routines.map((r) => ({ routineId: r.id, version: r.version })),
      lookupReferences: [...usedLookups]
        .sort()
        .flatMap((id) =>
          project.lookups.some((l) => l.id === id) ? [{ lookupId: id as never }] : [],
        ),
    },
  };
}

function cleanGeneration(
  s: TargetStructure,
  datasets: ReadonlySet<string>,
  relIds: ReadonlySet<string>,
): TargetStructure {
  if (!s.generation) return s;
  if (!datasets.has(s.generation.driverDatasetId)) {
    const copy = { ...s };
    delete copy.generation;
    return copy;
  }
  const via = s.generation.viaRelationshipIds?.filter((id) => relIds.has(id));
  return {
    ...s,
    generation: {
      driverDatasetId: s.generation.driverDatasetId,
      ...(via && via.length > 0 ? { viaRelationshipIds: via } : {}),
    },
  };
}

/** Removes mappings and relationships that point at datasets, fields or target fields that no longer exist. */
export function pruneDangling(project: Project): Project {
  const sourceFields = sourceFieldIndex(project.sourceDefinitions);
  const datasets = new Set(
    project.sourceDefinitions.flatMap((s) => s.datasets.map((d) => d.id as string)),
  );
  const targetFields = new Map<string, string>();
  for (const s of project.targetDefinition?.structures ?? [])
    for (const f of s.fields) targetFields.set(f.id, s.id);
  const refsOk = (m: FieldMapping): boolean =>
    targetFields.get(m.targetFieldId) === m.targetStructureId &&
    m.sourceReferences.every((r) => sourceFields.get(r.fieldId) === r.datasetId);
  const relOk = (r: Relationship): boolean =>
    datasets.has(r.leftDatasetId) &&
    datasets.has(r.rightDatasetId) &&
    r.keys.every(
      (k) =>
        sourceFields.get(k.leftFieldId) === r.leftDatasetId &&
        sourceFields.get(k.rightFieldId) === r.rightDatasetId,
    );
  const relationships = project.mappingDefinition.relationships.filter(relOk);
  const relIds = new Set(relationships.map((r) => r.id as string));
  const structures = project.targetDefinition?.structures.map((s) =>
    cleanGeneration(s, datasets, relIds),
  );
  return normalizeManifests({
    ...project,
    ...(project.targetDefinition && structures
      ? { targetDefinition: { ...project.targetDefinition, structures } }
      : {}),
    mappingDefinition: {
      ...project.mappingDefinition,
      relationships,
      mappings: project.mappingDefinition.mappings.filter(refsOk),
    },
  });
}

/** One mapping per target field: replaces the existing one. */
export function upsertMapping(project: Project, mapping: FieldMapping, at: string): Project {
  const others = project.mappingDefinition.mappings.filter(
    (m) =>
      !(
        m.targetStructureId === mapping.targetStructureId &&
        m.targetFieldId === mapping.targetFieldId
      ),
  );
  return touch(
    normalizeManifests({
      ...project,
      mappingDefinition: { ...project.mappingDefinition, mappings: [...others, mapping] },
    }),
    at,
  );
}

export function removeMapping(
  project: Project,
  targetStructureId: string,
  targetFieldId: string,
  at: string,
): Project {
  const mappings = project.mappingDefinition.mappings.filter(
    (m) => !(m.targetStructureId === targetStructureId && m.targetFieldId === targetFieldId),
  );
  return touch(
    normalizeManifests({
      ...project,
      mappingDefinition: { ...project.mappingDefinition, mappings },
    }),
    at,
  );
}

export function upsertLookup(project: Project, lookup: LookupDefinition, at: string): Project {
  const others = project.lookups.filter((l) => l.id !== lookup.id);
  return touch(normalizeManifests({ ...project, lookups: [...others, lookup] }), at);
}

/** Problems with references in the project (empty when consistent). */
export const projectIssues = (project: Project) => validateProject(project);
