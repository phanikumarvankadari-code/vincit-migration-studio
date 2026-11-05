import { describe, expect, it } from 'vitest';
import { validateProject } from '@mms/mapping-core';
import {
  buildMappingGraph,
  buildRelationshipGraph,
  connectFields,
  disconnectTarget,
  parseNodeId,
  sourceNodeId,
  stageStatuses,
  readinessChecklist,
  targetNodeId,
  draftToMapping,
  type StudioState,
} from '../src/index.js';
import { apply, at, newState, smallSources } from './helpers.js';

const target = {
  id: 'td-1',
  name: 'T',
  structures: [
    {
      id: 'ts-A',
      targetDefinitionId: 'td-1',
      name: 'Alpha',
      displayName: 'Alpha',
      fields: [
        {
          id: 'tf-A-1',
          targetStructureId: 'ts-A',
          displayName: 'Profit Center',
          datatype: 'string',
          required: true,
          isKey: true,
        },
        {
          id: 'tf-A-2',
          targetStructureId: 'ts-A',
          displayName: 'Region',
          datatype: 'string',
          required: false,
          isKey: false,
        },
        {
          id: 'tf-A-3',
          targetStructureId: 'ts-A',
          displayName: 'Valid From',
          datatype: 'date',
          required: true,
          isKey: false,
        },
      ],
    },
  ],
} as never;
const ref = (ds: string, f: number) => ({ datasetId: `ds-${ds}`, fieldId: `f-${ds}-${f}` });

function ready(): StudioState {
  const { cepc, bukrs } = smallSources();
  return apply(
    newState(),
    { type: 'sourceAdded', imported: cepc, at: at() },
    { type: 'sourceAdded', imported: bukrs, at: at() },
    { type: 'targetLoaded', target, at: at() },
  );
}
function mapped(): StudioState {
  let s = ready();
  const save = (field: string, draft: Parameters<typeof draftToMapping>[3]) => {
    const r = draftToMapping(s.project, 'ts-A', field, draft);
    if (!r.ok) throw new Error(r.problems.join(';'));
    s = apply(s, { type: 'mappingSaved', mapping: r.mapping, lookups: r.lookups, at: at() });
  };
  save('tf-A-1', { type: 'direct', source: ref('CEPC', 1) });
  save('tf-A-2', {
    type: 'lookup',
    source: ref('CEPC', 2),
    lookup: { id: 'lk-r', name: 'Regions', entries: [{ key: 'FI', value: 'N' }] },
    missing: { kind: 'null' },
  });
  save('tf-A-3', {
    type: 'routine',
    source: ref('CEPC', 3),
    steps: [
      {
        kind: 'routine',
        routineId: 'date.parse',
        configuration: '{"format":"M/D/YY","twoDigitYearPivot":68}',
        onError: 'stop',
      },
      {
        kind: 'routine',
        routineId: 'date.format',
        configuration: '{"format":"YYYYMMDD"}',
        onError: 'stop',
      },
    ],
  });
  return s;
}

describe('mapping graph (Visual Mapper projection)', () => {
  it('renders the canonical mapping: sources on the left, operations in the middle, target fields on the right', () => {
    const g = buildMappingGraph(mapped().project, { structureId: 'ts-A' });
    const byKind = (k: string) => g.nodes.filter((n) => n.kind === k).map((n) => n.label);
    expect(byKind('source')).toEqual(['Profit Center', 'Country', 'Valid From']);
    expect(byKind('lookup')).toEqual(['Lookup']);
    expect(byKind('routine')).toEqual(['Parse Date', 'Format Date']);
    expect(byKind('target')).toEqual(['Profit Center', 'Region', 'Valid From']);
    expect(g.nodes.filter((n) => n.kind === 'source').every((n) => n.column === 0)).toBe(true);
    const targetColumn = Math.max(...g.nodes.map((n) => n.column));
    expect(g.nodes.filter((n) => n.kind === 'target').every((n) => n.column === targetColumn)).toBe(
      true,
    );
    expect(targetColumn).toBe(3);
  });

  it('edges follow the chain: source to each step to the target', () => {
    const g = buildMappingGraph(mapped().project, { structureId: 'ts-A' });
    const path = (from: string) => {
      const out: string[] = [from];
      for (
        let cur = from, next = g.edges.find((e) => e.source === cur);
        next;
        cur = next.target, next = g.edges.find((e) => e.source === cur)
      )
        out.push(next.target);
      return out;
    };
    expect(path(sourceNodeId('f-CEPC-1'))).toEqual([
      sourceNodeId('f-CEPC-1'),
      targetNodeId('tf-A-1'),
    ]);
    expect(path(sourceNodeId('f-CEPC-2'))).toEqual([
      sourceNodeId('f-CEPC-2'),
      'op|m-tf-A-2',
      targetNodeId('tf-A-2'),
    ]);
    expect(path(sourceNodeId('f-CEPC-3'))).toEqual([
      sourceNodeId('f-CEPC-3'),
      'step|m-tf-A-3|0',
      'step|m-tf-A-3|1',
      targetNodeId('tf-A-3'),
    ]);
    expect(g.edges.every((e) => e.kind === 'flow')).toBe(true);
  });

  it('unmapped target fields are shown dimmed so they can be connected; required ones are marked', () => {
    const g = buildMappingGraph(ready().project, { structureId: 'ts-A' });
    expect(
      g.nodes
        .filter((n) => n.kind === 'target')
        .map((n) => [n.label, n.muted, n.required ?? false]),
    ).toEqual([
      ['Profit Center', true, true],
      ['Region', true, false],
      ['Valid From', true, true],
    ]);
    expect(g.edges).toEqual([]);
  });

  it('can show every field of every dataset so any of them can be connected', () => {
    const p = mapped().project;
    const some = buildMappingGraph(p, { structureId: 'ts-A' }).nodes.filter(
      (n) => n.kind === 'source',
    );
    const all = buildMappingGraph(p, { structureId: 'ts-A', showAllSources: true }).nodes.filter(
      (n) => n.kind === 'source',
    );
    expect(some).toHaveLength(3);
    expect(all.map((n) => n.id)).toEqual([
      'src|f-CEPC-1',
      'src|f-CEPC-2',
      'src|f-CEPC-3',
      'src|f-CEPC_BUKRS-1',
      'src|f-CEPC_BUKRS-2',
    ]);
    expect(new Set(all.map((n) => n.detail))).toEqual(new Set(['CEPC', 'CEPC_BUKRS']));
  });

  it('constants and conditions become operation nodes', () => {
    let s = ready();
    const save = (field: string, draft: Parameters<typeof draftToMapping>[3]) => {
      const r = draftToMapping(s.project, 'ts-A', field, draft);
      if (!r.ok) throw new Error(r.problems.join(';'));
      s = apply(s, { type: 'mappingSaved', mapping: r.mapping, at: at() });
    };
    save('tf-A-1', { type: 'constant', value: 'EN', datatype: 'string', blank: false });
    save('tf-A-2', {
      type: 'conditional',
      source: ref('CEPC', 2),
      rules: [
        {
          left: { kind: 'current' },
          operator: 'eq',
          right: 'FI',
          then: { kind: 'text', value: 'A' },
        },
      ],
      otherwise: undefined,
    });
    const g = buildMappingGraph(s.project, { structureId: 'ts-A' });
    expect(g.nodes.filter((n) => n.kind === 'constant').map((n) => n.label)).toEqual(['"EN"']);
    expect(g.nodes.filter((n) => n.kind === 'condition')).toHaveLength(1);
  });

  it('a structure that does not exist gives an empty graph', () => {
    expect(buildMappingGraph(mapped().project, { structureId: 'nope' })).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it('the graph is rebuilt identically from the same project (reload gives an equivalent picture)', () => {
    const p = mapped().project;
    expect(buildMappingGraph(JSON.parse(JSON.stringify(p)), { structureId: 'ts-A' })).toEqual(
      buildMappingGraph(p, { structureId: 'ts-A' }),
    );
  });
});

describe('visual edits update the canonical mapping', () => {
  it('connecting a source field to an unmapped target field makes a direct mapping', () => {
    const r = connectFields(
      ready().project,
      'ts-A',
      sourceNodeId('f-CEPC-1'),
      targetNodeId('tf-A-1'),
      at(),
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.project.mappingDefinition.mappings).toMatchObject([
      {
        id: 'm-tf-A-1',
        mappingType: 'direct',
        status: 'mapped',
        sourceReferences: [{ datasetId: 'ds-CEPC', fieldId: 'f-CEPC-1' }],
      },
    ]);
    expect(validateProject(r.project)).toEqual([]);
  });

  it('a mapped target is not overwritten by a stray drag', () => {
    const s = mapped();
    const r = connectFields(
      s.project,
      'ts-A',
      sourceNodeId('f-CEPC-2'),
      targetNodeId('tf-A-1'),
      at(),
    );
    expect(r).toEqual({
      ok: false,
      message:
        '"Profit Center" already has a mapping. Remove its link first, or edit it in the Mapping Table.',
    });
  });

  it('only source-to-target links are accepted, and unknown fields are refused', () => {
    const p = ready().project;
    expect(
      connectFields(p, 'ts-A', targetNodeId('tf-A-1'), sourceNodeId('f-CEPC-1'), at()).ok,
    ).toBe(false);
    expect(connectFields(p, 'ts-A', sourceNodeId('f-gone'), targetNodeId('tf-A-1'), at())).toEqual({
      ok: false,
      message: 'That source field does not exist.',
    });
    expect(
      connectFields(p, 'ts-A', sourceNodeId('f-CEPC-1'), targetNodeId('tf-gone'), at()),
    ).toEqual({ ok: false, message: 'That target field does not exist.' });
    expect(connectFields(p, 'ts-A', 'x', 'y', at())).toEqual({
      ok: false,
      message: 'Connect a source field to a target field.',
    });
  });

  it('removing a link removes the mapping', () => {
    const r = disconnectTarget(mapped().project, 'ts-A', targetNodeId('tf-A-3'), at());
    if (!r.ok) throw new Error(r.message);
    expect(r.project.mappingDefinition.mappings.map((m) => m.targetFieldId)).toEqual([
      'tf-A-1',
      'tf-A-2',
    ]);
    expect(r.project.routines).toEqual([]); // the routines were only used by the removed mapping
    expect(disconnectTarget(r.project, 'ts-A', targetNodeId('tf-A-3'), at())).toEqual({
      ok: false,
      message: 'That target field has no mapping.',
    });
  });

  it('node IDs parse back into their parts', () => {
    expect(parseNodeId(sourceNodeId('f-1'))).toEqual({ kind: 'src', parts: ['f-1'] });
    expect(parseNodeId('step|m-1|2')).toEqual({ kind: 'step', parts: ['m-1', '2'] });
    expect(parseNodeId('zzz|1')).toBeUndefined();
  });

  it('visual edits do not need the picture: the result is the same as editing through the table', () => {
    const viaGraph = connectFields(
      ready().project,
      'ts-A',
      sourceNodeId('f-CEPC-1'),
      targetNodeId('tf-A-1'),
      'T',
    );
    const viaDraft = draftToMapping(ready().project, 'ts-A', 'tf-A-1', {
      type: 'direct',
      source: ref('CEPC', 1),
    });
    expect(viaGraph.ok && viaDraft.ok && viaGraph.project.mappingDefinition.mappings[0]).toEqual(
      viaDraft.ok && viaDraft.mapping,
    );
  });
});

describe('relationship graph', () => {
  it('shows datasets as nodes and relationships as edges with their status', () => {
    const g = buildRelationshipGraph(ready().project);
    expect(g.nodes.map((n) => [n.label, n.detail])).toEqual([
      ['CEPC', '3 fields'],
      ['CEPC_BUKRS', '2 fields'],
    ]);
    expect(g.edges).toEqual([
      {
        id: 'rel|rel-CEPC-CEPC_BUKRS',
        source: 'ds|ds-CEPC',
        target: 'ds|ds-CEPC_BUKRS',
        kind: 'relationship',
        label: 'Profit Center (oneToMany)',
        status: 'suggested',
      },
    ]);
  });
});

describe('stage status and readiness', () => {
  it('starts with nothing done', () => {
    const s = stageStatuses(newState());
    expect(Object.values(s).map((x) => x.state)).toEqual([
      'notStarted',
      'notStarted',
      'notStarted',
      'notStarted',
      'notStarted',
    ]);
    expect(s.sources.summary).toBe('No files yet');
  });

  it('an open join suggestion never blocks the sources stage; confirming it is shown in the summary', () => {
    let s = ready();
    expect(stageStatuses(s).sources).toEqual({
      state: 'complete',
      summary: '2 datasets, 1 join suggested',
    });
    s = apply(s, {
      type: 'relationshipDecided',
      relationshipId: 'rel-CEPC-CEPC_BUKRS',
      status: 'confirmed',
      at: at(),
    });
    expect(stageStatuses(s).sources).toEqual({
      state: 'complete',
      summary: '2 datasets, 1 join confirmed',
    });
    expect(stageStatuses(s).target).toEqual({
      state: 'complete',
      summary: '1 structure, 3 fields',
    });
  });

  it('Reject all rejects every suggested join and keeps the confirmed ones', () => {
    const s0 = ready();
    const rels = s0.project.mappingDefinition.relationships;
    expect(rels.length).toBeGreaterThan(0);
    const s1 = apply(s0, { type: 'relationshipsRejectedAll', at: at() });
    expect(s1.project.mappingDefinition.relationships.map((r) => r.status)).toEqual(
      rels.map(() => 'rejected'),
    );
    expect(stageStatuses(s1).sources).toEqual({ state: 'complete', summary: '2 datasets' });
    const first = rels[0]!.id;
    const s2 = apply(
      s0,
      { type: 'relationshipDecided', relationshipId: first, status: 'confirmed', at: at() },
      { type: 'relationshipsRejectedAll', at: at() },
    );
    const byId = Object.fromEntries(
      s2.project.mappingDefinition.relationships.map((r) => [r.id, r.status]),
    );
    expect(byId[first]).toBe('confirmed');
  });

  it('the map stage follows completeness and pre-flight problems', () => {
    expect(stageStatuses(ready()).map).toEqual({
      state: 'notStarted',
      summary: '0 of 3 fields mapped',
    });
    const m = mapped();
    expect(stageStatuses(m).map).toEqual({ state: 'complete', summary: '3 of 3 fields mapped' });
    expect(stageStatuses(m, [{ severity: 'error', code: 'X', message: 'm' }]).map).toEqual({
      state: 'attention',
      summary: '3 of 3 fields mapped, 1 problem',
    });
    const partial = apply(ready(), {
      type: 'mappingSaved',
      mapping: mapped().project.mappingDefinition.mappings[1]!,
      lookups: mapped().project.lookups,
      at: at(),
    });
    expect(stageStatuses(partial).map.state).toBe('inProgress');
  });

  it('test and ready stages follow the last run', () => {
    let s = mapped();
    s = apply(s, {
      type: 'relationshipDecided',
      relationshipId: 'rel-CEPC-CEPC_BUKRS',
      status: 'confirmed',
      at: at(),
    });
    const clean = { run: { status: 'completed', errorCount: 0, warningCount: 2 } } as never;
    const failing = {
      run: { status: 'completedWithErrors', errorCount: 3, warningCount: 0 },
    } as never;
    const failed = { run: { status: 'failed', errorCount: 1, warningCount: 0 } } as never;
    expect(stageStatuses({ ...s, lastRun: clean }).test).toEqual({
      state: 'complete',
      summary: 'Last run clean, 2 warnings',
    });
    expect(stageStatuses({ ...s, lastRun: failing }).test).toEqual({
      state: 'attention',
      summary: '3 errors in the last run',
    });
    expect(stageStatuses({ ...s, lastRun: failed }).test).toEqual({
      state: 'attention',
      summary: 'Last run could not execute',
    });
    expect(stageStatuses({ ...s, lastRun: clean, runStale: true }).test).toEqual({
      state: 'inProgress',
      summary: 'Results out of date',
    });
    expect(stageStatuses({ ...s, lastRun: clean }).ready).toEqual({
      state: 'inProgress',
      summary: 'Ready to save a snapshot',
    });
    const marked = {
      snapshot: { name: 'SIT Cycle 1' },
      marker: 'approved',
      markedAt: 'x',
    } as never;
    expect(stageStatuses({ ...s, lastRun: clean, snapshots: [marked] }).ready).toEqual({
      state: 'complete',
      summary: 'Snapshot "SIT Cycle 1" is approved',
    });
    expect(stageStatuses({ ...s, lastRun: failing }).ready).toEqual({
      state: 'inProgress',
      summary: 'Waiting for a clean test',
    });
    expect(stageStatuses(newState()).ready.state).toBe('notStarted');
  });

  it('the checklist lists what is still open', () => {
    const s = mapped();
    const list = readinessChecklist(s);
    expect(list.map((i) => [i.label, i.done])).toEqual([
      ['Source files are loaded', true],
      ['A target structure is loaded', true],
      ['All required and key fields are mapped', true],
      ['No mapping has a configuration problem', true],
      ['A test run has been done', false],
      ['The last test run has no errors', false],
      ['The test results are up to date', false],
      ['A snapshot is saved', false],
      ['A snapshot is marked Ready or Approved', false],
    ]);
    expect(
      readinessChecklist(newState())
        .filter((i) => i.done)
        .map((i) => i.label),
    ).toEqual(['No mapping has a configuration problem']);
  });
});
