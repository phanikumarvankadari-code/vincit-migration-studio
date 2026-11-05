import { describe, expect, it } from 'vitest';
import { serializeProject } from '@mms/mapping-core';
import { applyDescriptions, applyPairings } from '@mms/studio-model';
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

  it('lists every target field and the source fields that have data, by name and without IDs', () => {
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
    for (const s of c.structures)
      for (const f of s.fields) expect(md).toContain(f.technicalName ?? f.name);
    expect(md).not.toContain('tf-General-1'); // no IDs: the answer uses names
    expect(md).not.toContain('f-ANLA-1');
    expect(md).toContain('### ANLA');
    expect(md).toContain('| TXT50 |');
  });

  it('describes the wizard once: interview, table descriptions, pairing, fields, summary', () => {
    const { project, data } = setup();
    const prompt = buildKit(project, data)[0]!.content;
    for (const step of [
      'Step 0 - Interview',
      'Step 1 - What the source tables are',
      'Step 2 - Which table feeds which structure',
      'Step 3 - Fields, one structure at a time',
      'Step 4 - Summary',
    ])
      expect(prompt).toContain(step);
    expect(prompt).toContain('ANLA - 4 rows');
    expect(prompt).toContain('tableDescriptions');
    expect(prompt).toContain('pairings');
    expect(prompt).toContain('fieldDescriptions');
  });

  it('shows what is known: table and field descriptions, and the main table of a structure', () => {
    const { project, data } = setup();
    const t = targetField(project, 'General', 'ANLN1');
    const s = sourceField(project, 'TXT50');
    const withText = applyDescriptions(
      project,
      {
        tables: [{ datasetId: s.datasetId, description: 'Asset master record segment' }],
        fields: [{ datasetId: s.datasetId, fieldId: s.fieldId, description: 'Asset description' }],
      },
      AT,
    );
    const paired = applyPairings(
      withText,
      [{ structureId: t.structureId, driverDatasetId: s.datasetId, status: 'suggested' }],
      AT,
    );
    const md = buildKit(paired, data).find((f) => f.name === 'catalog.md')!.content;
    expect(md).toContain('### ANLA - Asset master record segment');
    expect(md).toContain('| Asset description |');
    expect(md).toContain('Main source table: ANLA (suggested, not confirmed)');
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
      '20171017',
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
    expect(asset.find((f) => f.name === 'ABGDT')!.codeValues).toBeUndefined(); // SAP dates stored as text
    expect(asset.find((f) => f.name === 'ANLN1')!.keyCandidate).toBe(true);
  });

  it('the examples use real names of the project', () => {
    const { project, data } = setup();
    const ex = JSON.parse(buildKit(project, data).find((f) => f.name === 'examples.json')!.content);
    expect(ex.step1_tableDescriptions.tableDescriptions[0].table).toBe('ANLA');
    expect(ex.step2_pairings.pairings[0].structure).toBe('General');
    expect(ex.step3_mappings.mappings[0]).toMatchObject({
      structure: 'General',
      table: 'ANLA',
      type: 'direct',
    });
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

describe('importing the steps of the wizard', () => {
  it('step 1: adds table descriptions, matching the table by name', () => {
    const { project } = setup();
    const { project: next, report } = importAiResult(
      project,
      JSON.stringify({
        tableDescriptions: [
          { table: 'anla', description: 'Asset master record segment' },
          { table: 'NOPE', description: 'x' },
          { table: 'ANLA', description: '' },
        ],
      }),
      AT,
    );
    expect(report.tableDescriptions).toBe(1);
    expect(report.skipped.map((s) => s.code)).toEqual(['AI_UNKNOWN_TABLE', 'AI_INVALID_ITEM']);
    expect(next.sourceDefinitions[0]!.datasets[0]!.description).toBe('Asset master record segment');
  });

  it('step 2: pairs structures with a main table and extras as "suggested"; skips unknown names', () => {
    const { project } = setup();
    const { project: next, report } = importAiResult(
      project,
      JSON.stringify({
        pairings: [
          {
            structure: 'General',
            mainTable: 'ANLA',
            extraTables: ['ANLA', 'T999'],
            confidence: 'certain',
            reason: 'master',
          },
          { structure: 'Origin', mainTable: 'ANLA' },
          { structure: 'Nope', mainTable: 'ANLA' },
          { structure: 'Inventory', mainTable: 'T999' },
          { structure: 'General', mainTable: 'ANLA' },
        ],
      }),
      AT,
    );
    expect(report.pairings).toEqual([
      { structure: 'General', mainTable: 'ANLA', extraTables: [] },
      { structure: 'Origin', mainTable: 'ANLA', extraTables: [] },
    ]);
    expect(report.skipped.map((s) => s.code)).toEqual([
      'AI_UNKNOWN_TABLE', // the extra table
      'AI_UNKNOWN_STRUCTURE',
      'AI_UNKNOWN_TABLE',
      'AI_DUPLICATE_TARGET',
    ]);
    const general = next.targetDefinition!.structures.find((s) => s.name === 'General')!;
    expect(general.generation).toMatchObject({ status: 'suggested' });
    expect(general.generation!.driverDatasetId).toBe(project.sourceDefinitions[0]!.datasets[0]!.id);
    expect(
      next.targetDefinition!.structures.find((s) => s.name === 'Inventory')!.generation,
    ).toBeUndefined();
  });

  it('step 3: adds field descriptions, flat or grouped by table, and reports unknown and ambiguous names', () => {
    const { project } = setup();
    const { project: next, report } = importAiResult(
      project,
      JSON.stringify({
        fieldDescriptions: [
          { table: 'ANLA', field: 'ANLN1', description: 'Main asset number' },
          {
            table: 'ANLA',
            fields: [
              { field: 'TXT50', description: 'Asset description' },
              { field: 'XXXX', description: 'x' },
            ],
          },
        ],
      }),
      AT,
    );
    expect(report.fieldDescriptions).toBe(2);
    expect(report.skipped.map((s) => s.code)).toEqual(['AI_UNKNOWN_SOURCE']);
    const fields = next.sourceDefinitions[0]!.datasets[0]!.fields;
    expect(fields.find((f) => f.displayName === 'ANLN1')!.description).toBe('Main asset number');
    expect(fields.find((f) => f.displayName === 'TXT50')!.description).toBe('Asset description');
  });

  it('step 3: mappings by names (structure, target, table, source), and a lookup by its name', () => {
    const { project } = setup();
    const { project: next, report } = importAiResult(
      project,
      JSON.stringify({
        lookups: [{ id: 'lk-class', name: 'Asset class', entries: [{ key: 'A', value: '1000' }] }],
        mappings: [
          {
            structure: 'General',
            target: 'ANLN1',
            table: 'ANLA',
            source: 'ANLN1',
            type: 'direct',
            confidence: 'certain',
          },
          {
            structure: 'General',
            target: 'Asset Class',
            table: 'ANLA',
            source: 'ASTAT',
            type: 'lookup',
            lookup: 'Asset class',
          },
          { structure: 'General', target: 'ANLN2', table: 'ANLA', source: 'NOPE', type: 'direct' },
          { structure: 'General', target: 'NOPE', table: 'ANLA', source: 'ANLN1', type: 'direct' },
          { structure: 'Nope', target: 'ANLN1', table: 'ANLA', source: 'ANLN1', type: 'direct' },
          { structure: 'General', target: 'ANLN2', table: 'T999', source: 'ANLN1', type: 'direct' },
        ],
      }),
      AT,
    );
    expect(report.imported.map((i) => [i.field, i.source, i.mappingType])).toEqual([
      ['Ext./Leg. Asset Number', 'ANLA.ANLN1', 'direct'],
      ['Asset Class', 'ANLA.ASTAT', 'lookup'],
    ]);
    expect(report.skipped.map((s) => s.code)).toEqual([
      'AI_UNKNOWN_SOURCE',
      'AI_UNKNOWN_TARGET',
      'AI_UNKNOWN_STRUCTURE',
      'AI_UNKNOWN_TABLE',
    ]);
    const m = next.mappingDefinition.mappings.find((x) => x.mappingType === 'lookup')!;
    expect(m).toMatchObject({ status: 'needsReview', lookup: { lookupId: 'lk-class' } });
  });

  it('takes several blocks of one conversation in any order: pairing, descriptions, mappings', () => {
    const { project } = setup();
    const block = (o: unknown) => `text\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\`\n`;
    const answer =
      block({
        mappings: [
          { structure: 'General', target: 'ANLN1', table: 'ANLA', source: 'ANLN1', type: 'direct' },
        ],
      }) +
      block({ pairings: [{ structure: 'General', mainTable: 'ANLA' }] }) +
      block({ tableDescriptions: [{ table: 'ANLA', description: 'Assets' }] });
    const { report } = importAiResult(project, answer, AT);
    expect(report.tableDescriptions).toBe(1);
    expect(report.pairings).toHaveLength(1);
    expect(report.imported).toHaveLength(1);
    expect(report.skipped).toEqual([]);
  });

  it('the report text names what was imported', () => {
    const { project } = setup();
    const { report } = importAiResult(
      project,
      JSON.stringify({
        tableDescriptions: [{ table: 'ANLA', description: 'Assets' }],
        pairings: [{ structure: 'General', mainTable: 'ANLA' }],
      }),
      AT,
    );
    expect(reportToText(report)).toContain(
      'Imported 1 table description(s), 1 pairing(s), 0 mapping(s).',
    );
  });
});
