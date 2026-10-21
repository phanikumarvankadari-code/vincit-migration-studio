import { describe, expect, it } from 'vitest';
import { call, code, val } from './helpers.js';

const parse = { format: 'M/D/YY', twoDigitYearPivot: 68 };

describe('date.parse (SPEC-014)', () => {
  it.each([
    ['1/1/26', '2026-01-01'],
    ['5/1/26', '2026-05-01'],
    ['12/31/99', '1999-12-31'],
    ['2/29/24', '2024-02-29'],
    ['12/31/68', '2068-12-31'],
    ['1/1/69', '1969-01-01'],
  ])('reads %s with the layout M/D/YY and pivot 68 as %s', (input, expected) => {
    expect(val(call('date.parse', parse, input))).toBe(expected);
  });

  it('the layout decides: 5/1/26 is 1 May with M/D/YY and 5 January with D/M/YY', () => {
    expect(val(call('date.parse', parse, '5/1/26'))).toBe('2026-05-01');
    expect(val(call('date.parse', { ...parse, format: 'D/M/YY' }, '5/1/26'))).toBe('2026-01-05');
  });

  it('century policy is explicit: the pivot moves the century boundary, and special values handle 12/31/99 as "never ends"', () => {
    expect(val(call('date.parse', { format: 'M/D/YY', twoDigitYearPivot: 99 }, '12/31/99'))).toBe(
      '2099-12-31',
    );
    expect(
      val(
        call('date.parse', { ...parse, specialValues: { '12/31/99': '9999-12-31' } }, '12/31/99'),
      ),
    ).toBe('9999-12-31');
    expect(
      val(call('date.parse', { ...parse, specialValues: { '12/31/99': '9999-12-31' } }, '1/1/26')),
    ).toBe('2026-01-01');
  });

  it('special values can also map an input to blank', () => {
    expect(
      val(
        call('date.parse', { format: 'YYYYMMDD', specialValues: { '00000000': null } }, '00000000'),
      ),
    ).toBeNull();
  });

  it.each([
    ['DD.MM.YYYY', '31.12.2026', '2026-12-31'],
    ['YYYYMMDD', '20261231', '2026-12-31'],
    ['YYYY-MM-DD', '2026-01-05', '2026-01-05'],
    ['D MMM YYYY', '5 Jan 2026', '2026-01-05'],
    ['MMM D, YYYY', 'dec 31, 2026', '2026-12-31'],
  ])('layout %s reads %s', (format, input, expected) => {
    expect(val(call('date.parse', { format, locale: 'en' }, input))).toBe(expected);
  });

  it('blank and null give null by default, or an error when a date is required', () => {
    for (const blank of [null, '']) {
      expect(val(call('date.parse', parse, blank))).toBeNull();
      expect(code(call('date.parse', { ...parse, onBlank: 'error' }, blank))).toBe('DATE_BLANK');
    }
  });

  it.each([
    ['13/45/26', 'DATE_INVALID'],
    ['2/30/26', 'DATE_INVALID'],
    ['2/29/25', 'DATE_INVALID'],
    ['0/1/26', 'DATE_INVALID'],
    ['1/0/26', 'DATE_INVALID'],
    ['1/1/2026', 'DATE_INVALID_FORMAT'],
    ['2026-01-01', 'DATE_INVALID_FORMAT'],
    [' 1/1/26', 'DATE_INVALID_FORMAT'],
    ['1/1/26 ', 'DATE_INVALID_FORMAT'],
    ['abc', 'DATE_INVALID_FORMAT'],
    ['00000000', 'DATE_INVALID_FORMAT'],
  ])('invalid date %j returns a structured error %s', (input, expected) => {
    const r = call('date.parse', parse, input);
    expect(code(r)).toBe(expected);
    if (!r.ok) expect(r.message).toContain(input.trim() === '' ? '' : input);
  });

  it('an unreadable month name is an error', () => {
    expect(code(call('date.parse', { format: 'D MMM YYYY', locale: 'en' }, '5 Foo 2026'))).toBe(
      'DATE_INVALID',
    );
  });

  it('year limits', () => {
    expect(val(call('date.parse', { format: 'YYYY-MM-DD' }, '9999-12-31'))).toBe('9999-12-31');
    expect(val(call('date.parse', { format: 'YYYY-MM-DD' }, '0001-01-01'))).toBe('0001-01-01');
    expect(code(call('date.parse', { format: 'YYYY-MM-DD' }, '0000-01-01'))).toBe('DATE_INVALID');
  });

  it.each<[Record<string, unknown>, string]>([
    [{}, 'format is required (no layout is guessed)'],
    [{ format: 'M/D/YY' }, 'a two-digit year needs a pivot'],
    [{ format: 'D MMM YYYY' }, 'month names need a locale'],
    [{ format: 'MD/YYYY', twoDigitYearPivot: 1 }, 'M and D side by side are ambiguous'],
    [{ format: 'MM/DD' }, 'no year'],
    [{ format: 'YYYY/YY/MM/DD' }, 'two years'],
    [{ format: 'YYYY', twoDigitYearPivot: 1 }, 'no month or day'],
    [{ format: 'MM/DD/YYYY', extra: 1 }, 'unknown setting'],
    [
      { format: 'MM/DD/YYYY', specialValues: { x: 'not a date' } },
      'special value must be an ISO date',
    ],
  ])('an unusable configuration %j is rejected (%s)', (config) => {
    expect(code(call('date.parse', config as never, '1/1/26'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('date.format', () => {
  it.each([
    ['YYYYMMDD', '2026-01-05', '20260105'],
    ['DD.MM.YYYY', '2026-01-05', '05.01.2026'],
    ['D.M.YY', '2026-01-05', '5.1.26'],
    ['YYYY-MM-DD', '9999-12-31', '9999-12-31'],
    ['M/D/YYYY', '2026-12-31', '12/31/2026'],
  ])('writes %s as %s', (format, input, expected) => {
    expect(val(call('date.format', { format }, input))).toBe(expected);
  });

  it('month names need a locale and are English', () => {
    expect(val(call('date.format', { format: 'D MMM YYYY', locale: 'en' }, '2026-03-07'))).toBe(
      '7 Mar 2026',
    );
    expect(code(call('date.format', { format: 'D MMM YYYY' }, '2026-03-07'))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
  });

  it('only ISO dates are accepted: parse first', () => {
    expect(code(call('date.format', { format: 'YYYYMMDD' }, '1/1/26'))).toBe('DATE_INVALID');
    expect(code(call('date.format', { format: 'YYYYMMDD' }, '2026-02-30'))).toBe('DATE_INVALID');
  });

  it('blank rules', () => {
    expect(val(call('date.format', { format: 'YYYYMMDD' }, null))).toBeNull();
    expect(val(call('date.format', { format: 'YYYYMMDD' }, ''))).toBeNull();
    expect(code(call('date.format', { format: 'YYYYMMDD', onBlank: 'error' }, null))).toBe(
      'DATE_BLANK',
    );
  });

  it('format is required', () => {
    expect(code(call('date.format', {}, '2026-01-01'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('date.default', () => {
  it('replaces only blanks', () => {
    const cfg = { value: '9999-12-31' };
    expect(val(call('date.default', cfg, null))).toBe('9999-12-31');
    expect(val(call('date.default', cfg, ''))).toBe('9999-12-31');
    expect(val(call('date.default', cfg, '2026-01-01'))).toBe('2026-01-01');
    expect(val(call('date.default', cfg, ' '))).toBe(' ');
  });
  it('the default must be a valid ISO date', () => {
    expect(code(call('date.default', { value: '31/12/2026' }, null))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
    expect(code(call('date.default', { value: '2026-02-30' }, null))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
    expect(code(call('date.default', {}, null))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('date.sapZeroToNull', () => {
  it.each(['00000000', '0000-00-00', '00.00.0000', '0/0/00', '0'])(
    'turns the empty date %j into null',
    (v) => {
      expect(val(call('date.sapZeroToNull', {}, v))).toBeNull();
    },
  );
  it.each(['20260101', '2026-01-01', '12/31/99', '00000001', 'abc', ' '])(
    'leaves %j alone',
    (v) => {
      expect(val(call('date.sapZeroToNull', {}, v))).toBe(v);
    },
  );
  it('blanks pass through unchanged', () => {
    expect(val(call('date.sapZeroToNull', {}, null))).toBeNull();
    expect(val(call('date.sapZeroToNull', {}, ''))).toBe('');
  });
});

describe('date.validate', () => {
  it('valid dates pass unchanged; invalid ones are errors', () => {
    expect(val(call('date.validate', {}, '2026-02-28'))).toBe('2026-02-28');
    expect(code(call('date.validate', {}, '2026-02-30'))).toBe('DATE_INVALID');
    expect(code(call('date.validate', {}, '1/1/26'))).toBe('DATE_INVALID');
  });
  it('min and max are inclusive', () => {
    const cfg = { min: '2026-01-01', max: '2026-12-31' };
    expect(val(call('date.validate', cfg, '2026-01-01'))).toBe('2026-01-01');
    expect(val(call('date.validate', cfg, '2026-12-31'))).toBe('2026-12-31');
    expect(code(call('date.validate', cfg, '2025-12-31'))).toBe('DATE_OUT_OF_RANGE');
    expect(code(call('date.validate', cfg, '2027-01-01'))).toBe('DATE_OUT_OF_RANGE');
  });
  it('blank rules', () => {
    expect(val(call('date.validate', {}, null))).toBeNull();
    expect(code(call('date.validate', { onBlank: 'error' }, ''))).toBe('DATE_BLANK');
  });
});

describe('a date chain, as in the PRD', () => {
  it('zero date to null, parse, format', () => {
    const run = (v: string | null) => {
      const a = call('date.sapZeroToNull', {}, v);
      if (!a.ok) return a;
      const b = call(
        'date.parse',
        { format: 'M/D/YY', twoDigitYearPivot: 68, specialValues: { '12/31/99': '9999-12-31' } },
        a.value,
      );
      if (!b.ok) return b;
      return call('date.format', { format: 'YYYYMMDD' }, b.value);
    };
    expect(val(run('1/1/26'))).toBe('20260101');
    expect(val(run('5/1/26'))).toBe('20260501');
    expect(val(run('12/31/99'))).toBe('99991231');
    expect(val(run('00000000'))).toBeNull();
    expect(val(run(null))).toBeNull();
    expect(val(run(''))).toBeNull();
    expect(code(run('13/45/26'))).toBe('DATE_INVALID');
  });
});
