import type { Project, RowGeneration } from '@mms/mapping-core';

/**
 * A confirmed pair of a source dataset and a target structure is the structure's driver (`generation`), which is
 * what the engine already uses to make rows. Helpers are not stored: they are the datasets joined to the driver.
 */
const touch = (p: Project, at: string): Project => ({
  ...p,
  updatedAt: at as Project['updatedAt'],
});

/** Sets the driver dataset of a structure, keeping its parent link and any join restriction that still applies. */
export function setDriver(
  project: Project,
  structureId: string,
  driverDatasetId: string,
  at: string,
): Project {
  const target = project.targetDefinition;
  if (!target || !target.structures.some((s) => s.id === structureId)) return project;
  return touch(
    {
      ...project,
      targetDefinition: {
        ...target,
        structures: target.structures.map((s) => {
          if (s.id !== structureId) return s;
          const generation: RowGeneration = {
            driverDatasetId: driverDatasetId as RowGeneration['driverDatasetId'],
          };
          return { ...s, generation };
        }),
      },
    },
    at,
  );
}

/** Removes the driver of a structure (the engine then falls back to the one dataset its mappings read). */
export function clearDriver(project: Project, structureId: string, at: string): Project {
  const target = project.targetDefinition;
  if (!target) return project;
  return touch(
    {
      ...project,
      targetDefinition: {
        ...target,
        structures: target.structures.map((s) => {
          if (s.id !== structureId) return s;
          const copy = { ...s };
          delete copy.generation;
          return copy;
        }),
      },
    },
    at,
  );
}

export interface PairView {
  structureId: string;
  driverDatasetId: string | undefined;
  /** Datasets joined to the driver (a join that is not rejected). */
  helperDatasetIds: string[];
  /** Of those, the ones whose join is only suggested, not confirmed (rows are not joined until it is). */
  unconfirmedHelperIds: string[];
  /** Datasets the structure's mappings read that are neither the driver nor a helper. */
  strayDatasetIds: string[];
}

export function pairViews(project: Project): PairView[] {
  const rels = project.mappingDefinition.relationships.filter((r) => r.status !== 'rejected');
  return (project.targetDefinition?.structures ?? []).map((st) => {
    const driver = st.generation?.driverDatasetId as string | undefined;
    const helpers = new Map<string, boolean>(); // dataset -> confirmed
    if (driver)
      for (const r of rels) {
        const other: string | undefined =
          r.leftDatasetId === driver
            ? r.rightDatasetId
            : r.rightDatasetId === driver
              ? r.leftDatasetId
              : undefined;
        if (other && other !== driver)
          helpers.set(other, (helpers.get(other) ?? false) || r.status === 'confirmed');
      }
    const reads = new Set<string>();
    for (const m of project.mappingDefinition.mappings)
      if (m.targetStructureId === st.id)
        for (const ref of m.sourceReferences) reads.add(ref.datasetId);
    return {
      structureId: st.id,
      driverDatasetId: driver,
      helperDatasetIds: [...helpers.keys()],
      unconfirmedHelperIds: [...helpers].filter(([, ok]) => !ok).map(([id]) => id),
      strayDatasetIds: driver ? [...reads].filter((d) => d !== driver && !helpers.has(d)) : [],
    };
  });
}

/** The datasets to look in for a structure: its driver and the datasets joined to it. Undefined while unpaired. */
export function scopeOf(project: Project, structureId: string): string[] | undefined {
  const v = pairViews(project).find((p) => p.structureId === structureId);
  return v?.driverDatasetId ? [v.driverDatasetId, ...v.helperDatasetIds] : undefined;
}
