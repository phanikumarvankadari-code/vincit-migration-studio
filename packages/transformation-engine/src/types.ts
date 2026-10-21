import type {
  CellLineage,
  Diagnostic,
  JsonValue,
  JavaScriptDefinition,
  SourceValue,
  TargetRows,
} from '@mms/mapping-core';

export type RoutineResult =
  { ok: true; value: SourceValue } | { ok: false; code: string; message: string };

/**
 * A routine implementation (SPEC-014 to 017 provide them). It gets the current value of the chain, all
 * source values of the mapping, and its configuration. It must be deterministic and must not throw.
 */
export type RoutineImplementation = (args: {
  value: SourceValue;
  inputs: readonly SourceValue[];
  configuration: Record<string, JsonValue>;
}) => RoutineResult;

/** Routine implementations by routine ID. */
export type RoutineRegistry = Readonly<Record<string, RoutineImplementation>>;

/** Runs custom JavaScript (SPEC-019 provides the sandbox). The engine never evaluates code itself. */
export type JavaScriptExecutor = (args: {
  definition: JavaScriptDefinition;
  value: SourceValue;
  inputs: readonly SourceValue[];
  /** Values of the current row by source field ID, for the datasets the mapping can reach. */
  row: Readonly<Record<string, SourceValue>>;
  /**
   * Approved lookup helper. Only lookups the mapping declares in `declaredLookupIds` can be used.
   * Returns undefined when the lookup is not declared or the key has no entry.
   */
  lookup: (lookupId: string, key: SourceValue) => SourceValue | undefined;
}) => RoutineResult;

export interface ExecuteOptions {
  routines?: RoutineRegistry;
  javascript?: JavaScriptExecutor;
  /** Record where every target value came from. Default false (it costs memory on large runs). */
  collectLineage?: boolean;
  /** Only the first N driver rows of each target structure (test runs). */
  limit?: number;
  /** Only these target structures, by ID. Default: all. */
  structures?: readonly string[];
}

export type RowStatus = 'ready' | 'warning' | 'error';

export interface TargetOutput {
  rows: TargetRows;
  /** One per output row. Error beats warning beats ready. */
  rowStatus: RowStatus[];
  /** For each output row, the 1-based driver row it came from. */
  driverRows: number[];
  /** For each output row and field, if collectLineage is on. */
  lineage?: (CellLineage | undefined)[][];
}

export interface ExecutionResult {
  targets: TargetOutput[];
  diagnostics: Diagnostic[];
  inputRecordCounts: Record<string, number>;
  outputRecordCounts: Record<string, number>;
  warningCount: number;
  errorCount: number;
}
