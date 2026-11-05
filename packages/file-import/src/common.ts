import {
  SourceDatasetIdSchema,
  SourceDefinitionIdSchema,
  SourceDefinitionSchema,
  SourceFieldIdSchema,
  SourceRowsSchema,
  type Diagnostic,
  type SourceDefinition,
  type SourceLocation,
  type SourceRows,
  type SourceValue,
} from '@mms/mapping-core';

export interface ImportedSource {
  source: SourceDefinition;
  rows: SourceRows[];
  diagnostics: Diagnostic[];
}

export function diag(
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic {
  return { severity, code, message, ...extra };
}

/** Readable, deterministic ID fragment from a name. */
export function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || fileName;
}

/**
 * A dataset name from a file name: without the extension, and without what table export tools add around an SAP
 * table name, a system prefix and a date or time stamp (S4H_ANLA_20261105_153937.csv gives ANLA).
 */
export function datasetNameFromFile(fileName: string): string {
  const base = stripExtension(fileName);
  const name = base
    .replace(/(?:[_-]\d{8}(?:[_-]?\d{4,6})?)+$/, '')
    .replace(/^(?:S4H|S4|ECC6?|ERP|R3|BW)[_-](?=[A-Za-z0-9])/i, '');
  return name || base;
}

/** Deterministic dataset IDs from names. Equal slugs get a numeric suffix. */
export function assignDatasetIds(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    let id = `ds-${slug(n)}`;
    for (let k = 2; used.has(id); k++) id = `ds-${slug(n)}-${k}`;
    used.add(id);
    return id;
  });
}

export interface DatasetBuild {
  id: string;
  name: string;
  headers: string[];
  rows: SourceValue[][];
}

/** Turns parsed tables into schema-checked canonical objects. IDs are deterministic. */
export function buildSource(args: {
  fileName: string;
  sourceType: 'csv' | 'xlsx';
  location: SourceLocation;
  datasets: DatasetBuild[];
}): { source: SourceDefinition; rows: SourceRows[] } {
  const sourceId = `src-${slug(stripExtension(args.fileName))}`;
  const rows: SourceRows[] = [];
  const datasets = args.datasets.map((d) => {
    const dsId = d.id;
    const fields = d.headers.map((h, i) => ({
      id: `f-${dsId.slice(3)}-${i + 1}`,
      datasetId: dsId,
      displayName: h,
      datatype: 'unknown' as const,
    }));
    rows.push(
      SourceRowsSchema.parse({ datasetId: dsId, fieldIds: fields.map((f) => f.id), rows: d.rows }),
    );
    return { id: dsId, sourceId, name: d.name, displayName: d.name, fields };
  });
  const source = SourceDefinitionSchema.parse({
    id: sourceId,
    name: args.fileName,
    sourceType: args.sourceType,
    location: args.location,
    datasets,
  });
  return { source, rows };
}

// Re-exported so call sites need not import ID schemas just to brand strings.
export { SourceDatasetIdSchema, SourceDefinitionIdSchema, SourceFieldIdSchema };
