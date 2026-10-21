import type { FieldMapping, Project } from '@mms/mapping-core';
import { upsertMapping, removeMapping } from './edit.js';
import { describeMapping, mappingTypeLabel } from './table.js';

/**
 * A picture of the canonical mapping for the Visual Mapper. This is a pure projection: nodes and edges are derived
 * from the project and carry no mapping logic of their own. Edits go back through the same project functions as the
 * Mapping Table. Positions are not stored here (the UI keeps them as layout only).
 */
export type GraphNodeKind =
  'source' | 'constant' | 'lookup' | 'condition' | 'routine' | 'javascript' | 'target' | 'dataset';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  detail?: string;
  /** Left to right, starting at 0. */
  column: number;
  /** Top to bottom within the column. */
  row: number;
  /** A target field without a mapping, shown dimmed so it can be connected. */
  muted?: boolean;
  required?: boolean;
  mappingId?: string;
  fieldId?: string;
  datasetId?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'flow' | 'relationship';
  label?: string;
  status?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const sourceNodeId = (fieldId: string): string => `src|${fieldId}`;
export const targetNodeId = (fieldId: string): string => `tgt|${fieldId}`;
export const parseNodeId = (
  id: string,
): { kind: 'src' | 'tgt' | 'op' | 'step' | 'ds'; parts: string[] } | undefined => {
  const [kind, ...parts] = id.split('|');
  return kind === 'src' || kind === 'tgt' || kind === 'op' || kind === 'step' || kind === 'ds'
    ? { kind, parts }
    : undefined;
};

export interface MappingGraphOptions {
  structureId: string;
  /** Also show every field of every dataset, so any of them can be connected. */
  showAllSources?: boolean;
}

/** Operation node kind for the primary operation of a mapping, if it has one. */
function primaryNode(m: FieldMapping): { kind: GraphNodeKind; label: string } | undefined {
  switch (m.mappingType) {
    case 'constant':
      return { kind: 'constant', label: `"${m.constant.value ?? ''}"` };
    case 'lookup':
      return { kind: 'lookup', label: 'Lookup' };
    case 'conditional':
      return { kind: 'condition', label: 'Condition' };
    case 'javascript':
      return { kind: 'javascript', label: 'JavaScript' };
    default:
      return undefined;
  }
}

export function buildMappingGraph(project: Project, options: MappingGraphOptions): Graph {
  const structure = project.targetDefinition?.structures.find((s) => s.id === options.structureId);
  if (!structure) return { nodes: [], edges: [] };
  const mappings = project.mappingDefinition.mappings.filter(
    (m) => m.targetStructureId === structure.id,
  );
  const fieldNames = new Map<string, { dataset: string; field: string; datasetId: string }>();
  for (const s of project.sourceDefinitions)
    for (const d of s.datasets)
      for (const f of d.fields)
        fieldNames.set(f.id, { dataset: d.name, field: f.displayName, datasetId: d.id });
  const datasetNames = new Map(
    project.sourceDefinitions.flatMap((s) => s.datasets.map((d) => [d.id as string, d] as const)),
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const rowOf = new Map<number, number>();
  const add = (n: Omit<GraphNode, 'row'>): void => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    const row = rowOf.get(n.column) ?? 0;
    rowOf.set(n.column, row + 1);
    nodes.push({ ...n, row });
  };

  // Depth of the longest chain decides the target column.
  const depth = (m: FieldMapping): number => (primaryNode(m) ? 1 : 0) + m.transformations.length;
  const targetColumn = 1 + Math.max(0, ...mappings.map(depth));

  const ordered = [...mappings].sort(
    (a, b) =>
      structure.fields.findIndex((f) => f.id === a.targetFieldId) -
      structure.fields.findIndex((f) => f.id === b.targetFieldId),
  );
  for (const m of ordered) {
    for (const r of m.sourceReferences) {
      const n = fieldNames.get(r.fieldId);
      add({
        id: sourceNodeId(r.fieldId),
        kind: 'source',
        label: n?.field ?? r.fieldId,
        detail: n?.dataset ?? r.datasetId,
        column: 0,
        fieldId: r.fieldId,
        datasetId: r.datasetId,
      });
    }
  }
  if (options.showAllSources) {
    // Every field of every dataset, so any of them can be connected.
    for (const [dsId, ds] of datasetNames) {
      for (const f of ds.fields) {
        add({
          id: sourceNodeId(f.id),
          kind: 'source',
          label: f.displayName,
          detail: ds.name,
          column: 0,
          fieldId: f.id,
          datasetId: dsId,
        });
      }
    }
  }

  for (const m of ordered) {
    let previous: string[] = m.sourceReferences.map((r) => sourceNodeId(r.fieldId));
    let column = 1;
    const chain: { id: string; kind: GraphNodeKind; label: string; detail?: string }[] = [];
    const prim = primaryNode(m);
    const text = describeMapping(project, m);
    if (prim)
      chain.push({
        id: `op|${m.id}`,
        kind: prim.kind,
        label: prim.label,
        detail: m.mappingType === 'constant' ? 'Constant' : text.transformation,
      });
    m.transformations
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((t, i) => {
        const label =
          t.kind === 'routine'
            ? (text.transformation.split(' → ').filter((p) => p !== 'Direct')[(prim ? 1 : 0) + i] ??
              t.routineId)
            : (text.transformation.split(' → ')[(prim ? 1 : 0) + i] ?? 'Lookup');
        chain.push({
          id: `step|${m.id}|${t.order}`,
          kind: t.kind === 'routine' ? 'routine' : 'lookup',
          label,
          detail: t.kind === 'routine' ? t.routineId : t.lookupId,
        });
      });
    for (const c of chain) {
      add({
        id: c.id,
        kind: c.kind,
        label: c.label,
        ...(c.detail ? { detail: c.detail } : {}),
        column: column++,
        mappingId: m.id,
      });
      for (const p of previous)
        edges.push({ id: `${p}>${c.id}`, source: p, target: c.id, kind: 'flow' });
      previous = [c.id];
    }
    const tgt = targetNodeId(m.targetFieldId);
    for (const p of previous)
      edges.push({ id: `${p}>${tgt}`, source: p, target: tgt, kind: 'flow' });
  }

  for (const f of structure.fields) {
    const m = mappings.find((x) => x.targetFieldId === f.id);
    add({
      id: targetNodeId(f.id),
      kind: 'target',
      label: f.displayName,
      detail: m ? mappingTypeLabel(m.mappingType) : 'Not mapped',
      column: targetColumn,
      ...(m ? { mappingId: m.id } : { muted: true }),
      ...(f.required ? { required: true } : {}),
      fieldId: f.id,
    });
  }
  return { nodes, edges };
}

export type GraphEdit = { ok: true; project: Project } | { ok: false; message: string };

/**
 * Connecting a source field to an unmapped target field makes a direct mapping. A target that already has a mapping
 * is not changed (edit it in the table, or remove its link first), so a stray drag never destroys work.
 */
export function connectFields(
  project: Project,
  structureId: string,
  fromNodeId: string,
  toNodeId: string,
  at: string,
): GraphEdit {
  const from = parseNodeId(fromNodeId);
  const to = parseNodeId(toNodeId);
  if (from?.kind !== 'src' || to?.kind !== 'tgt')
    return { ok: false, message: 'Connect a source field to a target field.' };
  const sourceFieldId = from.parts[0]!;
  const targetFieldId = to.parts[0]!;
  const structure = project.targetDefinition?.structures.find((s) => s.id === structureId);
  const field = structure?.fields.find((f) => f.id === targetFieldId);
  if (!structure || !field) return { ok: false, message: 'That target field does not exist.' };
  let datasetId: string | undefined;
  for (const s of project.sourceDefinitions)
    for (const d of s.datasets) if (d.fields.some((f) => f.id === sourceFieldId)) datasetId = d.id;
  if (!datasetId) return { ok: false, message: 'That source field does not exist.' };
  if (project.mappingDefinition.mappings.some((m) => m.targetFieldId === targetFieldId)) {
    return {
      ok: false,
      message: `"${field.displayName}" already has a mapping. Remove its link first, or edit it in the Mapping Table.`,
    };
  }
  const mapping: FieldMapping = {
    id: `m-${targetFieldId}` as FieldMapping['id'],
    targetStructureId: structureId as FieldMapping['targetStructureId'],
    targetFieldId: targetFieldId as FieldMapping['targetFieldId'],
    mappingType: 'direct',
    sourceReferences: [{ datasetId: datasetId as never, fieldId: sourceFieldId as never }],
    transformations: [],
    status: 'mapped',
  };
  return { ok: true, project: upsertMapping(project, mapping, at) };
}

/** Removes the mapping that feeds a target field (deleting its links in the picture). */
export function disconnectTarget(
  project: Project,
  structureId: string,
  targetNodeIdOrFieldId: string,
  at: string,
): GraphEdit {
  const parsed = parseNodeId(targetNodeIdOrFieldId);
  const fieldId = parsed?.kind === 'tgt' ? parsed.parts[0]! : targetNodeIdOrFieldId;
  if (
    !project.mappingDefinition.mappings.some(
      (m) => m.targetFieldId === fieldId && m.targetStructureId === structureId,
    )
  ) {
    return { ok: false, message: 'That target field has no mapping.' };
  }
  return { ok: true, project: removeMapping(project, structureId, fieldId, at) };
}

/** Datasets as nodes, relationships as edges (the Visual Mapper's second picture). */
export function buildRelationshipGraph(project: Project): Graph {
  const nodes: GraphNode[] = [];
  const names = new Map<string, string>();
  const fieldNames = new Map<string, string>();
  let row = 0;
  for (const s of project.sourceDefinitions) {
    for (const d of s.datasets) {
      names.set(d.id, d.name);
      for (const f of d.fields) fieldNames.set(f.id, f.displayName);
      nodes.push({
        id: `ds|${d.id}`,
        kind: 'dataset',
        label: d.name,
        detail: `${d.fields.length} fields`,
        column: row % 2,
        row: Math.floor(row / 2),
        datasetId: d.id,
      });
      row++;
    }
  }
  const edges: GraphEdge[] = project.mappingDefinition.relationships.map((r) => ({
    id: `rel|${r.id}`,
    source: `ds|${r.leftDatasetId}`,
    target: `ds|${r.rightDatasetId}`,
    kind: 'relationship',
    label: `${r.keys.map((k) => (fieldNames.get(k.leftFieldId) === fieldNames.get(k.rightFieldId) ? fieldNames.get(k.leftFieldId) : `${fieldNames.get(k.leftFieldId)} = ${fieldNames.get(k.rightFieldId)}`)).join(' + ')} (${r.cardinality})`,
    status: r.status,
  }));
  return { nodes, edges };
}

export interface SuggestionItem {
  structureId: string;
  targetFieldId: string;
  sourceFieldId: string;
}

/**
 * Turns accepted suggestions into direct mappings in one edit. A target that already has a mapping, or a source
 * that no longer exists, is skipped, so accepting never overwrites work.
 */
export function applySuggestions(
  project: Project,
  items: readonly SuggestionItem[],
  at: string,
): { project: Project; applied: number; skipped: number } {
  let current = project;
  let applied = 0;
  for (const i of items) {
    const r = connectFields(
      current,
      i.structureId,
      sourceNodeId(i.sourceFieldId),
      targetNodeId(i.targetFieldId),
      at,
    );
    if (r.ok) {
      current = r.project;
      applied++;
    }
  }
  return { project: current, applied, skipped: items.length - applied };
}
