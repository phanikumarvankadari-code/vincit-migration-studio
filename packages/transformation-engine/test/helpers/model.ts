import { parseProject, type Project, type SourceRows } from '@mms/mapping-core';

type Raw = Record<string, unknown>;
export interface DatasetSpec {
  name: string;
  fields: string[];
  rows: (string | null)[][];
}
export interface StructureSpec {
  name: string;
  fields: string[];
  generation?: { driver: string; via?: string[] };
}
export interface Spec {
  datasets: DatasetSpec[];
  targets: StructureSpec[];
  mappings: Raw[];
  relationships?: Raw[];
  lookups?: Raw[];
}

export const ds = (name: string) => `ds-${name}`;
export const sf = (path: string) => path; // source field id: "Dataset.Field"
export const tf = (path: string) => `tf-${path}`; // target field id: "Structure.Field"
const sref = (path: string): Raw => ({ datasetId: ds(path.split('.')[0]!), fieldId: sf(path) });
const base = (target: string, srcs: string[], over: Raw = {}): Raw => ({
  id: `m-${target}`,
  targetStructureId: `ts-${target.split('.')[0]}`,
  targetFieldId: tf(target),
  sourceReferences: srcs.map(sref),
  transformations: [],
  status: 'mapped',
  ...over,
});

export const direct = (target: string, src: string, over: Raw = {}): Raw => ({
  ...base(target, [src], over),
  mappingType: 'direct',
});
export const constant = (
  target: string,
  value: string | number | boolean | null,
  datatype = 'string',
  over: Raw = {},
): Raw => ({
  ...base(target, [], over),
  mappingType: 'constant',
  constant: { datatype, value },
});
export const lookup = (
  target: string,
  src: string,
  lookupId: string,
  missingValue: Raw = { kind: 'error' },
  over: Raw = {},
): Raw => ({
  ...base(target, [src], over),
  mappingType: 'lookup',
  lookup: { lookupId, configuration: {}, missingValue },
});
export const conditional = (
  target: string,
  srcs: string[],
  rules: Raw[],
  otherwise?: Raw,
  over: Raw = {},
): Raw => ({
  ...base(target, srcs, over),
  mappingType: 'conditional',
  conditional: { rules, ...(otherwise ? { otherwise } : {}) },
});
export const routineMapping = (target: string, src: string, steps: Raw[], over: Raw = {}): Raw => ({
  ...base(target, [src], { transformations: steps, ...over }),
  mappingType: 'routine',
});
export const javascript = (
  target: string,
  src: string,
  code = 'return value;',
  over: Raw = {},
): Raw => ({
  ...base(target, [src], over),
  mappingType: 'javascript',
  javascript: { code, declaredLookupIds: [] },
});
export const rstep = (
  routineId: string,
  order: number,
  onError: 'stop' | 'continue' = 'stop',
  configuration: Raw = {},
): Raw => ({
  kind: 'routine',
  routineId,
  configuration,
  order,
  onError,
});
export const lstep = (
  lookupId: string,
  order: number,
  missingValue: Raw = { kind: 'error' },
): Raw => ({ kind: 'lookup', lookupId, configuration: {}, missingValue, order });

export const field = (path: string): Raw => ({
  kind: 'field',
  datasetId: ds(path.split('.')[0]!),
  fieldId: sf(path),
});
export const lit = (value: string): Raw => ({
  kind: 'constant',
  constant: { datatype: 'string', value },
});
export const eq = (left: Raw, right: Raw): Raw => ({ op: 'compare', operator: 'eq', left, right });

export const rel = (
  id: string,
  left: string,
  right: string,
  pairs: [string, string][],
  over: Raw = {},
): Raw => ({
  id,
  leftDatasetId: ds(left),
  rightDatasetId: ds(right),
  keys: pairs.map(([a, b]) => ({ leftFieldId: `${left}.${a}`, rightFieldId: `${right}.${b}` })),
  cardinality: 'oneToMany',
  joinType: 'left',
  status: 'confirmed',
  ...over,
});

export const lookupDef = (id: string, entries: [string, string | null][]): Raw => ({
  id,
  name: id,
  keyDatatype: 'string',
  valueDatatype: 'string',
  entries: entries.map(([key, value]) => ({ key, value })),
});

export function build(spec: Spec): { model: Project; data: SourceRows[] } {
  const t = '2026-10-21T10:00:00.000Z';
  const lookups = spec.lookups ?? [];
  const usedRoutines = new Set<string>();
  for (const m of spec.mappings)
    for (const s of (m['transformations'] as Raw[]) ?? [])
      if (s['kind'] === 'routine') usedRoutines.add(String(s['routineId']));
  const raw = {
    id: 'p1',
    name: 'T',
    businessEntity: 'T',
    projectState: 'draft',
    createdAt: t,
    updatedAt: t,
    sourceDefinitions: spec.datasets.map((d) => ({
      id: `src-${d.name}`,
      name: d.name,
      sourceType: 'csv',
      location: { kind: 'localFile', path: `${d.name}.csv` },
      datasets: [
        {
          id: ds(d.name),
          sourceId: `src-${d.name}`,
          name: d.name,
          displayName: d.name,
          fields: d.fields.map((f) => ({
            id: sf(`${d.name}.${f}`),
            datasetId: ds(d.name),
            displayName: f,
            datatype: 'unknown',
          })),
        },
      ],
    })),
    targetDefinition: {
      id: 'td1',
      name: 'T',
      structures: spec.targets.map((s) => ({
        id: `ts-${s.name}`,
        targetDefinitionId: 'td1',
        name: s.name,
        displayName: s.name,
        fields: s.fields.map((f) => ({
          id: tf(`${s.name}.${f}`),
          targetStructureId: `ts-${s.name}`,
          displayName: f,
          datatype: 'string',
          required: false,
          isKey: false,
        })),
        ...(s.generation
          ? {
              generation: {
                driverDatasetId: ds(s.generation.driver),
                ...(s.generation.via ? { viaRelationshipIds: s.generation.via } : {}),
              },
            }
          : {}),
      })),
    },
    routines: [...usedRoutines].map((id) => ({ id, name: id, scope: 'builtIn', version: '1' })),
    lookups,
    mappingDefinition: {
      id: 'md1',
      mappings: spec.mappings,
      relationships: spec.relationships ?? [],
      routineReferences: [...usedRoutines].map((routineId) => ({ routineId, version: '1' })),
      lookupReferences: lookups.map((l) => ({ lookupId: l['id'] })),
      validationRules: [],
    },
  };
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new Error('test model invalid: ' + JSON.stringify(parsed.issues));
  const data: SourceRows[] = spec.datasets.map((d) => ({
    datasetId: ds(d.name),
    fieldIds: d.fields.map((f) => sf(`${d.name}.${f}`)),
    rows: d.rows,
  })) as SourceRows[];
  return { model: parsed.value, data };
}
