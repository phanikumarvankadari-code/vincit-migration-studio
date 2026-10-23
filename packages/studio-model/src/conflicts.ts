import type { DataType, Project } from '@mms/mapping-core';

/**
 * Things in a mapping that deserve a second look, worked out from the project itself (nothing is stored).
 * A conflict never blocks anything: a person decides.
 */
export type ConflictKind = 'typeMismatch' | 'lengthOverflow' | 'sourceReused' | 'sourceEmpty';

export interface MappingConflict {
  id: string;
  kind: ConflictKind;
  severity: 'warning' | 'info';
  structureId: string;
  /** Target fields the conflict is about (at least one). */
  targetFieldIds: string[];
  sourceFieldIds: string[];
  message: string;
}

export interface ConflictOptions {
  /** Share of rows with a value, 0 to 100, by source field ID (from the profiler). Omit when no rows are loaded. */
  fill?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
}

const NUMERIC: ReadonlySet<DataType> = new Set(['integer', 'decimal']);
const TEMPORAL: ReadonlySet<DataType> = new Set(['date', 'dateTime', 'time']);

/** Does copying a value of type `from` into a field of type `to` need a conversion step? */
function needsConversion(from: DataType, to: DataType): boolean {
  if (from === 'unknown' || to === 'unknown' || from === to) return false;
  if (to === 'string') return false; // anything can be written as text
  if (NUMERIC.has(from) && NUMERIC.has(to)) return false;
  if (TEMPORAL.has(from) && TEMPORAL.has(to)) return false;
  return true;
}

const pctText = (n: number): string => `${Math.round(n * 10) / 10}%`;

export function detectConflicts(
  project: Project,
  options: ConflictOptions = {},
): MappingConflict[] {
  const out: MappingConflict[] = [];
  const sources = new Map<
    string,
    { name: string; dataset: string; datatype: DataType; length?: number }
  >();
  for (const sd of project.sourceDefinitions)
    for (const ds of sd.datasets)
      for (const f of ds.fields)
        sources.set(f.id, {
          name: f.displayName,
          dataset: ds.name,
          datatype: f.datatype,
          ...(f.length !== undefined ? { length: f.length } : {}),
        });
  const fillOf = (id: string): number | undefined =>
    options.fill instanceof Map
      ? options.fill.get(id)
      : (options.fill as Readonly<Record<string, number>> | undefined)?.[id];
  const label = (id: string): string => {
    const s = sources.get(id);
    return s ? `${s.dataset}.${s.name}` : id;
  };

  for (const st of project.targetDefinition?.structures ?? []) {
    const fields = new Map(st.fields.map((f) => [f.id as string, f] as const));
    const mappings = project.mappingDefinition.mappings.filter(
      (m) => m.targetStructureId === st.id,
    );

    // One source feeding several target fields.
    const bySource = new Map<string, string[]>();
    for (const m of mappings)
      for (const r of m.sourceReferences) {
        const list = bySource.get(r.fieldId) ?? [];
        if (!list.includes(m.targetFieldId)) list.push(m.targetFieldId);
        bySource.set(r.fieldId, list);
      }
    for (const [sourceId, targets] of bySource) {
      if (targets.length < 2) continue;
      out.push({
        id: `reuse:${st.id}:${sourceId}`,
        kind: 'sourceReused',
        severity: 'info',
        structureId: st.id,
        targetFieldIds: targets,
        sourceFieldIds: [sourceId],
        message: `${label(sourceId)} feeds ${targets.length} fields: ${targets.map((t) => fields.get(t)?.displayName ?? t).join(', ')}.`,
      });
    }

    for (const m of mappings) {
      const target = fields.get(m.targetFieldId);
      if (!target) continue;
      const direct = m.mappingType === 'direct' && m.transformations.length === 0;
      const ref = m.sourceReferences[0];
      const src = ref ? sources.get(ref.fieldId) : undefined;
      if (direct && ref && src) {
        if (needsConversion(src.datatype, target.datatype))
          out.push({
            id: `type:${m.id}`,
            kind: 'typeMismatch',
            severity: 'warning',
            structureId: st.id,
            targetFieldIds: [target.id],
            sourceFieldIds: [ref.fieldId],
            message: `${label(ref.fieldId)} is ${src.datatype} but ${target.displayName} expects ${target.datatype}. Add a conversion step.`,
          });
        if (src.length !== undefined && target.length !== undefined && src.length > target.length)
          out.push({
            id: `length:${m.id}`,
            kind: 'lengthOverflow',
            severity: 'warning',
            structureId: st.id,
            targetFieldIds: [target.id],
            sourceFieldIds: [ref.fieldId],
            message: `${label(ref.fieldId)} can hold ${src.length} characters but ${target.displayName} only ${target.length}. Longer values may be cut.`,
          });
      }
      for (const r of m.sourceReferences) {
        const fill = fillOf(r.fieldId);
        if (fill === undefined) continue;
        if (fill === 0)
          out.push({
            id: `empty:${m.id}:${r.fieldId}`,
            kind: 'sourceEmpty',
            severity: 'warning',
            structureId: st.id,
            targetFieldIds: [target.id],
            sourceFieldIds: [r.fieldId],
            message: `${label(r.fieldId)} is empty in the loaded rows, so ${target.displayName} will be empty.`,
          });
        else if (fill < 100 && target.required)
          out.push({
            id: `blank:${m.id}:${r.fieldId}`,
            kind: 'sourceEmpty',
            severity: 'warning',
            structureId: st.id,
            targetFieldIds: [target.id],
            sourceFieldIds: [r.fieldId],
            message: `${target.displayName} is required but ${label(r.fieldId)} is blank in ${pctText(100 - fill)} of the rows.`,
          });
      }
    }
  }

  return out;
}

/** Conflicts by target field ID, for a row or a marker. */
export function conflictsByTarget(
  conflicts: readonly MappingConflict[],
): Map<string, MappingConflict[]> {
  const out = new Map<string, MappingConflict[]>();
  for (const c of conflicts)
    for (const t of c.targetFieldIds) out.set(t, [...(out.get(t) ?? []), c]);
  return out;
}
