import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importCsv, importFieldDictionary } from '@mms/file-import';
import type { Result } from '@mms/mapping-core';
import { runTest } from '@mms/test-engine';
import {
  autoImportTarget,
  buildMappingGraph,
  buildMappingRows,
  connectFields,
  createStudioState,
  draftToMapping,
  previewMapping,
  readinessChecklist,
  reduce,
  stageStatuses,
  type StudioAction,
  type StudioState,
} from '@mms/studio-model';
import { createBuiltInRegistry } from '@mms/routine-library';
import { preflight } from '@mms/test-engine';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, base), 'utf8');
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

/**
 * M7 proves that the screen has no logic of its own: the whole journey (load sources, confirm joins, load the target,
 * map with the editor's forms, add a link as the Visual Mapper does, preview, test, read lineage, check readiness)
 * runs here without a browser, through the same functions the screen calls. The browser tests under
 * apps/mapping-studio/e2e prove the screens.
 */
describe('M7 the screen runs on pure, tested functions', () => {
  let n = 0;
  const at = () => `2026-10-21T14:00:${String(n++ % 60).padStart(2, '0')}.000Z`;
  const apply = (s: StudioState, ...a: StudioAction[]): StudioState => a.reduce(reduce, s);
  const registry = createBuiltInRegistry();

  const cepc = ok(
    importCsv(
      [
        'Profit Center,Valid From,Country',
        'P100,1/1/26,FI',
        'P200,5/1/26,SE',
        'P300,13/45/26,NO',
      ].join('\n'),
      { fileName: 'CEPC.csv' },
    ),
  );
  const bukrs = ok(
    importCsv(['Profit Center,Company Code', 'P100,FI01', 'P100,FI02', 'P300,NO01'].join('\n'), {
      fileName: 'CEPC_BUKRS.csv',
    }),
  );
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

  const start = (): StudioState =>
    apply(
      createStudioState({
        id: 'p1',
        name: 'Profit Center migration',
        businessEntity: 'Profit Center',
        at: at(),
      }),
      { type: 'sourceAdded', imported: cepc, at: at() },
      { type: 'sourceAdded', imported: bukrs, at: at() },
      {
        type: 'relationshipDecided',
        relationshipId: 'rel-CEPC-CEPC_BUKRS',
        status: 'confirmed',
        at: at(),
      },
      { type: 'targetLoaded', target, at: at() },
    );
  const pc = () => target.structures[0]!;
  const field = (name: string) => pc().fields.find((f) => f.displayName === name)!;
  const ref = (ds: string, f: number) => ({ datasetId: `ds-${ds}`, fieldId: `f-${ds}-${f}` });

  it('M7-01 stage status follows the work: nothing, then sources, target, mapping', () => {
    const empty = createStudioState({ id: 'p', name: 'x', businessEntity: 'y', at: at() });
    expect(Object.values(stageStatuses(empty)).map((s) => s.state)).toEqual([
      'notStarted',
      'notStarted',
      'notStarted',
      'notStarted',
      'notStarted',
    ]);
    const s = start();
    const st = stageStatuses(s, preflight(s.project, { routines: registry }));
    expect(st.sources).toEqual({ state: 'complete', summary: '2 datasets, 1 join confirmed' });
    expect(st.target).toEqual({ state: 'complete', summary: '3 structures, 39 fields' });
    expect(st.map).toEqual({ state: 'notStarted', summary: '0 of 39 fields mapped' });
  });

  it('M7-02 a dictionary enriches sources and the table lists every target field, required ones first to find', () => {
    let s = start();
    s = apply(s, {
      type: 'dictionaryLoaded',
      dictionary: dict.dictionary,
      diagnostics: dict.diagnostics,
      at: at(),
    });
    const rows = buildMappingRows({ project: s.project });
    expect(rows).toHaveLength(39);
    expect(rows.filter((r) => r.required && r.status === 'unmapped')).toHaveLength(13);
  });

  it('M7-03 mapping with the editor forms and with a visual link gives ordinary canonical mappings', () => {
    let s = start();
    const direct = ok(
      asResult(
        draftToMapping(s.project, pc().id, field('Profit Center').id, {
          type: 'direct',
          source: ref('CEPC', 1),
        }),
      ),
    );
    s = apply(s, { type: 'mappingSaved', mapping: direct.mapping, at: at() });
    const date = ok(
      asResult(
        draftToMapping(s.project, pc().id, field('Valid From').id, {
          type: 'routine',
          source: ref('CEPC', 2),
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
        }),
      ),
    );
    s = apply(s, { type: 'mappingSaved', mapping: date.mapping, at: at() });
    const visual = connectFields(
      s.project,
      pc().id,
      'src|f-CEPC-3',
      `tgt|${field('Language Key').id}`,
      at(),
    );
    if (!visual.ok) throw new Error(visual.message);
    s = apply(s, { type: 'projectEdited', project: visual.project });
    expect(s.project.mappingDefinition.mappings.map((m) => m.mappingType)).toEqual([
      'direct',
      'routine',
      'direct',
    ]);
    expect(s.project.routines.map((r) => r.id)).toEqual(['date.format', 'date.parse']);
    expect(buildMappingGraph(s.project, { structureId: pc().id }).edges.length).toBe(5); // 1 direct + 3 chain links + 1 visual link
  });

  it('M7-04 the editor preview shows what a mapping would do on real rows, including problems', () => {
    const s = start();
    const date = ok(
      asResult(
        draftToMapping(s.project, pc().id, field('Valid From').id, {
          type: 'routine',
          source: ref('CEPC', 2),
          steps: [
            {
              kind: 'routine',
              routineId: 'date.parse',
              configuration: '{"format":"M/D/YY","twoDigitYearPivot":68}',
              onError: 'stop',
            },
          ],
        }),
      ),
    );
    const p = previewMapping(s, date.mapping, date.lookups, { routines: registry });
    expect(p.ok && p.rows.map((r) => r.value)).toEqual(['2026-01-01', '2026-05-01', null]);
    expect(p.ok && p.rows[2]!.issues[0]!.code).toBe('DATE_INVALID');
  });

  it('M7-05 a test run, a traced cell and a readiness checklist all come from the same state', () => {
    let s = start();
    for (const [name, source] of [
      ['Profit Center', 1],
      ['Language Key', 3],
    ] as const) {
      const d = ok(
        asResult(
          draftToMapping(s.project, pc().id, field(name).id, {
            type: 'direct',
            source: ref('CEPC', source),
          }),
        ),
      );
      s = apply(s, { type: 'mappingSaved', mapping: d.mapping, at: at() });
    }
    const run = runTest(
      {
        runId: 'run-1',
        model: s.project,
        data: Object.values(s.data),
        sample: { kind: 'firstRows', count: 100 },
      },
      { now: at, routines: registry },
    );
    s = apply(s, { type: 'runFinished', run });
    const out = run.targets[0]!;
    expect(out.rows.rows.map((r) => r[0])).toEqual(['P100', 'P200', 'P300']);
    const lineage =
      out.lineage![0]![pc().fields.findIndex((f) => f.displayName === 'Profit Center')]!;
    expect(lineage.sources).toEqual([
      { datasetId: 'ds-CEPC', fieldId: 'f-CEPC-1', sourceRow: 1, value: 'P100' },
    ]);
    const list = readinessChecklist(s, preflight(s.project, { routines: registry }));
    expect(list.find((i) => i.label === 'A test run has been done')!.done).toBe(true);
    expect(list.find((i) => i.label === 'All required and key fields are mapped')!.done).toBe(
      false,
    );
    s = apply(s, {
      type: 'projectRenamed',
      name: 'Renamed',
      businessEntity: 'Profit Center',
      at: at(),
    });
    expect(s.runStale).toBe(true);
    expect(stageStatuses(s).test.summary).toBe('Results out of date');
  });
});

function asResult<T extends { ok: boolean }>(r: T): Result<Extract<T, { ok: true }>> {
  return (
    r.ok
      ? { ok: true, value: r as Extract<T, { ok: true }> }
      : { ok: false, issues: [{ severity: 'error', code: 'X', message: JSON.stringify(r) }] }
  ) as never;
}
