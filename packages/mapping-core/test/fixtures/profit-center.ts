/**
 * Model-only Profit Center reference fixture (SPEC-001 section 11).
 * Plain JSON-shaped data, no file reading. Parse it with parseProject.
 */
type Raw = Record<string, unknown>;

const field = (
  id: string,
  datasetId: string,
  displayName: string,
  technicalName: string,
  isKey = false,
): Raw => ({
  id,
  datasetId,
  displayName,
  technicalName,
  datatype: 'string',
  isKey,
});

const tfield = (
  id: string,
  structureId: string,
  displayName: string,
  datatype: string,
  extra: Raw = {},
): Raw => ({
  id,
  targetStructureId: structureId,
  displayName,
  datatype,
  required: false,
  isKey: false,
  ...extra,
});

const src = (id: string, name: string, dsId: string, fields: Raw[]): Raw => ({
  id,
  name,
  sourceType: 'csv',
  location: { kind: 'localFile', path: `test-data/profit-center/input/${name}.csv` },
  datasets: [{ id: dsId, sourceId: id, name, displayName: name, fields }],
});

const sref = (datasetId: string, fieldId: string): Raw => ({ datasetId, fieldId });

const mappingBase = (id: string, structureId: string, fieldId: string, refs: Raw[]): Raw => ({
  id,
  targetStructureId: structureId,
  targetFieldId: fieldId,
  sourceReferences: refs,
  transformations: [],
  status: 'mapped',
});

const step = (routineId: string, order: number): Raw => ({
  kind: 'routine',
  routineId,
  version: '1',
  configuration: {},
  order,
  onError: 'stop',
});

export function profitCenterRaw(): Raw {
  const t = '2026-10-21T10:00:00.000Z';
  return {
    id: 'p1',
    name: 'Profit Center migration',
    businessEntity: 'ProfitCenter',
    projectState: 'draft',
    createdAt: t,
    updatedAt: t,
    sourceDefinitions: [
      src('src-cepc', 'CEPC', 'ds-cepc', [
        field('f-cepc-prctr', 'ds-cepc', 'Profit Center', 'PRCTR', true),
        field('f-cepc-kokrs', 'ds-cepc', 'Controlling Area', 'KOKRS', true),
        field('f-cepc-datab', 'ds-cepc', 'Valid From', 'DATAB'),
        field('f-cepc-land1', 'ds-cepc', 'Country Key', 'LAND1'),
      ]),
      src('src-cepct', 'CEPCT', 'ds-cepct', [
        field('f-cepct-prctr', 'ds-cepct', 'Profit Center', 'PRCTR', true),
        field('f-cepct-kokrs', 'ds-cepct', 'Controlling Area', 'KOKRS', true),
        field('f-cepct-ktext', 'ds-cepct', 'Name', 'KTEXT'),
      ]),
      src('src-bukrs', 'CEPC_BUKRS', 'ds-bukrs', [
        field('f-bukrs-prctr', 'ds-bukrs', 'Profit Center', 'PRCTR', true),
        field('f-bukrs-kokrs', 'ds-bukrs', 'Controlling Area', 'KOKRS', true),
        field('f-bukrs-bukrs', 'ds-bukrs', 'Company Code', 'BUKRS', true),
      ]),
    ],
    targetDefinition: {
      id: 'td1',
      name: 'Profit Center target',
      structures: [
        {
          id: 'ts-pc',
          targetDefinitionId: 'td1',
          name: 'ProfitCenter',
          displayName: 'Profit Center',
          fields: [
            tfield('tf-pc-prctr', 'ts-pc', 'Profit Center', 'string', {
              required: true,
              isKey: true,
              length: 10,
            }),
            tfield('tf-pc-validfrom', 'ts-pc', 'Valid From', 'date', { required: true }),
            tfield('tf-pc-name', 'ts-pc', 'Profit Center Name', 'string', { length: 20 }),
            tfield('tf-pc-lang', 'ts-pc', 'Language', 'string'),
          ],
        },
        {
          id: 'ts-cc',
          targetDefinitionId: 'td1',
          name: 'CompanyCodes',
          displayName: 'Company Codes',
          fields: [
            tfield('tf-cc-prctr', 'ts-cc', 'Profit Center', 'string', {
              required: true,
              isKey: true,
            }),
            tfield('tf-cc-bukrs', 'ts-cc', 'Company Code', 'string', {
              required: true,
              isKey: true,
            }),
          ],
          generation: { driverDatasetId: 'ds-bukrs', viaRelationshipIds: ['rel-cepc-bukrs'] },
          parent: {
            parentStructureId: 'ts-pc',
            keys: [{ childFieldId: 'tf-cc-prctr', parentFieldId: 'tf-pc-prctr' }],
          },
        },
        {
          id: 'ts-tr',
          targetDefinitionId: 'td1',
          name: 'Translation',
          displayName: 'Translation',
          fields: [
            tfield('tf-tr-prctr', 'ts-tr', 'Profit Center', 'string', {
              required: true,
              isKey: true,
            }),
            tfield('tf-tr-name', 'ts-tr', 'Profit Center Name', 'string'),
          ],
          generation: { driverDatasetId: 'ds-cepct' },
        },
      ],
    },
    routines: [
      { id: 'r-zero-date', name: 'Zero Date to Null', scope: 'builtIn', version: '1' },
      { id: 'r-parse-date', name: 'Parse Date', scope: 'builtIn', version: '1' },
      { id: 'r-format-date', name: 'Format Date', scope: 'builtIn', version: '1' },
    ],
    lookups: [
      {
        id: 'lk-company',
        name: 'Controlling Area to Company Code',
        keyDatatype: 'string',
        valueDatatype: 'string',
        entries: [{ key: '1000', value: 'FI01' }],
      },
    ],
    mappingDefinition: {
      id: 'md1',
      relationships: [
        {
          id: 'rel-cepc-cepct',
          leftDatasetId: 'ds-cepc',
          rightDatasetId: 'ds-cepct',
          keys: [
            { leftFieldId: 'f-cepc-prctr', rightFieldId: 'f-cepct-prctr' },
            { leftFieldId: 'f-cepc-kokrs', rightFieldId: 'f-cepct-kokrs' },
          ],
          cardinality: 'oneToMany',
          joinType: 'left',
          status: 'confirmed',
        },
        {
          id: 'rel-cepc-bukrs',
          leftDatasetId: 'ds-cepc',
          rightDatasetId: 'ds-bukrs',
          keys: [{ leftFieldId: 'f-cepc-prctr', rightFieldId: 'f-bukrs-prctr' }],
          cardinality: 'oneToMany',
          joinType: 'inner',
          status: 'suggested',
        },
      ],
      routineReferences: [
        { routineId: 'r-zero-date', version: '1' },
        { routineId: 'r-parse-date', version: '1' },
        { routineId: 'r-format-date', version: '1' },
      ],
      lookupReferences: [{ lookupId: 'lk-company' }],
      validationRules: [
        {
          id: 'vr-1',
          scope: { kind: 'targetField', targetFieldId: 'tf-pc-prctr' },
          ruleType: 'required',
          configuration: {},
          severity: 'error',
        },
      ],
      mappings: [
        {
          ...mappingBase('m-prctr', 'ts-pc', 'tf-pc-prctr', [sref('ds-cepc', 'f-cepc-prctr')]),
          mappingType: 'direct',
        },
        {
          ...mappingBase('m-lang', 'ts-pc', 'tf-pc-lang', []),
          mappingType: 'constant',
          constant: { datatype: 'string', value: 'EN' },
        },
        {
          ...mappingBase('m-validfrom', 'ts-pc', 'tf-pc-validfrom', [
            sref('ds-cepc', 'f-cepc-datab'),
          ]),
          mappingType: 'routine',
          transformations: [
            step('r-zero-date', 0),
            step('r-parse-date', 1),
            step('r-format-date', 2),
          ],
        },
        {
          ...mappingBase('m-company', 'ts-cc', 'tf-cc-bukrs', [sref('ds-bukrs', 'f-bukrs-kokrs')]),
          mappingType: 'lookup',
          lookup: {
            lookupId: 'lk-company',
            configuration: {},
            missingValue: { kind: 'error' },
          },
        },
        {
          ...mappingBase('m-name', 'ts-pc', 'tf-pc-name', [
            sref('ds-cepc', 'f-cepc-land1'),
            sref('ds-cepct', 'f-cepct-ktext'),
          ]),
          mappingType: 'conditional',
          conditional: {
            rules: [
              {
                when: {
                  op: 'compare',
                  operator: 'eq',
                  left: { kind: 'field', datasetId: 'ds-cepc', fieldId: 'f-cepc-land1' },
                  right: { kind: 'constant', constant: { datatype: 'string', value: 'FI' } },
                },
                then: { kind: 'field', datasetId: 'ds-cepct', fieldId: 'f-cepct-ktext' },
              },
            ],
            otherwise: { kind: 'constant', constant: { datatype: 'string', value: 'DEFAULT' } },
          },
        },
        {
          ...mappingBase('m-tr-name', 'ts-tr', 'tf-tr-name', [sref('ds-cepct', 'f-cepct-ktext')]),
          mappingType: 'javascript',
          javascript: { code: 'return value.trim();', declaredLookupIds: [] },
        },
      ],
    },
  };
}
