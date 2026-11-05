import { importCsv } from '@mms/file-import';
import type { Project, SourceRows } from '@mms/mapping-core';
import { autoImportTarget } from '@mms/studio-model';
import {
  apply,
  at,
  fixedAssetTemplateFile,
  newState,
  ok,
} from '../../studio-model/test/helpers.js';

/** A small asset table with a name, a code, an amount, a date and a unique number. */
export const ASSETS = [
  'ANLN1\tTXT50\tASTAT\tAMT\tAKTIV\tABGDT',
  '000000200001\tSecret Pump Alpha\tA\t1000.00\t20190101\t00000000',
  '000000200002\tSecret Valve Beta\tA\t2500.50\t20190202\t00000000',
  '000000200003\tSecret Motor Gamma\tB\t99.99\t20190303\t20171017',
  '000000200004\tSecret Press Delta\tB\t12.34\t20190404\t20171017',
].join('\n');

export interface Setup {
  project: Project;
  data: Record<string, SourceRows>;
}

/** The asset table loaded as a source and the Fixed asset template (11 structures) as the target. */
export function setup(): Setup {
  const imported = ok(importCsv(ASSETS, { fileName: 'S4H_ANLA_20261105_153937.csv' }));
  const target = ok(autoImportTarget(fixedAssetTemplateFile(), 'Fixed asset')).target;
  const s = apply(
    newState(),
    { type: 'sourceAdded', imported, at: at() },
    { type: 'targetLoaded', target, at: at() },
  );
  return { project: s.project, data: s.data as Record<string, SourceRows> };
}

export const targetField = (p: Project, structure: string, name: string) => {
  const s = p.targetDefinition!.structures.find((x) => x.name === structure)!;
  const f = s.fields.find((x) => x.displayName === name || x.technicalName === name)!;
  return { structureId: s.id as string, fieldId: f.id as string };
};

export const sourceField = (p: Project, name: string) => {
  const d = p.sourceDefinitions[0]!.datasets[0]!;
  const f = d.fields.find((x) => x.displayName === name)!;
  return { datasetId: d.id as string, fieldId: f.id as string };
};
