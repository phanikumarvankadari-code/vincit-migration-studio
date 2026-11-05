import { computeCompleteness, type Diagnostic } from '@mms/mapping-core';
import type { StudioState } from './state.js';

export const STAGES = ['sources', 'target', 'map', 'test', 'ready'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  sources: 'Sources',
  target: 'Target',
  map: 'Map',
  test: 'Test',
  ready: 'Ready',
};

export type StageState = 'notStarted' | 'inProgress' | 'attention' | 'complete';
export interface StageStatus {
  state: StageState;
  /** One line shown under the stage name. */
  summary: string;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Status per stage, derived from the state (never stored). "Attention" means something needs a decision
 * (for example suggested relationships, or errors in the last test).
 */
export function stageStatuses(
  state: StudioState,
  preflight: readonly Diagnostic[] = [],
): Record<Stage, StageStatus> {
  const p = state.project;
  const datasets = p.sourceDefinitions.flatMap((s) => s.datasets);
  const rels = p.mappingDefinition.relationships;
  const pending = rels.filter((r) => r.status === 'suggested').length;
  const confirmed = rels.filter((r) => r.status === 'confirmed').length;

  const missing = datasets.filter((d) => !state.data[d.id]).length;
  const sources: StageStatus =
    datasets.length === 0
      ? { state: 'notStarted', summary: 'No files yet' }
      : missing > 0
        ? { state: 'attention', summary: `${plural(datasets.length, 'dataset')}, data not loaded` }
        : {
            // Joins are optional: only confirmed joins are used, so open suggestions never block anything.
            state: 'complete',
            summary: `${plural(datasets.length, 'dataset')}${confirmed > 0 ? `, ${plural(confirmed, 'join')} confirmed` : ''}${pending > 0 ? `, ${plural(pending, 'join')} suggested` : ''}`,
          };

  const structures = p.targetDefinition?.structures ?? [];
  const target: StageStatus =
    structures.length === 0
      ? { state: 'notStarted', summary: 'No target yet' }
      : {
          state: 'complete',
          summary: `${plural(structures.length, 'structure')}, ${plural(
            structures.reduce((n, s) => n + s.fields.length, 0),
            'field',
          )}`,
        };

  const completeness = p.targetDefinition
    ? computeCompleteness(p.targetDefinition, p.mappingDefinition)
    : [];
  const total = completeness.reduce((n, c) => n + c.totalFields, 0);
  const mapped = completeness.reduce((n, c) => n + c.mappedFields, 0);
  const allReady = completeness.length > 0 && completeness.every((c) => c.ready);
  const mapErrors = preflight.filter((d) => d.severity === 'error').length;
  const map: StageStatus =
    total === 0
      ? { state: 'notStarted', summary: 'Nothing to map yet' }
      : mapErrors > 0
        ? {
            state: 'attention',
            summary: `${mapped} of ${total} fields mapped, ${plural(mapErrors, 'problem')}`,
          }
        : mapped === 0
          ? { state: 'notStarted', summary: `0 of ${total} fields mapped` }
          : {
              state: allReady ? 'complete' : 'inProgress',
              summary: `${mapped} of ${total} fields mapped${allReady ? '' : ', required fields open'}`,
            };

  const run = state.lastRun;
  const test: StageStatus = !run
    ? { state: 'notStarted', summary: 'Not run yet' }
    : run.run.status === 'failed'
      ? { state: 'attention', summary: 'Last run could not execute' }
      : run.run.errorCount > 0
        ? { state: 'attention', summary: `${plural(run.run.errorCount, 'error')} in the last run` }
        : state.runStale
          ? { state: 'inProgress', summary: 'Results out of date' }
          : {
              state: 'complete',
              summary: `Last run clean${run.run.warningCount > 0 ? `, ${plural(run.run.warningCount, 'warning')}` : ''}`,
            };

  const blockers: string[] = [];
  if (sources.state !== 'complete') blockers.push('sources');
  if (target.state !== 'complete') blockers.push('target');
  if (map.state !== 'complete') blockers.push('mappings');
  if (test.state !== 'complete') blockers.push('a clean test');
  const marked = [...state.snapshots].reverse().find((r) => r.marker !== 'none');
  const ready: StageStatus =
    blockers.length > 0
      ? {
          state: blockers.length === 4 ? 'notStarted' : 'inProgress',
          summary: `Waiting for ${blockers.join(', ')}`,
        }
      : marked
        ? {
            state: 'complete',
            summary: `Snapshot "${marked.snapshot.name}" is ${marked.marker === 'approved' ? 'approved' : 'ready'}`,
          }
        : { state: 'inProgress', summary: 'Ready to save a snapshot' };

  return { sources, target, map, test, ready };
}

export interface ReadinessItem {
  stage: Stage;
  label: string;
  done: boolean;
}

/** The checklist shown on the Ready stage. */
export function readinessChecklist(
  state: StudioState,
  preflight: readonly Diagnostic[] = [],
): ReadinessItem[] {
  const s = stageStatuses(state, preflight);
  const p = state.project;
  const completeness = p.targetDefinition
    ? computeCompleteness(p.targetDefinition, p.mappingDefinition)
    : [];
  return [
    { stage: 'sources', label: 'Source files are loaded', done: p.sourceDefinitions.length > 0 },
    { stage: 'target', label: 'A target structure is loaded', done: s.target.state === 'complete' },
    {
      stage: 'map',
      label: 'All required and key fields are mapped',
      done: completeness.length > 0 && completeness.every((c) => c.ready),
    },
    {
      stage: 'map',
      label: 'No mapping has a configuration problem',
      done: preflight.every((d) => d.severity !== 'error'),
    },
    { stage: 'test', label: 'A test run has been done', done: state.lastRun !== undefined },
    {
      stage: 'test',
      label: 'The last test run has no errors',
      done:
        state.lastRun !== undefined &&
        state.lastRun.run.status !== 'failed' &&
        state.lastRun.run.errorCount === 0,
    },
    {
      stage: 'test',
      label: 'The test results are up to date',
      done: state.lastRun !== undefined && !state.runStale,
    },
    { stage: 'ready', label: 'A snapshot is saved', done: state.snapshots.length > 0 },
    {
      stage: 'ready',
      label: 'A snapshot is marked Ready or Approved',
      done: state.snapshots.some((r) => r.marker !== 'none'),
    },
  ];
}
