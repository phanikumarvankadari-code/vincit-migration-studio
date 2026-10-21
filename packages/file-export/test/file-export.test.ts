import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importCsv, importXlsx } from '@mms/file-import';
import type { Result, SourceValue } from '@mms/mapping-core';
import { sheetName, toCsv, toXlsx, toZip, utf8Bytes } from '../src/index.js';

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

const header = ['Id', 'Name', 'Note'];
const tricky: SourceValue[][] = [
  ['00330', ' padded ', 'a,b'],
  ['2', null, 'say "hi"'],
  ['3', '', 'line1\nline2'],
  ['4', 'Ünï 日本 😀', null],
  ['', 'x', '=1+1'],
];

describe('CSV writer', () => {
  it('writes RFC 4180 text with CRLF by default', () => {
    expect(toCsv({ header: ['a', 'b'], rows: [['1', '2']] })).toBe('a,b\r\n1,2\r\n');
    expect(toCsv({ header: ['a'], rows: [['1']] }, { lineEnding: '\n' })).toBe('a\n1\n');
  });

  it('quotes only when needed: delimiter, quote, line break', () => {
    expect(
      toCsv(
        { header: ['a', 'b', 'c', 'd'], rows: [['x,y', 'say "hi"', 'l1\nl2', 'plain']] },
        { lineEnding: '\n' },
      ),
    ).toBe('a,b,c,d\n"x,y","say ""hi""","l1\nl2",plain\n');
  });

  it('keeps blank (null) and empty string apart, and does not trim or convert', () => {
    expect(
      toCsv(
        { header: ['a', 'b', 'c', 'd'], rows: [[null, '', ' x ', '00123']] },
        { lineEnding: '\n' },
      ),
    ).toBe('a,b,c,d\n,"", x ,00123\n');
  });

  it('supports another delimiter, a BOM, and an empty table', () => {
    expect(
      toCsv({ header: ['a', 'b'], rows: [['1;1', '2']] }, { delimiter: ';', lineEnding: '\n' }),
    ).toBe('a;b\n"1;1";2\n');
    expect(toCsv({ header: ['a'], rows: [] }, { bom: true, lineEnding: '\n' })).toBe('﻿a\n');
    expect(toCsv({ header: [], rows: [] }, { lineEnding: '\n' })).toBe('\n');
  });

  it('round-trips through the CSV importer exactly', () => {
    const text = toCsv({ header, rows: tricky });
    const r = ok(importCsv(text, { fileName: 'x.csv' }));
    expect(r.source.datasets[0]!.fields.map((f) => f.displayName)).toEqual(header);
    expect(r.rows[0]!.rows).toEqual(tricky);
    expect(r.diagnostics).toEqual([]);
  });

  it('is repeatable', () => {
    expect(toCsv({ header, rows: tricky })).toBe(toCsv({ header, rows: tricky }));
  });
});

describe('XLSX writer', () => {
  it('writes a workbook the importer reads back exactly, with one dataset per sheet', () => {
    const out = ok(
      toXlsx([
        { name: 'Profit Center', header, rows: tricky },
        {
          name: 'Company Codes',
          header: ['PC', 'CC'],
          rows: [
            ['P100', 'FI01'],
            ['P100', 'FI02'],
          ],
        },
      ]),
    );
    expect(out.sheetNames).toEqual(['Profit Center', 'Company Codes']);
    expect(out.notes).toEqual([]);
    const back = ok(importXlsx(out.bytes, { fileName: 'out.xlsx' }));
    expect(back.source.datasets.map((d) => d.name)).toEqual(['Profit Center', 'Company Codes']);
    expect(back.rows[0]!.rows).toEqual(tricky);
    expect(back.rows[1]!.rows).toEqual([
      ['P100', 'FI01'],
      ['P100', 'FI02'],
    ]);
    expect(back.source.datasets[0]!.fields.map((f) => f.displayName)).toEqual(header);
    expect(back.diagnostics).toEqual([]);
  });

  it('keeps leading zeros, long digit strings and date text as text', () => {
    const rows: SourceValue[][] = [['00330', '12345678901234567890', '12/31/99', '1E5']];
    const back = ok(
      importXlsx(ok(toXlsx([{ name: 'S', header: ['a', 'b', 'c', 'd'], rows }])).bytes, {
        fileName: 'x.xlsx',
      }),
    );
    expect(back.rows[0]!.rows).toEqual(rows);
  });

  it('is a valid package: required parts exist and the header is bold', () => {
    const files = unzipSync(ok(toXlsx([{ name: 'S', header: ['a'], rows: [['1']] }])).bytes);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(strFromU8(files['xl/worksheets/sheet1.xml']!)).toContain(
      '<c r="A1" s="1" t="inlineStr">',
    );
    expect(strFromU8(files['xl/styles.xml']!)).toContain('<b/>');
  });

  it('cleans sheet names and says so', () => {
    const out = ok(
      toXlsx([
        {
          name: 'Profit/Center: [all] with a very long name over thirty one characters',
          header: ['a'],
          rows: [],
        },
        { name: 'A:B', header: ['a'], rows: [] },
        { name: 'A_B', header: ['a'], rows: [] },
        { name: '', header: ['a'], rows: [] },
      ]),
    );
    expect(out.sheetNames[0]).toBe('Profit_Center_ _all_ with a ver');
    expect(out.sheetNames[0]!.length).toBeLessThanOrEqual(31);
    expect(out.sheetNames.slice(1)).toEqual(['A_B', 'A_B (2)', 'Sheet']);
    expect(out.notes).toEqual([
      'Sheet name "Profit/Center: [all] with a very long name over thirty one characters" was changed to "Profit_Center_ _all_ with a ver".',
      'Sheet name "A:B" was changed to "A_B".',
      'Sheet name "A_B" was changed to "A_B (2)".',
      'Sheet name "" was changed to "Sheet".',
    ]);
    expect(sheetName('Data', new Set(['data']))).toBe('Data (2)');
    expect(sheetName("'quoted'", new Set())).toBe('quoted');
  });

  it('escapes XML and replaces characters XLSX cannot store, with a note', () => {
    const out = ok(
      toXlsx([{ name: 'S', header: ['a&b', 'c'], rows: [['<x> & y', 'bad\u0001char']] }]),
    );
    expect(out.notes).toEqual([
      'Control characters that XLSX cannot store were replaced with U+FFFD.',
    ]);
    const back = ok(importXlsx(out.bytes, { fileName: 'x.xlsx' }));
    expect(back.source.datasets[0]!.fields[0]!.displayName).toBe('a&b');
    expect(back.rows[0]!.rows).toEqual([['<x> & y', 'bad�char']]);
  });

  it('refuses what a worksheet cannot hold, and an empty workbook', () => {
    const tooMany = toXlsx([{ name: 'S', header: ['a'], rows: { length: 1_048_576 } as never }]);
    expect(!tooMany.ok && tooMany.issues[0]!.code).toBe('XLSX_TOO_MANY_ROWS');
    expect(!toXlsx([]).ok).toBe(true);
    const wide = toXlsx([
      { name: 'S', header: Array.from({ length: 16_385 }, (_, i) => `c${i}`), rows: [] },
    ]);
    expect(!wide.ok && wide.issues[0]!.code).toBe('XLSX_TOO_MANY_COLUMNS');
  });

  it('writes many rows quickly and correctly', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => [String(i), `name ${i}`]);
    const back = ok(
      importXlsx(ok(toXlsx([{ name: 'S', header: ['id', 'name'], rows }])).bytes, {
        fileName: 'x.xlsx',
      }),
    );
    expect(back.rows[0]!.rows).toHaveLength(20_000);
    expect(back.rows[0]!.rows[19_999]).toEqual(['19999', 'name 19999']);
  });
});

describe('ZIP', () => {
  it('bundles text and binary files', () => {
    const zip = toZip([
      { name: 'a.csv', data: 'x,y\r\n1,2\r\n' },
      { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) },
    ]);
    const files = unzipSync(zip);
    expect(strFromU8(files['a.csv']!)).toBe('x,y\r\n1,2\r\n');
    expect([...files['dir/b.bin']!]).toEqual([1, 2, 3]);
    expect([...utf8Bytes('é')]).toEqual([0xc3, 0xa9]);
  });
});

describe('file-export boundaries', () => {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
  it('imports only fflate, mapping-core and relative modules; no Node, DOM, clock or randomness', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        expect(
          ['fflate', '@mms/mapping-core'].includes(m[1]!) || m[1]!.startsWith('./'),
          `${f}: ${m[1]}`,
        ).toBe(true);
      }
      expect(text, f).not.toMatch(
        /node:|\bprocess\.|\bBuffer\b|\bdocument\.|\bwindow\.|Math\.random|Date\.now|new Date|\beval\(|new Function/,
      );
    }
  });
});
