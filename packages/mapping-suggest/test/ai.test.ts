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
      suggestion: { value: '9999-12-31', confidence: 0.85, reason: 'open end', origin: 'ai' },
    });
    expect(
      parseValueResponse('Sure:\n```json\n{"value":"2026-01-01","confidence":0.6}\n```').ok,
    ).toBe(true);
    expect(parseValueResponse('{"value":"","confidence":0}')).toMatchObject({ ok: false });
    expect(parseValueResponse('no idea')).toMatchObject({ ok: false });
  });
});

import {
  buildStructureAiPrompt,
  coverageOf,
  mergeStructureSuggestions,
  parseStructureAiResponse,
  suggestStructurePairs,
} from '../src/index.js';

describe('structure pairing (SPEC-037)', () => {
  /** Two source datasets, two target structures whose names resemble nothing in the source. */
  function twoByTwo(): Project {
    const p = project();
    const sd = p.sourceDefinitions[0]!;
    const orders = {
      id: 'ds-2',
      sourceId: 'src-1',
      name: 'ZORD',
      displayName: 'ZORD',
      fields: [
        {
          id: 'o1',
          datasetId: 'ds-2',
          displayName: 'Order Number',
          datatype: 'string' as const,
          length: 10,
          isKey: true,
        },
        { id: 'o2', datasetId: 'ds-2', displayName: 'Order Date', datatype: 'date' as const },
        {
          id: 'o3',
          datasetId: 'ds-2',
          displayName: 'Profit Center',
          datatype: 'string' as const,
          length: 10,
        },
      ],
    };
    sd.datasets.push(orders as never);
    p.targetDefinition!.structures.push({
      id: 'st-2',
      targetDefinitionId: 'tgt-1',
      name: 'Sales Documents',
      displayName: 'Sales Documents',
      fields: [
        {
          id: 'sf1',
          targetStructureId: 'st-2',
          displayName: 'Order Number',
          datatype: 'string',
          required: true,
          isKey: true,
        },
        {
          id: 'sf2',
          targetStructureId: 'st-2',
          displayName: 'Order Date',
          datatype: 'date',
          required: true,
          isKey: false,
        },
        {
          id: 'sf3',
          targetStructureId: 'st-2',
          displayName: 'Profit Center',
          datatype: 'string',
          required: false,
          isKey: false,
        },
      ],
    } as never);
    return p;
  }

  it('pairs by the fields, whatever the names of the structures and datasets are', () => {
    const p = twoByTwo();
    const pairs = suggestStructurePairs(p);
    const by = Object.fromEntries(pairs.map((x) => [x.targetStructureId, x]));
    expect(by['st-1']).toMatchObject({ driverDatasetId: 'ds-1', origin: 'rules' });
    expect(by['st-2']).toMatchObject({ driverDatasetId: 'ds-2' });
    expect(by['st-2']!.coverage).toMatchObject({
      total: 3,
      matched: 3,
      requiredMatched: 2,
      keysMatched: 1,
    });
    expect(by['st-2']!.reasons[0]).toContain('ZORD has a matching field for 3 of 3 target fields');
    // the other dataset covers one of the three fields and none of the required ones: too weak to be offered
    expect(by['st-2']!.alternatives).toEqual([]);
  });

  it('a dataset that does not fit gives no suggestion; a structure can be asked for alone; one dataset may drive several', () => {
    const p = twoByTwo();
    p.targetDefinition!.structures.push({
      id: 'st-3',
      targetDefinitionId: 'tgt-1',
      name: 'Weather',
      displayName: 'Weather',
      fields: [
        {
          id: 'w1',
          targetStructureId: 'st-3',
          displayName: 'Rainfall',
          datatype: 'decimal',
          required: false,
          isKey: false,
        },
      ],
    } as never);
    expect(suggestStructurePairs(p).find((x) => x.targetStructureId === 'st-3')).toBeUndefined();
    expect(suggestStructurePairs(p, { structureId: 'st-2' })).toHaveLength(1);
    // both structures read Profit Center: ds-1 is the driver of st-1 only because it covers more of it
    expect(
      coverageOf(p.targetDefinition!.structures[0]!, p.sourceDefinitions[0]!.datasets[0]!).coverage
        .matched,
    ).toBeGreaterThan(1);
  });

  it('a joined dataset that fills fields the driver cannot is offered as a helper', () => {
    const p = twoByTwo();
    p.targetDefinition!.structures[1]!.fields.push({
      id: 'sf4',
      targetStructureId: 'st-2',
      displayName: 'Country',
      datatype: 'string',
      required: false,
      isKey: false,
    } as never);
    p.mappingDefinition.relationships.push({
      id: 'rel-1',
      leftDatasetId: 'ds-2',
      rightDatasetId: 'ds-1',
      keys: [{ leftFieldId: 'o3', rightFieldId: 'f1' }],
      cardinality: 'manyToOne',
      joinType: 'left',
      status: 'confirmed',
    } as never);
    const pair = suggestStructurePairs(p).find((x) => x.targetStructureId === 'st-2')!;
    expect(pair.driverDatasetId).toBe('ds-2');
    expect(pair.helperDatasetIds).toEqual(['ds-1']);
    expect(pair.reasons.join(' ')).toContain('CEPC adds Country through a join');
    // a rejected join is not a way to get the field
    p.mappingDefinition.relationships[0]!.status = 'rejected';
    expect(
      suggestStructurePairs(p).find((x) => x.targetStructureId === 'st-2')!.helperDatasetIds,
    ).toEqual([]);
  });

  it('the AI prompt holds names and fields only, and the answer is read and merged', () => {
    const p = twoByTwo();
    const rules = suggestStructurePairs(p);
    const prompt = buildStructureAiPrompt(p, rules)!;
    const user = JSON.parse(prompt.user) as {
      targets: { id: string; name: string }[];
      datasets: { id: string; name: string }[];
    };
    expect(user.targets.map((t) => t.name)).toEqual(['Profit Center', 'Sales Documents']);
    expect(user.datasets.map((d) => d.name)).toEqual(['CEPC', 'ZORD']);
    expect(prompt.system).toContain('You see no data values');
    const answer =
      '{"pairs":[{"target":"t1","driver":"d1","helpers":[],"confidence":90,"reason":"master data"},{"target":"t2","driver":"d1","confidence":99,"reason":"guess"},{"target":"t9","driver":"d1","confidence":50}]}';
    const parsed = parseStructureAiResponse(answer, prompt);
    expect(parsed.items.map((i) => [i.targetStructureId, i.driverDatasetId])).toEqual([
      ['st-1', 'ds-1'],
      ['st-2', 'ds-1'],
    ]);
    expect(parsed.problems).toHaveLength(1);
    const merged = mergeStructureSuggestions(rules, parsed.items, p);
    const st1 = merged.find((m) => m.targetStructureId === 'st-1')!;
    expect(st1).toMatchObject({ origin: 'both', driverDatasetId: 'ds-1' });
    expect(st1.score).toBeGreaterThan(rules.find((r) => r.targetStructureId === 'st-1')!.score);
    const st2 = merged.find((m) => m.targetStructureId === 'st-2')!;
    expect(st2).toMatchObject({ origin: 'ai', driverDatasetId: 'ds-1', score: 0.95 });
    expect(st2.conflict).toMatchObject({ driverDatasetId: 'ds-2', origin: 'rules' });
    expect(parseStructureAiResponse('nonsense', prompt).problems).toEqual([
      'The answer was not the expected JSON.',
    ]);
  });

  it('scoped field suggestions look in the pair first and only widen on request', () => {
    const p = twoByTwo();
    const only = suggestMappings(p, { structureId: 'st-2', datasetIds: ['ds-2'] });
    expect(only.every((s) => s.datasetId === 'ds-2')).toBe(true);
    const wide = suggestMappings(p, {
      structureId: 'st-2',
      datasetIds: ['ds-1'],
      includeOthers: true,
    });
    const pc = wide.find((s) => s.targetFieldId === 'sf3')!; // Profit Center exists in both datasets
    expect(pc.datasetId).toBe('ds-1');
    const out = wide.find((s) => s.targetFieldId === 'sf1')!; // Order Number only in ds-2, outside the scope
    expect(out.datasetId).toBe('ds-2');
    expect(out.reasons.join(' ')).toContain('another structure');
    expect(out.score).toBeLessThan(
      suggestMappings(p, { structureId: 'st-2' }).find((s) => s.targetFieldId === 'sf1')!.score,
    );
    const prompts = buildAiPrompts(p, { structureId: 'st-2', datasetIds: ['ds-2'] });
    expect([...prompts[0]!.sources.values()].every((s) => s.datasetId === 'ds-2')).toBe(true);
  });

  it('ids the model repeats in a reason become names', () => {
    const prompt = buildStructureAiPrompt(twoByTwo())!;
    const t = [...prompt.targets.keys()][0]!;
    const d = [...prompt.datasets.keys()][0]!;
    const out = parseStructureAiResponse(
      JSON.stringify({
        pairs: [{ target: t, driver: d, confidence: 80, reason: `${d} fits ${t}` }],
      }),
      prompt,
    );
    expect(out.items[0]!.reason).toBe(`${prompt.names!.get(d)} fits ${prompt.names!.get(t)}`);
  });
});
