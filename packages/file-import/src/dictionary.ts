import {
  SourceDefinitionSchema,
  type DataType,
  type Diagnostic,
  type Result,
  type SourceDefinition,
  type SourceField,
} from '@mms/mapping-core';
import { diag } from './common.js';
import { parseCsvText } from './csv.js';

export interface DictionaryEntry {
  table: string;
  field: string;
  /** Order key from the dictionary. Entries are matched by order, not by the raw number. */
  position: number;
  isKey: boolean;
  mandatory: boolean;
  rollName?: string;
  checkTable?: string;
  nativeType?: string;
  length?: number;
  datatype: DataType;
}

export interface FieldDictionary {
  entries: DictionaryEntry[];
}

/** Column names in the dictionary file. Defaults follow the SAP DD03L export; all are configurable. */
export interface DictionaryColumns {
  table: string;
  field: string;
  position: string;
  key: string;
  mandatory: string;
  rollName: string;
  checkTable: string;
  nativeType: string;
  length: string;
}

export const DEFAULT_DICTIONARY_COLUMNS: DictionaryColumns = {
  table: 'TABNAME',
  field: 'FIELDNAME',
  position: 'POSITION',
  key: 'KEYFLAG',
  mandatory: 'MANDATORY',
  rollName: 'ROLLNAME',
  checkTable: 'CHECKTABLE',
  nativeType: 'INTTYPE',
  length: 'INTLEN',
};

const NATIVE_TO_DATATYPE: Record<string, DataType> = {
  C: 'string',
  N: 'string',
  D: 'date',
  T: 'time',
  I: 'integer',
  b: 'integer',
  s: 'integer',
  '8': 'integer',
  P: 'decimal',
  F: 'decimal',
  a: 'decimal',
  e: 'decimal',
};

export interface DictionaryImportOptions {
  columns?: Partial<DictionaryColumns>;
  delimiter?: string;
}

export interface ImportedDictionary {
  dictionary: FieldDictionary;
  diagnostics: Diagnostic[];
}

const isFlag = (v: string | null | undefined): boolean =>
  v !== null && v !== undefined && v.trim() !== '';

export function importFieldDictionary(
  text: string,
  options: DictionaryImportOptions = {},
): Result<ImportedDictionary> {
  const cols = { ...DEFAULT_DICTIONARY_COLUMNS, ...options.columns };
  const parsed = parseCsvText(text, options.delimiter ?? ',');
  if (!parsed.ok) return { ok: false, issues: [diag('error', parsed.code, parsed.message)] };
  const [header, ...data] = parsed.rows;
  if (!header)
    return {
      ok: false,
      issues: [diag('error', 'DICT_EMPTY', 'The dictionary file contains no header row.')],
    };

  const index = new Map(header.cells.map((h, i) => [(h ?? '').trim().toUpperCase(), i]));
  const at = (name: string): number | undefined => index.get(name.toUpperCase());
  const tableCol = at(cols.table);
  const fieldCol = at(cols.field);
  if (tableCol === undefined || fieldCol === undefined) {
    return {
      ok: false,
      issues: [
        diag(
          'error',
          'DICT_COLUMN_MISSING',
          `The dictionary needs the columns "${cols.table}" and "${cols.field}".`,
        ),
      ],
    };
  }
  const [posCol, keyCol, mandCol, rollCol, checkCol, typeCol, lenCol] = [
    cols.position,
    cols.key,
    cols.mandatory,
    cols.rollName,
    cols.checkTable,
    cols.nativeType,
    cols.length,
  ].map(at);

  const diagnostics: Diagnostic[] = [];
  const entries: DictionaryEntry[] = [];
  data.forEach((row, n) => {
    const get = (c: number | undefined): string | null =>
      c === undefined ? null : (row.cells[c] ?? null);
    const table = get(tableCol)?.trim();
    const field = get(fieldCol)?.trim();
    if (!table && !field) {
      diagnostics.push(
        diag('info', 'DICT_BLANK_ROW', `Dictionary row ${n + 1} is blank and was skipped.`, {
          sourceRow: n + 1,
        }),
      );
      return;
    }
    if (!table || !field) {
      diagnostics.push(
        diag(
          'warning',
          'DICT_INCOMPLETE_ROW',
          `Dictionary row ${n + 1} lacks a table or field name and was skipped.`,
          { sourceRow: n + 1 },
        ),
      );
      return;
    }
    if (field.startsWith('.')) {
      diagnostics.push(
        diag(
          'info',
          'DICT_PSEUDO_FIELD_SKIPPED',
          `${table}: "${field}" is a structure include, not a data column. It was skipped.`,
          { sourceRow: n + 1 },
        ),
      );
      return;
    }
    const nativeType = get(typeCol)?.trim() || undefined;
    const length = Number(get(lenCol));
    const position = Number(get(posCol));
    const rollName = get(rollCol)?.trim();
    const checkTable = get(checkCol)?.trim();
    entries.push({
      table,
      field,
      position: Number.isFinite(position) && get(posCol) !== null ? position : n + 1,
      isKey: isFlag(get(keyCol)),
      mandatory: isFlag(get(mandCol)),
      ...(rollName ? { rollName } : {}),
      ...(checkTable ? { checkTable } : {}),
      ...(nativeType ? { nativeType } : {}),
      ...(get(lenCol) !== null && Number.isFinite(length) ? { length } : {}),
      datatype: (nativeType && NATIVE_TO_DATATYPE[nativeType]) || 'unknown',
    });
  });
  return { ok: true, value: { dictionary: { entries }, diagnostics } };
}

export interface ApplyDictionaryOptions {
  /** Dataset id to dictionary table name, when the dataset name differs from the table. */
  datasetTables?: Record<string, string>;
}

/**
 * Enriches fields by column order: the Nth column of a dataset is the Nth dictionary field of its table
 * (include placeholders already removed). Display names are never replaced. Datasets without a dictionary
 * table are left as they are.
 */
export function applyFieldDictionary(
  source: SourceDefinition,
  dictionary: FieldDictionary,
  options: ApplyDictionaryOptions = {},
): { source: SourceDefinition; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const datasets = source.datasets.map((ds) => {
    const table = (options.datasetTables?.[ds.id] ?? ds.name).toUpperCase();
    const entries = dictionary.entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.table.toUpperCase() === table)
      .sort((a, b) => a.e.position - b.e.position || a.i - b.i)
      .map(({ e }) => e);
    const ctx = { datasetId: ds.id };
    if (entries.length === 0) {
      diagnostics.push(
        diag(
          'info',
          'DICT_TABLE_NOT_FOUND',
          `No dictionary entries for "${ds.name}". The dataset keeps its imported field information.`,
          ctx,
        ),
      );
      return ds;
    }
    const names = entries.map((e) => e.field);
    const dupNames = names.filter((n, i) => names.indexOf(n) !== i);
    const positions = entries.map((e) => e.position);
    const dupPos = positions.filter((p, i) => positions.indexOf(p) !== i);
    if (dupNames.length > 0 || dupPos.length > 0) {
      diagnostics.push(
        diag(
          'warning',
          'DICT_AMBIGUOUS',
          `The dictionary for "${ds.name}" is ambiguous (repeated ${dupNames.length > 0 ? `field ${dupNames[0]}` : `position ${dupPos[0]}`}). The dataset was not enriched.`,
          ctx,
        ),
      );
      return ds;
    }
    if (entries.length !== ds.fields.length) {
      const unmatchedEntries = entries.slice(ds.fields.length).map((e) => e.field);
      const unmatchedCols = ds.fields.slice(entries.length).map((f) => f.displayName);
      diagnostics.push(
        diag(
          'warning',
          'DICT_COLUMN_COUNT_MISMATCH',
          `"${ds.name}" has ${ds.fields.length} columns but the dictionary lists ${entries.length} fields. Matching by order may be misaligned.`,
          {
            ...ctx,
            technicalDetails: [
              unmatchedEntries.length
                ? `Dictionary fields without a column: ${unmatchedEntries.join(', ')}`
                : '',
              unmatchedCols.length
                ? `Columns without a dictionary field: ${unmatchedCols.join(', ')}`
                : '',
            ]
              .filter(Boolean)
              .join('. '),
          },
        ),
      );
    }
    const fields = ds.fields.map((f, i): SourceField => {
      const e = entries[i];
      if (!e) return f;
      return {
        ...f,
        technicalName: e.field,
        datatype: f.datatype === 'unknown' ? e.datatype : f.datatype,
        ...(e.nativeType ? { nativeType: e.nativeType } : {}),
        ...(e.length !== undefined ? { length: e.length } : {}),
        isKey: e.isKey,
        nullable: !e.mandatory,
        ...(e.rollName || e.checkTable
          ? {
              reference: {
                ...(e.rollName ? { rollName: e.rollName } : {}),
                ...(e.checkTable ? { checkTable: e.checkTable } : {}),
              },
            }
          : {}),
      };
    });
    return { ...ds, fields };
  });
  return { source: SourceDefinitionSchema.parse({ ...source, datasets }), diagnostics };
}
