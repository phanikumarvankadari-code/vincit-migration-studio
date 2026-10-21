import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importCsv, importFieldDictionary } from '@mms/file-import';
import { suggestMappings } from '@mms/mapping-suggest';
import {
  applySuggestions,
  autoImportTarget,
  createStudioState,
  reduce,
  type StudioState,
} from '@mms/studio-model';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, base), 'utf8');
const AT = '2026-10-22T10:00:00.000Z';

/** M11 / SPEC-031: suggestions on the real Profit Center files, and accepting them, without a browser. */
describe('M11 mapping suggestions on the Profit Center files', () => {
  let state: StudioState = createStudioState({
    id: 'p',
    name: 'p',
    businessEntity: 'Profit Center',
    at: AT,
  });
  const dict = importFieldDictionary(text('input/field_dictionary.csv'));
  if (!dict.ok) throw new Error('dictionary');
  for (const f of ['CEPC.csv', 'CEPCT.csv', 'CEPC_BUKRS.csv']) {
    const r = importCsv(text(`input/${f}`), { fileName: f });
    if (!r.ok) throw new Error(f);
    state = reduce(state, { type: 'sourceAdded', imported: r.value, at: AT });
  }
  state = reduce(state, {
    type: 'dictionaryLoaded',
    dictionary: dict.value.dictionary,
    diagnostics: dict.value.diagnostics,
    at: AT,
  });
  const tg = autoImportTarget(
    {
      name: 'data_pc.XLSX',
      content: new Uint8Array(readFileSync(new URL('target/data_pc.XLSX', base))),
    },
    'Profit Center',
  );
  if (!tg.ok) throw new Error('target');
  state = reduce(state, { type: 'targetLoaded', target: tg.value.target, at: AT });

  const srcName = new Map(
    state.project.sourceDefinitions.flatMap((s) =>
      s.datasets.flatMap((d) =>
        d.fields.map((f) => [f.id as string, `${d.name}.${f.displayName}`] as const),
      ),
    ),
  );
  const tgtName = new Map(
    state.project.targetDefinition!.structures.flatMap((s) =>
      s.fields.map((f) => [f.id as string, `${s.name}.${f.displayName}`] as const),
    ),
  );
  const found = suggestMappings(state.project, { data: state.data });
  const pair = (t: string) => {
    const s = found.find((x) => tgtName.get(x.targetFieldId) === t);
    return s && { source: srcName.get(s.sourceFieldId), score: s.score, reasons: s.reasons };
  };

  it('M11-01 proposes the obvious sources with scores and reasons', () => {
    expect(pair('Profit Center.Profit Center')).toMatchObject({
      source: 'CEPC.Profit Center',
      score: 0.8,
    });
    expect(pair('Profit Center.Profit Center')!.reasons).toContain('key on both sides');
    expect(pair('Profit Center.Valid From')).toMatchObject({ source: 'CEPC.Valid From' });
    expect(pair('Company Codes.Company Code')).toMatchObject({ source: 'CEPC_BUKRS.Company Code' });
    expect(pair('Translation.Language Key')).toMatchObject({ source: 'CEPCT.Language Key' });
  });

  it('M11-02 a partial name match is offered with a lower score than an exact one', () => {
    const weak = pair('Profit Center.Person Responsible')!;
    expect(weak.source).toBe('CEPC.Person Responsible for Profit Center');
    expect(weak.score).toBeLessThan(pair('Profit Center.Street')!.score);
  });

  it('M11-03 accepting applies direct mappings in one edit and never overwrites an existing one', () => {
    const items = found.map((x) => ({
      structureId: x.targetStructureId,
      targetFieldId: x.targetFieldId,
      sourceFieldId: x.sourceFieldId,
    }));
    const first = applySuggestions(state.project, items, AT);
    expect(first.applied).toBe(items.length);
    expect(first.skipped).toBe(0);
    expect(first.project.mappingDefinition.mappings).toHaveLength(items.length);
    expect(first.project.mappingDefinition.mappings.every((m) => m.mappingType === 'direct')).toBe(
      true,
    );
    // accepting the same list again changes nothing
    const again = applySuggestions(first.project, items, AT);
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(items.length);
    expect(again.project.mappingDefinition.mappings).toHaveLength(items.length);
    // mapped targets get no new suggestions
    expect(suggestMappings(first.project, { data: state.data })).toEqual([]);
  });

  it('M11-04 does not change the project it was given', () => {
    const before = JSON.stringify(state.project);
    applySuggestions(
      state.project,
      found.slice(0, 3).map((x) => ({
        structureId: x.targetStructureId,
        targetFieldId: x.targetFieldId,
        sourceFieldId: x.sourceFieldId,
      })),
      AT,
    );
    expect(JSON.stringify(state.project)).toBe(before);
  });
});
