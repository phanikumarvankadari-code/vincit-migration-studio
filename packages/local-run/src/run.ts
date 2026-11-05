import {
  fillTemplate,
  toCsv,
  toXlsx,
  utf8Bytes,
  type CsvOptions,
  type TemplateSheet,
} from '@mms/file-export';
import {
  RunResultSchema,
  fromBase64,
  type Diagnostic,
  type MappingSnapshot,
  type RunDefinition,
  type RunResult,
  type SourceRows,
  type SourceValue,
  type TargetStructure,
} from '@mms/mapping-core';
import { preflight, runTest } from '@mms/test-engine';
import type { JavaScriptExecutor, RoutineRegistry } from '@mms/transformation-engine';

export interface LocalRunOptions {
  /** UTC ISO 8601 clock, injected so this package has no clock of its own. */
  now: () => string;
  routines?: RoutineRegistry;
  javascript?: JavaScriptExecutor;
  /** Output formats. Default CSV only. */
  formats?: readonly ('csv' | 'xlsx')[];
  /** Column headings: field display names (default) or technical names (display name where there is none). */
  header?: 'displayName' | 'technicalName';
  csv?: CsvOptions;
  /** Name of the workbook file (without extension) when XLSX is chosen. Default "Target". */
  workbookName?: string;
}

export interface OutputFile {
  name: string;
  format: 'csv' | 'xlsx' | 'json';
  kind: 'output' | 'errors' | 'diagnostics' | 'summary';
  targetStructureId?: string;
  /** Data rows in the file (not counting the header). */
  rows?: number;
  /** Text for CSV and JSON, bytes for XLSX. Text is UTF-8. */
  content: string | Uint8Array;
}

export interface StructureRunSummary {
  targetStructureId: string;
  name: string;
  /** Rows made from the driver rows. */
  produced: number;
  /** Rows written to the output file (ready or warning). */
  written: number;
  /** Rows that failed and went to the errors file instead. */
  errors: number;
  /** Written rows that carry a warning. */
  warnings: number;
  /** Driver rows that made no row because a join found no match (see the diagnostics file). */
  dropped: number;
}

export interface RunSummary {
  runId: string;
  snapshotId: string;
  snapshotName: string;
  startedAt: string;
  completedAt: string;
  status: RunResult['status'];
  inputRecordCounts: Record<string, number>;
  structures: StructureRunSummary[];
  warningCount: number;
  errorCount: number;
  files: { name: string; kind: OutputFile['kind']; format: OutputFile['format']; rows?: number }[];
  /** Things that had to be adjusted to fit a file format. */
  notes: string[];
}

export interface LocalRunResult {
  run: RunResult;
  summary: RunSummary;
  files: OutputFile[];
}

const safeName = (s: string): string =>
  Array.from(s)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'Output';

const DIAG_HEADER = [
  'Severity',
  'Code',
  'Message',
  'Target structure',
  'Target field',
  'Target row',
  'Source dataset',
  'Source row',
  'Source value',
  'Mapping',
  'Routine',
  'Details',
];
const diagRow = (d: Diagnostic, names: (id: string) => string): SourceValue[] => [
  d.severity,
  d.code,
  d.message,
  d.targetStructureId ? names(d.targetStructureId) : null,
  d.targetFieldId ?? null,
  d.targetRow === undefined ? null : String(d.targetRow),
  d.datasetId ?? null,
  d.sourceRow === undefined ? null : String(d.sourceRow),
  d.sourceValue ?? null,
  d.fieldMappingId ?? null,
  d.routineId ?? null,
  d.technicalDetails ?? null,
];

function failed(
  snapshot: MappingSnapshot,
  definition: RunDefinition,
  options: LocalRunOptions,
  diagnostics: Diagnostic[],
  inputCounts: Record<string, number>,
): LocalRunResult {
  const startedAt = options.now();
  const completedAt = options.now();
  const run = RunResultSchema.parse({
    runId: definition.id,
    status: 'failed',
    startedAt,
    completedAt,
    inputRecordCounts: inputCounts,
    outputRecordCounts: {},
    warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
    errorCount: diagnostics.filter((d) => d.severity === 'error').length,
    diagnostics,
  });
  const summary: RunSummary = {
    runId: definition.id,
    snapshotId: snapshot.id,
    snapshotName: snapshot.name,
    startedAt,
    completedAt,
    status: 'failed',
    inputRecordCounts: inputCounts,
    structures: [],
    warningCount: run.warningCount,
    errorCount: run.errorCount,
    files: [],
    notes: [],
  };
  return { run, summary, files: [] };
}

/**
 * Runs a saved snapshot on every row of the source data and writes the result as files.
 *
 * - Rows that passed (ready or with warnings) go to one output table per target structure.
 * - Rows that failed go to a separate errors table for that structure, with the row number, the source row and the
 *   reasons, so nothing is silently dropped. Driver rows that made no row because a join found no match are counted and
 *   listed in the diagnostics table.
 * - A diagnostics table lists every problem, and a JSON summary gives the run summary (times, snapshot, input and
 *   output counts, warnings, errors, files).
 * - A run is refused ("failed", no output) when the run definition is not a full run of this snapshot, or when routines
 *   or settings are broken (every row would fail the same way).
 * No AI, network or file system access: the caller supplies the rows and saves the files.
 */
export function runLocal(
  snapshot: MappingSnapshot,
  data: readonly SourceRows[],
  definition: RunDefinition,
  options: LocalRunOptions,
): LocalRunResult {
  const inputCounts: Record<string, number> = {};
  for (const r of data) inputCounts[r.datasetId] = r.rows.length;
  const err = (code: string, message: string): Diagnostic => ({ severity: 'error', code, message });

  if (definition.runType !== 'full')
    return failed(
      snapshot,
      definition,
      options,
      [
        err(
          'LOCAL_RUN_MISMATCH',
          `Run "${definition.id}" is a ${definition.runType} run, not a full run.`,
        ),
      ],
      inputCounts,
    );
  if (definition.snapshotId !== snapshot.id)
    return failed(
      snapshot,
      definition,
      options,
      [
        err(
          'LOCAL_RUN_MISMATCH',
          `Run "${definition.id}" is for snapshot "${definition.snapshotId}", not "${snapshot.id}".`,
        ),
      ],
      inputCounts,
    );

  const model = {
    sourceDefinitions: snapshot.sourceSchemas,
    targetDefinition: snapshot.targetDefinition,
    mappingDefinition: snapshot.mappingDefinition,
    routines: snapshot.routines,
    lookups: snapshot.lookups,
  };
  const blocking = preflight(model, {
    ...(options.routines ? { routines: options.routines } : {}),
    ...(options.javascript ? { javascript: options.javascript } : {}),
  }).filter((d) => d.severity === 'error');
  if (blocking.length > 0) {
    return failed(
      snapshot,
      definition,
      options,
      [
        ...blocking,
        err(
          'LOCAL_RUN_BLOCKED',
          'Fix these problems before a full run: every row would fail the same way.',
        ),
      ],
      inputCounts,
    );
  }

  const all = runTest(
    { runId: definition.id, model, data, sample: { kind: 'all' } },
    {
      now: options.now,
      ...(options.routines ? { routines: options.routines } : {}),
      ...(options.javascript ? { javascript: options.javascript } : {}),
      collectLineage: false,
      safeRowLimit: Number.POSITIVE_INFINITY,
    },
  );
  if (all.run.status === 'failed')
    return failed(snapshot, definition, options, all.run.diagnostics, inputCounts);

  const structureName = (id: string): string =>
    snapshot.targetDefinition.structures.find((s) => s.id === id)?.name ?? id;
  const diagnostics = all.run.diagnostics;
  const notes: string[] = [];
  const files: OutputFile[] = [];
  const structures: StructureRunSummary[] = [];
  const formats = options.formats ?? ['csv'];
  const xlsxSheets: { name: string; header: string[]; rows: SourceValue[][] }[] = [];
  const written: Record<string, number> = {};
  const templateSheets: TemplateSheet[] = [];

  const used = new Set<string>();
  const unique = (name: string): string => {
    let n = name;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = name.replace(/(\.[^.]*)?$/, ` (${i})$1`);
    used.add(n.toLowerCase());
    return n;
  };

  for (const out of all.targets) {
    const st: TargetStructure = snapshot.targetDefinition.structures.find(
      (s) => s.id === out.rows.targetStructureId,
    )!;
    const header = st.fields.map((f) =>
      options.header === 'technicalName' ? (f.technicalName ?? f.displayName) : f.displayName,
    );
    const good: SourceValue[][] = [];
    const bad: SourceValue[][] = [];
    let warnings = 0;
    out.rows.rows.forEach((row, i) => {
      const status = out.rowStatus[i]!;
      if (status === 'error') {
        const reasons = diagnostics
          .filter(
            (d) => d.targetStructureId === st.id && d.targetRow === i + 1 && d.severity !== 'info',
          )
          .map((d) => d.message);
        bad.push([String(i + 1), String(out.driverRows[i] ?? ''), reasons.join(' | '), ...row]);
      } else {
        good.push([...row]);
        if (status === 'warning') warnings++;
      }
    });
    const dropped = diagnostics.filter(
      (d) => d.code === 'ENGINE_ROW_DROPPED' && d.targetStructureId === st.id,
    ).length;
    structures.push({
      targetStructureId: st.id,
      name: st.name,
      produced: out.rows.rows.length,
      written: good.length,
      errors: bad.length,
      warnings,
      dropped,
    });
    written[st.id] = good.length;
    if (st.templateSheet)
      templateSheets.push({
        sheet: st.templateSheet,
        keys: st.fields.map((f) => f.technicalName ?? null),
        rows: good,
      });

    const errHeader = ['Row', 'Source row', 'Problems', ...header];
    if (formats.includes('csv')) {
      files.push({
        name: unique(`${safeName(st.name)}.csv`),
        format: 'csv',
        kind: 'output',
        targetStructureId: st.id,
        rows: good.length,
        content: toCsv({ header, rows: good }, options.csv),
      });
      if (bad.length > 0)
        files.push({
          name: unique(`${safeName(st.name)}.errors.csv`),
          format: 'csv',
          kind: 'errors',
          targetStructureId: st.id,
          rows: bad.length,
          content: toCsv({ header: errHeader, rows: bad }, options.csv),
        });
    }
    if (formats.includes('xlsx')) {
      xlsxSheets.push({ name: st.name, header, rows: good });
      if (bad.length > 0)
        xlsxSheets.push({ name: `${st.name} errors`, header: errHeader, rows: bad });
    }
  }

  // A target template workbook gets the rows in its own sheets (always, whatever formats were chosen).
  const template = snapshot.targetDefinition.template;
  if (template && templateSheets.length > 0) {
    const filled = fillTemplate(fromBase64(template.base64), templateSheets);
    if (filled.ok) {
      files.push({
        name: unique(template.fileName.replace(/[\\/:*?"<>|]/g, '_')),
        format: 'xlsx',
        kind: 'output',
        rows: templateSheets.reduce((n, t) => n + t.rows.length, 0),
        content: filled.value.bytes,
      });
      notes.push(...filled.value.notes);
    } else {
      notes.push(...filled.issues.map((i) => `The target template was not filled: ${i.message}`));
    }
  }

  const diagTable = {
    header: DIAG_HEADER,
    rows: diagnostics.map((d) => diagRow(d, structureName)),
  };
  if (formats.includes('csv'))
    files.push({
      name: unique('diagnostics.csv'),
      format: 'csv',
      kind: 'diagnostics',
      rows: diagTable.rows.length,
      content: toCsv(diagTable, options.csv),
    });
  if (formats.includes('xlsx')) {
    xlsxSheets.push({ name: 'Diagnostics', ...diagTable });
    const book = toXlsx(xlsxSheets);
    if (book.ok) {
      files.push({
        name: unique(`${safeName(options.workbookName ?? 'Target')}.xlsx`),
        format: 'xlsx',
        kind: 'output',
        rows: xlsxSheets.reduce((n, s) => n + s.rows.length, 0),
        content: book.value.bytes,
      });
      notes.push(...book.value.notes);
    } else {
      notes.push(...book.issues.map((i) => `The Excel file was not written: ${i.message}`));
    }
  }

  const completedAt = options.now();
  const counts = {
    warning: diagnostics.filter((d) => d.severity === 'warning').length,
    error: diagnostics.filter((d) => d.severity === 'error').length,
  };
  const status: RunResult['status'] =
    structures.some((s) => s.errors > 0) || counts.error > 0 ? 'completedWithErrors' : 'completed';

  const summary: RunSummary = {
    runId: definition.id,
    snapshotId: snapshot.id,
    snapshotName: snapshot.name,
    startedAt: all.run.startedAt,
    completedAt,
    status,
    inputRecordCounts: inputCounts,
    structures,
    warningCount: counts.warning,
    errorCount: counts.error,
    files: [],
    notes,
  };
  const summaryName = unique('run-summary.json');
  summary.files = [
    ...files,
    { name: summaryName, format: 'json' as const, kind: 'summary' as const, content: '' },
  ].map((f) => ({
    name: f.name,
    kind: f.kind,
    format: f.format,
    ...(f.rows !== undefined ? { rows: f.rows } : {}),
  }));
  files.push({
    name: summaryName,
    format: 'json',
    kind: 'summary',
    content: JSON.stringify(summary, null, 2) + '\n',
  });

  const run = RunResultSchema.parse({
    runId: definition.id,
    status,
    startedAt: all.run.startedAt,
    completedAt,
    inputRecordCounts: inputCounts,
    outputRecordCounts: written,
    warningCount: counts.warning,
    errorCount: counts.error,
    generatedFiles: files.map((f) => ({
      kind: f.kind,
      ...(f.targetStructureId ? { targetStructureId: f.targetStructureId } : {}),
      fileName: f.name,
      format: f.format,
    })),
    diagnostics,
  });
  return { run, summary, files };
}

/** The bytes of an output file (text as UTF-8). */
export const fileBytes = (f: OutputFile): Uint8Array =>
  typeof f.content === 'string' ? utf8Bytes(f.content) : f.content;
