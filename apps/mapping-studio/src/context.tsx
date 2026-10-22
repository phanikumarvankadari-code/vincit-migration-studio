import type { Diagnostic, Project } from '@mms/mapping-core';
import type { LocalRunResult } from '@mms/local-run';
import { profileDataset, type DatasetProfile } from '@mms/profiler';
import { createBuiltInRegistry } from '@mms/routine-library';
import {
  applySuggestions,
  buildMappingRows,
  clearDriver,
  conflictsByTarget,
  createStudioState,
  detectConflicts,
  decodeWorkspace,
  encodeWorkspace,
  reduce,
  removeMappings,
  setDriver,
  stageStatuses,
  type MappingConflict,
  type MappingRow,
  type Stage,
  type StageStatus,
  type StudioAction,
  type StudioState,
} from '@mms/studio-model';
import { preflight, runTest, type SampleConfig } from '@mms/test-engine';
import type { MappingSuggestion, StructureSuggestion } from '@mms/mapping-suggest';
import type { RoutineRegistry } from '@mms/transformation-engine';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Workspace } from '@mms/studio-model';
import {
  MIME,
  clearStored,
  downloadFile,
  loadFromLibrary,
  loadStored,
  saveToLibrary,
  store,
  type Stored,
} from './lib/storage';

type WithoutAt<A> = A extends { at: string } ? Omit<A, 'at'> : A;
export type StudioEvent = WithoutAt<StudioAction>;

export interface StudioApi {
  state: StudioState;
  /** Sends a change to the project. The time stamp is added here. */
  send: (event: StudioEvent) => void;
  registry: RoutineRegistry;
  preflight: Diagnostic[];
  rows: MappingRow[];
  statuses: Record<Stage, StageStatus>;
  profiles: ReadonlyMap<string, DatasetProfile>;
  /** Suggestions (rules and AI) waiting for a decision. They live here so the mapper and the table share them. */
  suggestions: MappingSuggestion[] | undefined;
  setSuggestions: (
    s:
      | MappingSuggestion[]
      | undefined
      | ((cur: MappingSuggestion[] | undefined) => MappingSuggestion[] | undefined),
  ) => void;
  /** Accepts suggestions as direct mappings, in one edit. */
  acceptSuggestions: (list: readonly MappingSuggestion[]) => { applied: number; skipped: number };
  /** Things in the mappings worth a second look (type, length, reuse, empty source, disagreeing suggestions). */
  conflicts: MappingConflict[];
  conflictsByField: Map<string, MappingConflict[]>;
  /** Removes mappings and keeps the project as it was, so Undo can bring them back. */
  deleteMappings: (targets: readonly { structureId: string; fieldId: string }[]) => number;
  lastDeleted: { message: string } | undefined;
  /** Which source dataset drives each target structure: suggestions waiting for a decision. */
  pairSuggestions: StructureSuggestion[] | undefined;
  setPairSuggestions: (
    s:
      | StructureSuggestion[]
      | undefined
      | ((cur: StructureSuggestion[] | undefined) => StructureSuggestion[] | undefined),
  ) => void;
  /** Sets the driver dataset of target structures, with Undo. */
  pairStructures: (pairs: readonly { structureId: string; driverDatasetId: string }[]) => number;
  /** Removes the driver of a structure, with Undo. */
  unpairStructure: (structureId: string) => void;
  undoDelete: () => void;
  dismissUndo: () => void;
  stage: Stage;
  setStage: (s: Stage) => void;
  runSample: (sample: SampleConfig) => void;
  /** Output of the last full run. */
  lastOutput: LocalRunResult | undefined;
  setLastOutput: (r: LocalRunResult | undefined) => void;
  /** Autosave: when the draft was last saved in this browser, or why it could not be. */
  saveStatus: { state: 'idle' | 'saved' | 'error'; at?: string; message?: string };
  /** What happened to the project saved in this browser when the app started. */
  startup: Stored;
  dismissStartup: () => void;
  newProject: () => void;
  /** Opens a project kept in this browser's library. Returns a message when it cannot be read. */
  openLibraryProject: (id: string) => string | undefined;
  saveProjectFile: () => void;
  openProjectFile: (file: File) => Promise<string | undefined>;
}

const Ctx = createContext<StudioApi | undefined>(undefined);

export const nowIso = (): string => new Date().toISOString();

function freshState(): StudioState {
  return createStudioState({
    id: crypto.randomUUID(),
    name: 'New migration project',
    businessEntity: 'Business object',
    at: nowIso(),
  });
}

/** The project saved in this browser (without row data), or a new one. */
function initialState(initial?: Workspace): { state: StudioState; startup: Stored } {
  if (initial) {
    return {
      state: reduce(freshState(), { type: 'workspaceLoaded', workspace: initial }),
      startup: { kind: 'ok', workspace: initial },
    };
  }
  const stored = loadStored();
  if (stored.kind === 'ok') {
    return {
      state: reduce(freshState(), { type: 'workspaceLoaded', workspace: stored.workspace }),
      startup: stored,
    };
  }
  return { state: freshState(), startup: stored };
}

/** Saves the project text somewhere other than this browser's single slot (a workspace object folder). */
export type Persist = (text: string) => Promise<{ ok: true } | { ok: false; message: string }>;

export function StudioProvider({
  children,
  initial,
  persist,
  registerFlush,
  initialStage,
}: {
  children: ReactNode;
  /** The project to start from, when it comes from a workspace. */
  initial?: Workspace;
  persist?: Persist;
  /** Lets the screen above save a pending change before it leaves the project. */
  registerFlush?: (flush: (() => Promise<void>) | undefined) => void;
  initialStage?: Stage | undefined;
}) {
  const [boot] = useState(() => initialState(initial));
  const [state, dispatch] = useReducer(reduce, boot.state);
  const [stage, setStage] = useState<Stage>(initialStage ?? 'sources');
  const [startup, setStartup] = useState<Stored>(boot.startup);
  const [lastOutput, setLastOutput] = useState<LocalRunResult | undefined>();
  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | undefined>();
  const [pairSuggestions, setPairSuggestions] = useState<StructureSuggestion[] | undefined>();
  const [deleted, setDeleted] = useState<{ before: Project; message: string } | undefined>();
  const [saveStatus, setSaveStatus] = useState<StudioApi['saveStatus']>({ state: 'idle' });
  const registry = useMemo(
    () => createBuiltInRegistry({ randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)) }),
    [],
  );

  const send = useCallback((event: StudioEvent) => {
    dispatch(
      event.type === 'runFinished'
        ? (event as StudioAction)
        : ({ ...event, at: nowIso() } as StudioAction),
    );
  }, []);

  const preflightList = useMemo(
    () => preflight(state.project, { routines: registry }),
    [state.project, registry],
  );
  const rows = useMemo(
    () =>
      buildMappingRows({
        project: state.project,
        preflight: preflightList,
        ...(state.lastRun && !state.runStale
          ? { runDiagnostics: state.lastRun.run.diagnostics }
          : {}),
      }),
    [state.project, preflightList, state.lastRun, state.runStale],
  );
  const statuses = useMemo(() => stageStatuses(state, preflightList), [state, preflightList]);
  const profiles = useMemo(() => {
    const out = new Map<string, DatasetProfile>();
    for (const s of state.project.sourceDefinitions) {
      for (const d of s.datasets) {
        const data = state.data[d.id];
        if (!data) continue;
        const p = profileDataset(d, data);
        if (p.ok) out.set(d.id, p.value);
      }
    }
    return out;
  }, [state.project.sourceDefinitions, state.data]);

  const conflicts = useMemo(() => {
    const fill: Record<string, number> = {};
    for (const p of profiles.values()) for (const f of p.fields) fill[f.fieldId] = f.fillPercentage;
    return detectConflicts(state.project, {
      fill,
      ...(suggestions ? { suggestions } : {}),
    });
  }, [state.project, profiles, suggestions]);
  const conflictsByField = useMemo(() => conflictsByTarget(conflicts), [conflicts]);

  const acceptSuggestions = useCallback(
    (list: readonly MappingSuggestion[]) => {
      const r = applySuggestions(
        state.project,
        list.map((x) => ({
          structureId: x.targetStructureId,
          targetFieldId: x.targetFieldId,
          sourceFieldId: x.sourceFieldId,
        })),
        nowIso(),
      );
      if (r.applied > 0) dispatch({ type: 'projectEdited', project: r.project });
      return { applied: r.applied, skipped: r.skipped };
    },
    [state.project],
  );

  const deleteMappings = useCallback(
    (targets: readonly { structureId: string; fieldId: string }[]) => {
      const r = removeMappings(state.project, targets, nowIso());
      if (r.removed === 0) return 0;
      const names = targets
        .map(
          (t) =>
            state.project.targetDefinition?.structures
              .find((x) => x.id === t.structureId)
              ?.fields.find((f) => f.id === t.fieldId)?.displayName,
        )
        .filter((n) => n !== undefined);
      const list = names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '');
      setDeleted({
        before: state.project,
        message: `${r.removed === 1 ? 'Mapping removed' : `${r.removed} mappings removed`}${list ? `: ${list}` : ''}.`,
      });
      dispatch({ type: 'projectEdited', project: r.project });
      return r.removed;
    },
    [state.project],
  );
  const structureName = useCallback(
    (id: string) => state.project.targetDefinition?.structures.find((x) => x.id === id)?.name ?? id,
    [state.project.targetDefinition],
  );
  const pairStructures = useCallback(
    (pairs: readonly { structureId: string; driverDatasetId: string }[]) => {
      let project = state.project;
      let n = 0;
      for (const p of pairs) {
        const next = setDriver(project, p.structureId, p.driverDatasetId, nowIso());
        if (next !== project) n++;
        project = next;
      }
      if (n === 0) return 0;
      const names = pairs.map((p) => structureName(p.structureId));
      setDeleted({
        before: state.project,
        message: `${n === 1 ? 'Source dataset set' : `${n} source datasets set`} for ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}.`,
      });
      dispatch({ type: 'projectEdited', project });
      return n;
    },
    [state.project, structureName],
  );
  const unpairStructure = useCallback(
    (structureId: string) => {
      const next = clearDriver(state.project, structureId, nowIso());
      setDeleted({
        before: state.project,
        message: `Source dataset removed from ${structureName(structureId)}.`,
      });
      dispatch({ type: 'projectEdited', project: next });
    },
    [state.project, structureName],
  );
  const undoDelete = useCallback(() => {
    if (!deleted) return;
    dispatch({ type: 'projectEdited', project: deleted.before });
    setDeleted(undefined);
  }, [deleted]);

  const runSample = useCallback(
    (sample: SampleConfig) => {
      const run = runTest(
        {
          runId: crypto.randomUUID(),
          model: state.project,
          data: Object.values(state.data),
          sample,
        },
        { now: nowIso, routines: registry },
      );
      dispatch({ type: 'runFinished', run });
    },
    [state.project, state.data, registry],
  );

  // Autosave: the draft, its snapshots and the dictionary (never the row data) are kept in this browser.
  const first = useRef(true);
  const dirty = useRef(false);
  const latest = useRef({
    project: state.project,
    snapshots: state.snapshots,
    dictionary: state.dictionary,
  });
  useEffect(() => {
    latest.current = {
      project: state.project,
      snapshots: state.snapshots,
      dictionary: state.dictionary,
    };
  });
  // Back to the customer saves a change that the delay has not saved yet, and waits for it.
  useEffect(() => {
    if (!persist || !registerFlush) return;
    registerFlush(async () => {
      if (!dirty.current) return;
      const l = latest.current;
      await persist(
        encodeWorkspace({
          project: l.project,
          snapshots: [...l.snapshots],
          dictionary: l.dictionary,
          savedAt: nowIso(),
        }),
      );
      dirty.current = false;
    });
    return () => registerFlush(undefined);
  }, [persist, registerFlush]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (startup.kind === 'ok') return; // just loaded: nothing new to save
    }
    dirty.current = true;
    const timer = window.setTimeout(() => {
      const at = nowIso();
      const text = encodeWorkspace({
        project: state.project,
        snapshots: [...state.snapshots],
        dictionary: state.dictionary,
        savedAt: at,
      });
      if (persist) {
        void persist(text).then((r) => {
          if (r.ok) dirty.current = false;
          setSaveStatus(r.ok ? { state: 'saved', at } : { state: 'error', message: r.message });
        });
        return;
      }
      const result = store(text);
      const hasWork =
        state.project.sourceDefinitions.length > 0 ||
        (state.project.targetDefinition?.structures.length ?? 0) > 0 ||
        state.project.mappingDefinition.mappings.length > 0 ||
        state.snapshots.length > 0;
      if (result.ok && hasWork) {
        saveToLibrary(
          {
            id: state.project.id,
            name: state.project.name,
            businessEntity: state.project.businessEntity,
            savedAt: at,
          },
          text,
        );
      }
      setSaveStatus(
        result.ok ? { state: 'saved', at } : { state: 'error', message: result.message },
      );
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.project, state.snapshots, state.dictionary]);

  const newProject = useCallback(() => {
    clearStored();
    dispatch({
      type: 'projectReset',
      id: crypto.randomUUID(),
      name: 'New migration project',
      businessEntity: 'Business object',
      at: nowIso(),
    });
    setLastOutput(undefined);
    setStartup({ kind: 'none' });
    setStage('sources');
  }, []);

  const openLibraryProject = useCallback((id: string): string | undefined => {
    const r = loadFromLibrary(id);
    if (r.kind !== 'ok') {
      return r.kind === 'unreadable'
        ? r.reason
        : 'That project is no longer saved in this browser.';
    }
    dispatch({ type: 'workspaceLoaded', workspace: r.workspace });
    setLastOutput(undefined);
    setStartup({ kind: 'ok', workspace: r.workspace });
    setStage('sources');
    return undefined;
  }, []);

  const saveProjectFile = useCallback(() => {
    const text = encodeWorkspace({
      project: state.project,
      snapshots: [...state.snapshots],
      dictionary: state.dictionary,
      savedAt: nowIso(),
    });
    downloadFile(
      `${state.project.name.replace(/[\\/:*?"<>|]+/g, '_') || 'project'}.mms.json`,
      text,
      MIME['json']!,
    );
  }, [state.project, state.snapshots, state.dictionary]);

  const openProjectFile = useCallback(async (file: File): Promise<string | undefined> => {
    const r = decodeWorkspace(await file.text());
    if (!r.ok) return r.issues.map((i) => i.message).join(' ');
    dispatch({ type: 'workspaceLoaded', workspace: r.value });
    setLastOutput(undefined);
    setStartup({ kind: 'ok', workspace: r.value });
    return undefined;
  }, []);

  const api = useMemo<StudioApi>(
    () => ({
      state,
      send,
      registry,
      preflight: preflightList,
      rows,
      statuses,
      profiles,
      suggestions,
      setSuggestions,
      acceptSuggestions,
      conflicts,
      conflictsByField,
      deleteMappings,
      lastDeleted: deleted ? { message: deleted.message } : undefined,
      pairSuggestions,
      setPairSuggestions,
      pairStructures,
      unpairStructure,
      undoDelete,
      dismissUndo: () => setDeleted(undefined),
      stage,
      setStage,
      runSample,
      lastOutput,
      setLastOutput,
      saveStatus,
      startup,
      dismissStartup: () => setStartup({ kind: 'none' }),
      newProject,
      openLibraryProject,
      saveProjectFile,
      openProjectFile,
    }),
    [
      state,
      send,
      registry,
      preflightList,
      rows,
      statuses,
      profiles,
      suggestions,
      acceptSuggestions,
      conflicts,
      conflictsByField,
      deleteMappings,
      deleted,
      pairSuggestions,
      pairStructures,
      unpairStructure,
      undoDelete,
      stage,
      runSample,
      lastOutput,
      saveStatus,
      startup,
      newProject,
      openLibraryProject,
      saveProjectFile,
      openProjectFile,
    ],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStudio(): StudioApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio must be used inside StudioProvider');
  return v;
}
