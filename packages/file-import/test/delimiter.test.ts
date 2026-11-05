import { describe, expect, it } from 'vitest';
import type { Result } from '@mms/mapping-core';
import { datasetNameFromFile, detectDelimiter, importCsv } from '../src/index.js';

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

describe('CSV separator detection (SAP table dumps are tab separated)', () => {
  it.each([
    ['MANDT\tBUKRS\tANLN1\n100\t1010\t0001', '\t'],
    ['a;b;c\n1;2;3', ';'],
    ['a|b|c', '|'],
    ['a,b,c', ','],
    ['single', ','],
    ['﻿MANDT\tBUKRS', '\t'],
    ['"a,b"\tc\td', '\t'], // commas inside quotes do not count
  ])('%j uses %j', (text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });

  it('imports a tab-separated table with a BOM into its columns, keeping leading zeros', () => {
    const text =
      '﻿MANDT\tBUKRS\tANLN1\tTXT50\n100\t1010\t000000200000\tPump, large\n100\t1010\t000000200001\t\n';
    const s = ok(importCsv(text, { fileName: 'S4H_ANLA_20261105_153937.csv' }));
    expect(s.source.datasets[0]!.fields.map((f) => f.displayName)).toEqual([
      'MANDT',
      'BUKRS',
      'ANLN1',
      'TXT50',
    ]);
    expect(s.rows[0]!.rows).toEqual([
      ['100', '1010', '000000200000', 'Pump, large'],
      ['100', '1010', '000000200001', null],
    ]);
  });

  it('an explicit separator wins over detection', () => {
    const s = ok(importCsv('a,b\tc\n1,2\t3', { fileName: 'x.csv', delimiter: ',' }));
    expect(s.source.datasets[0]!.fields.map((f) => f.displayName)).toEqual(['a', 'b\tc']);
  });
});

describe('dataset name from a file name', () => {
  it.each([
    ['S4H_ANLA_20261105_153937.csv', 'ANLA'],
    ['ECC_T001_20260101.csv', 'T001'],
    ['S4H_BSEG_20261105_153937.csv', 'BSEG'],
    ['CEPC.csv', 'CEPC'],
    ['Assets.csv', 'Assets'],
    ['S4H.csv', 'S4H'],
    ['20261105.csv', '20261105'],
    ['orders_2026.csv', 'orders_2026'],
  ])('%s gives %s', (file, name) => {
    expect(datasetNameFromFile(file)).toBe(name);
    expect(ok(importCsv('a,b\n1,2', { fileName: file })).source.datasets[0]!.name).toBe(name);
  });
});
