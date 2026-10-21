import type { Diagnostic } from '@mms/mapping-core';
import type { LocalRunResult } from '@mms/local-run';
import { profileDataset, type DatasetProfile } from '@mms/profiler';
import { createBuiltInRegistry } from '@mms/routine-library';
import {
  buildMappingRows,
  createStudioState,
  decodeWorkspace,
  encodeWorkspace,
  reduce,
  stageStatuses,
  type MappingRow,
  type Stage,
  type StageStatus,
  type StudioAction,
  type StudioState,
} from '@mms/studio-model';
import { preflight, runTest, type SampleConfig } from '@mms/test-engine';
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
function initialState(): { state: StudioState; startup: Stored } {
  const stored = loadStored();
  if (stored.kind === 'ok') {
    return {
      state: reduce(freshState(), { type: 'workspaceLoaded', workspace: stored.workspace }),
      startup: stored,
    };
  }
  return { state: freshState(), startup: stored };
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(initialState);
  const [state, dispatch] = useReducer(reduce, boot.state);
  const [stage, setStage] = useState<Stage>('sources');
  const [startup, setStartup] = useState<Stored>(boot.startup);
  const [lastOutput, setLastOutput] = useState<LocalRunResult | undefined>();
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
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (startup.kind === 'ok') return; // just loaded: nothing new to save
    }
    const timer = window.setTimeout(() => {
      const at = nowIso();
      const text = encodeWorkspace({
        project: state.project,
        snapshots: [...state.snapshots],
        dictionary: state.dictionary,
        savedAt: at,
      });
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
