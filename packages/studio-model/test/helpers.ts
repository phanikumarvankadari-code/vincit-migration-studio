import { readFileSync } from 'node:fs';
import { importCsv, importFieldDictionary, type ImportedSource } from '@mms/file-import';
import type { Result } from '@mms/mapping-core';
import { createStudioState, reduce, type StudioAction, type StudioState } from '../src/index.js';

export function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

const root = new URL('../../../test-data/profit-center/', import.meta.url);
export const fixtureText = (p: string): string => readFileSync(new URL(p, root), 'utf8');
export const fixtureBytes = (p: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(p, root)));

let n = 0;
export const at = (): string => `2026-10-21T12:00:${String(n++ % 60).padStart(2, '0')}.000Z`;

export const csv = (name: string, text: string): ImportedSource =>
  ok(importCsv(text, { fileName: `${name}.csv` }));
export const fixtureCsv = (file: string): ImportedSource =>
  ok(importCsv(fixtureText(`input/${file}`), { fileName: file }));
export const dictionary = () =>
  ok(importFieldDictionary(fixtureText('input/field_dictionary.csv')));
export const targetFile = () => ({
  name: 'data_pc.XLSX',
  content: fixtureBytes('target/data_pc.XLSX'),
});

export const templateFile = () => ({
  name: 'data_pc_template.xlsx',
  content: fixtureBytes('target/data_pc_template.xlsx'),
});

export const newState = (): StudioState =>
  createStudioState({
    id: 'p1',
    name: 'Profit Center migration',
    businessEntity: 'ProfitCenter',
    at: at(),
  });
export const apply = (s: StudioState, ...actions: StudioAction[]): StudioState =>
  actions.reduce(reduce, s);

/** Small two-dataset model: parents (CEPC) and children (BUKRS), joined on Profit Center. */
export const smallSources = (): { cepc: ImportedSource; bukrs: ImportedSource } => ({
  cepc: csv(
    'CEPC',
    ['Profit Center,Country,Valid From', 'P100,FI,1/1/26', 'P200,SE,5/1/26', 'P300,NO,1/1/26'].join(
      '\n',
    ),
  ),
  bukrs: csv(
    'CEPC_BUKRS',
    ['Profit Center,Company Code', 'P100,FI01', 'P100,FI02', 'P300,NO01'].join('\n'),
  ),
});

export const fixedAssetTemplateFile = () => ({
  name: 'fixed_asset_template.xml',
  content: fixtureBytes('../fixed-asset/target/fixed_asset_template.xml'),
});
