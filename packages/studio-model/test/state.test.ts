import { describe, expect, it } from 'vitest';
import {
  parseProject,
  validateProject,
  serializeProject,
  deserializeProject,
  targetDateFormat,
} from '@mms/mapping-core';
import { autoImportTarget, pruneDangling } from '../src/index.js';
import {
  apply,
  at,
  dictionary,
  fixtureCsv,
  newState,
  ok,
  smallSources,
  targetFile,
} from './helpers.js';

describe('studio state: sources', () => {
  it('a new project is empty and valid', () => {
    const s = newState();
    expect(s.project).toMatchObject({
      name: 'Profit Center migration',
      businessEntity: 'ProfitCenter',
      projectState: 'draft',
      sourceDefinitions: [],
      routines: [],
      lookups: [],
    });
    expect(parseProject(JSON.parse(JSON.stringify(s.project))).ok).toBe(true);
    expect(s.runStale).toBe(false);
  });

  it('adding sources keeps rows apart from the project and records import diagnostics', () => {
    const { cepc, bukrs } = smallSources();
    const s = apply(
      newState(),
      { type: 'sourceAdded', imported: cepc, at: at() },
      { type: 'sourceAdded', imported: bukrs, at: at() },
    );
    expect(s.project.sourceDefinitions.map((x) => x.name)).toEqual(['CEPC.csv', 'CEPC_BUKRS.csv']);
    expect(Object.keys(s.data)).toEqual(['ds-CEPC', 'ds-CEPC_BUKRS']);
    expect(JSON.stringify(s.project)).not.toContain('P100');
    expect(s.importDiagnostics['src-CEPC']).toEqual([]);
  });

  it('suggests a join between the sources and keeps it as suggested until a person decides', () => {
    const { cepc, bukrs } = smallSources();
    const s = apply(
      newState(),
      { type: 'sourceAdded', imported: cepc, at: at() },
      { type: 'sourceAdded', imported: bukrs, at: at() },
    );
    const rels = s.project.mappingDefinition.relationships;
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({
      id: 'rel-CEPC-CEPC_BUKRS',
      status: 'suggested',
      cardinality: 'oneToMany',
    });
    expect(s.suggestionNotes['rel-CEPC-CEPC_BUKRS']!.evidence.length).toBeGreaterThan(0);
  });

  it('a decided relationship is never overwritten when sources change', () => {
    const { cepc, bukrs } = smallSources();
    let s = apply(
      newState(),
      { type: 'sourceAdded', imported: cepc, at: at() },
      { type: 'sourceAdded', imported: bukrs, at: at() },
    );
    s = apply(s, {
      type: 'relationshipDecided',
      relationshipId: 'rel-CEPC-CEPC_BUKRS',
      status: 'confirmed',
      at: at(),
    });
    s = apply(s, { type: 'sourceAdded', imported: smallSources().cepc, at: at() });
    expect(s.project.mappingDefinition.relationships).toMatchObject([
      { id: 'rel-CEPC-CEPC_BUKRS', status: 'confirmed' },
    ]);
  });

  it('the join type of a relationship can be changed and is kept', () => {
    const { cepc, bukrs } = smallSources();
    let s = apply(
      newState(),
      { type: 'sourceAdded', imported: cepc, at: at() },
      { type: 'sourceAdded', imported: bukrs, at: at() },
    );
    s = apply(s, {
      type: 'relationshipJoinType',
      relationshipId: 'rel-CEPC-CEPC_BUKRS',
      joinType: 'inner',
      at: at(),
    });
    expect(s.project.mappingDefinition.relationships[0]!.joinType).toBe('inner');
  });

  it('applies the result of a pure project edit and marks the run out of date', () => {
    const { cepc } = smallSources();
    let s = apply(newState(), { type: 'sourceAdded', imported: cepc, at: at() });
    s = { ...s, lastRun: {} as never };
    s = apply(s, { type: 'projectEdited', project: { ...s.project, name: 'Edited' } });
    expect(s.project.name).toBe('Edited');
    expect(s.runStale).toBe(true);
  });

  it('re-adding a source replaces it and its rows', () => {
    const { cepc } = smallSources();
    let s = apply(newState(), { type: 'sourceAdded', imported: cepc, at: at() });
    const changed = { ...cepc, rows: [{ ...cepc.rows[0]!, rows: [['P999', 'FI', '1/1/26']] }] };
    s = apply(s, { type: 'sourceAdded', imported: changed, at: at() });
    expect(s.project.sourceDefinitions).toHaveLength(1);
    expect(s.data['ds-CEPC']!.rows).toEqual([['P999', 'FI', '1/1/26']]);
  });

  it('removing a source removes its rows, relationships and mappings that depended on it', () => {
    const { cepc, bukrs } = smallSources();
    let s = apply(
      newState(),
      { type: 'sourceAdded', imported: cepc, at: at() },
      { type: 'sourceAdded', imported: bukrs, at: at() },
    );
    s = apply(s, { type: 'sourceRemoved', sourceId: 'src-CEPC_BUKRS', at: at() });
    expect(Object.keys(s.data)).toEqual(['ds-CEPC']);
    expect(s.project.mappingDefinition.relationships).toEqual([]);
    expect(s.importDiagnostics['src-CEPC_BUKRS']).toBeUndefined();
    expect(apply(s, { type: 'sourceRemoved', sourceId: 'nope', at: at() })).toBe(s);
  });

  it('a field dictionary enriches existing and later sources, and refreshes suggestions', () => {
    const dict = dictionary();
    let s = apply(newState(), { type: 'sourceAdded', imported: fixtureCsv('CEPC.csv'), at: at() });
    expect(s.project.sourceDefinitions[0]!.datasets[0]!.fields[1]!.technicalName).toBeUndefined();
    s = apply(s, {
      type: 'dictionaryLoaded',
      dictionary: dict.dictionary,
      diagnostics: dict.diagnostics,
      at: at(),
    });
    expect(s.project.sourceDefinitions[0]!.datasets[0]!.fields[1]).toMatchObject({
      technicalName: 'PRCTR',
      isKey: true,
    });
    s = apply(s, { type: 'sourceAdded', imported: fixtureCsv('CEPCT.csv'), at: at() });
    expect(s.project.sourceDefinitions[1]!.datasets[0]!.fields[2]).toMatchObject({
      technicalName: 'PRCTR',
    });
    const rel = s.project.mappingDefinition.relationships[0]!;
    expect(rel.status).toBe('suggested');
    expect(rel.keys.length).toBeGreaterThanOrEqual(2); // technical names now allow composite keys
    expect(
      s.importDiagnostics['dictionary']!.some((d) => d.code === 'DICT_PSEUDO_FIELD_SKIPPED'),
    ).toBe(true);
  });

  it('changes mark an existing test run as out of date', () => {
    const { cepc } = smallSources();
    let s = apply(newState(), { type: 'sourceAdded', imported: cepc, at: at() });
    s = { ...s, lastRun: {} as never };
    s = apply(s, { type: 'projectRenamed', name: 'X', businessEntity: 'Y', at: at() });
    expect(s.runStale).toBe(true);
    expect(s.project).toMatchObject({ name: 'X', businessEntity: 'Y' });
  });
});

describe('studio state: target and structure settings', () => {
  const withTarget = () => {
    const { cepc, bukrs } = smallSources();
    const preview = ok(autoImportTarget(targetFile(), 'Profit Center'));
    return apply(
      newState(),
      { type: 'sourceAdded', imported: cepc, at: at() },
      { type: 'sourceAdded', imported: bukrs, at: at() },
      { type: 'targetLoaded', target: preview.target, at: at() },
    );
  };

  it('loads the target workbook automatically: header row 4, three structures', () => {
    const preview = ok(autoImportTarget(targetFile(), 'Profit Center'));
    expect(preview.headerRow).toBe(4);
    expect(preview.layout.mode).toBe('sectionRows');
    expect(preview.target.structures.map((x) => x.name)).toEqual([
      'Profit Center',
      'Company Codes',
      'Translation',
    ]);
  });

  it('structure settings set and clear the driver dataset and the parent link', () => {
    let s = withTarget();
    const cc = s.project.targetDefinition!.structures[1]!;
    s = apply(s, {
      type: 'structureSettings',
      structureId: cc.id,
      generation: { driverDatasetId: 'ds-CEPC_BUKRS' as never },
      parent: {
        parentStructureId: s.project.targetDefinition!.structures[0]!.id,
        keys: [
          {
            childFieldId: cc.fields[0]!.id,
            parentFieldId: s.project.targetDefinition!.structures[0]!.fields[0]!.id,
          },
        ],
      },
      at: at(),
    });
    expect(s.project.targetDefinition!.structures[1]!.generation).toEqual({
      driverDatasetId: 'ds-CEPC_BUKRS',
    });
    expect(s.project.targetDefinition!.structures[1]!.parent!.keys).toHaveLength(1);
    expect(validateProject(s.project)).toEqual([]);
    s = apply(s, {
      type: 'structureSettings',
      structureId: cc.id,
      generation: null,
      parent: null,
      at: at(),
    });
    expect(s.project.targetDefinition!.structures[1]).not.toHaveProperty('generation');
    expect(s.project.targetDefinition!.structures[1]).not.toHaveProperty('parent');
  });

  it('reloading the target keeps structure settings and the mappings for fields that still exist', () => {
    let s = withTarget();
    const [pc, cc] = s.project.targetDefinition!.structures;
    s = apply(s, {
      type: 'structureSettings',
      structureId: cc!.id,
      generation: { driverDatasetId: 'ds-CEPC_BUKRS' as never },
      parent: null,
      at: at(),
    });
    s = apply(s, {
      type: 'mappingSaved',
      mapping: {
        id: 'm-1' as never,
        targetStructureId: pc!.id,
        targetFieldId: pc!.fields[0]!.id,
        mappingType: 'constant',
        constant: { datatype: 'string', value: 'X' },
        sourceReferences: [],
        transformations: [],
        status: 'mapped',
      },
      at: at(),
    });
    const again = ok(autoImportTarget(targetFile(), 'Profit Center')).target;
    s = apply(s, { type: 'targetLoaded', target: again, at: at() });
    expect(s.project.targetDefinition!.structures[1]!.generation).toEqual({
      driverDatasetId: 'ds-CEPC_BUKRS',
    });
    expect(s.project.mappingDefinition.mappings).toHaveLength(1);
  });

  it('a target with fewer fields drops mappings of fields that are gone', () => {
    let s = withTarget();
    const [pc] = s.project.targetDefinition!.structures;
    s = apply(s, {
      type: 'mappingSaved',
      mapping: {
        id: 'm-1' as never,
        targetStructureId: pc!.id,
        targetFieldId: pc!.fields[0]!.id,
        mappingType: 'constant',
        constant: { datatype: 'string', value: 'X' },
        sourceReferences: [],
        transformations: [],
        status: 'mapped',
      },
      at: at(),
    });
    const smaller = {
      ...s.project.targetDefinition!,
      structures: [{ ...pc!, fields: pc!.fields.slice(1) }],
    };
    s = apply(s, { type: 'targetLoaded', target: smaller, at: at() });
    expect(s.project.mappingDefinition.mappings).toEqual([]);
  });

  it('the project always passes the model checks and survives a save and load', () => {
    const s = withTarget();
    expect(validateProject(s.project)).toEqual([]);
    const back = deserializeProject(serializeProject(s.project));
    expect(back.ok && back.value).toEqual(s.project);
    expect(pruneDangling(s.project)).toEqual(s.project);
  });

  it('a target date format is kept per field and per structure, survives a target reload, and can be removed', () => {
    let s = withTarget();
    const [pc] = s.project.targetDefinition!.structures;
    const f = pc!.fields[0]!;
    s = apply(s, {
      type: 'structureSettings',
      structureId: pc!.id,
      generation: null,
      parent: null,
      dateFormat: 'yyyy-MM-dd',
      at: at(),
    });
    s = apply(s, {
      type: 'targetFieldFormat',
      structureId: pc!.id,
      fieldId: f.id,
      dateFormat: 'dd.MM.yyyy',
      at: at(),
    });
    const read = () => s.project.targetDefinition!.structures[0]!;
    expect(read().dateFormat).toBe('yyyy-MM-dd');
    expect(targetDateFormat(read(), read().fields[0]!)).toBe('dd.MM.yyyy');
    expect(targetDateFormat(read(), read().fields[1]!)).toBe('yyyy-MM-dd');
    expect(validateProject(s.project)).toEqual([]);

    const again = ok(autoImportTarget(targetFile(), 'Profit Center')).target;
    s = apply(s, { type: 'targetLoaded', target: again, at: at() });
    expect(read().dateFormat).toBe('yyyy-MM-dd');
    expect(read().fields[0]!.dateFormat).toBe('dd.MM.yyyy');

    s = apply(s, {
      type: 'targetFieldFormat',
      structureId: pc!.id,
      fieldId: f.id,
      dateFormat: null,
      at: at(),
    });
    s = apply(s, {
      type: 'structureSettings',
      structureId: pc!.id,
      generation: null,
      parent: null,
      dateFormat: null,
      at: at(),
    });
    expect(read()).not.toHaveProperty('dateFormat');
    expect(read().fields[0]).not.toHaveProperty('dateFormat');
  });

  it('structure settings saved without a date format leave the format alone', () => {
    let s = withTarget();
    const pc = s.project.targetDefinition!.structures[0]!;
    s = apply(s, {
      type: 'structureSettings',
      structureId: pc.id,
      generation: null,
      parent: null,
      dateFormat: 'yyyyMMdd',
      at: at(),
    });
    s = apply(s, {
      type: 'structureSettings',
      structureId: pc.id,
      generation: null,
      parent: null,
      at: at(),
    });
    expect(s.project.targetDefinition!.structures[0]!.dateFormat).toBe('yyyyMMdd');
  });
});
