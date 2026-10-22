import { describe, expect, it } from 'vitest';
import { ProjectSchema, type Project } from '@mms/mapping-core';
import {
  buildAiPrompts,
  confidenceBand,
  mergeSuggestions,
  parseAiResponse,
  suggestMappings,
  type AiMapping,
} from '../src/index.js';

const NOW = '2026-10-22T10:00:00.000Z';

function project(): Project {
  const f = (id: string, ds: string, displayName: string, over: object = {}) => ({
    id,
    datasetId: ds,
    displayName,
    datatype: 'string',
    ...over,
  });
  return ProjectSchema.parse({
    id: 'p',
    name: 'p',
    businessEntity: 'Profit Center',
    projectState: 'draft',
    createdAt: NOW,
    updatedAt: NOW,
    sourceDefinitions: [
      {
        id: 'src-1',
        name: 'CEPC.csv',
        sourceType: 'csv',
        location: { kind: 'localFile', path: 'CEPC.csv' },
        datasets: [
          {
            id: 'ds-1',
            sourceId: 'src-1',
            name: 'CEPC',
            displayName: 'CEPC',
            fields: [
              f('f1', 'ds-1', 'Profit Center', { technicalName: 'PRCTR', length: 10, isKey: true }),
              f('f2', 'ds-1', 'Country', { length: 3 }),
              f('f3', 'ds-1', 'Responsible', { length: 12 }),
              f('f4', 'ds-1', 'Owner', { length: 12 }),
            ],
          },
        ],
      },
    ],
    targetDefinition: {
      id: 'tgt-1',
      name: 'S/4',
      structures: [
        {
          id: 'st-1',
          targetDefinitionId: 'tgt-1',
          name: 'Profit Center',
          displayName: 'Profit Center',
          fields: [
            {
              id: 'tf1',
              targetStructureId: 'st-1',
              displayName: 'Profit Center',
              technicalName: 'PRCTR',
              datatype: 'string',
              length: 10,
              required: true,
              isKey: true,
              description: 'Key of the profit center',
            },
            {
              id: 'tf2',
              targetStructureId: 'st-1',
              displayName: 'Country',
              datatype: 'string',
              length: 3,
              required: false,
              isKey: false,
            },
            {
              id: 'tf3',
              targetStructureId: 'st-1',
              displayName: 'Person Responsible',
              datatype: 'string',
              required: false,
              isKey: false,
            },
            {
              id: 'tf4',
              targetStructureId: 'st-1',
              displayName: 'Planet',
              datatype: 'string',
              required: false,
              isKey: false,
            },
          ],
        },
      ],
    },
    mappingDefinition: {
      id: 'md',
      mappings: [],
      relationships: [],
      routineReferences: [],
      lookupReferences: [],
      validationRules: [],
    },
    routines: [],
    lookups: [],
  });
}

describe('AI prompts (SPEC-036 AC-1)', () => {
  it('holds metadata and rule hints with short ids, and no row values', () => {
    const p = project();
    const [prompt] = buildAiPrompts(p, { hints: suggestMappings(p) });
    const user = JSON.parse(prompt!.user) as {
      targets: { id: string; name: string; description?: string }[];
      sources: { id: string; name: string; technicalName?: string }[];
      hints: { target: string; candidates: { source: string; score: number }[] }[];
    };
    expect(user.targets.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(user.targets[0]).toMatchObject({
      name: 'Profit Center',
      description: 'Key of the profit center',
    });
    expect(user.sources[0]).toMatchObject({
      id: 's1',
      name: 'Profit Center',
      technicalName: 'PRCTR',
    });
    expect(user.hints.find((h) => h.target === 't2')!.candidates[0]).toMatchObject({
      source: 's2',
    });
    expect(prompt!.system).toContain('You see no data values');
    expect(prompt!.targets.get('t2')).toEqual({ structureId: 'st-1', fieldId: 'tf2' });
    expect(prompt!.sources.get('s2')).toEqual({ datasetId: 'ds-1', fieldId: 'f2' });
    // the prompt is built from the project only: a data-looking string cannot be in it
    expect(prompt!.user).not.toMatch(/P100|P200|FI01/);
  });

  it('asks only for unmapped target fields, in batches', () => {
    const p = project();
    p.mappingDefinition.mappings.push({
      id: 'm1',
      targetStructureId: 'st-1',
      targetFieldId: 'tf1',
      mappingType: 'direct',
      sourceReferences: [{ datasetId: 'ds-1', fieldId: 'f1' }],
      transformations: [],
      status: 'mapped',
    } as never);
    const prompts = buildAiPrompts(p, { batchSize: 2 });
    expect(prompts).toHaveLength(2);
    expect(prompts.flatMap((x) => [...x.targets.values()].map((t) => t.fieldId))).toEqual([
      'tf2',
      'tf3',
      'tf4',
    ]);
    expect(buildAiPrompts(p, { structureId: 'nope' })).toEqual([]);
  });
});

describe('AI answers (AC-2)', () => {
  const prompt = () => buildAiPrompts(project())[0]!;
  const answer =
    '{"mappings":[{"target":"t1","source":"s1","confidence":92,"reason":"same key"},{"target":"t3","source":"s3","confidence":0.7,"reason":"responsible person"},{"target":"t4","source":null,"confidence":10,"reason":"none"}]}';

  it('reads bare JSON, scales 0-1 and 0-100, and keeps a no-match answer', () => {
    const r = parseAiResponse(answer, prompt());
    expect(r.problems).toEqual([]);
    expect(r.items).toEqual([
      {
        targetFieldId: 'tf1',
        sourceFieldId: 'f1',
        datasetId: 'ds-1',
        confidence: 0.92,
        reason: 'same key',
      },
      {
        targetFieldId: 'tf3',
        sourceFieldId: 'f3',
        datasetId: 'ds-1',
        confidence: 0.7,
        reason: 'responsible person',
      },
      {
        targetFieldId: 'tf4',
        sourceFieldId: null,
        datasetId: null,
        confidence: 0.1,
        reason: 'none',
      },
    ]);
  });

  it('reads JSON in a code fence or with text around it', () => {
    expect(
      parseAiResponse('Here you go:\n```json\n' + answer + '\n```\nDone.', prompt()).items,
    ).toHaveLength(3);
    expect(parseAiResponse('Sure! ' + answer + ' Hope it helps', prompt()).items).toHaveLength(3);
    expect(
      parseAiResponse(JSON.stringify(JSON.parse(answer).mappings), prompt()).items,
    ).toHaveLength(3);
  });

  it('drops made-up ids and reports them; reports an unreadable answer', () => {
    const bad =
      '{"mappings":[{"target":"t9","source":"s1","confidence":90},{"target":"t2","source":"s99","confidence":90},{"target":"t2","source":"s2","confidence":"high"}]}';
    const r = parseAiResponse(bad, prompt());
    expect(r.items).toHaveLength(0);
    expect(r.problems.length).toBeGreaterThanOrEqual(2);
    expect(parseAiResponse('I cannot do that', prompt())).toEqual({
      items: [],
      problems: ['The answer was not the expected JSON.'],
    });
  });
});

describe('merging rules and AI (AC-3)', () => {
  const ai = (
    targetFieldId: string,
    sourceFieldId: string | null,
    confidence: number,
    reason = 'r',
  ): AiMapping => ({
    targetFieldId,
    sourceFieldId,
    datasetId: sourceFieldId ? 'ds-1' : null,
    confidence,
    reason,
  });

  it('agreement raises the confidence by 5 points and marks both', () => {
    const p = project();
    const rules = suggestMappings(p);
    const merged = mergeSuggestions(rules, [ai('tf1', 'f1', 0.9)], p);
    const s = merged.find((x) => x.targetFieldId === 'tf1')!;
    expect(s.origin).toBe('both');
    expect(s.score).toBe(0.95);
    expect(s.reasons.at(-1)).toBe('AI: r');
    expect(s.conflict).toBeUndefined();
  });

  it('disagreement keeps the stronger proposal and records the other as a conflict', () => {
    const p = project();
    const rules = suggestMappings(p);
    const rule = rules.find((x) => x.targetFieldId === 'tf3')!; // "Person Responsible" -> Responsible
    const aiWins = mergeSuggestions(rules, [ai('tf3', 'f4', 0.9)], p).find(
      (x) => x.targetFieldId === 'tf3',
    )!;
    expect(aiWins).toMatchObject({ origin: 'ai', sourceFieldId: 'f4', score: 0.9 });
    expect(aiWins.conflict).toMatchObject({ sourceFieldId: rule.sourceFieldId, origin: 'rules' });
    const rulesWin = mergeSuggestions(rules, [ai('tf3', 'f4', 0.2)], p).find(
      (x) => x.targetFieldId === 'tf3',
    )!;
    expect(rulesWin).toMatchObject({ origin: 'rules', sourceFieldId: rule.sourceFieldId });
    expect(rulesWin.conflict).toMatchObject({ sourceFieldId: 'f4', origin: 'ai' });
  });

  it('an AI-only proposal is capped at 95%; "no match" only adds a note', () => {
    const p = project();
    const rules = suggestMappings(p);
    const merged = mergeSuggestions(rules, [ai('tf4', 'f3', 1), ai('tf2', null, 0.9)], p);
    expect(merged.find((x) => x.targetFieldId === 'tf4')).toMatchObject({
      origin: 'ai',
      score: 0.95,
    });
    expect(merged.find((x) => x.targetFieldId === 'tf2')!.reasons).toContain(
      'AI found no clear match',
    );
    expect(merged.find((x) => x.targetFieldId === 'tf2')!.origin).toBe('rules');
    // an AI answer for a field that does not exist is ignored
    expect(mergeSuggestions([], [ai('nope', 'f1', 0.9)], p)).toEqual([]);
  });

  it('confidence bands: high 80+, medium 60-79, low below', () => {
    expect([0.95, 0.8, 0.79, 0.6, 0.59, 0].map(confidenceBand)).toEqual([
      'high',
      'high',
      'medium',
      'medium',
      'low',
      'low',
    ]);
  });
});

import {
  buildValuePrompt,
  mappingConfidence,
  parseValueResponse,
  ruleValueSuggestion,
} from '../src/index.js';

describe('confidence of existing mappings', () => {
  const direct = (target: string, source: string): Record<string, unknown> => ({
    id: `m-${target}`,
    targetStructureId: 'st-1',
    targetFieldId: target,
    mappingType: 'direct',
    sourceReferences: [{ datasetId: 'ds-1', fieldId: source }],
    transformations: [],
    status: 'mapped',
  });

  it('scores a direct copy like a suggestion, and calls everything else manual', () => {
    const p = project();
    const good = mappingConfidence(p, direct('tf1', 'f1') as never);
    expect(good).toMatchObject({ kind: 'matched', band: 'high' });
    const weak = mappingConfidence(p, direct('tf4', 'f2') as never);
    expect(weak).toMatchObject({ kind: 'matched', band: 'low', score: 0 });
    expect(weak.kind === 'matched' && weak.reasons).toEqual([
      'the names do not resemble each other',
    ]);
    const constant = {
      ...direct('tf2', 'f2'),
      mappingType: 'constant',
      sourceReferences: [],
    } as never;
    expect(mappingConfidence(p, constant)).toEqual({ kind: 'manual' });
    const withStep = { ...direct('tf2', 'f2'), transformations: [{ order: 1 }] } as never;
    expect(mappingConfidence(p, withStep)).toEqual({ kind: 'manual' });
  });
});

describe('hard-coded value suggestions (SPEC-036)', () => {
  const dateField = (displayName: string, over: object = {}): Record<string, unknown> => ({
    id: 'x',
    targetStructureId: 'st',
    displayName,
    datatype: 'date',
    required: false,
    isKey: false,
    ...over,
  });

  it('rules suggest the open end for an end date, and nothing for other fields', () => {
    expect(ruleValueSuggestion(dateField('Valid To') as never)).toMatchObject({
      value: '9999-12-31',
      origin: 'rules',
    });
    expect(ruleValueSuggestion(dateField('End Date') as never)).toMatchObject({
      value: '9999-12-31',
    });
    expect(ruleValueSuggestion(dateField('Valid From') as never)).toBeUndefined();
    expect(
      ruleValueSuggestion({ ...dateField('Valid To'), datatype: 'string' } as never),
    ).toBeUndefined();
  });

  it('the prompt holds the field and its siblings and no data', () => {
    const p = project();
    const prompt = buildValuePrompt(p, 'st-1', 'tf4', '2026-10-22')!;
    const user = JSON.parse(prompt.user) as {
      today: string;
      structure: string;
      field: { name: string };
      siblings: { name: string }[];
    };
    expect(user).toMatchObject({
      today: '2026-10-22',
      structure: 'Profit Center',
      field: { name: 'Planet' },
    });
    expect(user.siblings.map((x) => x.name)).toEqual([
      'Profit Center',
      'Country',
      'Person Responsible',
    ]);
    expect(prompt.system).toContain('You see no data values');
    expect(buildValuePrompt(p, 'st-1', 'nope', '2026-10-22')).toBeUndefined();
  });

  it('reads the answer, caps the confidence and rejects an empty value', () => {
    expect(
      parseValueResponse('{"value":"9999-12-31","confidence":99,"reason":"open end"}'),
    ).toEqual({
      ok: true,
      suggestion: { value: '9999-12-31', confidence: 0.95, reason: 'open end', origin: 'ai' },
    });
    expect(
      parseValueResponse('Sure:\n```json\n{"value":"2026-01-01","confidence":0.6}\n```').ok,
    ).toBe(true);
    expect(parseValueResponse('{"value":"","confidence":0}')).toMatchObject({ ok: false });
    expect(parseValueResponse('no idea')).toMatchObject({ ok: false });
  });
});
