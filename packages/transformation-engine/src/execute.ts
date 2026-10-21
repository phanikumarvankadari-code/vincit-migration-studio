import {
  validateModel,
  type Diagnostic,
  type FieldMapping,
  type ModelParts,
  type Relationship,
  type Result,
  type SourceRows,
  type SourceValue,
  type TargetStructure,
} from '@mms/mapping-core';
import { buildLookupIndex, evaluateMapping, type RowAccess } from './evaluate.js';
import type { ExecuteOptions, ExecutionResult, RowStatus, TargetOutput } from './types.js';

type Row = readonly SourceValue[];

interface JoinStep {
  rel: Relationship;
  from: 'left' | 'right';
  fromDataset: string;
  toDataset: string;
  fromFields: string[];
  toFields: string[];
}

const SEP = '\u0000';
const diag = (
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic => ({ severity, code, message, ...extra }) as Diagnostic;

/** Field IDs of every dataset a mapping reads: its source references and condition operands. */
function mappingDatasets(m: FieldMapping): string[] {
  const out = new Set<string>(m.sourceReferences.map((r) => r.datasetId));
  const operand = (o: { kind: string; datasetId?: string }): void => {
    if (o.kind === 'field' && o.datasetId) out.add(o.datasetId);
  };
  const cond = (c: import('@mms/mapping-core').ConditionExpr): void => {
    if (c.op === 'compare') {
      operand(c.left);
      operand(c.right);
    } else if (c.op === 'in' || c.op === 'isEmpty') operand(c.operand);
    else if (c.op === 'not') cond(c.condition);
    else c.conditions.forEach(cond);
  };
  if (m.mappingType === 'conditional') {
    for (const r of m.conditional.rules) {
      cond(r.when);
      operand(r.then);
    }
    if (m.conditional.otherwise) operand(m.conditional.otherwise);
  }
  return [...out];
}

/**
 * Runs the mapping over the source rows and produces one output table per target structure.
 *
 * Rows: each target structure has a driver dataset (its `generation`, or the one dataset its mappings read).
 * One output row is made per driver row, so a parent with three children in the driver dataset gives three rows
 * and a parent with none gives none. Other datasets are reached through confirmed relationships.
 * Joins: no match on a left join keeps the row with blanks; no match on an inner join (or when the join runs
 * from the right side) drops the row with a warning; several matches use the first and warn.
 * Nothing is dropped silently. Output order follows the driver rows, so a run is repeatable.
 */
export function executeMapping(
  model: ModelParts,
  data: readonly SourceRows[],
  options: ExecuteOptions = {},
): Result<ExecutionResult> {
  const invalid = validateModel(model).filter((i) => i.severity === 'error');
  if (invalid.length > 0) return { ok: false, issues: invalid };
  const target = model.targetDefinition;
  if (!target)
    return {
      ok: false,
      issues: [diag('error', 'ENGINE_NO_TARGET', 'The model has no target definition.')],
    };

  // Datasets and their data
  const datasets = new Map(
    model.sourceDefinitions.flatMap((s) => s.datasets).map((d) => [d.id as string, d]),
  );
  const rowsOf = new Map<string, readonly Row[]>();
  const fieldIndex = new Map<string, Map<string, number>>();
  for (const r of data) {
    const ds = datasets.get(r.datasetId);
    if (!ds)
      return {
        ok: false,
        issues: [
          diag(
            'error',
            'ENGINE_UNKNOWN_DATASET',
            `Rows were given for unknown dataset "${r.datasetId}".`,
          ),
        ],
      };
    if (
      r.fieldIds.length !== ds.fields.length ||
      r.fieldIds.some((id, i) => id !== ds.fields[i]!.id)
    ) {
      return {
        ok: false,
        issues: [
          diag(
            'error',
            'ENGINE_DATA_MISMATCH',
            `The columns of the rows for "${ds.name}" do not match its fields.`,
            { datasetId: ds.id },
          ),
        ],
      };
    }
    const bad = r.rows.findIndex((row) => row.length !== r.fieldIds.length);
    if (bad >= 0) {
      return {
        ok: false,
        issues: [
          diag(
            'error',
            'ENGINE_DATA_MISMATCH',
            `Row ${bad + 1} of "${ds.name}" has ${r.rows[bad]!.length} values but the dataset has ${r.fieldIds.length} fields.`,
            { datasetId: ds.id, sourceRow: bad + 1 },
          ),
        ],
      };
    }
    rowsOf.set(r.datasetId, r.rows);
    fieldIndex.set(r.datasetId, new Map(r.fieldIds.map((id, i) => [id as string, i])));
  }

  const lookups = new Map(model.lookups.map((l) => [l.id as string, buildLookupIndex(l)]));
  const confirmed = model.mappingDefinition.relationships.filter((r) => r.status === 'confirmed');
  const joinIndexes = new Map<string, Map<string, number[]>>();
  const indexFor = (step: JoinStep): Map<string, number[]> => {
    const key = `${step.rel.id}>${step.toDataset}`;
    let idx = joinIndexes.get(key);
    if (!idx) {
      idx = new Map();
      const rows = rowsOf.get(step.toDataset) ?? [];
      const cols = step.toFields.map((f) => fieldIndex.get(step.toDataset)!.get(f)!);
      rows.forEach((row, i) => {
        const k = keyOf(row, cols);
        if (k !== undefined) (idx!.get(k) ?? (idx!.set(k, []), idx!.get(k)!)).push(i);
      });
      joinIndexes.set(key, idx);
    }
    return idx;
  };

  const diagnostics: Diagnostic[] = [];
  const targets: TargetOutput[] = [];
  const wanted = options.structures ? new Set(options.structures) : undefined;

  for (const structure of target.structures) {
    if (wanted && !wanted.has(structure.id)) continue;
    const out = runStructure(structure);
    targets.push(out);
  }

  function runStructure(structure: TargetStructure): TargetOutput {
    const output: TargetOutput = {
      rows: {
        targetStructureId: structure.id,
        fieldIds: structure.fields.map((f) => f.id),
        rows: [],
      },
      rowStatus: [],
      driverRows: [],
      driverDataset: '',
      driverRowCount: 0,
      sampledRowCount: 0,
      ...(options.collectLineage ? { lineage: [] } : {}),
    };
    const structCtx = { targetStructureId: structure.id } as Partial<Diagnostic>;
    const mappings = model.mappingDefinition.mappings.filter(
      (m) => m.targetStructureId === structure.id,
    );
    if (mappings.length === 0) {
      diagnostics.push(
        diag(
          'info',
          'ENGINE_STRUCTURE_NOT_MAPPED',
          `Target structure "${structure.name}" has no mappings. No rows were produced.`,
          structCtx,
        ),
      );
      return output;
    }

    const needed = new Set<string>();
    mappings.forEach((m) => mappingDatasets(m).forEach((d) => needed.add(d)));

    const driver: string | undefined =
      (structure.generation?.driverDatasetId as string | undefined) ??
      (needed.size === 1 ? [...needed][0] : undefined);
    if (driver === undefined) {
      diagnostics.push(
        diag(
          'error',
          'ENGINE_NO_DRIVER',
          `Cannot tell which dataset drives the rows of "${structure.name}"${needed.size > 1 ? ` (its mappings read ${[...needed].join(', ')})` : ' (its mappings read no source data)'}. Set the driver dataset on the structure.`,
          structCtx,
        ),
      );
      return output;
    }
    needed.delete(driver);
    if (!rowsOf.has(driver)) {
      diagnostics.push(
        diag(
          'error',
          'ENGINE_NO_DATA',
          `No rows were given for the driver dataset "${driver}" of "${structure.name}".`,
          structCtx,
        ),
      );
      return output;
    }

    // Join plan: shortest confirmed path from the driver to each other dataset, in a fixed order.
    const via = structure.generation?.viaRelationshipIds?.map(String);
    const allowed = via ? confirmed.filter((r) => via.includes(r.id)) : confirmed;
    const plan: JoinStep[] = [];
    const reached = new Set<string>([driver]);
    for (const dsId of [...needed]) {
      const path = findPath(driver, dsId, allowed);
      if (!path) {
        diagnostics.push(
          diag(
            'error',
            'ENGINE_NO_JOIN_PATH',
            `No confirmed relationship connects "${driver}" to "${dsId}"${via ? ' within the relationships set on the structure' : ''}. Values from "${dsId}" are blank in "${structure.name}".`,
            structCtx,
          ),
        );
        continue;
      }
      if (!rowsOf.has(dsId)) {
        diagnostics.push(
          diag(
            'error',
            'ENGINE_NO_DATA',
            `No rows were given for dataset "${dsId}" used by "${structure.name}".`,
            structCtx,
          ),
        );
        continue;
      }
      for (const step of path) {
        if (reached.has(step.toDataset)) continue;
        if (!rowsOf.has(step.toDataset)) {
          diagnostics.push(
            diag(
              'error',
              'ENGINE_NO_DATA',
              `No rows were given for dataset "${step.toDataset}" on the join path to "${dsId}".`,
              structCtx,
            ),
          );
          break;
        }
        reached.add(step.toDataset);
        plan.push(step);
      }
    }

    const byField = new Map(mappings.map((m) => [m.targetFieldId as string, m]));
    const driverRows = rowsOf.get(driver)!;
    const total = driverRows.length;
    let selected: number[];
    if (options.sampleRows) {
      const picked = options.sampleRows({
        targetStructureId: structure.id,
        driverDatasetId: driver,
        rowCount: total,
      });
      selected = [
        ...new Set(picked.filter((n) => Number.isInteger(n) && n >= 0 && n < total)),
      ].sort((a, b) => a - b);
    } else {
      const count =
        options.limit === undefined ? total : Math.min(Math.max(0, options.limit), total);
      selected = Array.from({ length: count }, (_, n) => n);
    }
    output.driverDataset = driver;
    output.driverRowCount = total;
    output.sampledRowCount = selected.length;

    for (const i of selected) {
      const ctx = new Map<string, number | undefined>([[driver, i]]);
      const driverNo = i + 1;
      const rowDiags: Diagnostic[] = [];
      const base = {
        datasetId: driver,
        sourceRow: driverNo,
        targetStructureId: structure.id,
      } as Partial<Diagnostic>;
      let dropped = false;

      for (const step of plan) {
        const fromRow = ctx.get(step.fromDataset);
        if (fromRow === undefined) {
          ctx.set(step.toDataset, undefined);
          continue;
        }
        const k = keyOf(
          rowsOf.get(step.fromDataset)![fromRow]!,
          step.fromFields.map((f) => fieldIndex.get(step.fromDataset)!.get(f)!),
        );
        const matches = k === undefined ? undefined : indexFor(step).get(k);
        if (!matches || matches.length === 0) {
          if (step.rel.joinType === 'inner' || step.from === 'right') {
            rowDiags.push(
              diag(
                'warning',
                'ENGINE_ROW_DROPPED',
                `Row ${driverNo} of "${driver}" was not produced: no matching row in "${step.toDataset}" (${step.rel.joinType} join, relationship "${step.rel.id}").`,
                base,
              ),
            );
            dropped = true;
            break;
          }
          ctx.set(step.toDataset, undefined);
        } else {
          if (matches.length > 1) {
            rowDiags.push(
              diag(
                'warning',
                'ENGINE_JOIN_MULTIPLE_MATCHES',
                `Row ${driverNo} of "${driver}" matches ${matches.length} rows in "${step.toDataset}". The first one is used.`,
                base,
              ),
            );
          }
          ctx.set(step.toDataset, matches[0]);
        }
      }
      if (dropped) {
        diagnostics.push(...rowDiags);
        continue;
      }

      const rowAccess: RowAccess = {
        value: (datasetId, fieldId) => {
          const r = ctx.get(datasetId);
          const col = fieldIndex.get(datasetId)?.get(fieldId);
          return r === undefined || col === undefined
            ? null
            : (rowsOf.get(datasetId)![r]![col] ?? null);
        },
        rowNumber: (datasetId) => {
          const r = ctx.get(datasetId);
          return r === undefined ? undefined : r + 1;
        },
        record: (ids) => {
          const rec: Record<string, SourceValue> = {};
          for (const id of ids) {
            for (const [fid, col] of fieldIndex.get(id) ?? []) {
              const r = ctx.get(id);
              rec[fid] = r === undefined ? null : (rowsOf.get(id)![r]![col] ?? null);
            }
          }
          return rec;
        },
      };

      const targetRow = output.rows.rows.length + 1;
      const values: SourceValue[] = [];
      const lineageRow: (import('@mms/mapping-core').CellLineage | undefined)[] = [];
      const cellDiags: Diagnostic[] = [];
      for (const field of structure.fields) {
        const m = byField.get(field.id);
        if (!m) {
          values.push(null);
          lineageRow.push(undefined);
          continue;
        }
        const cell = evaluateMapping(
          m,
          {
            row: rowAccess,
            lookups,
            routines: options.routines ?? {},
            ...(options.javascript ? { javascript: options.javascript } : {}),
            collectLineage: options.collectLineage === true,
          },
          { ...base, targetRow } as Partial<Diagnostic>,
        );
        values.push(cell.value);
        lineageRow.push(cell.lineage);
        cellDiags.push(...cell.diagnostics);
      }
      const all = [...rowDiags.map((d) => ({ ...d, targetRow }) as Diagnostic), ...cellDiags];
      diagnostics.push(...all);
      output.rows.rows.push(values);
      output.driverRows.push(driverNo);
      output.rowStatus.push(statusOf(all));
      output.lineage?.push(lineageRow);
    }
    return output;
  }

  const inputRecordCounts: Record<string, number> = {};
  for (const [id, rows] of rowsOf) inputRecordCounts[id] = rows.length;
  const outputRecordCounts: Record<string, number> = {};
  for (const t of targets) outputRecordCounts[t.rows.targetStructureId] = t.rows.rows.length;
  return {
    ok: true,
    value: {
      targets,
      diagnostics,
      inputRecordCounts,
      outputRecordCounts,
      warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
      errorCount: diagnostics.filter((d) => d.severity === 'error').length,
    },
  };
}

function statusOf(diags: readonly Diagnostic[]): RowStatus {
  return diags.some((d) => d.severity === 'error')
    ? 'error'
    : diags.some((d) => d.severity === 'warning')
      ? 'warning'
      : 'ready';
}

/** A key with a blank part never matches. */
function keyOf(row: Row, cols: readonly number[]): string | undefined {
  const parts: string[] = [];
  for (const c of cols) {
    const v = row[c];
    if (v === null || v === undefined || v === '') return undefined;
    parts.push(v);
  }
  return parts.join(SEP);
}

/** Breadth-first, in relationship order, so the shortest path wins and ties are repeatable. */
function findPath(from: string, to: string, rels: readonly Relationship[]): JoinStep[] | undefined {
  if (from === to) return [];
  const seen = new Set<string>([from]);
  const queue: { dataset: string; path: JoinStep[] }[] = [{ dataset: from, path: [] }];
  while (queue.length > 0) {
    const { dataset, path } = queue.shift()!;
    for (const rel of rels) {
      const forward = rel.leftDatasetId === dataset;
      const backward = rel.rightDatasetId === dataset;
      if (!forward && !backward) continue;
      const side: 'left' | 'right' = forward ? 'left' : 'right';
      const next = forward ? rel.rightDatasetId : rel.leftDatasetId;
      if (seen.has(next)) continue;
      const step: JoinStep = {
        rel,
        from: side,
        fromDataset: dataset,
        toDataset: next,
        fromFields: rel.keys.map((k) => (forward ? k.leftFieldId : k.rightFieldId)),
        toFields: rel.keys.map((k) => (forward ? k.rightFieldId : k.leftFieldId)),
      };
      if (next === to) return [...path, step];
      seen.add(next);
      queue.push({ dataset: next, path: [...path, step] });
    }
  }
  return undefined;
}
