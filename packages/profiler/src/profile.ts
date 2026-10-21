import type { DataType, Diagnostic, Result, SourceDataset, SourceRows } from '@mms/mapping-core';

export interface FieldProfile {
  fieldId: string;
  rowCount: number;
  /** Cells that are null (absent). */
  nullCount: number;
  /** Cells that are an explicit empty string. */
  emptyCount: number;
  filledCount: number;
  /** filled / rows * 100, rounded to 2 decimals. */
  fillPercentage: number;
  distinctCount: number;
  uniqueness: 'unique' | 'notUnique' | 'unknown';
  inferredDatatype: DataType;
  minLength?: number;
  maxLength?: number;
  representativeValues: string[];
}

export interface DatasetProfile {
  datasetId: string;
  rowCount: number;
  fields: FieldProfile[];
}

export interface ProfileOptions {
  /** Most frequent distinct values to list per field. Default 5. */
  maxRepresentativeValues?: number;
}

const INTEGER = /^-?(0|[1-9]\d*)$/;
const DECIMAL = /^-?(0|[1-9]\d*)\.\d+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

function validDate(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function classify(v: string): DataType {
  if (/^(true|false)$/i.test(v)) return 'boolean';
  if (INTEGER.test(v)) return 'integer';
  if (DECIMAL.test(v)) return 'decimal';
  if (validDate(v)) return 'date';
  if (DATETIME.test(v) && validDate(v.slice(0, 10))) return 'dateTime';
  return 'string';
}

/** Values with leading zeros (such as 00330) are text, never numbers. Ambiguous dates (1/1/26) stay text. */
function infer(kinds: Set<DataType>): DataType {
  if (kinds.size === 0) return 'unknown';
  if (kinds.size === 1) return [...kinds][0]!;
  if (kinds.size === 2 && kinds.has('integer') && kinds.has('decimal')) return 'decimal';
  return 'string';
}

function fail(code: string, message: string, extra: Partial<Diagnostic> = {}): Result<never> {
  return { ok: false, issues: [{ severity: 'error', code, message, ...extra }] };
}

/** Reads the rows and never changes them. Profiling is separate from import. */
export function profileDataset(
  dataset: SourceDataset,
  data: SourceRows,
  options: ProfileOptions = {},
): Result<DatasetProfile> {
  if (data.datasetId !== dataset.id) {
    return fail(
      'PROFILE_DATASET_MISMATCH',
      `Rows belong to dataset "${data.datasetId}", not "${dataset.id}".`,
    );
  }
  const ids = dataset.fields.map((f) => f.id as string);
  if (data.fieldIds.length !== ids.length || data.fieldIds.some((id, i) => id !== ids[i])) {
    return fail('PROFILE_FIELD_MISMATCH', 'The row columns do not match the dataset fields.', {
      datasetId: dataset.id,
    });
  }
  for (const [i, row] of data.rows.entries()) {
    if (row.length !== ids.length) {
      return fail(
        'PROFILE_ROW_WIDTH',
        `Row ${i + 1} has ${row.length} values but the dataset has ${ids.length} fields.`,
        { datasetId: dataset.id, sourceRow: i + 1 },
      );
    }
  }

  const max = options.maxRepresentativeValues ?? 5;
  const rowCount = data.rows.length;
  const fields = ids.map((fieldId, col): FieldProfile => {
    let nullCount = 0;
    let emptyCount = 0;
    let minLength: number | undefined;
    let maxLength: number | undefined;
    const freq = new Map<string, number>(); // insertion order = first seen
    const kinds = new Set<DataType>();
    for (const row of data.rows) {
      const v = row[col] ?? null;
      if (v === null) nullCount++;
      else if (v === '') emptyCount++;
      else {
        freq.set(v, (freq.get(v) ?? 0) + 1);
        kinds.add(classify(v));
        minLength = minLength === undefined ? v.length : Math.min(minLength, v.length);
        maxLength = maxLength === undefined ? v.length : Math.max(maxLength, v.length);
      }
    }
    const filledCount = rowCount - nullCount - emptyCount;
    const representativeValues = [...freq.entries()]
      .map(([value, count], order) => ({ value, count, order }))
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .slice(0, max)
      .map((x) => x.value);
    return {
      fieldId,
      rowCount,
      nullCount,
      emptyCount,
      filledCount,
      fillPercentage: rowCount === 0 ? 0 : Math.round((filledCount / rowCount) * 10000) / 100,
      distinctCount: freq.size,
      uniqueness:
        filledCount === 0 ? 'unknown' : freq.size === filledCount ? 'unique' : 'notUnique',
      inferredDatatype: infer(kinds),
      ...(minLength !== undefined ? { minLength } : {}),
      ...(maxLength !== undefined ? { maxLength } : {}),
      representativeValues,
    };
  });
  return { ok: true, value: { datasetId: dataset.id, rowCount, fields } };
}
