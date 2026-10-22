import { computeCompleteness } from '@mms/mapping-core';
import type { Workspace } from './persistence.js';

/** What a business-object card on the home page shows. */
export interface ObjectSummary {
  state: 'draft' | 'ready' | 'approved';
  datasets: number;
  structures: number;
  fields: number;
  mapped: number;
  snapshots: number;
  /** Required target fields without a mapping. */
  requiredOpen: number;
  joinsConfirmed: number;
}

export function summarizeWorkspace(ws: Workspace): ObjectSummary {
  const target = ws.project.targetDefinition;
  const completeness = target ? computeCompleteness(target, ws.project.mappingDefinition) : [];
  return {
    state: ws.project.projectState,
    datasets: ws.project.sourceDefinitions.reduce((n, s) => n + s.datasets.length, 0),
    structures: target?.structures.length ?? 0,
    fields: completeness.reduce((n, c) => n + c.totalFields, 0),
    mapped: completeness.reduce((n, c) => n + c.mappedFields, 0),
    snapshots: ws.snapshots.length,
    requiredOpen: completeness.reduce((n, c) => n + c.unmappedRequired.length, 0),
    joinsConfirmed: ws.project.mappingDefinition.relationships.filter(
      (r) => r.status === 'confirmed',
    ).length,
  };
}
