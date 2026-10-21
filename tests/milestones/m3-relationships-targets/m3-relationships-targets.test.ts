import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeCompleteness,
  deserializeProject,
  parseProject,
  serializeProject,
  validateProject,
  type Project,
  type Result,
} from '@mms/mapping-core';
import {
  applyFieldDictionary,
  importCsv,
  importFieldDictionary,
  importXlsx,
} from '@mms/file-import';
import { confirmRelationship, suggestRelationships } from '@mms/relationships';
import { detectTargetLayout, parseTargetStructures } from '@mms/target-parser';

const base = new URL('../../../test-data/profit-center/', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, base), 'utf8');
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

/**
 * M3 demo check: joins are suggested and confirmed (composite keys); data_pc.XLSX loads through the
 * layout step into three structures; both fit into one valid Project.
 */
describe('M3 relationships and targets', () => {
  const dictionary = ok(importFieldDictionary(text('input/field_dictionary.csv'))).dictionary;
  const sources = ['CEPC.csv', 'CEPCT.csv', 'CEPC_BUKRS.csv'].map((file) => {
    const imported = ok(importCsv(text(`input/${file}`), { fileName: file }));
    const source = applyFieldDictionary(imported.source, dictionary).source;
    return { source, data: { dataset: source.datasets[0]!, rows: imported.rows[0]! } };
  });
  const suggestions = suggestRelationships(sources.map((s) => s.data));
  const workbook = ok(
    importXlsx(new Uint8Array(readFileSync(new URL('target/data_pc.XLSX', base))), {
      fileName: 'data_pc.XLSX',
      headerRow: 4,
    }),
  );
  const layout = ok(detectTargetLayout(workbook)).layout;
  const target = ok(parseTargetStructures(workbook, layout, { name: 'Profit Center' })).target;

  const project = (): Project =>
    ok(
      parseProject({
        id: 'p1',
        name: 'Profit Center migration',
        businessEntity: 'ProfitCenter',
        projectState: 'draft',
        createdAt: '2026-10-21T12:00:00.000Z',
        updatedAt: '2026-10-21T12:00:00.000Z',
        sourceDefinitions: sources.map((s) => s.source),
        targetDefinition: target,
        routines: [],
        lookups: [],
        mappingDefinition: {
          id: 'md1',
          mappings: [],
          relationships: suggestions.map((s) => confirmRelationship(s.relationship)),
          routineReferences: [],
          lookupReferences: [],
          validationRules: [],
        },
      }),
    );

  it('M3-01 joins are suggested on composite keys and need confirmation', () => {
    expect(suggestions.map((s) => s.relationship.id)).toEqual([
      'rel-CEPC-CEPCT',
      'rel-CEPC-CEPC_BUKRS',
      'rel-CEPCT-CEPC_BUKRS',
    ]);
    expect(suggestions.every((s) => s.relationship.status === 'suggested')).toBe(true);
    expect(suggestions[0]!.relationship.keys.length).toBeGreaterThanOrEqual(2);
    expect(confirmRelationship(suggestions[0]!.relationship).status).toBe('confirmed');
  });

  it('M3-02 data problems in the sample are reported, not hidden', () => {
    const codes = suggestions.flatMap((s) => s.diagnostics.map((d) => d.code));
    expect(codes).toContain('RELATIONSHIP_NO_MATCHING_VALUES');
    expect(codes).toContain('RELATIONSHIP_BLANK_KEYS');
  });

  it('M3-03 data_pc.XLSX loads through layout detection into three structures', () => {
    expect(layout.mode).toBe('sectionRows');
    expect(target.structures.map((s) => s.name)).toEqual([
      'Profit Center',
      'Company Codes',
      'Translation',
    ]);
  });

  it('M3-04 required fields, keys and technical metadata are preserved', () => {
    const pc = target.structures[0]!;
    expect(pc.fields.filter((f) => f.required)).toHaveLength(7);
    expect(pc.fields.filter((f) => f.isKey).map((f) => f.technicalName)).toEqual([
      'PROFITCENTERFOREDIT',
      'VALIDITYENDDATEFOREDIT',
    ]);
    expect(pc.technicalName).toBe('S_I_PROFITCENTERTP_2');
  });

  it('M3-05 sources, relationships and targets fit into one valid project that round-trips through JSON', () => {
    const p = project();
    expect(validateProject(p)).toEqual([]);
    const back = deserializeProject(serializeProject(p));
    expect(back.ok && back.value).toEqual(p);
  });

  it('M3-06 mapping completeness is calculated independently per structure', () => {
    const p = project();
    const c = computeCompleteness(p.targetDefinition!, p.mappingDefinition);
    expect(c.map((x) => [x.totalFields, x.requiredFields, x.mappedFields, x.ready])).toEqual([
      [31, 7, 0, false],
      [3, 3, 0, false],
      [5, 3, 0, false],
    ]);
  });
});
