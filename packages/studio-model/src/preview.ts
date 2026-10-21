import type { Diagnostic, FieldMapping, LookupDefinition, SourceValue } from '@mms/mapping-core';
import { createBuiltInRegistry } from '@mms/routine-library';
import { datasetsRead, runTest, suggestDrivers } from '@mms/test-engine';
import type { JavaScriptExecutor, RoutineRegistry } from '@mms/transformation-engine';
import { removeMapping, upsertLookup, upsertMapping } from './edit.js';
import type { StudioState } from './state.js';

export interface PreviewRow {
  /** 1-based row of the driver dataset. */
  driverRow: number;
  /** Values of the source fields, in the order of the mapping's source references. */
  sources: SourceValue[];
  /** The value the mapping produces. */
  value: SourceValue;
  /** Problems for this row. */
  issues: Diagnostic[];
}

export type Preview =
  | { ok: true; rows: PreviewRow[]; sourceLabels: string[]; problems: Diagnostic[] }
  | { ok: false; message: string };

const FIXED_CLOCK = '2000-01-01T00:00:00.000Z';

export interface PreviewOptions {
  routines?: RoutineRegistry;
  javascript?: JavaScriptExecutor;
  /** How many rows to show. Default 5. */
  rows?: number;
}

/**
 * Shows what a mapping would produce on the first rows, without saving it. The mapping is tried in a copy of the
 * project, with the rest of its structure left as it is.
 */
export function previewMapping(
  state: Pick<StudioState, 'project' | 'data'>,
  mapping: FieldMapping,
  lookups: readonly LookupDefinition[] = [],
  options: PreviewOptions = {},
): Preview {
  const structure = state.project.targetDefinition?.structures.find(
    (s) => s.id === mapping.targetStructureId,
  );
  if (!structure) return { ok: false, message: 'The target structure is not loaded.' };
  if (Object.keys(state.data).length === 0)
    return { ok: false, message: 'Load source files first to see a preview.' };

  let project = removeMapping(
    state.project,
    mapping.targetStructureId,
    mapping.targetFieldId,
    FIXED_CLOCK,
  );
  for (const l of lookups) project = upsertLookup(project, l, FIXED_CLOCK);
  project = upsertMapping(project, mapping, FIXED_CLOCK);
  // Only this mapping is tried: the others in the structure are not needed for the preview.
  let only = {
    ...project,
    mappingDefinition: { ...project.mappingDefinition, mappings: [mapping] },
  };
  if (!structure.generation && mapping.sourceReferences.length === 0 && only.targetDefinition) {
    // A mapping that reads no data (a constant) has no driver of its own: show it on the first loaded dataset.
    const first = state.project.sourceDefinitions
      .flatMap((x) => x.datasets)
      .find((d) => state.data[d.id]);
    if (first) {
      only = {
        ...only,
        targetDefinition: {
          ...only.targetDefinition,
          structures: only.targetDefinition.structures.map((x) =>
            x.id === structure.id ? { ...x, generation: { driverDatasetId: first.id } } : x,
          ),
        },
      };
    }
  }

  if (!structure.generation) {
    // A mapping that reads one dataset can name its own driver. Several datasets need the structure's driver setting.
    const datasets = datasetsRead(mapping);
    if (datasets.length > 1) {
      const best = suggestDrivers(project, structure.id)[0];
      return {
        ok: false,
        message: `This mapping reads ${datasets.length} datasets. Set which dataset the rows of "${structure.name}" come from in the structure settings${best ? ` (suggested: ${best.datasetId})` : ''}.`,
      };
    }
  }

  const registry = options.routines ?? createBuiltInRegistry();
  const result = runTest(
    {
      runId: 'preview',
      model: only,
      data: Object.values(state.data),
      sample: { kind: 'firstRows', count: options.rows ?? 5 },
    },
    {
      now: () => FIXED_CLOCK,
      routines: registry,
      ...(options.javascript ? { javascript: options.javascript } : {}),
      collectLineage: true,
      structures: [structure.id],
    },
  );
  const out = result.targets.find((t) => t.rows.targetStructureId === structure.id);
  if (result.run.status === 'failed' || !out) {
    return {
      ok: false,
      message:
        result.run.diagnostics.find((d) => d.severity === 'error')?.message ??
        'The preview could not run.',
    };
  }
  const col = out.rows.fieldIds.indexOf(mapping.targetFieldId);
  const fieldDiags = result.run.diagnostics.filter(
    (d) =>
      d.fieldMappingId === mapping.id ||
      (d.targetFieldId === mapping.targetFieldId && d.severity !== 'info'),
  );
  const rows: PreviewRow[] = out.rows.rows.map((row, i) => {
    const cell = out.lineage?.[i]?.[col];
    return {
      driverRow: out.driverRows[i] ?? i + 1,
      sources: mapping.sourceReferences.map(
        (r) => cell?.sources.find((s) => s.fieldId === r.fieldId)?.value ?? null,
      ),
      value: row[col] ?? null,
      issues: fieldDiags.filter((d) => d.targetRow === i + 1),
    };
  });
  const names = new Map<string, string>();
  for (const s of state.project.sourceDefinitions)
    for (const d of s.datasets)
      for (const f of d.fields) names.set(f.id, `${d.name}.${f.displayName}`);
  return {
    ok: true,
    rows,
    sourceLabels: mapping.sourceReferences.map((r) => names.get(r.fieldId) ?? r.fieldId),
    problems: fieldDiags.filter((d) => d.targetRow === undefined),
  };
}
