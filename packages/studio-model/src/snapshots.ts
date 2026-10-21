import {
  MappingDefinitionSchema,
  MappingSnapshotSchema,
  SourceDefinitionSchema,
  TargetDefinitionSchema,
  LookupDefinitionSchema,
  RoutineDefinitionSchema,
  validateProject,
  type Diagnostic,
  type MappingSnapshot,
  type Project,
  type Result,
} from '@mms/mapping-core';
import { SCHEMA_VERSION } from '@mms/mapping-core';

export type SnapshotMarker = 'none' | 'ready' | 'approved';

/**
 * A saved snapshot plus its marker. The marker is kept outside the snapshot, so the snapshot itself never changes
 * after it is saved.
 */
export interface SnapshotRecord {
  snapshot: MappingSnapshot;
  marker: SnapshotMarker;
  markedAt: string | undefined;
}

export const MARKER_LABEL: Record<SnapshotMarker, string> = {
  none: 'Not marked',
  ready: 'Ready',
  approved: 'Approved',
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Problems that make a snapshot pointless or wrong. Errors block saving. */
export function snapshotProblems(
  project: Project,
  extra: readonly Diagnostic[] = [],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!project.targetDefinition)
    out.push({
      severity: 'error',
      code: 'SNAPSHOT_NO_TARGET',
      message: 'Load a target structure before saving a snapshot.',
    });
  if (project.mappingDefinition.mappings.length === 0)
    out.push({
      severity: 'error',
      code: 'SNAPSHOT_NO_MAPPINGS',
      message: 'There are no mappings to save yet.',
    });
  out.push(...validateProject(project).filter((d) => d.severity === 'error'));
  out.push(...extra.filter((d) => d.severity === 'error'));
  return out;
}

/**
 * Freezes the current draft as an immutable snapshot: the mapping, the relationships, the target structure, the
 * source schemas (without row data), and the routine and lookup definitions it uses. Everything is copied, so later
 * draft changes cannot reach the snapshot.
 */
export function createSnapshot(
  project: Project,
  args: { id: string; name: string; at: string },
  extraProblems: readonly Diagnostic[] = [],
): Result<MappingSnapshot> {
  const name = args.name.trim();
  if (name === '')
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          code: 'SNAPSHOT_NAME_REQUIRED',
          message: 'Give the snapshot a name, for example "SIT Cycle 1".',
        },
      ],
    };
  const problems = snapshotProblems(project, extraProblems);
  if (problems.length > 0) return { ok: false, issues: problems };
  const parsed = MappingSnapshotSchema.safeParse({
    id: args.id,
    projectId: project.id,
    name,
    createdAt: args.at,
    modelSchemaVersion: SCHEMA_VERSION,
    mappingDefinition: project.mappingDefinition,
    targetDefinition: project.targetDefinition,
    sourceSchemas: project.sourceDefinitions,
    routines: project.routines,
    lookups: project.lookups,
  });
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        severity: 'error' as const,
        code: 'SNAPSHOT_INVALID',
        message: i.message,
      })),
    };
  return { ok: true, value: deepFreeze(parsed.data) };
}

/** The draft that results from reloading a snapshot. The snapshot is not changed. */
export function restoreSnapshot(project: Project, snapshot: MappingSnapshot, at: string): Project {
  const copy = MappingSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
  return {
    ...project,
    sourceDefinitions: copy.sourceSchemas,
    targetDefinition: copy.targetDefinition,
    mappingDefinition: copy.mappingDefinition,
    routines: copy.routines,
    lookups: copy.lookups,
    updatedAt: at as Project['updatedAt'],
  };
}

const byId = <T extends { id: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => a.id.localeCompare(b.id));

/** The parts of a project that a snapshot captures, in a fixed shape and order, as text. */
function fingerprint(parts: {
  sourceSchemas: Project['sourceDefinitions'];
  targetDefinition: Project['targetDefinition'];
  mappingDefinition: Project['mappingDefinition'];
  routines: Project['routines'];
  lookups: Project['lookups'];
}): string {
  const md = MappingDefinitionSchema.parse(parts.mappingDefinition);
  return JSON.stringify({
    sources: byId(parts.sourceSchemas.map((s) => SourceDefinitionSchema.parse(s))),
    target: parts.targetDefinition ? TargetDefinitionSchema.parse(parts.targetDefinition) : null,
    mappings: byId(md.mappings),
    relationships: byId(md.relationships),
    validationRules: byId(md.validationRules),
    routines: byId(parts.routines.map((r) => RoutineDefinitionSchema.parse(r))),
    lookups: byId(parts.lookups.map((l) => LookupDefinitionSchema.parse(l))),
  });
}

/** True when the draft is the same as the snapshot (so there is nothing new to save). */
export function draftMatchesSnapshot(project: Project, snapshot: MappingSnapshot): boolean {
  return (
    fingerprint({
      sourceSchemas: project.sourceDefinitions,
      targetDefinition: project.targetDefinition,
      mappingDefinition: project.mappingDefinition,
      routines: project.routines,
      lookups: project.lookups,
    }) ===
    fingerprint({
      sourceSchemas: snapshot.sourceSchemas,
      targetDefinition: snapshot.targetDefinition,
      mappingDefinition: snapshot.mappingDefinition,
      routines: snapshot.routines,
      lookups: snapshot.lookups,
    })
  );
}

export function markSnapshot(
  record: SnapshotRecord,
  marker: SnapshotMarker,
  at: string,
): SnapshotRecord {
  return { snapshot: record.snapshot, marker, markedAt: marker === 'none' ? undefined : at };
}

/** A full run needs a snapshot that a person has marked Ready or Approved. */
export const canRunFull = (record: SnapshotRecord): boolean =>
  record.marker === 'ready' || record.marker === 'approved';

export interface SnapshotSummary {
  structures: number;
  mappings: number;
  fields: number;
  mappedPercent: number;
}

export function summarizeSnapshot(s: MappingSnapshot): SnapshotSummary {
  const fields = s.targetDefinition.structures.reduce((n, st) => n + st.fields.length, 0);
  const mappings = s.mappingDefinition.mappings.length;
  return {
    structures: s.targetDefinition.structures.length,
    mappings,
    fields,
    mappedPercent: fields === 0 ? 0 : Math.round((mappings / fields) * 1000) / 10,
  };
}
