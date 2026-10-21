import {
  IsoDateTimeSchema,
  RunResultSchema,
  computeCompleteness,
  type Diagnostic,
  type MappingSnapshot,
  type ModelParts,
  type RunDefinition,
  type RunResult,
  type SourceRows,
  type StructureCompleteness,
} from '@mms/mapping-core';
import {
  executeMapping,
  type JavaScriptExecutor,
  type RoutineRegistry,
  type TargetOutput,
} from '@mms/transformation-engine';
import { checkTargetRows } from './checks.js';
import { preflight } from './preflight.js';
import { DEFAULT_SAMPLE, selectRows, type SampleConfig } from './sample.js';
import { summarizeDiagnostics, type DiagnosticGroup } from './summarize.js';

export interface TestRunOptions {
  /** UTC ISO 8601 clock, such as the current time as an ISO string. Injected so this package has no clock of its own. */
  now: () => string;
  routines?: RoutineRegistry;
  javascript?: JavaScriptExecutor;
  /** Record lineage. Default: on for samples of up to 1,000 rows, off for larger ones. */
  collectLineage?: boolean;
  /** "All rows" only runs if the sources hold at most this many rows in total. Default 100,000. */
  safeRowLimit?: number;
  /** Only these target structures, by ID. */
  structures?: readonly string[];
}

export interface TestRunInput {
  runId: string;
  model: ModelParts;
  data: readonly SourceRows[];
  /** Default: the first 100 rows of each structure's driver dataset. */
  sample?: SampleConfig;
}

export interface StructureSummary {
  targetStructureId: string;
  name: string;
  driverDataset: string;
  driverRowCount: number;
  /** Driver rows that were run. */
  sampledRowCount: number;
  /** Rows produced. */
  rows: number;
  ready: number;
  warning: number;
  error: number;
}

export interface TestRunResult {
  /** The run summary in the shared contract: counts, status, times, all diagnostics. */
  run: RunResult;
  sample: SampleConfig;
  /** One table per structure, each with row status, driver row numbers and (optionally) lineage. */
  targets: TargetOutput[];
  structures: StructureSummary[];
  completeness: StructureCompleteness[];
  /** Problems found before running. Also part of run.diagnostics. */
  preflight: Diagnostic[];
  /** run.diagnostics collapsed by code, structure and field, worst first. */
  diagnosticGroups: DiagnosticGroup[];
}

const DEFAULT_SAFE_ROWS = 100_000;

function finish(args: {
  input: TestRunInput;
  sample: SampleConfig;
  startedAt: string;
  options: TestRunOptions;
  status: RunResult['status'];
  diagnostics: Diagnostic[];
  preflightDiags: Diagnostic[];
  targets: TargetOutput[];
  inputCounts: Record<string, number>;
}): TestRunResult {
  const { diagnostics } = args;
  const outputCounts: Record<string, number> = {};
  for (const t of args.targets) outputCounts[t.rows.targetStructureId] = t.rows.rows.length;
  const run = RunResultSchema.parse({
    runId: args.input.runId,
    status: args.status,
    startedAt: args.startedAt,
    completedAt: args.options.now(),
    inputRecordCounts: args.inputCounts,
    outputRecordCounts: outputCounts,
    warningCount: diagnostics.filter((x) => x.severity === 'warning').length,
    errorCount: diagnostics.filter((x) => x.severity === 'error').length,
    diagnostics,
  });
  const target = args.input.model.targetDefinition;
  const names = new Map((target?.structures ?? []).map((s) => [s.id as string, s.name]));
  return {
    run,
    sample: args.sample,
    targets: args.targets,
    structures: args.targets.map((t) => ({
      targetStructureId: t.rows.targetStructureId,
      name: names.get(t.rows.targetStructureId) ?? t.rows.targetStructureId,
      driverDataset: t.driverDataset,
      driverRowCount: t.driverRowCount,
      sampledRowCount: t.sampledRowCount,
      rows: t.rows.rows.length,
      ready: t.rowStatus.filter((s) => s === 'ready').length,
      warning: t.rowStatus.filter((s) => s === 'warning').length,
      error: t.rowStatus.filter((s) => s === 'error').length,
    })),
    completeness: target ? computeCompleteness(target, args.input.model.mappingDefinition) : [],
    preflight: args.preflightDiags,
    diagnosticGroups: summarizeDiagnostics(diagnostics),
  };
}

/**
 * Runs a draft mapping on a sample and packages everything a result view needs. Repeatable: the same model, data and
 * sample give the same rows (apart from UUID v4). Problems in some rows never hide the others; a model that cannot
 * run at all gives a result with status "failed" and the reasons as diagnostics. This function does not throw
 * for bad models or bad data.
 */
export function runTest(input: TestRunInput, options: TestRunOptions): TestRunResult {
  const startedAt = IsoDateTimeSchema.parse(options.now());
  const sample = input.sample ?? DEFAULT_SAMPLE;
  const preflightDiags = preflight(input.model, {
    ...(options.routines ? { routines: options.routines } : {}),
    ...(options.javascript ? { javascript: options.javascript } : {}),
  });
  const inputCounts: Record<string, number> = {};
  for (const r of input.data) inputCounts[r.datasetId] = r.rows.length;
  const common = { input, sample, startedAt, options, preflightDiags, inputCounts };

  const totalRows = input.data.reduce((n, r) => n + r.rows.length, 0);
  const limit = options.safeRowLimit ?? DEFAULT_SAFE_ROWS;
  if (sample.kind === 'all' && totalRows > limit) {
    const blocked: Diagnostic = {
      severity: 'error',
      code: 'TEST_ALL_NOT_SAFE',
      message: `Running all rows was requested but the sources hold ${totalRows.toLocaleString('en-US')} rows (the safe limit is ${limit.toLocaleString('en-US')}). Choose a smaller sample or raise the limit.`,
    };
    return finish({
      ...common,
      status: 'failed',
      diagnostics: [...preflightDiags, blocked],
      targets: [],
    });
  }

  const lineage = options.collectLineage ?? (sample.kind !== 'all' && sample.count <= 1000);
  const executed = executeMapping(input.model, input.data, {
    ...(options.routines ? { routines: options.routines } : {}),
    ...(options.javascript ? { javascript: options.javascript } : {}),
    ...(options.structures ? { structures: options.structures } : {}),
    collectLineage: lineage,
    sampleRows: ({ rowCount }) => selectRows(sample, rowCount),
  });
  if (!executed.ok) {
    return finish({
      ...common,
      status: 'failed',
      diagnostics: [...preflightDiags, ...executed.issues],
      targets: [],
    });
  }

  const checked = checkTargetRows(input.model, executed.value.targets);
  const targets = executed.value.targets.map((t) => ({
    ...t,
    rowStatus: checked.rowStatus.get(t.rows.targetStructureId) ?? t.rowStatus,
  }));
  const diagnostics = [...preflightDiags, ...executed.value.diagnostics, ...checked.diagnostics];
  const status = diagnostics.some((x) => x.severity === 'error')
    ? 'completedWithErrors'
    : 'completed';
  return finish({ ...common, status, diagnostics, targets });
}

/** Runs a test run against a saved snapshot. The run definition must be a test run for that snapshot. */
export function runTestOnSnapshot(
  snapshot: MappingSnapshot,
  data: readonly SourceRows[],
  definition: RunDefinition,
  options: TestRunOptions,
): TestRunResult {
  const model: ModelParts = {
    sourceDefinitions: snapshot.sourceSchemas,
    targetDefinition: snapshot.targetDefinition,
    mappingDefinition: snapshot.mappingDefinition,
    routines: snapshot.routines,
    lookups: snapshot.lookups,
  };
  const input: TestRunInput = {
    runId: definition.id,
    model,
    data,
    ...(definition.sample ? { sample: definition.sample } : {}),
  };
  if (definition.runType !== 'test' || definition.snapshotId !== snapshot.id) {
    const startedAt = IsoDateTimeSchema.parse(options.now());
    const reason =
      definition.runType !== 'test'
        ? `Run "${definition.id}" is a ${definition.runType} run, not a test run.`
        : `Run "${definition.id}" is for snapshot "${definition.snapshotId}", not "${snapshot.id}".`;
    return finish({
      input,
      sample: input.sample ?? DEFAULT_SAMPLE,
      startedAt,
      options,
      status: 'failed',
      diagnostics: [{ severity: 'error', code: 'TEST_RUN_MISMATCH', message: reason }],
      preflightDiags: [],
      targets: [],
      inputCounts: {},
    });
  }
  return runTest(input, options);
}
