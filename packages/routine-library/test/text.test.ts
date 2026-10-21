import { describe, expect, it } from 'vitest';
import { call, code, val } from './helpers.js';

describe('text.trim', () => {
  it('removes white space from both ends by default, including non-breaking and tab', () => {
    expect(val(call('text.trim', {}, ' \t Bo \n'))).toBe('Bo');
    expect(val(call('text.trim', {}, '  a  b  '))).toBe('a  b');
  });
  it('can trim only one end', () => {
    expect(val(call('text.trim', { mode: 'start' }, '  a  '))).toBe('a  ');
    expect(val(call('text.trim', { mode: 'end' }, '  a  '))).toBe('  a');
  });
  it('null stays null; empty and spaces-only become empty', () => {
    expect(val(call('text.trim', {}, null))).toBeNull();
    expect(val(call('text.trim', {}, ''))).toBe('');
    expect(val(call('text.trim', {}, '   '))).toBe('');
  });
  it('rejects an unknown mode or setting', () => {
    expect(code(call('text.trim', { mode: 'middle' }, 'a'))).toBe('ROUTINE_CONFIG_INVALID');
    expect(code(call('text.trim', { nope: 1 }, 'a'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('text.upper and text.lower', () => {
  it('change case with Unicode rules', () => {
    expect(val(call('text.upper', {}, 'helsinki ä ö'))).toBe('HELSINKI Ä Ö');
    expect(val(call('text.upper', {}, 'straße'))).toBe('STRASSE');
    expect(val(call('text.lower', {}, 'ÄÖ ÅB İ'))).toBe('äö åb i̇');
  });
  it('digits, symbols and emoji are unchanged; null stays null; empty stays empty', () => {
    expect(val(call('text.upper', {}, '12-ab 😀'))).toBe('12-AB 😀');
    expect(val(call('text.lower', {}, null))).toBeNull();
    expect(val(call('text.upper', {}, ''))).toBe('');
  });
  it('take no settings', () => {
    expect(code(call('text.upper', { x: 1 }, 'a'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('text.concat', () => {
  it('joins the current value and the other source values with a separator', () => {
    expect(val(call('text.concat', { separator: ' ' }, 'Ann', ['Ann', 'Lee']))).toBe('Ann Lee');
    expect(val(call('text.concat', {}, 'a', ['a', 'b', 'c']))).toBe('abc');
  });
  it('the current value replaces the first source value, so earlier chain steps count', () => {
    expect(val(call('text.concat', { separator: '-' }, 'CHANGED', ['orig', 'x']))).toBe(
      'CHANGED-x',
    );
  });
  it('blank parts are skipped by default so no separator dangles', () => {
    expect(val(call('text.concat', { separator: ', ' }, 'a', ['a', null, '', 'b']))).toBe('a, b');
    expect(val(call('text.concat', { separator: ', ' }, null, [null, 'b']))).toBe('b');
  });
  it('all blank gives null; skipBlank false keeps empty parts', () => {
    expect(val(call('text.concat', { separator: ',' }, null, [null, '']))).toBeNull();
    expect(
      val(call('text.concat', { separator: ',', skipBlank: false }, 'a', ['a', null, 'b'])),
    ).toBe('a,,b');
    expect(val(call('text.concat', { separator: ',', skipBlank: false }, null, [null, null]))).toBe(
      ',',
    );
  });
  it('a single value is returned as is', () => {
    expect(val(call('text.concat', { separator: '-' }, 'only'))).toBe('only');
  });
});

describe('text.replace', () => {
  it('replaces every occurrence of exact text by default; no pattern matching', () => {
    expect(val(call('text.replace', { find: 'a', replaceWith: 'o' }, 'banana'))).toBe('bonono');
    expect(val(call('text.replace', { find: '.', replaceWith: '-' }, 'a.b.c'))).toBe('a-b-c');
    expect(val(call('text.replace', { find: '$&', replaceWith: 'X' }, 'a$&b'))).toBe('aXb');
    expect(val(call('text.replace', { find: '.*', replaceWith: 'X' }, 'abc'))).toBe('abc');
  });
  it('can replace only the first, or replace with nothing', () => {
    expect(val(call('text.replace', { find: 'a', replaceWith: 'o', all: false }, 'banana'))).toBe(
      'bonana',
    );
    expect(val(call('text.replace', { find: ' ', replaceWith: '' }, 'a b c'))).toBe('abc');
    expect(val(call('text.replace', { find: 'z', replaceWith: 'o', all: false }, 'banana'))).toBe(
      'banana',
    );
  });
  it('null stays null; empty stays empty; find is required and not empty', () => {
    expect(val(call('text.replace', { find: 'a', replaceWith: 'b' }, null))).toBeNull();
    expect(val(call('text.replace', { find: 'a', replaceWith: 'b' }, ''))).toBe('');
    expect(code(call('text.replace', { find: '', replaceWith: 'b' }, 'a'))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
    expect(code(call('text.replace', { replaceWith: 'b' }, 'a'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('text.substring', () => {
  it('takes characters from a 0-based start for a length, or to the end', () => {
    expect(val(call('text.substring', { start: 1, length: 3 }, 'abcdef'))).toBe('bcd');
    expect(val(call('text.substring', { start: 2 }, 'abcdef'))).toBe('cdef');
    expect(val(call('text.substring', { start: 0, length: 0 }, 'abc'))).toBe('');
  });
  it('boundaries: past the end gives empty, a long length stops at the end', () => {
    expect(val(call('text.substring', { start: 10 }, 'abc'))).toBe('');
    expect(val(call('text.substring', { start: 1, length: 99 }, 'abc'))).toBe('bc');
    expect(val(call('text.substring', { start: 3 }, 'abc'))).toBe('');
  });
  it('counts code points, so emoji and accented letters are not split', () => {
    expect(val(call('text.substring', { start: 1, length: 2 }, 'a😀é😀b'))).toBe('😀é');
  });
  it('null stays null; negative or fractional numbers are rejected', () => {
    expect(val(call('text.substring', { start: 0 }, null))).toBeNull();
    expect(code(call('text.substring', { start: -1 }, 'a'))).toBe('ROUTINE_CONFIG_INVALID');
    expect(code(call('text.substring', { start: 1.5 }, 'a'))).toBe('ROUTINE_CONFIG_INVALID');
    expect(code(call('text.substring', {}, 'a'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('text.leftPad and text.rightPad', () => {
  it('fill up to the length on the chosen side', () => {
    expect(val(call('text.leftPad', { length: 5, pad: '0' }, '42'))).toBe('00042');
    expect(val(call('text.rightPad', { length: 5, pad: '.' }, '42'))).toBe('42...');
    expect(val(call('text.leftPad', { length: 3 }, 'a'))).toBe('  a');
  });
  it('boundaries: exact length unchanged; longer is kept, or is an error when asked', () => {
    expect(val(call('text.leftPad', { length: 3, pad: '0' }, 'abc'))).toBe('abc');
    expect(val(call('text.leftPad', { length: 3, pad: '0' }, 'abcd'))).toBe('abcd');
    expect(code(call('text.leftPad', { length: 3, onTooLong: 'error' }, 'abcd'))).toBe(
      'TEXT_TOO_LONG',
    );
    expect(val(call('text.rightPad', { length: 0 }, 'ab'))).toBe('ab');
  });
  it('an empty string is padded; null stays null', () => {
    expect(val(call('text.leftPad', { length: 3, pad: '0' }, ''))).toBe('000');
    expect(val(call('text.rightPad', { length: 3, pad: '0' }, null))).toBeNull();
  });
  it('counts code points and accepts an emoji as the pad character', () => {
    expect(val(call('text.leftPad', { length: 4, pad: '😀' }, 'é'))).toBe('😀😀😀é');
  });
  it('the pad must be exactly one character', () => {
    expect(code(call('text.leftPad', { length: 3, pad: 'ab' }, 'x'))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
    expect(code(call('text.leftPad', { length: 3, pad: '' }, 'x'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('text.maxLength', () => {
  it('text within the limit passes through, exactly at the limit too', () => {
    expect(val(call('text.maxLength', { length: 5 }, 'abc'))).toBe('abc');
    expect(val(call('text.maxLength', { length: 3 }, 'abc'))).toBe('abc');
  });
  it('longer text is an error by default and is cut when asked', () => {
    const r = call('text.maxLength', { length: 3 }, 'abcd');
    expect(code(r)).toBe('TEXT_TOO_LONG');
    if (!r.ok) expect(r.message).toBe('"abcd" has 4 characters but at most 3 are allowed.');
    expect(val(call('text.maxLength', { length: 3, onTooLong: 'truncate' }, 'abcd'))).toBe('abc');
  });
  it('counts code points', () => {
    expect(val(call('text.maxLength', { length: 2 }, '😀😀'))).toBe('😀😀');
    expect(val(call('text.maxLength', { length: 2, onTooLong: 'truncate' }, '😀😀😀'))).toBe(
      '😀😀',
    );
    expect(code(call('text.maxLength', { length: 1 }, '😀😀'))).toBe('TEXT_TOO_LONG');
  });
  it('null and empty pass; length 0 allows only empty', () => {
    expect(val(call('text.maxLength', { length: 0 }, null))).toBeNull();
    expect(val(call('text.maxLength', { length: 0 }, ''))).toBe('');
    expect(code(call('text.maxLength', { length: 0 }, 'a'))).toBe('TEXT_TOO_LONG');
    expect(code(call('text.maxLength', {}, 'a'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('text.nullHandling', () => {
  it('maps null, empty and spaces-only explicitly', () => {
    const cfg = { nullTo: 'N/A', emptyTo: null, whitespaceTo: '' };
    expect(val(call('text.nullHandling', cfg, null))).toBe('N/A');
    expect(val(call('text.nullHandling', cfg, ''))).toBeNull();
    expect(val(call('text.nullHandling', cfg, '   '))).toBe('');
    expect(val(call('text.nullHandling', cfg, 'x'))).toBe('x');
  });
  it('a setting that is left out keeps that kind of value', () => {
    expect(val(call('text.nullHandling', {}, null))).toBeNull();
    expect(val(call('text.nullHandling', {}, ''))).toBe('');
    expect(val(call('text.nullHandling', {}, '  '))).toBe('  ');
    expect(val(call('text.nullHandling', { emptyTo: null }, null))).toBeNull();
  });
  it('null can be turned into an empty string', () => {
    expect(val(call('text.nullHandling', { nullTo: '' }, null))).toBe('');
  });
});
