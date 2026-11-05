import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importXlsx } from '@mms/file-import';
import type { Result } from '@mms/mapping-core';
import { fillTemplate } from '../src/index.js';

const template = new Uint8Array(
  readFileSync(
    new URL('../../../test-data/profit-center/target/data_pc_template.xlsx', import.meta.url),
  ),
);
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const pc = {
  sheet: 'Profit Center',
  keys: ['PROFITCENTERFOREDIT', 'VALIDITYENDDATEFOREDIT', 'VALIDITYSTARTDATE', 'SEGMENT'],
  rows: [
    ['00330', '9999-12-31', '2026-01-01', 'SEG01'],
    ['P2', null, '2026-05-01', null],
  ],
};

describe('fillTemplate', () => {
  it('writes rows from row 9 under the right columns', () => {
    const out = ok(fillTemplate(template, [pc]));
    const book = ok(
      importXlsx(out.bytes, { fileName: 't.xlsx', sheets: ['Profit Center'], headerRow: 8 }),
    );
    const rows = book.rows[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.slice(0, 3)).toEqual(['00330', '9999-12-31', '2026-01-01']);
    expect(rows[0]![9]).toBe('SEG01');
    expect(rows[1]!.slice(0, 3)).toEqual(['P2', null, '2026-05-01']);
    expect(out.notes).toEqual([]);
  });

  it('leaves the other sheets and the header rows unchanged', () => {
    const out = ok(fillTemplate(template, [pc]));
    const a = unzipSync(template);
    const b = unzipSync(out.bytes);
    for (const name of Object.keys(a))
      if (name !== 'xl/worksheets/sheet3.xml') expect(b[name]).toEqual(a[name]);
    const xml = strFromU8(b['xl/worksheets/sheet3.xml']!);
    const old = strFromU8(a['xl/worksheets/sheet3.xml']!);
    for (let r = 1; r <= 8; r++) {
      const take = (s: string) => new RegExp(`<row r="${r}"[\\s\\S]*?</row>`).exec(s)?.[0];
      expect(take(xml)).toEqual(take(old));
    }
    expect(xml).toContain('<c r="A9" t="inlineStr">');
    expect(xml).toContain('>00330<');
    expect(xml).toContain('<c r="B9" t="inlineStr"><is><t xml:space="preserve">9999-12-31<');
    expect(xml).toContain('<c r="J9"'); // SEGMENT is column J
    expect(xml).not.toContain('<c r="B10"'); // blank stays an empty cell
    expect(xml).toMatch(/<dimension ref="A1:[A-Z]+10"\/>/);
  });

  it('replaces rows that are already there, and reports a field with no column', () => {
    const once = ok(fillTemplate(template, [pc]));
    const twice = ok(
      fillTemplate(once.bytes, [
        { ...pc, keys: [...pc.keys, 'NOT_A_FIELD'], rows: [['X', null, null, null, 'v']] },
      ]),
    );
    const xml = strFromU8(unzipSync(twice.bytes)['xl/worksheets/sheet3.xml']!);
    expect(xml).not.toContain('>00330<');
    expect(xml).toContain('>X<');
    expect(xml).not.toContain('<row r="10"');
    expect(twice.notes[0]).toContain('"NOT_A_FIELD"');
  });

  it('fails clearly for a missing sheet or a file that is not a workbook', () => {
    const a = fillTemplate(template, [{ ...pc, sheet: 'Nope' }]);
    expect(!a.ok && a.issues[0]!.code).toBe('TEMPLATE_SHEET_NOT_FOUND');
    const b = fillTemplate(new Uint8Array([1, 2, 3]), [pc]);
    expect(!b.ok && b.issues[0]!.code).toBe('TEMPLATE_INVALID_FILE');
  });
});
