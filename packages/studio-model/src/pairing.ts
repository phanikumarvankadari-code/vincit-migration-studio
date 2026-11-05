import type { Project, RowGeneration, TargetStructure } from '@mms/mapping-core';

/**
 * Pure edits for descriptions and for the pairing of target structures with their main source table.
 * They are used by the Structures overview and by the import of an AI answer.
 */

const touch = (p: Project, at: string): Project => ({
  ...p,
  updatedAt: at as Project['updatedAt'],
});

export interface DescriptionEdits {
  /** Table descriptions by dataset ID. */
  tables?: readonly { datasetId: string; description: string }[];
  /** Field descriptions by dataset and field ID. */
  fields?: readonly { datasetId: string; fieldId: string; description: string }[];
}

/** Sets the descriptions of source tables and fields. Unknown IDs are ignored. */
export function applyDescriptions(project: Project, edits: DescriptionEdits, at: string): Project {
  const tables = new Map((edits.tables ?? []).map((t) => [t.datasetId, t.description]));
  const fields = new Map(
    (edits.fields ?? []).map((f) => [`${f.datasetId}/${f.fieldId}`, f.description]),
  );
  return touch(
    {
      ...project,
      sourceDefinitions: project.sourceDefinitions.map((s) => ({
        ...s,
        datasets: s.datasets.map((d) => ({
          ...d,
          ...(tables.has(d.id) ? { description: tables.get(d.id)! } : {}),
          fields: d.fields.map((f) => {
            const text = fields.get(`${d.id}/${f.id}`);
            return text === undefined ? f : { ...f, description: text };
          }),
        })),
      })),
    },
    at,
  );
}

export interface PairingEdit {
  structureId: string;
  driverDatasetId: string;
  helperDatasetIds?: readonly string[];
  status: 'suggested' | 'confirmed';
}

function withGeneration(s: TargetStructure, g: RowGeneration): TargetStructure {
  return { ...s, generation: g };
}

/**
 * Sets the main table (and the extra tables) of structures. A structure that keeps its main table keeps its
 * relationship choices. Unknown structures are ignored.
 */
export function applyPairings(
  project: Project,
  edits: readonly PairingEdit[],
  at: string,
): Project {
  const target = project.targetDefinition;
  if (!target) return project;
  const byId = new Map(edits.map((e) => [e.structureId, e]));
  return touch(
    {
      ...project,
      targetDefinition: {
        ...target,
        structures: target.structures.map((s) => {
          const e = byId.get(s.id);
          if (!e) return s;
          const keep =
            s.generation?.driverDatasetId === e.driverDatasetId ? s.generation : undefined;
          const helpers = (e.helperDatasetIds ?? []).filter((id) => id !== e.driverDatasetId);
          return withGeneration(s, {
            driverDatasetId: e.driverDatasetId as RowGeneration['driverDatasetId'],
            ...(keep?.viaRelationshipIds ? { viaRelationshipIds: keep.viaRelationshipIds } : {}),
            ...(helpers.length > 0
              ? { helperDatasetIds: helpers as unknown as RowGeneration['helperDatasetIds'] }
              : {}),
            status: e.status,
          });
        }),
      },
    },
    at,
  );
}

/** Marks the pairing of one structure (or of every structure with a suggested pairing) as confirmed. */
export function confirmPairings(
  project: Project,
  structureId: string | undefined,
  at: string,
): Project {
  const target = project.targetDefinition;
  if (!target) return project;
  return touch(
    {
      ...project,
      targetDefinition: {
        ...target,
        structures: target.structures.map((s) =>
          s.generation?.status === 'suggested' &&
          (structureId === undefined || s.id === structureId)
            ? withGeneration(s, { ...s.generation, status: 'confirmed' })
            : s,
        ),
      },
    },
    at,
  );
}

/** Structures whose pairing is still only suggested. */
export function suggestedPairings(project: Project): TargetStructure[] {
  return (project.targetDefinition?.structures ?? []).filter(
    (s) => s.generation?.status === 'suggested',
  );
}
