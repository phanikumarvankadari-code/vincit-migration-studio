import {
  IsoDateTimeSchema,
  type Diagnostic,
  type LookupDefinition,
  type FieldMapping,
  type ParentLink,
  type Project,
  type Relationship,
  type RowGeneration,
  type SourceRows,
  type TargetDefinition,
  type SourceDefinition,
} from '@mms/mapping-core';
import { applyFieldDictionary, type FieldDictionary, type ImportedSource } from '@mms/file-import';
import { suggestRelationships, type DatasetData } from '@mms/relationships';
import type { TestRunResult } from '@mms/test-engine';
import { pruneDangling, removeMapping, upsertLookup, upsertMapping } from './edit.js';
import type { Workspace } from './persistence.js';
import {
  markSnapshot,
  restoreSnapshot,
  type SnapshotMarker,
  type SnapshotRecord,
} from './snapshots.js';

/**
 * Everything the app knows. Row data stays here (in memory) and is never part of the project.
 * All changes go through `reduce`, a pure function, so the behavior can be tested without a browser.
 */
export interface StudioState {
  project: Project;
  /** Rows by dataset ID. */
  data: Readonly<Record<string, SourceRows>>;
  dictionary: FieldDictionary | undefined;
  /** Import and dictionary diagnostics by source ID (and "dictionary"). */
  importDiagnostics: Readonly<Record<string, readonly Diagnostic[]>>;
  /** Why a suggested relationship was proposed, by relationship ID. */
  suggestionNotes: Readonly<
    Record<string, { score: number; evidence: string[]; diagnostics: Diagnostic[] }>
  >;
  /** Saved snapshots, oldest first. Immutable; only their marker changes. */
  snapshots: readonly SnapshotRecord[];
  lastRun: TestRunResult | undefined;
  /** The project changed since lastRun, so its results may be out of date. */
  runStale: boolean;
}

export type StudioAction =
  | { type: 'projectRenamed'; name: string; businessEntity: string; at: string }
  | { type: 'sourceAdded'; imported: ImportedSource; at: string }
  | { type: 'sourceRemoved'; sourceId: string; at: string }
  | {
      type: 'dictionaryLoaded';
      dictionary: FieldDictionary;
      diagnostics: readonly Diagnostic[];
      at: string;
    }
  | {
      type: 'relationshipDecided';
      relationshipId: string;
      status: Relationship['status'];
      at: string;
    }
  /** Rejects every join that is still only suggested. Confirmed joins stay. */
  | { type: 'relationshipsRejectedAll'; at: string }
  | {
      type: 'relationshipJoinType';
      relationshipId: string;
      joinType: Relationship['joinType'];
      at: string;
    }
  | { type: 'targetLoaded'; target: TargetDefinition; at: string }
  | {
      type: 'structureSettings';
      structureId: string;
      generation: RowGeneration | null;
      parent: ParentLink | null;
      /** Default date layout of the structure. Left as it is when absent, removed when null. */
      dateFormat?: string | null;
      at: string;
    }
  | {
      type: 'targetFieldFormat';
      structureId: string;
      fieldId: string;
      /** The date layout the field expects; null removes it. */
      dateFormat: string | null;
      at: string;
    }
  | {
      type: 'mappingSaved';
      mapping: FieldMapping;
      lookups?: readonly LookupDefinition[];
      at: string;
    }
  | { type: 'mappingRemoved'; structureId: string; fieldId: string; at: string }
  | { type: 'lookupSaved'; lookup: LookupDefinition; at: string }
  | { type: 'snapshotSaved'; record: SnapshotRecord }
  | { type: 'snapshotMarked'; snapshotId: string; marker: SnapshotMarker; at: string }
  | { type: 'snapshotRestored'; snapshotId: string; at: string }
  | { type: 'workspaceLoaded'; workspace: Workspace }
  | { type: 'rowsAttached'; imported: ImportedSource; at: string }
  | { type: 'projectReset'; id: string; name: string; businessEntity: string; at: string }
  | { type: 'projectEdited'; project: Project }
  | { type: 'runFinished'; run: TestRunResult };

export function createStudioState(args: {
  id: string;
  name: string;
  businessEntity: string;
  at: string;
}): StudioState {
  const at = IsoDateTimeSchema.parse(args.at);
  return {
    project: {
      id: args.id as Project['id'],
      name: args.name,
      businessEntity: args.businessEntity,
      projectState: 'draft',
      createdAt: at,
      updatedAt: at,
      sourceDefinitions: [],
      mappingDefinition: {
        id: 'md-1' as Project['mappingDefinition']['id'],
        mappings: [],
        relationships: [],
        routineReferences: [],
        lookupReferences: [],
        validationRules: [],
      },
      routines: [],
      lookups: [],
    },
    data: {},
    dictionary: undefined,
    importDiagnostics: {},
    suggestionNotes: {},
    snapshots: [],
    lastRun: undefined,
    runStale: false,
  };
}

const withProject = (
  s: StudioState,
  project: Project,
  extra: Partial<StudioState> = {},
): StudioState => ({
  ...s,
  ...extra,
  project,
  runStale: s.lastRun !== undefined,
});

function allDatasets(state: StudioState): DatasetData[] {
  return state.project.sourceDefinitions.flatMap((s) =>
    s.datasets.flatMap((dataset) => {
      const rows = state.data[dataset.id];
      return rows ? [{ dataset, rows }] : [];
    }),
  );
}

/**
 * Keeps relationship suggestions in step with the sources. Decided relationships (confirmed or rejected) are never
 * overwritten; suggested ones are refreshed (for example when a field dictionary adds technical names).
 */
function syncRelationships(state: StudioState, at: string): StudioState {
  const suggestions = suggestRelationships(allDatasets(state));
  const existing = state.project.mappingDefinition.relationships;
  const decided = existing.filter((r) => r.status !== 'suggested');
  const decidedIds = new Set(decided.map((r) => r.id as string));
  const fresh = suggestions
    .filter((x) => !decidedIds.has(x.relationship.id))
    .map((x) => x.relationship);
  const notes = Object.fromEntries(
    suggestions.map((x) => [
      x.relationship.id,
      { score: x.score, evidence: x.evidence, diagnostics: x.diagnostics },
    ]),
  );
  const project: Project = {
    ...state.project,
    updatedAt: at as Project['updatedAt'],
    mappingDefinition: {
      ...state.project.mappingDefinition,
      relationships: [...decided, ...fresh],
    },
  };
  return { ...state, project: pruneDangling(project), suggestionNotes: notes };
}

export function reduce(state: StudioState, action: StudioAction): StudioState {
  const stamp = (p: Project, at: string): Project => ({
    ...p,
    updatedAt: at as Project['updatedAt'],
  });
  switch (action.type) {
    case 'projectRenamed':
      return withProject(
        state,
        stamp(
          { ...state.project, name: action.name, businessEntity: action.businessEntity },
          action.at,
        ),
      );

    case 'sourceAdded': {
      const { source, rows, diagnostics } = action.imported;
      const old = state.project.sourceDefinitions.find((s) => s.id === source.id);
      const oldIds = new Set(old?.datasets.map((d) => d.id as string) ?? []);
      let enriched = source;
      let dictDiagnostics: readonly Diagnostic[] = [];
      if (state.dictionary) {
        const applied = applyFieldDictionary(source, state.dictionary);
        enriched = applied.source;
        dictDiagnostics = applied.diagnostics;
      }
      // Reading the same file again keeps the descriptions that were added to its tables and fields.
      if (old) enriched = carryDescriptions(enriched, old);
      const data: Record<string, SourceRows> = Object.fromEntries(
        Object.entries(state.data).filter(([id]) => !oldIds.has(id)),
      );
      for (const r of rows) data[r.datasetId] = r;
      const sources = old
        ? state.project.sourceDefinitions.map((s) => (s.id === source.id ? enriched : s))
        : [...state.project.sourceDefinitions, enriched];
      const next = withProject(
        state,
        stamp({ ...state.project, sourceDefinitions: sources }, action.at),
        {
          data,
          importDiagnostics: {
            ...state.importDiagnostics,
            [source.id]: [...diagnostics, ...dictDiagnostics],
          },
        },
      );
      return syncRelationships(next, action.at);
    }

    case 'sourceRemoved': {
      const gone = state.project.sourceDefinitions.find((s) => s.id === action.sourceId);
      if (!gone) return state;
      const ids = new Set(gone.datasets.map((d) => d.id as string));
      const data = Object.fromEntries(Object.entries(state.data).filter(([id]) => !ids.has(id)));
      const diag = Object.fromEntries(
        Object.entries(state.importDiagnostics).filter(([k]) => k !== action.sourceId),
      );
      const project = pruneDangling(
        stamp(
          {
            ...state.project,
            sourceDefinitions: state.project.sourceDefinitions.filter(
              (s) => s.id !== action.sourceId,
            ),
          },
          action.at,
        ),
      );
      return syncRelationships(
        withProject(state, project, { data, importDiagnostics: diag }),
        action.at,
      );
    }

    case 'dictionaryLoaded': {
      const diagnostics: Record<string, readonly Diagnostic[]> = {
        ...state.importDiagnostics,
        dictionary: action.diagnostics,
      };
      let sources = state.project.sourceDefinitions;
      sources = sources.map((s) => {
        const applied = applyFieldDictionary(s, action.dictionary);
        diagnostics[s.id] = [
          ...(state.importDiagnostics[s.id] ?? []).filter((d) => !d.code.startsWith('DICT_')),
          ...applied.diagnostics,
        ];
        return applied.source;
      });
      const next = withProject(
        state,
        stamp({ ...state.project, sourceDefinitions: sources }, action.at),
        { dictionary: action.dictionary, importDiagnostics: diagnostics },
      );
      return syncRelationships(next, action.at);
    }

    case 'relationshipsRejectedAll': {
      const relationships = state.project.mappingDefinition.relationships.map((r) =>
        r.status === 'suggested' ? { ...r, status: 'rejected' as const } : r,
      );
      return withProject(
        state,
        stamp(
          {
            ...state.project,
            mappingDefinition: { ...state.project.mappingDefinition, relationships },
          },
          action.at,
        ),
      );
    }

    case 'relationshipDecided': {
      const relationships = state.project.mappingDefinition.relationships.map((r) =>
        r.id === action.relationshipId ? { ...r, status: action.status } : r,
      );
      return withProject(
        state,
        stamp(
          {
            ...state.project,
            mappingDefinition: { ...state.project.mappingDefinition, relationships },
          },
          action.at,
        ),
      );
    }

    case 'relationshipJoinType': {
      const relationships = state.project.mappingDefinition.relationships.map((r) =>
        r.id === action.relationshipId ? { ...r, joinType: action.joinType } : r,
      );
      return withProject(
        state,
        stamp(
          {
            ...state.project,
            mappingDefinition: { ...state.project.mappingDefinition, relationships },
          },
          action.at,
        ),
      );
    }

    case 'targetLoaded': {
      const previous = new Map(
        (state.project.targetDefinition?.structures ?? []).map((s) => [s.id as string, s]),
      );
      const structures = action.target.structures.map((s) => {
        const old = previous.get(s.id);
        return {
          ...s,
          ...(old?.generation && !s.generation ? { generation: old.generation } : {}),
          ...(old?.parent && !s.parent ? { parent: old.parent } : {}),
          ...(old?.dateFormat && !s.dateFormat ? { dateFormat: old.dateFormat } : {}),
          fields: s.fields.map((f) => {
            const was = old?.fields.find((x) => x.id === f.id)?.dateFormat;
            return was && !f.dateFormat ? { ...f, dateFormat: was } : f;
          }),
        };
      });
      const project = pruneDangling(
        stamp({ ...state.project, targetDefinition: { ...action.target, structures } }, action.at),
      );
      return withProject(state, project);
    }

    case 'structureSettings': {
      const target = state.project.targetDefinition;
      if (!target) return state;
      const structures = target.structures.map((s) => {
        if (s.id !== action.structureId) return s;
        const copy = { ...s };
        delete copy.generation;
        delete copy.parent;
        if (action.dateFormat !== undefined) delete copy.dateFormat;
        return {
          ...copy,
          ...(action.dateFormat ? { dateFormat: action.dateFormat } : {}),
          ...(action.generation ? { generation: action.generation } : {}),
          ...(action.parent ? { parent: action.parent } : {}),
        };
      });
      return withProject(
        state,
        stamp({ ...state.project, targetDefinition: { ...target, structures } }, action.at),
      );
    }

    case 'targetFieldFormat': {
      const target = state.project.targetDefinition;
      if (!target) return state;
      const structures = target.structures.map((s) =>
        s.id !== action.structureId
          ? s
          : {
              ...s,
              fields: s.fields.map((f) => {
                if (f.id !== action.fieldId) return f;
                const next = { ...f };
                delete next.dateFormat;
                return action.dateFormat ? { ...next, dateFormat: action.dateFormat } : next;
              }),
            },
      );
      return withProject(
        state,
        stamp({ ...state.project, targetDefinition: { ...target, structures } }, action.at),
      );
    }

    case 'mappingSaved': {
      let project = state.project;
      for (const l of action.lookups ?? []) project = upsertLookup(project, l, action.at);
      return withProject(state, upsertMapping(project, action.mapping, action.at));
    }

    case 'mappingRemoved':
      return withProject(
        state,
        removeMapping(state.project, action.structureId, action.fieldId, action.at),
      );

    case 'lookupSaved':
      return withProject(state, upsertLookup(state.project, action.lookup, action.at));

    case 'snapshotSaved':
      if (state.snapshots.some((r) => r.snapshot.id === action.record.snapshot.id)) return state;
      return { ...state, snapshots: [...state.snapshots, action.record] };

    case 'snapshotMarked': {
      if (!state.snapshots.some((r) => r.snapshot.id === action.snapshotId)) return state;
      return {
        ...state,
        snapshots: state.snapshots.map((r) =>
          r.snapshot.id === action.snapshotId ? markSnapshot(r, action.marker, action.at) : r,
        ),
      };
    }

    case 'snapshotRestored': {
      const record = state.snapshots.find((r) => r.snapshot.id === action.snapshotId);
      if (!record) return state;
      const project = pruneDangling(restoreSnapshot(state.project, record.snapshot, action.at));
      const ids = new Set(
        project.sourceDefinitions.flatMap((x) => x.datasets.map((d) => d.id as string)),
      );
      const data = Object.fromEntries(Object.entries(state.data).filter(([id]) => ids.has(id)));
      return withProject(state, project, { data });
    }

    case 'workspaceLoaded':
      return {
        ...createStudioState({
          id: action.workspace.project.id,
          name: action.workspace.project.name,
          businessEntity: action.workspace.project.businessEntity,
          at: action.workspace.project.createdAt,
        }),
        project: action.workspace.project,
        snapshots: action.workspace.snapshots,
        dictionary: action.workspace.dictionary,
      };

    case 'rowsAttached': {
      const diagnostics: Diagnostic[] = [];
      const data: Record<string, SourceRows> = { ...state.data };
      const datasets = new Map(
        state.project.sourceDefinitions
          .flatMap((x) => x.datasets)
          .map((d) => [d.id as string, d] as const),
      );
      for (const r of action.imported.rows) {
        const ds = datasets.get(r.datasetId);
        const incoming = action.imported.source.datasets.find((d) => d.id === r.datasetId);
        if (!ds || !incoming) {
          diagnostics.push({
            severity: 'warning',
            code: 'ATTACH_UNKNOWN_DATASET',
            message: `The file's data "${incoming?.name ?? r.datasetId}" does not match any dataset of this project, so it was not used.`,
          });
          continue;
        }
        const expected = ds.fields.map((f) => f.displayName);
        const found = incoming.fields.map((f) => f.displayName);
        if (expected.length !== found.length || expected.some((n, i) => n !== found[i])) {
          diagnostics.push({
            severity: 'error',
            code: 'ATTACH_FIELD_MISMATCH',
            message: `"${ds.name}" does not fit: the project expects the columns ${expected.join(', ')} but the file has ${found.join(', ')}.`,
          });
          continue;
        }
        data[ds.id] = { datasetId: ds.id, fieldIds: ds.fields.map((f) => f.id), rows: r.rows };
      }
      return {
        ...state,
        data,
        importDiagnostics: {
          ...state.importDiagnostics,
          [action.imported.source.id]: [...action.imported.diagnostics, ...diagnostics],
        },
        runStale: state.lastRun !== undefined,
      };
    }

    case 'projectReset':
      return {
        ...createStudioState({
          id: action.id,
          name: action.name,
          businessEntity: action.businessEntity,
          at: action.at,
        }),
      };

    case 'projectEdited':
      // The result of a pure edit (for example from the Visual Mapper). It must already be a consistent project.
      return withProject(state, action.project);

    case 'runFinished':
      return { ...state, lastRun: action.run, runStale: false };
  }
}

/** Datasets of the project whose rows are not loaded (for example after reopening a saved project). */
export function datasetsWithoutData(
  state: Pick<StudioState, 'project' | 'data'>,
): { datasetId: string; name: string; sourceName: string }[] {
  return state.project.sourceDefinitions.flatMap((s) =>
    s.datasets
      .filter((d) => !state.data[d.id])
      .map((d) => ({ datasetId: d.id as string, name: d.name, sourceName: s.name })),
  );
}

/** Copies table and field descriptions from an earlier version of a source onto the new one, matched by ID. */
function carryDescriptions(next: SourceDefinition, old: SourceDefinition): SourceDefinition {
  const oldDatasets = new Map(old.datasets.map((d) => [d.id as string, d]));
  return {
    ...next,
    datasets: next.datasets.map((d) => {
      const before = oldDatasets.get(d.id);
      if (!before) return d;
      const fields = new Map(before.fields.map((f) => [f.id as string, f.description]));
      return {
        ...d,
        ...(d.description === undefined && before.description
          ? { description: before.description }
          : {}),
        fields: d.fields.map((f) => {
          const text = fields.get(f.id);
          return f.description === undefined && text ? { ...f, description: text } : f;
        }),
      };
    }),
  };
}
