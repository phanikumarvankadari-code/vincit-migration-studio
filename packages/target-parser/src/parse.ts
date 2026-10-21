import {
  TargetDefinitionSchema,
  type DataType,
  type Diagnostic,
  type Result,
  type SourceDataset,
  type SourceDefinition,
  type SourceRows,
  type TargetDefinition,
} from '@mms/mapping-core';
import { DEFAULT_TYPE_MAP, type TargetLayout } from './layout.js';

/** A parsed table: schema plus rows, as produced by the file importers. */
export interface TargetTable {
  source: SourceDefinition;
  rows: SourceRows[];
}

export interface ParsedTarget {
  target: TargetDefinition;
  diagnostics: Diagnostic[];
}

const d = (
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic => ({ severity, code, message, ...extra });
const slug = (s: string): string =>
  s.replace(/[^A-Za-z0-9_]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

type Role = keyof TargetLayout['columns'];
const ROLES: Role[] = [
  'structure',
  'group',
  'displayName',
  'importance',
  'type',
  'length',
  'decimals',
  'technicalStructure',
  'technicalField',
  'key',
];

/** Splits "Profit Center (mandatory)" into the name and the note in brackets. */
function splitHeading(text: string): { name: string; importance?: string } {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(text);
  const name = m?.[1]?.trim();
  return m && name ? { name, importance: (m[2] ?? '').trim() } : { name: text.trim() };
}

const toInt = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : undefined);

interface DraftField {
  displayName: string;
  technicalName?: string;
  datatype: DataType;
  nativeType?: string;
  length?: number;
  decimals?: number;
  required: boolean;
  isKey: boolean;
  group?: string;
  importance?: string;
}
interface DraftStructure {
  name: string;
  importance?: string;
  technicalName?: string;
  fields: DraftField[];
}

export function parseTargetStructures(
  table: TargetTable,
  layout: TargetLayout,
  options: { name: string },
): Result<ParsedTarget> {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string): Result<never> => ({
    ok: false,
    issues: [d('error', code, message)],
  });

  const datasets =
    layout.mode === 'perSheet'
      ? table.source.datasets
      : table.source.datasets.filter((s) =>
          layout.dataset ? s.name === layout.dataset : s === table.source.datasets[0],
        );
  if (datasets.length === 0)
    return fail(
      'TARGET_DATASET_NOT_FOUND',
      `Dataset "${layout.dataset ?? ''}" was not found in the file.`,
    );
  if ((layout.mode === 'sectionRows' || layout.mode === 'column') && !layout.columns.structure) {
    return fail('TARGET_LAYOUT_INVALID', `Layout mode "${layout.mode}" needs a structure column.`);
  }

  const typeMap = { ...DEFAULT_TYPE_MAP, ...layout.typeMap };
  const keyGroups = (layout.keyGroups ?? ['Key']).map((g) => g.toLowerCase());
  const requiredPattern = layout.requiredPattern ?? /^\s*(mandatory|required)\b/i;
  const unknownTypes = new Set<string>();
  const structures: DraftStructure[] = [];

  for (const ds of datasets) {
    const data = table.rows.find((r) => r.datasetId === ds.id);
    if (!data) return fail('TARGET_ROWS_MISSING', `No row data for dataset "${ds.name}".`);
    const col = resolveColumns(ds, layout, diagnostics);
    if (!col.ok) return col;
    const c = col.value;
    const cell = (row: readonly (string | null)[], role: Role): string => {
      const i = c[role];
      return i === undefined ? '' : (row[i] ?? '').trim();
    };

    let current: DraftStructure | undefined =
      layout.mode === 'perSheet' ? { name: ds.name, fields: [] } : undefined;
    if (current) structures.push(current);
    let group: string | undefined;
    const byName = new Map<string, DraftStructure>();

    data.rows.forEach((row, n) => {
      const sourceRow = n + 1;
      const name = cell(row, 'displayName');
      const structCell = cell(row, 'structure');
      const others = ROLES.filter((r) => r !== 'structure' && r !== 'displayName').some(
        (r) => cell(row, r) !== '',
      );
      if (name === '' && structCell === '' && !others) return; // blank row

      if (layout.mode === 'sectionRows' && structCell !== '' && name === '') {
        const h = splitHeading(structCell);
        current = {
          name: h.name,
          ...(h.importance ? { importance: h.importance } : {}),
          fields: [],
        };
        structures.push(current);
        group = undefined;
        return;
      }
      if (layout.mode === 'column' && name !== '' && structCell !== '') {
        const h = splitHeading(structCell);
        current = byName.get(h.name);
        if (!current) {
          current = {
            name: h.name,
            ...(h.importance ? { importance: h.importance } : {}),
            fields: [],
          };
          byName.set(h.name, current);
          structures.push(current);
        }
      }
      if (name === '') {
        diagnostics.push(
          d(
            'warning',
            'TARGET_ROW_WITHOUT_NAME',
            `Row ${sourceRow} has content but no field name and was skipped.`,
            { datasetId: ds.id, sourceRow },
          ),
        );
        return;
      }
      if (!current) {
        diagnostics.push(
          d(
            'error',
            'TARGET_FIELD_BEFORE_STRUCTURE',
            `Field "${name}" (row ${sourceRow}) appears before any structure and was skipped.`,
            { datasetId: ds.id, sourceRow },
          ),
        );
        return;
      }

      const groupCell = cell(row, 'group');
      if (groupCell !== '') group = groupCell;
      const typeText = cell(row, 'type');
      let datatype: DataType = 'unknown';
      if (typeText !== '') {
        const mapped = typeMap[typeText.toLowerCase()];
        if (mapped) datatype = mapped;
        else unknownTypes.add(typeText);
      }
      const lengthText = cell(row, 'length');
      const decimalsText = cell(row, 'decimals');
      const length = toInt(lengthText);
      const decimals = toInt(decimalsText);
      if (lengthText !== '' && length === undefined) {
        diagnostics.push(
          d(
            'warning',
            'TARGET_BAD_NUMBER',
            `Length "${lengthText}" of "${name}" is not a whole number and was ignored.`,
            { datasetId: ds.id, sourceRow },
          ),
        );
      }
      if (decimalsText !== '' && decimals === undefined) {
        diagnostics.push(
          d(
            'warning',
            'TARGET_BAD_NUMBER',
            `Decimals "${decimalsText}" of "${name}" is not a whole number and was ignored.`,
            { datasetId: ds.id, sourceRow },
          ),
        );
      }
      const importance = cell(row, 'importance');
      const keyFlag = cell(row, 'key');
      const technicalStructure = cell(row, 'technicalStructure');
      if (technicalStructure !== '') {
        if (current.technicalName === undefined) current.technicalName = technicalStructure;
        else if (current.technicalName !== technicalStructure) {
          diagnostics.push(
            d(
              'warning',
              'TARGET_TECHNICAL_STRUCTURE_CONFLICT',
              `Structure "${current.name}" lists both "${current.technicalName}" and "${technicalStructure}". The first was kept.`,
              { datasetId: ds.id, sourceRow },
            ),
          );
        }
      }
      const technicalField = cell(row, 'technicalField');
      current.fields.push({
        displayName: name,
        ...(technicalField ? { technicalName: technicalField } : {}),
        datatype,
        ...(typeText ? { nativeType: typeText } : {}),
        ...(length !== undefined ? { length } : {}),
        ...(decimals !== undefined ? { decimals } : {}),
        required: importance !== '' && requiredPattern.test(importance),
        isKey:
          (group !== undefined && keyGroups.includes(group.toLowerCase())) ||
          /^(x|y|yes|true|1)$/i.test(keyFlag),
        ...(group ? { group } : {}),
        ...(importance ? { importance } : {}),
      });
    });
  }

  for (const t of unknownTypes) {
    diagnostics.push(
      d(
        'warning',
        'TARGET_UNKNOWN_TYPE',
        `Type "${t}" is not recognised. Fields with it have datatype "unknown". Add it to the layout's type map.`,
      ),
    );
  }
  if (structures.length === 0)
    return {
      ok: false,
      issues: [
        ...diagnostics,
        d('error', 'TARGET_NO_STRUCTURES', 'No target structure was found. Check the layout.'),
      ],
    };

  const usedIds = new Set<string>();
  const tdId = `td-${slug(options.name)}`;
  const built = structures.map((s) => {
    let sid = `ts-${slug(s.name)}`;
    for (let k = 2; usedIds.has(sid); k++) sid = `ts-${slug(s.name)}-${k}`;
    usedIds.add(sid);
    if (s.fields.length === 0)
      diagnostics.push(
        d('warning', 'TARGET_EMPTY_STRUCTURE', `Structure "${s.name}" has no fields.`),
      );
    const seen = new Set<string>();
    for (const f of s.fields) {
      if (seen.has(f.displayName))
        diagnostics.push(
          d(
            'warning',
            'TARGET_DUPLICATE_FIELD',
            `Structure "${s.name}" lists the field "${f.displayName}" more than once.`,
          ),
        );
      seen.add(f.displayName);
    }
    return {
      id: sid,
      targetDefinitionId: tdId,
      name: s.name,
      displayName: s.name,
      ...(s.technicalName ? { technicalName: s.technicalName } : {}),
      ...(s.importance ? { importance: s.importance } : {}),
      fields: s.fields.map((f, i) => ({
        id: `tf-${sid.slice(3)}-${i + 1}`,
        targetStructureId: sid,
        ...f,
      })),
    };
  });
  const target = TargetDefinitionSchema.parse({ id: tdId, name: options.name, structures: built });
  return { ok: true, value: { target, diagnostics } };
}

function resolveColumns(
  ds: SourceDataset,
  layout: TargetLayout,
  diagnostics: Diagnostic[],
): Result<Partial<Record<Role, number>>> {
  const out: Partial<Record<Role, number>> = {};
  const headers = ds.fields.map((f) => f.displayName.trim().toLowerCase());
  for (const role of ROLES) {
    const name = layout.columns[role];
    if (name === undefined) continue;
    const i = headers.indexOf(name.trim().toLowerCase());
    if (i < 0) {
      const required = role === 'displayName' || role === 'structure';
      const msg = `Column "${name}" (${role}) was not found in "${ds.name}". Available: ${ds.fields.map((f) => f.displayName).join(', ')}.`;
      if (required)
        return {
          ok: false,
          issues: [d('error', 'TARGET_COLUMN_NOT_FOUND', msg, { datasetId: ds.id })],
        };
      diagnostics.push(d('warning', 'TARGET_COLUMN_NOT_FOUND', msg, { datasetId: ds.id }));
      continue;
    }
    out[role] = i;
  }
  return { ok: true, value: out };
}
