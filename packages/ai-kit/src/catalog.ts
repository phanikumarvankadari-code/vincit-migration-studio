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

/** The catalog as readable Markdown, for a chat AI that cannot open JSON files comfortably. */
export function catalogToMarkdown(c: Catalog): string {
  const nameOf = new Map(
    c.datasets.flatMap((d) =>
      d.fields.map((f) => [f.id, `${d.name}.${f.technicalName ?? f.name}`] as const),
    ),
  );
  const lines: string[] = [`# Catalog: ${c.object}`, ''];
  lines.push('## Target structures (what is to be filled)', '');
  for (const s of c.structures) {
    lines.push(`### ${s.name}${s.sheet ? ` (tab "${s.sheet}")` : ''}`);
    lines.push(`Structure ID: \`${s.id}\``);
    if (s.driverDatasetId)
      lines.push(
        `Rows come from: ${c.datasets.find((d) => d.id === s.driverDatasetId)?.name ?? s.driverDatasetId}`,
      );
    lines.push(
      '',
      '| Field ID | Name | Technical name | Type | Length | Required | Key | Group | Set by |',
      '|---|---|---|---|---|---|---|---|---|',
    );
    for (const f of s.fields)
      lines.push(
        `| \`${f.id}\` | ${cell(f.name)} | ${cell(f.technicalName)} | ${f.datatype} | ${f.length ?? ''} | ${f.required ? 'yes' : ''} | ${f.key ? 'yes' : ''} | ${cell(f.group)} | ${f.manual ? 'user (date)' : 'AI proposes'} |`,
      );
    lines.push('');
  }
  lines.push('## Source tables (what can be used)', '');
  for (const d of c.datasets) {
    lines.push(`### ${d.name}`, `Dataset ID: \`${d.id}\`, rows: ${d.rows ?? 'unknown'}`, '');
    lines.push(
      '| Field ID | Name | Technical name | Type | Max length | Filled % | Distinct | Key candidate | Codes (value x count) |',
      '|---|---|---|---|---|---|---|---|---|',
    );
    for (const f of d.fields)
      lines.push(
        `| \`${f.id}\` | ${cell(f.name)} | ${cell(f.technicalName)} | ${f.datatype} | ${f.maxLength ?? ''} | ${f.filledPercent ?? ''} | ${f.distinct ?? ''} | ${f.keyCandidate ? 'yes' : ''} | ${f.codeValues ? cell(f.codeValues.map((v) => `${v.value} x${v.count}`).join(', ')) : ''} |`,
      );
    lines.push('');
  }
  lines.push('## Joins between the source tables', '');
  if (c.relationships.length === 0) lines.push('None are defined yet.');
  for (const r of c.relationships) {
    const l = c.datasets.find((d) => d.id === r.left.datasetId)?.name ?? r.left.datasetId;
    const rt = c.datasets.find((d) => d.id === r.right.datasetId)?.name ?? r.right.datasetId;
    lines.push(
      `- ${l} to ${rt} on ${r.left.fieldIds.map((id, i) => `${nameOf.get(id) ?? id} = ${nameOf.get(r.right.fieldIds[i]!) ?? r.right.fieldIds[i]}`).join(', ')} (${r.cardinality}, ${r.joinType} join, ${r.status})`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
