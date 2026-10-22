import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importCsv, importFieldDictionary } from '@mms/file-import';
import {
  buildAiPrompts,
  confidenceBand,
  mappingConfidence,
  mergeSuggestions,
  parseAiResponse,
  suggestMappings,
} from '@mms/mapping-suggest';
import {
  autoImportTarget,
  createStudioState,
  detectConflicts,
  removeMappings,
  reduce,
  applySuggestions,
  type StudioState,
} from '@mms/studio-model';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, base), 'utf8');
const AT = '2026-10-22T10:00:00.000Z';

/** M16 / SPEC-036 on the real Profit Center files, without a browser and without a model. */
describe('M16 AI suggestions, confidence, conflicts and delete', () => {
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
  const fieldName = new Map(
    project.targetDefinition!.structures.flatMap((s) =>
      s.fields.map((f) => [f.id as string, `${s.name}.${f.displayName}`] as const),
    ),
  );
  const nameOf = (id: string) => fieldName.get(id);

  it('M16-01 the prompts for the real files hold metadata and hints and not one row value', () => {
    const rules = suggestMappings(project, { data: state.data });
    const prompts = buildAiPrompts(project, { hints: rules, batchSize: 20 });
    expect(prompts.length).toBeGreaterThan(1); // 39 target fields in batches of 20
    const rows = Object.values(state.data)
      .flatMap((d) => d.rows.flat())
      .filter((v): v is string => !!v && v.length >= 4);
    expect(rows.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p.system).toContain('You see no data values');
      for (const v of new Set(rows)) expect(p.user).not.toContain(`"${v}"`);
    }
  });

  it('M16-02 a model answer is merged with the rules: agreement is raised, disagreement is a conflict', () => {
    const rules = suggestMappings(project, { data: state.data });
    const prompt = buildAiPrompts(project, { hints: rules })[0]!;
    const tId = [...prompt.targets].find(
      ([, t]) => nameOf(t.fieldId) === 'Profit Center.Profit Center',
    )![0];
    const dId = [...prompt.targets].find(
      ([, t]) => nameOf(t.fieldId) === 'Profit Center.Valid From',
    )![0];
    const sOf = (name: string) =>
      [...prompt.sources].find(
        ([, s]) =>
          project.sourceDefinitions
            .flatMap((d) => d.datasets)
            .flatMap((d) => d.fields)
            .find((f) => f.id === s.fieldId)!.displayName === name,
      )![0];
    const answer = JSON.stringify({
      mappings: [
        { target: tId, source: sOf('Profit Center'), confidence: 90, reason: 'same key' },
        { target: dId, source: sOf('Valid To'), confidence: 99, reason: 'a date' },
      ],
    });
    const parsed = parseAiResponse(answer, prompt);
    expect(parsed.problems).toEqual([]);
    const merged = mergeSuggestions(rules, parsed.items, project);
    const key = merged.find((m) => nameOf(m.targetFieldId) === 'Profit Center.Profit Center')!;
    expect(key.origin).toBe('both');
    expect(key.score).toBeGreaterThanOrEqual(0.9);
    const date = merged.find((m) => nameOf(m.targetFieldId) === 'Profit Center.Valid From')!;
    expect(date.origin).toBe('ai');
    expect(date.score).toBe(0.95); // capped
    expect(date.conflict).toMatchObject({ origin: 'rules' });
    const conflicts = detectConflicts(project, { suggestions: merged });
    expect(
      conflicts.some((c) => c.kind === 'suggestionDisagree' && c.message.includes('Valid From')),
    ).toBe(true);
  });

  it('M16-03 accepted suggestions get a confidence like any mapping, and conflicts are found in them', () => {
    const rules = suggestMappings(project, { data: state.data });
    const applied = applySuggestions(
      project,
      rules.map((x) => ({
        structureId: x.targetStructureId,
        targetFieldId: x.targetFieldId,
        sourceFieldId: x.sourceFieldId,
      })),
      AT,
    );
    expect(applied.applied).toBe(rules.length);
    const bands = applied.project.mappingDefinition.mappings.map((m) =>
      mappingConfidence(applied.project, m, state.data),
    );
    expect(bands.every((b) => b.kind === 'matched')).toBe(true);
    expect(bands.some((b) => b.kind === 'matched' && b.band === 'high')).toBe(true);
    // the same source copied into several targets (Profit Center feeds three structures) is information, not an error
    const conflicts = detectConflicts(applied.project);
    expect(
      conflicts.filter((c) => c.kind === 'sourceReused').every((c) => c.severity === 'info'),
    ).toBe(true);
    expect([0.95, 0.8, 0.79, 0.6, 0.59].map(confidenceBand)).toEqual([
      'high',
      'high',
      'medium',
      'medium',
      'low',
    ]);
  });

  it('M16-04 deleting several mappings in one edit leaves the rest, and the earlier project is the undo', () => {
    const rules = suggestMappings(project, { data: state.data });
    const applied = applySuggestions(
      project,
      rules.map((x) => ({
        structureId: x.targetStructureId,
        targetFieldId: x.targetFieldId,
        sourceFieldId: x.sourceFieldId,
      })),
      AT,
    ).project;
    const before = JSON.stringify(applied);
    const some = applied.mappingDefinition.mappings
      .slice(0, 3)
      .map((m) => ({ structureId: m.targetStructureId, fieldId: m.targetFieldId }));
    const r = removeMappings(applied, some, AT);
    expect(r.removed).toBe(3);
    expect(r.project.mappingDefinition.mappings).toHaveLength(
      applied.mappingDefinition.mappings.length - 3,
    );
    expect(JSON.stringify(applied)).toBe(before); // restoring this project is Undo
  });
});
