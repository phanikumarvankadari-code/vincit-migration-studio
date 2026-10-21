import { describe, expect, it } from 'vitest';
import { call, code, val } from './helpers.js';

describe('numeric.parse', () => {
  const eu = { decimalSeparator: ',', thousandsSeparator: '.' };
  const us = { decimalSeparator: '.', thousandsSeparator: ',' };
  it.each([
    [eu, '1.234,50', '1234.50'],
    [eu, '1234,5', '1234.5'],
    [eu, '12', '12'],
    [eu, '1.234.567', '1234567'],
    [us, '1,234.5', '1234.5'],
    [us, '0.5', '0.5'],
    [{ decimalSeparator: '.' }, '1234.50', '1234.50'],
    [{ decimalSeparator: ',', thousandsSeparator: ' ' }, '1 234,5', '1234.5'],
    [{ decimalSeparator: ',', thousandsSeparator: ' ' }, '1 234,5', '1234.5'],
    [{ decimalSeparator: '.', thousandsSeparator: "'" }, "1'234.5", '1234.5'],
    [us, '-1,234.5', '-1234.5'],
    [us, '+5', '5'],
    [us, '0012', '12'],
    [us, '0', '0'],
    [{ ...us, trailingMinus: true }, '100-', '-100'],
    [{ ...eu, trailingMinus: true }, '1.234,50-', '-1234.50'],
    [{ ...us, trailingMinus: true }, '100', '100'],
  ])('reads %j %j as %j', (cfg, input, expected) => {
    expect(val(call('numeric.parse', cfg, input))).toBe(expected);
  });

  it('negative zero is written as plain zero', () => {
    expect(
      val(call('numeric.parse', { decimalSeparator: '.', trailingMinus: true }, '0.00-')),
    ).toBe('0.00');
  });

  it.each([
    '',
    'abc',
    '1,2,3',
    '1..2',
    '12.',
    '.5',
    '1e5',
    '1 000',
    '--5',
    '5-',
    '1,23.4',
    '1,2345.6',
  ])('rejects %j with the US layout', (input) => {
    const r = call('numeric.parse', { decimalSeparator: '.', thousandsSeparator: ',' }, input);
    if (input === '') expect(val(r)).toBeNull();
    else expect(code(r)).toBe('NUMBER_INVALID');
  });

  it('a minus on both ends is an error', () => {
    expect(code(call('numeric.parse', { decimalSeparator: '.', trailingMinus: true }, '-5-'))).toBe(
      'NUMBER_INVALID',
    );
  });

  it('blank rules', () => {
    expect(val(call('numeric.parse', { decimalSeparator: '.' }, null))).toBeNull();
    expect(code(call('numeric.parse', { decimalSeparator: '.', onBlank: 'error' }, ''))).toBe(
      'NUMBER_BLANK',
    );
  });

  it('the layout must be stated and consistent', () => {
    expect(code(call('numeric.parse', {}, '1'))).toBe('ROUTINE_CONFIG_INVALID');
    expect(
      code(call('numeric.parse', { decimalSeparator: '.', thousandsSeparator: '.' }, '1')),
    ).toBe('ROUTINE_CONFIG_INVALID');
    expect(code(call('numeric.parse', { decimalSeparator: ';' }, '1'))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
  });

  it('keeps full precision on very large numbers', () => {
    expect(
      val(
        call(
          'numeric.parse',
          { decimalSeparator: '.' },
          '123456789012345678901234567890.123456789',
        ),
      ),
    ).toBe('123456789012345678901234567890.123456789');
  });
});

describe('numeric.round', () => {
  const r = (decimals: number, rounding: string | undefined, v: string) =>
    val(call('numeric.round', rounding ? { decimals, rounding } : { decimals }, v));
  it('halfUp (default) rounds ties away from zero', () => {
    expect(r(0, undefined, '2.5')).toBe('3');
    expect(r(0, undefined, '-2.5')).toBe('-3');
    expect(r(0, undefined, '2.4')).toBe('2');
    expect(r(1, undefined, '0.25')).toBe('0.3');
    expect(r(2, undefined, '1.005')).toBe('1.01'); // exact decimal, unlike binary floating point
  });
  it('halfEven rounds ties to the even digit', () => {
    expect(r(0, 'halfEven', '2.5')).toBe('2');
    expect(r(0, 'halfEven', '3.5')).toBe('4');
    expect(r(0, 'halfEven', '-2.5')).toBe('-2');
    expect(r(0, 'halfEven', '2.51')).toBe('3');
  });
  it('down cuts toward zero and up rounds away from zero', () => {
    expect(r(0, 'down', '2.9')).toBe('2');
    expect(r(0, 'down', '-2.9')).toBe('-2');
    expect(r(0, 'up', '2.1')).toBe('3');
    expect(r(0, 'up', '-2.1')).toBe('-3');
    expect(r(1, 'up', '2.10')).toBe('2.1');
  });
  it('pads with zeros and never gives negative zero', () => {
    expect(r(2, undefined, '1')).toBe('1.00');
    expect(r(3, undefined, '1.5')).toBe('1.500');
    expect(r(2, undefined, '-0.001')).toBe('0.00');
    expect(r(0, undefined, '-0.4')).toBe('0');
  });
  it('invalid input and blanks', () => {
    expect(code(call('numeric.round', { decimals: 2 }, '1,5'))).toBe('NUMBER_INVALID');
    expect(code(call('numeric.round', { decimals: 2 }, 'abc'))).toBe('NUMBER_INVALID');
    expect(val(call('numeric.round', { decimals: 2 }, null))).toBeNull();
    expect(code(call('numeric.round', { decimals: 2, onBlank: 'error' }, ''))).toBe('NUMBER_BLANK');
    expect(code(call('numeric.round', {}, '1'))).toBe('ROUTINE_CONFIG_INVALID');
    expect(code(call('numeric.round', { decimals: -1 }, '1'))).toBe('ROUTINE_CONFIG_INVALID');
    expect(code(call('numeric.round', { decimals: 2, rounding: 'sideways' }, '1'))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
  });
});

describe('numeric.format', () => {
  it('writes separators and decimals', () => {
    expect(
      val(call('numeric.format', { decimals: 2, thousandsSeparator: ',' }, '1234567.891')),
    ).toBe('1,234,567.89');
    expect(
      val(
        call(
          'numeric.format',
          { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.' },
          '1234567.891',
        ),
      ),
    ).toBe('1.234.567,89');
    expect(val(call('numeric.format', { thousandsSeparator: ' ' }, '1234567'))).toBe('1 234 567');
    expect(val(call('numeric.format', {}, '12.50'))).toBe('12.50');
    expect(val(call('numeric.format', { decimals: 0 }, '12.5'))).toBe('13');
  });
  it('small and zero values', () => {
    expect(val(call('numeric.format', { thousandsSeparator: ',' }, '999'))).toBe('999');
    expect(val(call('numeric.format', { thousandsSeparator: ',' }, '1000'))).toBe('1,000');
    expect(val(call('numeric.format', { decimals: 2 }, '0'))).toBe('0.00');
    expect(val(call('numeric.format', { decimals: 2 }, '0.005'))).toBe('0.01');
  });
  it('negative numbers, with an optional trailing minus; no negative zero', () => {
    expect(val(call('numeric.format', { decimals: 1 }, '-1234.56'))).toBe('-1234.6');
    expect(val(call('numeric.format', { trailingMinus: true, decimals: 2 }, '-100'))).toBe(
      '100.00-',
    );
    expect(val(call('numeric.format', { trailingMinus: true, decimals: 2 }, '100'))).toBe('100.00');
    expect(val(call('numeric.format', { decimals: 1 }, '-0.04'))).toBe('0.0');
  });
  it('rounding mode is configurable', () => {
    expect(val(call('numeric.format', { decimals: 0, rounding: 'halfEven' }, '2.5'))).toBe('2');
  });
  it('input must be plain decimal text; blanks follow onBlank; separators must differ', () => {
    expect(code(call('numeric.format', {}, '1.234,5'))).toBe('NUMBER_INVALID');
    expect(val(call('numeric.format', {}, null))).toBeNull();
    expect(code(call('numeric.format', { onBlank: 'error' }, null))).toBe('NUMBER_BLANK');
    expect(
      code(call('numeric.format', { decimalSeparator: ',', thousandsSeparator: ',' }, '1')),
    ).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('numeric.multiply', () => {
  it('multiplies exactly by a fixed number', () => {
    expect(val(call('numeric.multiply', { value: '3' }, '19.99'))).toBe('59.97');
    expect(val(call('numeric.multiply', { value: '0.1' }, '3'))).toBe('0.3');
    expect(val(call('numeric.multiply', { value: '1.5' }, '-2'))).toBe('-3.0');
    expect(val(call('numeric.multiply', { value: '0' }, '5'))).toBe('0');
  });
  it('precision: scales add up and nothing is lost on large numbers', () => {
    expect(val(call('numeric.multiply', { value: '0.01' }, '0.01'))).toBe('0.0001');
    expect(val(call('numeric.multiply', { value: '2' }, '123456789012345678901234567890.5'))).toBe(
      '246913578024691357802469135781.0',
    );
  });
  it('decimals rounds the result', () => {
    expect(val(call('numeric.multiply', { value: '0.333', decimals: 2 }, '10'))).toBe('3.33');
    expect(
      val(call('numeric.multiply', { value: '0.5', decimals: 0, rounding: 'halfEven' }, '5')),
    ).toBe('2');
  });
  it('can multiply by another source value (position in the mapping)', () => {
    expect(val(call('numeric.multiply', { fromInput: 1 }, '4', ['4', '2.5']))).toBe('10.0');
  });
  it('a blank factor field follows onBlank; a bad one is an error', () => {
    expect(val(call('numeric.multiply', { fromInput: 1 }, '4', ['4', null]))).toBeNull();
    expect(code(call('numeric.multiply', { fromInput: 1, onBlank: 'error' }, '4', ['4', '']))).toBe(
      'NUMBER_INVALID',
    );
    expect(code(call('numeric.multiply', { fromInput: 1 }, '4', ['4', 'x']))).toBe(
      'NUMBER_INVALID',
    );
    expect(code(call('numeric.multiply', { fromInput: 5 }, '4', ['4']))).toBe('NUMBER_INVALID');
  });
  it('input checks and configuration', () => {
    expect(code(call('numeric.multiply', { value: '2' }, 'x'))).toBe('NUMBER_INVALID');
    expect(val(call('numeric.multiply', { value: '2' }, null))).toBeNull();
    expect(code(call('numeric.multiply', {}, '1'))).toBe('ROUTINE_CONFIG_INVALID');
    expect(code(call('numeric.multiply', { value: '2', fromInput: 1 }, '1'))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
    expect(code(call('numeric.multiply', { value: '1,5' }, '1'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('numeric.divide', () => {
  const d = (cfg: Record<string, string | number>, v: string, inputs?: (string | null)[]) =>
    call('numeric.divide', cfg, v, inputs);
  it('divides to a chosen number of decimals', () => {
    expect(val(d({ value: '3', decimals: 4 }, '1'))).toBe('0.3333');
    expect(val(d({ value: '3', decimals: 4 }, '2'))).toBe('0.6667');
    expect(val(d({ value: '4', decimals: 2 }, '10'))).toBe('2.50');
    expect(val(d({ value: '2', decimals: 0 }, '9'))).toBe('5');
    expect(val(d({ value: '0.5', decimals: 1 }, '3'))).toBe('6.0');
    expect(val(d({ value: '-4', decimals: 1 }, '10'))).toBe('-2.5');
    expect(val(d({ value: '4', decimals: 1 }, '-10'))).toBe('-2.5');
    expect(val(d({ value: '-4', decimals: 1 }, '-10'))).toBe('2.5');
  });
  it('rounding mode applies', () => {
    expect(val(d({ value: '4', decimals: 0 }, '10'))).toBe('3');
    expect(val(d({ value: '4', decimals: 0, rounding: 'halfEven' }, '10'))).toBe('2');
    expect(val(d({ value: '3', decimals: 0, rounding: 'down' }, '10'))).toBe('3');
    expect(val(d({ value: '3', decimals: 0, rounding: 'up' }, '10'))).toBe('4');
    expect(val(d({ value: '3', decimals: 0, rounding: 'down' }, '-10'))).toBe('-3');
  });
  it('precision on large numbers and small results', () => {
    expect(val(d({ value: '7', decimals: 10 }, '1'))).toBe('0.1428571429');
    expect(val(d({ value: '1000000', decimals: 6 }, '1'))).toBe('0.000001');
    expect(val(d({ value: '3', decimals: 0 }, '123456789012345678901234567890'))).toBe(
      '41152263004115226300411522630',
    );
  });
  it('division by zero is an error on that row, not a crash', () => {
    for (const zero of ['0', '0.00', '-0']) {
      const r = d({ value: zero, decimals: 2 }, '5');
      expect(code(r)).toBe('NUMBER_DIVIDE_BY_ZERO');
    }
    const fromField = d({ fromInput: 1, decimals: 2 }, '5', ['5', '0']);
    expect(code(fromField)).toBe('NUMBER_DIVIDE_BY_ZERO');
    if (!fromField.ok) expect(fromField.message).toBe('Cannot divide 5 by zero.');
    expect(val(d({ fromInput: 1, decimals: 2 }, '5', ['5', '2']))).toBe('2.50');
  });
  it('zero divided by a number is zero', () => {
    expect(val(d({ value: '3', decimals: 2 }, '0'))).toBe('0.00');
  });
  it('blanks and invalid input', () => {
    expect(val(d({ value: '3', decimals: 2 }, null as never))).toBeNull();
    expect(val(d({ fromInput: 1, decimals: 2 }, '5', ['5', null]))).toBeNull();
    expect(
      code(call('numeric.divide', { fromInput: 1, decimals: 2, onBlank: 'error' }, '5', ['5', ''])),
    ).toBe('NUMBER_INVALID');
    expect(code(d({ value: '3', decimals: 2 }, 'abc'))).toBe('NUMBER_INVALID');
    expect(code(call('numeric.divide', { value: '3' }, '1'))).toBe('ROUTINE_CONFIG_INVALID');
    expect(code(call('numeric.divide', { decimals: 2 }, '1'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});
