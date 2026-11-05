import { describe, expect, it } from 'vitest';
import { serializeProject } from '@mms/mapping-core';
import { buildCatalog, buildKit, importAiResult, reportToText } from '../src/index.js';
import { setup, sourceField, targetField } from './helpers.js';

const AT = '2026-11-05T12:00:00.000Z';

describe('AI mapping kit', () => {
  it('has the prompt, the catalog in two forms, the example shape, the project file and a read-me', () => {
    const { project, data } = setup();
    const files = buildKit(project, data);
    expect(files.map((f) => f.name)).toEqual([
      'PROMPT.md',
      'README.md',
      'catalog.md',
      'catalog.json',
      'examples.json',
      'mapping.mms.json',
    ]);
    const prompt = files[0]!.content;
    for (const s of project.targetDefinition!.structures) expect(prompt).toContain(s.name);
    expect(prompt).toContain('11. Local-Time-Dependent f.Validtn');
    expect(files.find((f) => f.name === 'mapping.mms.json')!.content).toBe(
      serializeProject(project),
    );
  });

  it('lists every target and source field with its ID, and marks date fields as manual', () => {
    const { project, data } = setup();
    const c = buildCatalog(project, data);
    expect(c.structures).toHaveLength(11);
    const general = c.structures[0]!;
    expect(general.sheet).toBe('General');
    expect(general.fields).toHaveLength(14);
    const order = general.fields.find((f) => f.technicalName === 'FIXEDASSETORDERDATE')!;
    expect(order.manual).toBe('date');
    expect(general.fields.find((f) => f.technicalName === 'BUKRS')!.manual).toBeUndefined();
    expect(c.datasets[0]!.name).toBe('ANLA');
    expect(c.datasets[0]!.rows).toBe(4);
    const md = buildKit(project, data).find((f) => f.name === 'catalog.md')!.content;
    for (const s of c.structures) for (const f of s.fields) expect(md).toContain(f.id);
  });

  it('never includes a cell value, except the codes of code-like columns', () => {
    const { project, data } = setup();
    const all = buildKit(project, data)
      .map((f) => f.content)
      .join('\n');
    for (const secret of [
      'Secret Pump',
      'Secret Valve',
      '1000.00',
      '2500.50',
      '99.99',
      '000000200001',
      '20190101',
    ])
      expect(all).not.toContain(secret);
    const asset = buildCatalog(project, data).datasets[0]!.fields;
    expect(asset.find((f) => f.name === 'ASTAT')!.codeValues).toEqual([
      { value: 'A', count: 2 },
      { value: 'B', count: 2 },
    ]);
    expect(asset.find((f) => f.name === 'TXT50')!.codeValues).toBeUndefined(); // a name, all different
    expect(asset.find((f) => f.name === 'AMT')!.codeValues).toBeUndefined(); // amounts
    expect(asset.find((f) => f.name === 'ANLN1')!.codeValues).toBeUndefined(); // unique numbers
    expect(asset.find((f) => f.name === 'ANLN1')!.keyCandidate).toBe(true);
  });

  it('the example uses real IDs of the project', () => {
    const { project, data } = setup();
    const ex = JSON.parse(buildKit(project, data).find((f) => f.name === 'examples.json')!.content);
    const ids = JSON.stringify(project);
    expect(ids).toContain(ex.mappings[0].targetFieldId);
    expect(ids).toContain(ex.mappings[0].sourceReferences[0].fieldId);
  });
});

describe('importing what an AI answered', () => {
  const direct = (
    p: ReturnType<typeof setup>['project'],
    structure: string,
    field: string,
    source: string,
  ) => {
    const t = targetField(p, structure, field);
    const s = sourceField(p, source);
    return {
      targetStructureId: t.structureId,
      targetFieldId: t.fieldId,
      mappingType: 'direct',
      sourceReferences: [{ datasetId: s.datasetId, fieldId: s.fieldId }],
    };
  };

  it('adds valid direct mappings as "needs review", fills in id, status and transformations', () => {
    const { project } = setup();
    const answer = JSON.stringify({ mappings: [direct(project, 'General', 'ANLN1', 'ANLN1')] });
    const { project: next, report } = importAiResult(project, answer, AT);
    expect(report.imported).toEqual([
      expect.objectContaining({
        structure: 'General',
        source: 'ANLA.ANLN1',
        mappingType: 'direct',
      }),
    ]);
    expect(report.skipped).toEqual([]);
    const m = next.mappingDefinition.mappings[0]!;
    expect(m).toMatchObject({ status: 'needsReview', transformations: [], mappingType: 'direct' });
    expect(m.id).toBe(`m-${m.targetFieldId}`);
  });

  it('reads an answer with text around it and several code blocks, and drops explanations', () => {
    const { project } = setup();
    const a = {
      ...direct(project, 'General', 'ANLN1', 'ANLN1'),
      confidence: 'certain',
      reason: 'same key',
    };
    const b = direct(project, 'General', 'ANLN2', 'TXT50');
    const text = `Here is structure 1:\n\`\`\`json\n${JSON.stringify({ mappings: [a] })}\n\`\`\`\nand more:\n\`\`\`json\n${JSON.stringify({ mappings: [b] })}\n\`\`\`\nDone.`;
    const { report } = importAiResult(project, text, AT);
    expect(report.imported).toHaveLength(2);
    expect(report.skipped).toEqual([]);
  });

  it('skips, with a reason: constants, date fields, unknown IDs, two sources, duplicates and already mapped fields', () => {
    const { project } = setup();
    const good = direct(project, 'General', 'ANLN1', 'ANLN1');
    const date = direct(project, 'General', 'FIXEDASSETORDERDATE', 'AKTIV');
    const constant = {
      ...direct(project, 'General', 'ANLN2', 'ANLN1'),
      mappingType: 'constant',
      constant: { datatype: 'string', value: 'X' },
    };
    const unknownTarget = { ...good, targetFieldId: 'tf-nope' };
    const unknownSource = {
      ...direct(project, 'General', 'ANLKL', 'ANLN1'),
      sourceReferences: [{ datasetId: good.sourceReferences[0]!.datasetId, fieldId: 'f-nope' }],
    };
    const two = {
      ...direct(project, 'General', 'ANLKL', 'ANLN1'),
      sourceReferences: [
        good.sourceReferences[0],
        direct(project, 'General', 'ANLKL', 'TXT50').sourceReferences[0],
      ],
    };
    const first = importAiResult(project, JSON.stringify({ mappings: [good] }), AT).project;
    const { report } = importAiResult(
      first,
      JSON.stringify({
        mappings: [
          good,
          date,
          constant,
          unknownTarget,
          unknownSource,
          two,
          direct(first, 'General', 'ANLKL', 'TXT50'),
          direct(first, 'General', 'ANLKL', 'AMT'),
        ],
      }),
      AT,
    );
    expect(report.skipped.map((s) => s.code)).toEqual([
      'AI_ALREADY_MAPPED',
      'AI_DATE_MANUAL',
      'AI_TYPE_NOT_ALLOWED',
      'AI_UNKNOWN_TARGET',
      'AI_UNKNOWN_SOURCE',
      'AI_NEEDS_ONE_SOURCE',
      'AI_DUPLICATE_TARGET',
    ]);
    expect(report.imported.map((i) => i.field)).toEqual(['Asset Class']);
  });

  it('adds a lookup table and a lookup mapping that uses it; a lookup that is not defined is skipped', () => {
    const { project } = setup();
    const t = targetField(project, 'General', 'ANLKL');
    const s = sourceField(project, 'ASTAT');
    const lookupMapping = {
      targetStructureId: t.structureId,
      targetFieldId: t.fieldId,
      mappingType: 'lookup',
      sourceReferences: [s],
      lookup: { lookupId: 'lk-class' },
    };
    const ok1 = importAiResult(
      project,
      JSON.stringify({
        lookups: [
          {
            id: 'lk-class',
            name: 'Class',
            entries: [
              { key: 'A', value: '1000' },
              { key: 'B', value: '2000' },
            ],
          },
        ],
        mappings: [lookupMapping],
      }),
      AT,
    );
    expect(ok1.report.lookupsAdded).toEqual(['Class']);
    expect(ok1.report.imported[0]!.mappingType).toBe('lookup');
    expect(ok1.project.lookups.map((l) => l.id)).toEqual(['lk-class']);
    const missing = importAiResult(project, JSON.stringify({ mappings: [lookupMapping] }), AT);
    expect(missing.report.skipped[0]!.code).toBe('AI_UNKNOWN_LOOKUP');
  });

  it('reports an answer without JSON, and leaves the project as it was', () => {
    const { project } = setup();
    const { project: next, report } = importAiResult(
      project,
      'Sure, here is my plan in words.',
      AT,
    );
    expect(next).toBe(project);
    expect(report.parseError).toContain('No JSON');
    expect(reportToText(report)).toContain('could not be imported');
  });

  it('turns the skipped items into text to paste back, and lists fields still open (not dates)', () => {
    const { project } = setup();
    const bad = { ...direct(project, 'General', 'ANLN1', 'ANLN1'), mappingType: 'routine' };
    const { report } = importAiResult(project, JSON.stringify({ mappings: [bad] }), AT);
    const text = reportToText(report);
    expect(text).toContain('Imported 0 mapping(s).');
    expect(text).toContain('Item 1 (target');
    expect(text).toContain('Only "direct" and "lookup"');
    expect(text).toContain('General / Ext./Leg. Company Code');
    expect(text).not.toContain('Order Date'); // date fields are the user's
  });

  it('does not touch the input project', () => {
    const { project } = setup();
    const before = serializeProject(project);
    importAiResult(
      project,
      JSON.stringify({ mappings: [direct(project, 'General', 'ANLN1', 'ANLN1')] }),
      AT,
    );
    expect(serializeProject(project)).toBe(before);
  });
});
