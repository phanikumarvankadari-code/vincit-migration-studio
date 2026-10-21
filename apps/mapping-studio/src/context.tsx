import type { Diagnostic } from '@mms/mapping-core';
import { profileDataset, type DatasetProfile } from '@mms/profiler';
import { createBuiltInRegistry } from '@mms/routine-library';
import {
  buildMappingRows,
  createStudioState,
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
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';

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
}

const Ctx = createContext<StudioApi | undefined>(undefined);

export const nowIso = (): string => new Date().toISOString();

function initialState(): StudioState {
  return createStudioState({
    id: crypto.randomUUID(),
    name: 'New migration project',
    businessEntity: 'Business object',
    at: nowIso(),
  });
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [stage, setStage] = useState<Stage>('sources');
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
    }),
    [state, send, registry, preflightList, rows, statuses, profiles, stage, runSample],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStudio(): StudioApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio must be used inside StudioProvider');
  return v;
}
