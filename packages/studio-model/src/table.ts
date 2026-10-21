import type {
  ConditionExpr,
  Diagnostic,
  FieldMapping,
  Project,
  ValueOperand,
} from '@mms/mapping-core';
import { builtInRoutines } from '@mms/routine-library';

export type MappingStatus = 'mapped' | 'needsReview' | 'unmapped' | 'error';

export interface MappingRow {
  /** Stable key: structure ID and field ID. */
  key: string;
  structureId: string;
  structureName: string;
  fieldId: string;
  fieldName: string;
  technicalName: string | undefined;
  datatype: string;
  length: number | undefined;
  required: boolean;
  isKey: boolean;
  mapping: FieldMapping | undefined;
  status: MappingStatus;
  /** The "Source / Value" column. */
  source: string;
  /** The "Transformation" column. */
  transformation: string;
  /** Problems found before or during a run for this mapping. */
  issues: Diagnostic[];
}

const MAPPING_LABEL: Record<FieldMapping['mappingType'], string> = {
  direct: 'Direct',
  constant: 'Constant',
  lookup: 'Lookup',
  conditional: 'Condition',
  routine: 'Routine',
  javascript: 'JavaScript',
};
export const mappingTypeLabel = (t: FieldMapping['mappingType']): string => MAPPING_LABEL[t];

const OP_TEXT: Record<string, string> = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };

interface Names {
  field: (datasetId: string, fieldId: string) => string;
  lookup: (id: string) => string;
  routine: (id: string) => string;
}

function namesOf(project: Project): Names {
  const fields = new Map<string, string>();
  for (const s of project.sourceDefinitions)
    for (const d of s.datasets)
      for (const f of d.fields) fields.set(f.id, `${d.name}.${f.displayName}`);
  const routines = new Map(builtInRoutines().map((r) => [r.id, r.name]));
  for (const r of project.routines) routines.set(r.id, r.name);
  return {
    field: (_d, f) => fields.get(f) ?? f,
    lookup: (id) => project.lookups.find((l) => l.id === id)?.name ?? id,
    routine: (id) => routines.get(id) ?? id,
  };
}

function operandText(o: ValueOperand, names: Names): string {
  return o.kind === 'field'
    ? names.field(o.datasetId, o.fieldId)
    : o.kind === 'constant'
      ? `"${o.constant.value ?? ''}"`
      : 'this value';
}

function conditionText(c: ConditionExpr, names: Names): string {
  switch (c.op) {
    case 'compare':
      return `${operandText(c.left, names)} ${OP_TEXT[c.operator]} ${operandText(c.right, names)}`;
    case 'in':
      return `${operandText(c.operand, names)} in (${c.values.map((v) => `"${v.value ?? ''}"`).join(', ')})`;
    case 'isEmpty':
      return `${operandText(c.operand, names)} is empty`;
    case 'and':
    case 'or':
      return c.conditions
        .map((x) => conditionText(x, names))
        .join(c.op === 'and' ? ' and ' : ' or ');
    case 'not':
      return `not (${conditionText(c.condition, names)})`;
  }
}

/** Plain-language text for a mapping: what feeds the field, and what is done to it. */
export function describeMapping(
  project: Project,
  m: FieldMapping,
): { source: string; transformation: string } {
  const names = namesOf(project);
  const sources = m.sourceReferences.map((r) => names.field(r.datasetId, r.fieldId)).join(', ');
  const steps = m.transformations
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) =>
      t.kind === 'routine' ? names.routine(t.routineId) : `Lookup ${names.lookup(t.lookupId)}`,
    );
  let source = sources;
  let primary: string;
  switch (m.mappingType) {
    case 'direct':
      primary = steps.length > 0 ? '' : 'Direct';
      break;
    case 'constant':
      source = `"${m.constant.value ?? ''}"`;
      primary = 'Constant';
      break;
    case 'lookup':
      primary = `Lookup ${names.lookup(m.lookup.lookupId)}`;
      break;
    case 'conditional': {
      const first = m.conditional.rules[0];
      primary = `Condition${first ? `: if ${conditionText(first.when, names)}${m.conditional.rules.length > 1 ? ' …' : ''}` : ''}`;
      break;
    }
    case 'routine':
      primary = '';
      break;
    case 'javascript':
      primary = 'JavaScript';
      break;
  }
  return {
    source,
    transformation:
      [primary, ...steps].filter(Boolean).join(' → ') || mappingTypeLabel(m.mappingType),
  };
}

export interface RowSources {
  project: Project;
  /** Problems found by pre-flight checks. */
  preflight?: readonly Diagnostic[];
  /** Run diagnostics to count, if the run is current. */
  runDiagnostics?: readonly Diagnostic[];
}

/**
 * One row per target field, in structure and field order. Status: unmapped without a mapping; error when pre-flight
 * or a current run found an error for the mapping; needs review when flagged; otherwise mapped.
 */
export function buildMappingRows(input: RowSources): MappingRow[] {
  const { project } = input;
  const target = project.targetDefinition;
  if (!target) return [];
  const byField = new Map(
    project.mappingDefinition.mappings.map((m) => [`${m.targetStructureId}/${m.targetFieldId}`, m]),
  );
  const diags = [...(input.preflight ?? []), ...(input.runDiagnostics ?? [])];
  const rows: MappingRow[] = [];
  for (const s of target.structures) {
    for (const f of s.fields) {
      const mapping = byField.get(`${s.id}/${f.id}`);
      const issues = mapping
        ? diags.filter(
            (d) =>
              d.fieldMappingId === mapping.id ||
              (d.targetFieldId === f.id &&
                d.targetStructureId === s.id &&
                d.targetRow === undefined),
          )
        : [];
      let status: MappingStatus = 'unmapped';
      if (mapping && mapping.status !== 'unmapped') {
        status =
          issues.some((d) => d.severity === 'error') || mapping.status === 'error'
            ? 'error'
            : mapping.status === 'needsReview'
              ? 'needsReview'
              : 'mapped';
      }
      const text = mapping ? describeMapping(project, mapping) : { source: '', transformation: '' };
      rows.push({
        key: `${s.id}/${f.id}`,
        structureId: s.id,
        structureName: s.name,
        fieldId: f.id,
        fieldName: f.displayName,
        technicalName: f.technicalName,
        datatype: f.datatype,
        length: f.length,
        required: f.required,
        isKey: f.isKey,
        mapping,
        status,
        source: text.source,
        transformation: text.transformation,
        issues,
      });
    }
  }
  return rows;
}

export interface RowFilter {
  structureId?: string | undefined;
  status?: MappingStatus | 'requiredUnmapped' | undefined;
  search?: string | undefined;
}

export function filterRows(rows: readonly MappingRow[], f: RowFilter): MappingRow[] {
  const q = f.search?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.structureId && r.structureId !== f.structureId) return false;
    if (
      f.status === 'requiredUnmapped'
        ? !(r.required && r.status === 'unmapped')
        : f.status && r.status !== f.status
    )
      return false;
    if (
      q &&
      ![r.fieldName, r.technicalName ?? '', r.source, r.transformation, r.structureName].some((t) =>
        t.toLowerCase().includes(q),
      )
    )
      return false;
    return true;
  });
}
