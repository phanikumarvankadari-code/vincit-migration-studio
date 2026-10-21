import type { Diagnostic, Result } from '@mms/mapping-core';
import type { TargetLayout } from './layout.js';
import type { TargetTable } from './parse.js';

const SYNONYMS: Record<keyof TargetLayout['columns'], string[]> = {
  structure: ['sheet name', 'structure', 'structure name', 'target structure', 'sheet', 'table'],
  group: ['group name', 'group'],
  displayName: ['field description', 'field name', 'display name', 'description', 'field', 'name'],
  importance: ['importance', 'mandatory', 'required'],
  type: ['type', 'data type', 'datatype'],
  length: ['length', 'len'],
  decimals: ['decimal', 'decimals'],
  technicalStructure: ['sap structure', 'technical structure', 'structure technical name'],
  technicalField: ['sap field', 'technical field', 'technical name', 'field technical name'],
  key: ['key', 'key flag', 'is key'],
};

/**
 * Proposes a layout from the header names and the shape of the rows, to pre-fill a wizard.
 * The user can change every setting. Returns an error when no field-name column is found.
 */
export function detectTargetLayout(
  table: TargetTable,
): Result<{ layout: TargetLayout; diagnostics: Diagnostic[] }> {
  const ds = table.source.datasets[0];
  if (!ds)
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          code: 'TARGET_DATASET_NOT_FOUND',
          message: 'The file has no dataset.',
        },
      ],
    };
  const headers = ds.fields.map((f) => f.displayName);
  const find = (role: keyof TargetLayout['columns']): string | undefined => {
    for (const syn of SYNONYMS[role]) {
      const h = headers.find((x) => x.trim().toLowerCase() === syn);
      if (h !== undefined) return h;
    }
    return undefined;
  };
  const columns: Record<string, string> = {};
  for (const role of Object.keys(SYNONYMS) as (keyof TargetLayout['columns'])[]) {
    const h = find(role);
    if (h !== undefined) columns[role] = h;
  }
  const diagnostics: Diagnostic[] = [];
  if (!columns['displayName']) {
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          code: 'TARGET_COLUMN_NOT_FOUND',
          message: `No field name column found. Headers: ${headers.join(', ')}.`,
        },
      ],
    };
  }

  let mode: TargetLayout['mode'] = 'perSheet';
  if (columns['structure']) {
    const rows = table.rows.find((r) => r.datasetId === ds.id)?.rows ?? [];
    const sIdx = headers.indexOf(columns['structure']);
    const nIdx = headers.indexOf(columns['displayName']);
    const filled = (v: string | null | undefined): boolean => (v ?? '').trim() !== '';
    const sections = rows.filter((r) => filled(r[sIdx]) && !filled(r[nIdx])).length;
    const fieldRowsWithStructure = rows.filter((r) => filled(r[sIdx]) && filled(r[nIdx])).length;
    mode = sections > 0 && fieldRowsWithStructure === 0 ? 'sectionRows' : 'column';
  } else if (table.source.datasets.length === 1) {
    diagnostics.push({
      severity: 'warning',
      code: 'TARGET_LAYOUT_GUESS',
      message:
        'No structure column found and only one sheet: the whole sheet is treated as one structure.',
    });
  }
  const layout: TargetLayout = {
    mode,
    dataset: ds.name,
    columns: columns as TargetLayout['columns'],
  };
  return { ok: true, value: { layout, diagnostics } };
}
