import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importCsv, importFieldDictionary } from '@mms/file-import';
import {
  buildStructureAiPrompt,
  mergeStructureSuggestions,
  parseStructureAiResponse,
  suggestStructurePairs,
} from '@mms/mapping-suggest';
import {
  autoImportTarget,
  createStudioState,
  clearDriver,
  pairViews,
  reduce,
  scopeOf,
  setDriver,
  type StudioState,
} from '@mms/studio-model';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, base), 'utf8');
const AT = '2026-10-22T10:00:00.000Z';

/** M17 / SPEC-037 on the real Profit Center files, without a browser and without a model. */
describe('M17 structure pairing', () => {
  let state: StudioState = createStudioState({ id: 'p', name: 'p', businessEntity: 'PC', at: AT });
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
  const project = state.project;
  const structures = project.targetDefinition!.structures;
  const datasets = project.sourceDefinitions.flatMap((d) => d.datasets);
  const dsName = (id: string) => datasets.find((d) => d.id === id)?.name;
  const stId = (name: string) => structures.find((s) => s.name === name)!.id;

  it('M17-01 the real files pair by their fields: CEPC drives Profit Center and so on', () => {
    const s = suggestStructurePairs(project, { data: state.data });
    const by = (name: string) => s.find((x) => x.targetStructureId === stId(name));
    expect(dsName(by('Profit Center')!.driverDatasetId)).toBe('CEPC');
    expect(dsName(by('Company Codes')!.driverDatasetId)).toBe('CEPC_BUKRS');
    expect(dsName(by('Translation')!.driverDatasetId)).toBe('CEPCT');
    expect(by('Profit Center')!.score).toBeGreaterThan(by('Translation')!.score);
  });

  it('M17-02 names do not matter: with every dataset and structure renamed the pairs stay', () => {
    const rename = new Map(datasets.map((d, i) => [d.id as string, `SRC_${i}`]));
    const renamed = {
      ...project,
      sourceDefinitions: project.sourceDefinitions.map((sd) => ({
        ...sd,
        datasets: sd.datasets.map((d) => ({ ...d, name: rename.get(d.id as string)! })),
      })),
      targetDefinition: {
        ...project.targetDefinition!,
        structures: structures.map((st, i) => ({ ...st, name: `TGT_${i}` })),
      },
    };
    const s = suggestStructurePairs(renamed, { data: state.data });
    for (const [i, st] of structures.entries()) {
      const was = suggestStructurePairs(project, { data: state.data }).find(
        (x) => x.targetStructureId === st.id,
      )!;
      const now = s.find((x) => x.targetStructureId === st.id)!;
      expect(`TGT_${i}`).toBeTruthy();
      expect(now.driverDatasetId).toBe(was.driverDatasetId);
    }
  });

  it('M17-03 a pair is the structure driver; the scope is the driver and its joined datasets', () => {
    const pc = stId('Profit Center');
    const cepc = datasets.find((d) => d.name === 'CEPC')!.id;
    expect(scopeOf(project, pc)).toBeUndefined();
    const paired = setDriver(project, pc, cepc, AT);
    expect(paired.targetDefinition!.structures.find((x) => x.id === pc)!.generation).toMatchObject({
      driverDatasetId: cepc,
    });
    expect(scopeOf(paired, pc)![0]).toBe(cepc);
    expect(pairViews(paired).find((v) => v.structureId === pc)!.driverDatasetId).toBe(cepc);
    const cleared = clearDriver(paired, pc, AT);
    expect(scopeOf(cleared, pc)).toBeUndefined();
  });

  it('M17-04 the AI question holds names and fields only, no row value; a disagreement is a conflict', () => {
    const rules = suggestStructurePairs(project, { data: state.data });
    const prompt = buildStructureAiPrompt(project, rules)!;
    const rows = Object.values(state.data)
      .flatMap((d) => d.rows.flat())
      .filter((v): v is string => !!v && v.length >= 4);
    expect(rows.length).toBeGreaterThan(0);
    for (const v of new Set(rows)) expect(prompt.user).not.toContain(`"${v}"`);
    expect(prompt.system).toContain('no data values');
    const t = [...prompt.targets].find(([, v]) => v === stId('Translation'))![0];
    const d = [...prompt.datasets].find(([, v]) => dsName(v) === 'CEPC')![0];
    const parsed = parseStructureAiResponse(
      JSON.stringify({ pairs: [{ target: t, driver: d, confidence: 99, reason: 'texts' }] }),
      prompt,
    );
    expect(parsed.problems).toEqual([]);
    const merged = mergeStructureSuggestions(rules, parsed.items, project);
    const tr = merged.find((x) => x.targetStructureId === stId('Translation'))!;
    expect(tr.origin).toBe('ai');
    expect(tr.conflict).toBeDefined();
  });
});
