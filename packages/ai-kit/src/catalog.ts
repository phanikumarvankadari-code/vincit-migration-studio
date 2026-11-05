import type { Project, SourceRows } from '@mms/mapping-core';
import { profileDataset, type FieldProfile } from '@mms/profiler';

/**
 * What an AI is told about a project: names, IDs and statistics. No cell values are included except the distinct
 * values of code-like columns (few different, short, no spaces), which are needed to make value maps.
 */
export interface KitOptions {
  /** A column is code-like when it has at most this many distinct values. Default 30. */
  maxCodeValues?: number;
  /** ...and every value is at most this long. Default 10. */
  maxCodeLength?: number;
}

export interface CatalogSourceField {
  id: string;
  name: string;
  technicalName?: string;
  description?: string;
  datatype: string;
  maxLength?: number;
  filledPercent?: number;
  distinct?: number;
  /** Unique and filled in every row, or part of a relationship key. */
  keyCandidate: boolean;
  /** The distinct values with their counts, only for code-like columns. */
  codeValues?: { value: string; count: number }[];
}

export interface CatalogDataset {
  id: string;
  name: string;
  description?: string;
  rows: number | null;
  fields: CatalogSourceField[];
}

export interface CatalogTargetField {
  id: string;
  name: string;
  technicalName?: string;
  datatype: string;
  length?: number;
  decimals?: number;
  required: boolean;
  key: boolean;
  group?: string;
  importance?: string;
  /** Dates are set by the user, not by the AI. */
  manual?: 'date';
}

export interface CatalogStructure {
  id: string;
  name: string;
  /** The tab of the target workbook this structure is written to. */
  sheet?: string;
  driverDatasetId?: string;
  /** The pairing with the main table still waits for the user. */
  pairingSuggested?: boolean;
  fields: CatalogTargetField[];
}

export interface CatalogRelationship {
  id: string;
  left: { datasetId: string; fieldIds: string[] };
  right: { datasetId: string; fieldIds: string[] };
  cardinality: string;
  joinType: string;
  status: string;
}

export interface Catalog {
  object: string;
  datasets: CatalogDataset[];
  structures: CatalogStructure[];
  relationships: CatalogRelationship[];
}

const CODE = /^\S+$/;
const SAP_DATE = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$|^\d{4}-\d{2}-\d{2}$/;

function codeValues(
  profile: FieldProfile,
  column: readonly (string | null)[],
  o: Required<KitOptions>,
): { value: string; count: number }[] | undefined {
  if (profile.filledCount === 0) return undefined;
  if (profile.distinctCount < 2 || profile.distinctCount > o.maxCodeValues) return undefined;
  if (profile.uniqueness === 'unique') return undefined;
  if (profile.inferredDatatype === 'date' || profile.inferredDatatype === 'dateTime')
    return undefined;
  if (profile.inferredDatatype === 'decimal') return undefined; // amounts
  if ((profile.maxLength ?? 0) > o.maxCodeLength) return undefined;
  const counts = new Map<string, number>();
  for (const v of column) if (v !== null && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
  if ([...counts.keys()].some((v) => !CODE.test(v) || v.length > o.maxCodeLength)) return undefined;
  // SAP stores dates as text (20190101, or 00000000 for none). They are dates, not codes, whatever their type says.
  const dates = [...counts.keys()].filter((v) => SAP_DATE.test(v) || v === '00000000').length;
  if (dates / counts.size >= 0.5) return undefined;
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
}

export function buildCatalog(
  project: Project,
  data: Readonly<Record<string, SourceRows>>,
  options: KitOptions = {},
): Catalog {
  const o = {
    maxCodeValues: options.maxCodeValues ?? 30,
    maxCodeLength: options.maxCodeLength ?? 10,
  };
  const relationships = project.mappingDefinition.relationships;
  const inRelationshipKey = new Set(
    relationships.flatMap((r) =>
      r.keys.flatMap((k) => [k.leftFieldId as string, k.rightFieldId as string]),
    ),
  );

  const datasets: CatalogDataset[] = project.sourceDefinitions.flatMap((s) =>
    s.datasets.map((d): CatalogDataset => {
      const rows = data[d.id];
      const profiled = rows ? profileDataset(d, rows) : undefined;
      const profile = profiled?.ok ? profiled.value : undefined;
      return {
        id: d.id,
        name: d.displayName ?? d.name,
        ...(d.description ? { description: d.description } : {}),
        rows: profile ? profile.rowCount : null,
        fields: d.fields.map((f, col): CatalogSourceField => {
          const p = profile?.fields[col];
          const values =
            p && rows
              ? codeValues(
                  p,
                  rows.rows.map((r) => r[col] ?? null),
                  o,
                )
              : undefined;
          return {
            id: f.id,
            name: f.displayName,
            ...(f.technicalName ? { technicalName: f.technicalName } : {}),
            ...(f.description ? { description: f.description } : {}),
            datatype: p ? p.inferredDatatype : f.datatype,
            ...(p?.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
            ...(p ? { filledPercent: p.fillPercentage, distinct: p.distinctCount } : {}),
            keyCandidate:
              (p?.uniqueness === 'unique' && p.fillPercentage === 100) ||
              inRelationshipKey.has(f.id),
            ...(values ? { codeValues: values } : {}),
          };
        }),
      };
    }),
  );

  const structures: CatalogStructure[] = (project.targetDefinition?.structures ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    ...(s.templateSheet ? { sheet: s.templateSheet } : {}),
    ...(s.generation ? { driverDatasetId: s.generation.driverDatasetId } : {}),
    ...(s.generation?.status === 'suggested' ? { pairingSuggested: true } : {}),
    fields: s.fields.map((f): CatalogTargetField => ({
      id: f.id,
      name: f.displayName,
      ...(f.technicalName ? { technicalName: f.technicalName } : {}),
      datatype: f.datatype,
      ...(f.length !== undefined ? { length: f.length } : {}),
      ...(f.decimals !== undefined ? { decimals: f.decimals } : {}),
      required: f.required,
      key: f.isKey,
      ...(f.group ? { group: f.group } : {}),
      ...(f.importance ? { importance: f.importance } : {}),
      ...(f.datatype === 'date' || f.datatype === 'dateTime' ? { manual: 'date' as const } : {}),
    })),
  }));

  return {
    object: project.businessEntity || project.name,
    datasets,
    structures,
    relationships: relationships.map((r) => ({
      id: r.id,
      left: { datasetId: r.leftDatasetId, fieldIds: r.keys.map((k) => k.leftFieldId) },
      right: { datasetId: r.rightDatasetId, fieldIds: r.keys.map((k) => k.rightFieldId) },
      cardinality: r.cardinality,
      joinType: r.joinType,
      status: r.status,
    })),
  };
}

const cell = (v: unknown): string =>
  String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ');

/** Fields with no data in the export carry no information: they are listed by name only. */
const hasData = (f: CatalogSourceField): boolean =>
  f.filledPercent === undefined || f.filledPercent > 0;

/**
 * The catalog as compact Markdown for a chat AI. Fields are named, not numbered: the answer refers to tables,
 * structures and fields by name and the app finds the IDs.
 */
export function catalogToMarkdown(c: Catalog): string {
  const tableName = new Map(c.datasets.map((d) => [d.id, d.name] as const));
  const lines: string[] = [`# Catalog: ${c.object}`, ''];
  lines.push('## Target structures (what is to be filled)', '');
  for (const s of c.structures) {
    const rows = s.driverDatasetId
      ? ` Main source table: ${tableName.get(s.driverDatasetId) ?? s.driverDatasetId}${s.pairingSuggested ? ' (suggested, not confirmed)' : ''}.`
      : '';
    lines.push(
      `### ${s.name}${s.sheet && s.sheet !== s.name ? ` (tab "${s.sheet}")` : ''}${rows ? ' -' : ''}${rows}`,
      '',
    );
    lines.push(
      '| Description | Technical name | Type | Length | Required | Key | Group | Set by |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const f of s.fields)
      lines.push(
        `| ${cell(f.name)} | ${cell(f.technicalName)} | ${f.datatype} | ${f.length ?? ''} | ${f.required ? 'yes' : ''} | ${f.key ? 'yes' : ''} | ${cell(f.group)} | ${f.manual ? 'user (date)' : 'AI proposes'} |`,
      );
    lines.push('');
  }
  lines.push('## Source tables (what can be used)', '');
  for (const d of c.datasets) {
    const used = d.fields.filter(hasData);
    const empty = d.fields.filter((f) => !hasData(f));
    lines.push(
      `### ${d.name}${d.description ? ` - ${d.description}` : ''}`,
      `${d.rows ?? '?'} rows, ${d.fields.length} fields${empty.length > 0 ? `, ${used.length} with data` : ''}.`,
      '',
    );
    const withText = used.some((f) => f.description);
    lines.push(
      `| Field |${withText ? ' Description |' : ''} Type | Max length | Filled % | Distinct | Key candidate | Codes (value x count) |`,
      `|---|${withText ? '---|' : ''}---|---|---|---|---|---|`,
    );
    for (const f of used)
      lines.push(
        `| ${cell(f.technicalName ?? f.name)} |${withText ? ` ${cell(f.description)} |` : ''} ${f.datatype} | ${f.maxLength ?? ''} | ${f.filledPercent === undefined ? '' : Math.round(f.filledPercent)} | ${f.distinct ?? ''} | ${f.keyCandidate ? 'yes' : ''} | ${f.codeValues ? cell(f.codeValues.map((v) => `${v.value} x${v.count}`).join(', ')) : ''} |`,
      );
    if (empty.length > 0)
      lines.push(
        '',
        `Empty in this export: ${empty.map((f) => f.technicalName ?? f.name).join(', ')}.`,
      );
    lines.push('');
  }
  lines.push('## Joins between the source tables (optional)', '');
  const fieldName = new Map(
    c.datasets.flatMap((d) =>
      d.fields.map((f) => [f.id, `${d.name}.${f.technicalName ?? f.name}`] as const),
    ),
  );
  const confirmed = c.relationships.filter((r) => r.status === 'confirmed');
  if (confirmed.length === 0) lines.push('No join is confirmed. Do not rely on any join.');
  for (const r of confirmed) {
    lines.push(
      `- ${tableName.get(r.left.datasetId)} to ${tableName.get(r.right.datasetId)} on ${r.left.fieldIds.map((id, i) => `${fieldName.get(id)} = ${fieldName.get(r.right.fieldIds[i]!)}`).join(', ')} (${r.cardinality})`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
