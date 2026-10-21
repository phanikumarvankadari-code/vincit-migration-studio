import { describe, expect, it } from 'vitest';
import { MappingSnapshotSchema, validateSnapshot, type Project } from '@mms/mapping-core';
import {
  canRunFull,
  createSnapshot,
  datasetsWithoutData,
  decodeWorkspace,
  draftMatchesSnapshot,
  draftToMapping,
  encodeWorkspace,
  markSnapshot,
  restoreSnapshot,
  snapshotProblems,
  stageStatuses,
  summarizeSnapshot,
  type SnapshotRecord,
  type StudioState,
} from '../src/index.js';
import { apply, at, csv, dictionary, fixtureCsv, newState, ok, smallSources } from './helpers.js';

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
      ],
    },
  ],
} as never;
const ref = (ds: string, f: number) => ({ datasetId: `ds-${ds}`, fieldId: `f-${ds}-${f}` });

function mapped(): StudioState {
  const { cepc, bukrs } = smallSources();
  let s = apply(
    newState(),
    { type: 'sourceAdded', imported: cepc, at: at() },
    { type: 'sourceAdded', imported: bukrs, at: at() },
    { type: 'targetLoaded', target, at: at() },
  );
  const m1 = draftToMapping(s.project, 'ts-A', 'tf-A-1', {
    type: 'direct',
    source: ref('CEPC', 1),
  });
  const m2 = draftToMapping(s.project, 'ts-A', 'tf-A-2', {
    type: 'lookup',
    source: ref('CEPC', 2),
    lookup: { id: 'lk-r', name: 'Regions', entries: [{ key: 'FI', value: 'N' }] },
    missing: { kind: 'null' },
  });
  if (!m1.ok || !m2.ok) throw new Error('x');
  s = apply(
    s,
    { type: 'mappingSaved', mapping: m1.mapping, at: at() },
    { type: 'mappingSaved', mapping: m2.mapping, lookups: m2.lookups, at: at() },
  );
  return s;
}
const snap = (p: Project, name = 'Initial Mapping', id = 'snap-1') =>
  ok(createSnapshot(p, { id, name, at: at() }));

describe('snapshots (SPEC-027)', () => {
  it('captures the mapping, relationships, target, source schemas, routines and lookups, and nothing else', () => {
    const s = mapped();
    const shot = snap(s.project);
    expect(shot).toMatchObject({
      id: 'snap-1',
      projectId: 'p1',
      name: 'Initial Mapping',
      modelSchemaVersion: 1,
    });
    expect(shot.mappingDefinition.mappings).toHaveLength(2);
    expect(shot.mappingDefinition.relationships).toHaveLength(1);
    expect(shot.lookups.map((l) => l.id)).toEqual(['lk-r']);
    expect(shot.targetDefinition.structures).toHaveLength(1);
    expect(shot.sourceSchemas).toHaveLength(2);
    expect(MappingSnapshotSchema.safeParse(shot).success).toBe(true);
    expect(JSON.stringify(shot)).not.toContain('P100'); // no row data
  });

  it('is self-contained: every reference resolves inside the snapshot', () => {
    expect(validateSnapshot(snap(mapped().project))).toEqual([]);
  });

  it('is immutable: later draft changes do not modify it, and it is frozen', () => {
    const s = mapped();
    const shot = snap(s.project);
    const before = JSON.stringify(shot);
    const more = draftToMapping(s.project, 'ts-A', 'tf-A-2', {
      type: 'constant',
      value: 'EN',
      datatype: 'string',
      blank: false,
    });
    if (!more.ok) throw new Error('x');
    const changed = apply(s, { type: 'mappingSaved', mapping: more.mapping, at: at() });
    expect(JSON.stringify(shot)).toBe(before);
    expect(
      changed.project.mappingDefinition.mappings.find((m) => m.targetFieldId === 'tf-A-2')!
        .mappingType,
    ).toBe('constant');
    expect(
      shot.mappingDefinition.mappings.find((m) => m.targetFieldId === 'tf-A-2')!.mappingType,
    ).toBe('lookup');
    expect(Object.isFrozen(shot)).toBe(true);
    expect(Object.isFrozen(shot.mappingDefinition.mappings[0])).toBe(true);
    expect(() => {
      (shot as { name: string }).name = 'changed';
    }).toThrow();
  });

  it('needs a name, a target and mappings, and consistent references, and says what is wrong', () => {
    const s = mapped();
    expect(createSnapshot(s.project, { id: 'a', name: '  ', at: at() })).toMatchObject({
      ok: false,
      issues: [{ code: 'SNAPSHOT_NAME_REQUIRED' }],
    });
    const empty = apply(newState(), {
      type: 'sourceAdded',
      imported: smallSources().cepc,
      at: at(),
    });
    expect(snapshotProblems(empty.project).map((d) => d.code)).toEqual([
      'SNAPSHOT_NO_TARGET',
      'SNAPSHOT_NO_MAPPINGS',
    ]);
    const noMappings = apply(empty, { type: 'targetLoaded', target, at: at() });
    expect(snapshotProblems(noMappings.project).map((d) => d.code)).toEqual([
      'SNAPSHOT_NO_MAPPINGS',
    ]);
    const broken = {
      ...s.project,
      mappingDefinition: {
        ...s.project.mappingDefinition,
        routineReferences: [{ routineId: 'nope' as never, version: '1' }],
      },
    };
    expect(snapshotProblems(broken).map((d) => d.code)).toContain('MODEL_UNKNOWN_ROUTINE');
    const extra = createSnapshot(s.project, { id: 'a', name: 'X', at: at() }, [
      { severity: 'error', code: 'TEST_ROUTINE_NOT_AVAILABLE', message: 'm' },
    ]);
    expect(extra.ok).toBe(false);
  });

  it('reloading gives back the draft as it was, with the project identity unchanged', () => {
    const s = mapped();
    const shot = snap(s.project);
    const changed = apply(s, {
      type: 'mappingRemoved',
      structureId: 'ts-A',
      fieldId: 'tf-A-1',
      at: at(),
    });
    expect(changed.project.mappingDefinition.mappings).toHaveLength(1);
    const back = restoreSnapshot({ ...changed.project, name: 'Renamed' }, shot, at());
    expect(back.mappingDefinition).toEqual(s.project.mappingDefinition);
    expect(back.lookups).toEqual(s.project.lookups);
    expect(back.targetDefinition).toEqual(s.project.targetDefinition);
    expect(back.name).toBe('Renamed');
    expect(back.id).toBe('p1');
    expect(Object.isFrozen(back.mappingDefinition)).toBe(false); // the draft is editable again
  });

  it('a reloaded snapshot behaves equivalently: the draft matches it', () => {
    const s = mapped();
    const shot = snap(s.project);
    expect(draftMatchesSnapshot(s.project, shot)).toBe(true);
    const changed = apply(s, {
      type: 'mappingRemoved',
      structureId: 'ts-A',
      fieldId: 'tf-A-1',
      at: at(),
    });
    expect(draftMatchesSnapshot(changed.project, shot)).toBe(false);
    expect(draftMatchesSnapshot(restoreSnapshot(changed.project, shot, at()), shot)).toBe(true);
  });

  it('"matches" ignores the order mappings were saved in and the time stamps', () => {
    const s = mapped();
    const shot = snap(s.project);
    const reordered = {
      ...s.project,
      updatedAt: '2030-01-01T00:00:00.000Z' as never,
      mappingDefinition: {
        ...s.project.mappingDefinition,
        mappings: [...s.project.mappingDefinition.mappings].reverse(),
      },
    };
    expect(draftMatchesSnapshot(reordered, shot)).toBe(true);
  });

  it('marking Ready or Approved changes the record, not the snapshot; only marked snapshots may be run in full', () => {
    const shot = snap(mapped().project);
    const rec: SnapshotRecord = { snapshot: shot, marker: 'none', markedAt: undefined };
    expect(canRunFull(rec)).toBe(false);
    const ready = markSnapshot(rec, 'ready', '2026-10-21T15:00:00.000Z');
    expect(ready).toEqual({
      snapshot: shot,
      marker: 'ready',
      markedAt: '2026-10-21T15:00:00.000Z',
    });
    expect(ready.snapshot).toBe(shot);
    expect(canRunFull(ready)).toBe(true);
    expect(canRunFull(markSnapshot(ready, 'approved', at()))).toBe(true);
    expect(markSnapshot(ready, 'none', at())).toEqual({
      snapshot: shot,
      marker: 'none',
      markedAt: undefined,
    });
  });

  it('summarizes a snapshot', () => {
    expect(summarizeSnapshot(snap(mapped().project))).toEqual({
      structures: 1,
      mappings: 2,
      fields: 2,
      mappedPercent: 100,
    });
  });
});

describe('snapshots in the studio state', () => {
  it('saving, marking and reloading snapshots; history keeps older snapshots unchanged', () => {
    let s = mapped();
    const first = snap(s.project, 'Initial Mapping', 'snap-1');
    s = apply(s, {
      type: 'snapshotSaved',
      record: { snapshot: first, marker: 'none', markedAt: undefined },
    });
    s = apply(s, { type: 'mappingRemoved', structureId: 'ts-A', fieldId: 'tf-A-1', at: at() });
    const second = snap(s.project, 'SIT Cycle 1', 'snap-2');
    s = apply(s, {
      type: 'snapshotSaved',
      record: { snapshot: second, marker: 'none', markedAt: undefined },
    });
    expect(s.snapshots.map((r) => r.snapshot.name)).toEqual(['Initial Mapping', 'SIT Cycle 1']);
    expect(s.snapshots[0]!.snapshot.mappingDefinition.mappings).toHaveLength(2);
    expect(s.snapshots[1]!.snapshot.mappingDefinition.mappings).toHaveLength(1);
    // the same id twice is ignored
    expect(
      apply(s, {
        type: 'snapshotSaved',
        record: { snapshot: second, marker: 'none', markedAt: undefined },
      }).snapshots,
    ).toHaveLength(2);
    s = apply(s, { type: 'snapshotMarked', snapshotId: 'snap-2', marker: 'approved', at: at() });
    expect(s.snapshots[1]!.marker).toBe('approved');
    expect(s.snapshots[1]!.snapshot).toBe(second);
    expect(
      apply(s, { type: 'snapshotMarked', snapshotId: 'nope', marker: 'ready', at: at() }),
    ).toBe(s);
    s = apply(s, { type: 'snapshotRestored', snapshotId: 'snap-1', at: at() });
    expect(s.project.mappingDefinition.mappings).toHaveLength(2);
    expect(s.snapshots).toHaveLength(2);
    expect(apply(s, { type: 'snapshotRestored', snapshotId: 'nope', at: at() })).toBe(s);
  });

  it('reloading removes row data of datasets the snapshot does not know, and marks results out of date', () => {
    let s = mapped();
    const shot = snap(s.project);
    s = apply(s, {
      type: 'snapshotSaved',
      record: { snapshot: shot, marker: 'none', markedAt: undefined },
    });
    s = apply(s, { type: 'sourceAdded', imported: csv('Extra', 'a,b\n1,2'), at: at() });
    expect(Object.keys(s.data)).toContain('ds-Extra');
    s = { ...s, lastRun: {} as never };
    s = apply(s, { type: 'snapshotRestored', snapshotId: 'snap-1', at: at() });
    expect(Object.keys(s.data).sort()).toEqual(['ds-CEPC', 'ds-CEPC_BUKRS']);
    expect(s.project.sourceDefinitions.map((x) => x.name)).toEqual(['CEPC.csv', 'CEPC_BUKRS.csv']);
    expect(s.runStale).toBe(true);
  });
});

describe('saved workspace (autosave and project files)', () => {
  const workspace = () => {
    let s = mapped();
    const dict = dictionary();
    s = apply(s, {
      type: 'dictionaryLoaded',
      dictionary: dict.dictionary,
      diagnostics: dict.diagnostics,
      at: at(),
    });
    const shot = snap(s.project);
    s = apply(s, {
      type: 'snapshotSaved',
      record: { snapshot: shot, marker: 'ready', markedAt: '2026-10-21T15:00:00.000Z' },
    });
    return {
      project: s.project,
      snapshots: [...s.snapshots],
      dictionary: s.dictionary,
      savedAt: '2026-10-21T16:00:00.000Z',
    };
  };

  it('encodes to JSON and decodes to the same workspace', () => {
    const ws = workspace();
    const text = encodeWorkspace(ws);
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({
      format: 'mms.workspace',
      schemaVersion: 1,
      savedAt: '2026-10-21T16:00:00.000Z',
    });
    const back = ok(decodeWorkspace(text));
    expect(back).toEqual(ws);
    expect(encodeWorkspace(back)).toBe(text); // stable
  });

  it('never contains row data', () => {
    expect(encodeWorkspace(workspace())).not.toContain('P100');
  });

  it('restoring a workspace gives a state with no row data and a clear list of what to reload', () => {
    const ws = workspace();
    const s = apply(newState(), {
      type: 'workspaceLoaded',
      workspace: ok(decodeWorkspace(encodeWorkspace(ws))),
    });
    expect(s.project).toEqual(ws.project);
    expect(s.snapshots).toEqual(ws.snapshots);
    expect(s.dictionary).toEqual(ws.dictionary);
    expect(s.data).toEqual({});
    expect(s.lastRun).toBeUndefined();
    expect(datasetsWithoutData(s)).toEqual([
      { datasetId: 'ds-CEPC', name: 'CEPC', sourceName: 'CEPC.csv' },
      { datasetId: 'ds-CEPC_BUKRS', name: 'CEPC_BUKRS', sourceName: 'CEPC_BUKRS.csv' },
    ]);
    expect(stageStatuses(s).sources).toEqual({
      state: 'attention',
      summary: '2 datasets, data not loaded',
    });
  });

  it('attaching the source files again restores the rows; a file with other columns is refused with the reason', () => {
    const ws = workspace();
    let s = apply(newState(), { type: 'workspaceLoaded', workspace: ws });
    const { cepc, bukrs } = smallSources();
    s = apply(
      s,
      { type: 'rowsAttached', imported: cepc, at: at() },
      { type: 'rowsAttached', imported: bukrs, at: at() },
    );
    expect(Object.keys(s.data).sort()).toEqual(['ds-CEPC', 'ds-CEPC_BUKRS']);
    expect(s.data['ds-CEPC']!.rows).toHaveLength(3);
    expect(datasetsWithoutData(s)).toEqual([]);
    expect(s.project).toEqual(ws.project); // the schema is untouched

    const bad = csv('CEPC', 'Profit Center,Other\nP100,x');
    const t = apply(apply(newState(), { type: 'workspaceLoaded', workspace: ws }), {
      type: 'rowsAttached',
      imported: bad,
      at: at(),
    });
    expect(t.data).toEqual({});
    expect(t.importDiagnostics['src-CEPC']![0]).toMatchObject({
      severity: 'error',
      code: 'ATTACH_FIELD_MISMATCH',
    });
    expect(t.importDiagnostics['src-CEPC']![0]!.message).toContain(
      'expects the columns Profit Center, Country, Valid From but the file has Profit Center, Other',
    );

    const unknown = csv('Nothing', 'a\n1');
    const u = apply(apply(newState(), { type: 'workspaceLoaded', workspace: ws }), {
      type: 'rowsAttached',
      imported: unknown,
      at: at(),
    });
    expect(u.importDiagnostics['src-Nothing']![0]).toMatchObject({ severity: 'warning' });
  });

  it('reattaching also works with the real Profit Center file shape', () => {
    let s = apply(newState(), { type: 'sourceAdded', imported: fixtureCsv('CEPC.csv'), at: at() });
    const ws = {
      project: s.project,
      snapshots: [],
      dictionary: undefined,
      savedAt: '2026-10-21T16:00:00.000Z',
    };
    s = apply(newState(), { type: 'workspaceLoaded', workspace: ws });
    s = apply(s, { type: 'rowsAttached', imported: fixtureCsv('CEPC.csv'), at: at() });
    expect(s.data['ds-CEPC']!.rows).toHaveLength(3);
  });

  it.each([
    ['not json', '{oops', 'WORKSPACE_JSON_INVALID'],
    ['not an object', '[]', 'WORKSPACE_INVALID'],
    ['wrong format', JSON.stringify({ format: 'other' }), 'WORKSPACE_FORMAT_UNKNOWN'],
    [
      'bad version',
      JSON.stringify({ format: 'mms.workspace', schemaVersion: 'x' }),
      'WORKSPACE_VERSION_INVALID',
    ],
    [
      'newer version',
      JSON.stringify({ format: 'mms.workspace', schemaVersion: 2 }),
      'WORKSPACE_VERSION_UNSUPPORTED',
    ],
  ])('refuses a file that is %s', (_n, text, code) => {
    const r = decodeWorkspace(text);
    expect(!r.ok && r.issues[0]!.code).toBe(code);
  });

  it('refuses an inconsistent project instead of half-loading it', () => {
    const doc = JSON.parse(encodeWorkspace(workspace()));
    doc.project.mappingDefinition.mappings[0].targetFieldId = 'nope';
    const r = decodeWorkspace(JSON.stringify(doc));
    expect(!r.ok && r.issues.map((i) => i.code)).toContain('MODEL_UNKNOWN_TARGET_FIELD');
  });

  it('refuses a damaged snapshot or dictionary', () => {
    const doc = JSON.parse(encodeWorkspace(workspace()));
    doc.snapshots[0].snapshot.name = '';
    expect(decodeWorkspace(JSON.stringify(doc))).toMatchObject({
      ok: false,
      issues: [{ code: 'WORKSPACE_SNAPSHOT_INVALID' }],
    });
    const d2 = JSON.parse(encodeWorkspace(workspace()));
    d2.dictionary = [{ nope: 1 }];
    expect(decodeWorkspace(JSON.stringify(d2))).toMatchObject({
      ok: false,
      issues: [{ code: 'WORKSPACE_DICTIONARY_INVALID' }],
    });
    const d3 = JSON.parse(encodeWorkspace(workspace()));
    delete d3.snapshots;
    expect(decodeWorkspace(JSON.stringify(d3)).ok).toBe(false);
  });

  it('starting a new project clears everything', () => {
    const s = apply(mapped(), {
      type: 'projectReset',
      id: 'p2',
      name: 'Fresh',
      businessEntity: 'X',
      at: at(),
    });
    expect(s.project).toMatchObject({ id: 'p2', name: 'Fresh', sourceDefinitions: [] });
    expect(s.snapshots).toEqual([]);
    expect(s.data).toEqual({});
  });
});
