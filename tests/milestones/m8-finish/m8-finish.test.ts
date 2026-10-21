import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importCsv, importFieldDictionary } from '@mms/file-import';
import { MappingSnapshotSchema, validateSnapshot, type Result } from '@mms/mapping-core';
import { runLocal } from '@mms/local-run';
import { createBuiltInRegistry } from '@mms/routine-library';
import { runTest } from '@mms/test-engine';
import {
  autoImportTarget,
  createSnapshot,
  decodeWorkspace,
  draftToMapping,
  draftMatchesSnapshot,
  encodeWorkspace,
  markSnapshot,
  reduce,
  restoreSnapshot,
  stageStatuses,
  createStudioState,
  type MappingDraft,
  type StudioAction,
  type StudioState,
} from '@mms/studio-model';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, base), 'utf8');
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

/**
 * M8 / SPEC-029: the Profit Center golden scenario, from import to generated output, through pure functions (the same
 * ones the screen calls). apps/mapping-studio/e2e/golden.spec.ts runs the same journey through the real screens.
 */
describe('M8 Profit Center golden scenario', () => {
  let n = 0;
  const at = () => `2026-10-21T17:00:${String(n++ % 60).padStart(2, '0')}.000Z`;
  const apply = (s: StudioState, ...a: StudioAction[]): StudioState => a.reduce(reduce, s);
  const registry = createBuiltInRegistry();

  const golden = (f: string) => ok(importCsv(text(`golden/input/${f}`), { fileName: f }));
  const dict = ok(importFieldDictionary(text('input/field_dictionary.csv')));
  const target = ok(
    autoImportTarget(
      {
        name: 'data_pc.XLSX',
        content: new Uint8Array(readFileSync(new URL('target/data_pc.XLSX', base))),
      },
      'Profit Center',
    ),
  ).target;

  const structure = (name: string) => target.structures.find((s) => s.name === name)!;
  const tfield = (s: string, f: string) =>
    structure(s).fields.find((x) => x.displayName === f)!.id as string;

  let state = createStudioState({
    id: 'p1',
    name: 'Profit Center migration',
    businessEntity: 'Profit Center',
    at: at(),
  });
  const sfield = (ds: string, f: string) => {
    const d = state.project.sourceDefinitions
      .flatMap((s) => s.datasets)
      .find((x) => x.name === ds)!;
    return {
      datasetId: d.id as string,
      fieldId: d.fields.find((x) => x.displayName === f)!.id as string,
    };
  };
  const map = (s: string, f: string, draft: MappingDraft) => {
    const r = draftToMapping(state.project, structure(s).id, tfield(s, f), draft);
    if (!r.ok) throw new Error(`${s}.${f}: ${r.problems.join('; ')}`);
    state = apply(state, {
      type: 'mappingSaved',
      mapping: r.mapping,
      lookups: r.lookups,
      at: at(),
    });
  };
  const dateChain = (ds: string, field: string, parse: object): MappingDraft => ({
    type: 'routine',
    source: sfield(ds, field),
    steps: [
      {
        kind: 'routine',
        routineId: 'date.parse',
        configuration: JSON.stringify(parse),
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
  const PARSE = { format: 'M/D/YY', twoDigitYearPivot: 68 };
  const NEVER_ENDS = { ...PARSE, specialValues: { '12/31/99': '9999-12-31' } };
  const direct = (ds: string, f: string): MappingDraft => ({
    type: 'direct',
    source: sfield(ds, f),
  });
  const constant = (value: string): MappingDraft => ({
    type: 'constant',
    value,
    datatype: 'string',
    blank: false,
  });

  it('M8-01 import, dictionary and composite relationships, confirmed by a person', () => {
    state = apply(
      state,
      ...(['CEPC.csv', 'CEPCT.csv', 'CEPC_BUKRS.csv'] as const).map((f) => ({
        type: 'sourceAdded' as const,
        imported: golden(f),
        at: at(),
      })),
    );
    state = apply(state, {
      type: 'dictionaryLoaded',
      dictionary: dict.dictionary,
      diagnostics: dict.diagnostics,
      at: at(),
    });
    expect(Object.values(state.data).map((d) => d.rows.length)).toEqual([3, 3, 4]);
    const rels = state.project.mappingDefinition.relationships;
    expect(rels.map((r) => [r.id, r.cardinality, r.status])).toEqual([
      ['rel-CEPC-CEPCT', 'oneToOne', 'suggested'],
      ['rel-CEPC-CEPC_BUKRS', 'oneToMany', 'suggested'],
      ['rel-CEPCT-CEPC_BUKRS', 'oneToMany', 'suggested'],
    ]);
    expect(rels[1]!.keys.length).toBeGreaterThanOrEqual(3); // Client, Profit Center and Controlling Area
    state = apply(
      state,
      {
        type: 'relationshipDecided',
        relationshipId: 'rel-CEPC-CEPCT',
        status: 'confirmed',
        at: at(),
      },
      {
        type: 'relationshipDecided',
        relationshipId: 'rel-CEPC-CEPC_BUKRS',
        status: 'confirmed',
        at: at(),
      },
      {
        type: 'relationshipDecided',
        relationshipId: 'rel-CEPCT-CEPC_BUKRS',
        status: 'rejected',
        at: at(),
      },
    );
    expect(stageStatuses(state).sources).toEqual({
      state: 'complete',
      summary: '3 datasets, 2 joins confirmed',
    });
  });

  it('M8-02 target parsed; direct, constant, date routine, lookup and one-to-many mappings; three structures', () => {
    state = apply(state, { type: 'targetLoaded', target, at: at() });
    const PC = 'Profit Center';
    map(PC, 'Profit Center', direct('CEPC', 'Profit Center'));
    map(PC, 'Valid To', dateChain('CEPC', 'Valid To', NEVER_ENDS));
    map(PC, 'Valid From', dateChain('CEPC', 'Valid From', PARSE));
    map(PC, 'Profit Center Name', direct('CEPCT', 'Name'));
    map(PC, 'Description', direct('CEPCT', 'Long Text'));
    map(PC, 'Person Responsible', direct('CEPC', 'Person Responsible for Profit Center'));
    map(PC, 'User Responsible', direct('CEPC', 'User Responsible'));
    map(PC, 'Standard Hierarchy Node', constant('H1000'));
    map(PC, 'Segment', constant('SEG01'));
    map(PC, 'Department', direct('CEPC', 'Department'));
    map(PC, 'City', direct('CEPC', 'City'));
    map(PC, 'Postal Code', direct('CEPC', 'Postal Code'));
    map(PC, 'Language Key', {
      type: 'lookup',
      source: sfield('CEPC', 'Language Key'),
      lookup: { id: 'lk-lang', name: 'Language to SAP code', entries: [{ key: 'EN', value: 'E' }] },
      missing: { kind: 'error' },
    });
    const CC = 'Company Codes';
    map(CC, 'Profit Center', direct('CEPC_BUKRS', 'Profit Center'));
    map(CC, 'Validty End Date', dateChain('CEPC', 'Valid To', NEVER_ENDS));
    map(CC, 'Company Code', direct('CEPC_BUKRS', 'Company Code'));
    const TR = 'Translation';
    map(TR, 'Profit Center', direct('CEPCT', 'Profit Center'));
    map(TR, 'Validty End Date', dateChain('CEPCT', 'Valid To', NEVER_ENDS));
    map(TR, 'Language Key', direct('CEPCT', 'Language Key'));
    map(TR, 'Profit Center Name', direct('CEPCT', 'Name'));
    map(TR, 'Profit Center Description', direct('CEPCT', 'Long Text'));
    const link = (child: string) => ({
      parentStructureId: structure(PC).id,
      keys: [
        {
          childFieldId: tfield(child, 'Profit Center'),
          parentFieldId: tfield(PC, 'Profit Center'),
        },
        { childFieldId: tfield(child, 'Validty End Date'), parentFieldId: tfield(PC, 'Valid To') },
      ],
    });
    state = apply(
      state,
      {
        type: 'structureSettings',
        structureId: structure(PC).id,
        generation: { driverDatasetId: 'ds-CEPC' as never },
        parent: null,
        at: at(),
      },
      {
        type: 'structureSettings',
        structureId: structure(CC).id,
        generation: { driverDatasetId: 'ds-CEPC_BUKRS' as never },
        parent: link(CC) as never,
        at: at(),
      },
      {
        type: 'structureSettings',
        structureId: structure(TR).id,
        generation: { driverDatasetId: 'ds-CEPCT' as never },
        parent: link(TR) as never,
        at: at(),
      },
    );
    expect(state.project.mappingDefinition.mappings).toHaveLength(21);
    expect(stageStatuses(state).map.summary).toBe('21 of 39 fields mapped');
  });

  it('M8-03 test and validate: all three structures are produced, one-to-many is proven, the bad row is reported', () => {
    const run = runTest(
      {
        runId: 'run-1',
        model: state.project,
        data: Object.values(state.data),
        sample: { kind: 'all' },
      },
      { now: at, routines: registry },
    );
    state = apply(state, { type: 'runFinished', run });
    expect(run.targets.map((t) => [t.rows.targetStructureId, t.rows.rows.length])).toEqual([
      [structure('Profit Center').id, 3],
      [structure('Company Codes').id, 4],
      [structure('Translation').id, 3],
    ]);
    const cc = run.targets[1]!;
    const col = (n: string) =>
      structure('Company Codes').fields.findIndex((f) => f.displayName === n);
    expect(cc.rows.rows.map((r) => [r[col('Profit Center')], r[col('Company Code')]])).toEqual([
      ['S_PC_1', 'FI11'],
      ['S_PC_1', 'FI12'],
      ['S_PC_1', 'SE11'],
      ['S_PC_2', 'FI11'],
    ]);
    expect(run.targets[0]!.rowStatus).toEqual(['ready', 'ready', 'error']);
    expect(run.run.diagnostics.find((d) => d.code === 'DATE_INVALID')).toMatchObject({
      severity: 'error',
      sourceRow: 3,
      targetRow: 3,
      routineId: 'date.parse',
      sourceValue: '13/45/26',
    });
  });

  it('M8-04 a target cell can be traced to its source, through a join', () => {
    const run = runTest(
      {
        runId: 'run-2',
        model: state.project,
        data: Object.values(state.data),
        sample: { kind: 'firstRows', count: 100 },
      },
      { now: at, routines: registry },
    );
    const cc = run.targets[1]!;
    const idx = structure('Company Codes').fields.findIndex(
      (f) => f.displayName === 'Validty End Date',
    );
    const lineage = cc.lineage![1]![idx]!;
    expect(lineage.sources).toMatchObject([
      { datasetId: 'ds-CEPC', sourceRow: 1, value: '12/31/99' },
    ]);
    expect(lineage.steps.map((s) => s.ref ?? s.kind)).toEqual([
      'source',
      'date.parse',
      'date.format',
    ]);
  });

  it('M8-05 a snapshot can be saved, marked, stored, reloaded and behaves equivalently; it is immutable', () => {
    const snap = ok(
      createSnapshot(state.project, { id: 'snap-1', name: 'Initial Mapping', at: at() }),
    );
    expect(validateSnapshot(snap)).toEqual([]);
    expect(Object.isFrozen(snap)).toBe(true);
    state = apply(
      state,
      { type: 'snapshotSaved', record: { snapshot: snap, marker: 'none', markedAt: undefined } },
      { type: 'snapshotMarked', snapshotId: 'snap-1', marker: 'approved', at: at() },
    );
    // stored text has no rows and comes back equal
    const stored = encodeWorkspace({
      project: state.project,
      snapshots: [...state.snapshots],
      dictionary: state.dictionary,
      savedAt: at(),
    });
    expect(stored).not.toContain('S_PC_1');
    const back = ok(decodeWorkspace(stored));
    expect(back.snapshots[0]!.marker).toBe('approved');
    expect(MappingSnapshotSchema.safeParse(back.snapshots[0]!.snapshot).success).toBe(true);
    // change the draft, then reload the snapshot: the draft is the snapshot again
    const changed = apply(state, {
      type: 'mappingRemoved',
      structureId: structure('Profit Center').id,
      fieldId: tfield('Profit Center', 'Department'),
      at: at(),
    });
    expect(draftMatchesSnapshot(changed.project, snap)).toBe(false);
    const restored = apply(changed, { type: 'snapshotRestored', snapshotId: 'snap-1', at: at() });
    expect(draftMatchesSnapshot(restored.project, snap)).toBe(true);
    expect(restoreSnapshot(changed.project, snap, at()).mappingDefinition.mappings).toHaveLength(
      21,
    );
    expect(markSnapshot(state.snapshots[0]!, 'none', at()).snapshot).toBe(snap);
  });

  it('M8-06 full local run: output for all three structures, an errors file with reasons, diagnostics and a run summary', () => {
    const snap = state.snapshots[0]!.snapshot;
    const result = runLocal(
      snap,
      Object.values(state.data),
      { id: 'run-full' as never, snapshotId: snap.id, runType: 'full', inputs: [] },
      { now: at, routines: registry, csv: { lineEnding: '\n' } },
    );
    expect(result.run.status).toBe('completedWithErrors');
    expect(result.files.map((f) => f.name)).toEqual([
      'Profit Center.csv',
      'Profit Center.errors.csv',
      'Company Codes.csv',
      'Translation.csv',
      'diagnostics.csv',
      'run-summary.json',
    ]);
    const get = (name: string) => result.files.find((f) => f.name === name)!.content as string;
    const pc = importCsv(get('Profit Center.csv'), { fileName: 'x.csv' });
    const rows = ok(pc).rows[0]!.rows;
    const header = ok(pc).source.datasets[0]!.fields.map((f) => f.displayName);
    const cell = (r: (string | null)[], name: string) => r[header.indexOf(name)];
    expect(rows.map((r) => cell(r, 'Profit Center'))).toEqual(['S_PC_1', 'S_PC_2']);
    expect(rows.map((r) => cell(r, 'Valid From'))).toEqual(['20260101', '20260501']);
    expect(rows.map((r) => cell(r, 'Postal Code'))).toEqual(['00330', '00330']);
    expect(rows.map((r) => cell(r, 'Language Key'))).toEqual(['E', 'E']);
    expect(get('Company Codes.csv')).toBe(
      [
        'Profit Center,Validty End Date,Company Code',
        'S_PC_1,99991231,FI11',
        'S_PC_1,99991231,FI12',
        'S_PC_1,99991231,SE11',
        'S_PC_2,99991231,FI11',
        '',
      ].join('\n'),
    );
    expect(get('Profit Center.errors.csv')).toContain('S_PC_3');
    expect(get('Profit Center.errors.csv')).toContain('Cannot read ""13/45/26"" as a date');
    const summary = JSON.parse(get('run-summary.json'));
    expect(
      summary.structures.map(
        (s: { name: string; produced: number; written: number; errors: number }) => [
          s.name,
          s.produced,
          s.written,
          s.errors,
        ],
      ),
    ).toEqual([
      ['Profit Center', 3, 2, 1],
      ['Company Codes', 4, 4, 0],
      ['Translation', 3, 3, 0],
    ]);
    expect(summary).toMatchObject({
      snapshotName: 'Initial Mapping',
      inputRecordCounts: { 'ds-CEPC': 3, 'ds-CEPCT': 3, 'ds-CEPC_BUKRS': 4 },
    });
  });

  it('M8-07 the supplied reference files are unchanged (the golden data is a separate, labelled set)', () => {
    expect(text('input/CEPCT.csv').trim().split('\n')).toHaveLength(2);
    expect(text('input/CEPCT.csv')).toContain('DUMMY');
    expect(text('input/CEPC_BUKRS.csv')).toContain('P1PBP');
    expect(text('input/CEPC.csv')).toContain('S_PC_3');
    expect(text('input/CEPC.csv')).not.toContain('13/45/26');
    expect(text('golden/README.md')).toContain('never edited');
  });
});
