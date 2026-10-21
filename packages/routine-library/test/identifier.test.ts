import { randomFillSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createBuiltInRegistry, sha1, utf8, uuidV4, uuidV5, UUID } from '../src/index.js';
import { call, code, val } from './helpers.js';

const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 DNS namespace
const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0')).join('');

describe('hashing and UUID construction', () => {
  it('SHA-1 matches the standard test vectors', () => {
    expect(hex(sha1(utf8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1([]))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(utf8('The quick brown fox jumps over the lazy dog')))).toBe(
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    );
    expect(hex(sha1(utf8('a'.repeat(1000))))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba');
  });

  it('UTF-8 encoding handles 1 to 4 byte characters', () => {
    expect(utf8('Aé€😀')).toEqual([0x41, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
  });

  it('name-based UUID (version 5) matches the published example', () => {
    expect(uuidV5(NS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('random UUID gets version 4 and the RFC variant from the supplied bytes', () => {
    expect(uuidV4(new Array(16).fill(255))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(uuidV4(new Array(16).fill(0))).toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('id.preserveUuid', () => {
  const u = '123E4567-E89B-12D3-A456-426614174000';
  it('keeps a valid UUID exactly, or lower-cases it', () => {
    expect(val(call('id.preserveUuid', {}, u))).toBe(u);
    expect(val(call('id.preserveUuid', { lowercase: true }, u))).toBe(u.toLowerCase());
  });
  it('invalid values are errors', () => {
    for (const bad of [
      'abc',
      '123e4567e89b12d3a456426614174000',
      '123e4567-e89b-12d3-a456-42661417400',
      ' 123e4567-e89b-12d3-a456-426614174000',
    ]) {
      expect(code(call('id.preserveUuid', {}, bad))).toBe('UUID_INVALID');
    }
  });
  it('blank rules', () => {
    expect(val(call('id.preserveUuid', {}, null))).toBeNull();
    expect(code(call('id.preserveUuid', { onBlank: 'error' }, ''))).toBe('UUID_BLANK');
  });
});

describe('id.uuidV4 (explicitly not repeatable)', () => {
  const real = createBuiltInRegistry({ randomBytes: (n) => randomFillSync(new Uint8Array(n)) });
  const run = (reg: typeof real, value: string | null = null, config = {}) =>
    reg['id.uuidV4']!({ value, inputs: [value], configuration: config });

  it('makes syntactically valid version 4 UUIDs that differ between calls', () => {
    const a = run(real);
    const b = run(real);
    expect(a.ok && UUID.test(a.value!)).toBe(true);
    expect(a.ok && a.value![14]).toBe('4');
    expect(a.ok && '89ab'.includes(a.value![19]!)).toBe(true);
    expect(a.ok && b.ok && a.value !== b.value).toBe(true);
  });

  it('without a source of randomness it reports an error instead of faking one', () => {
    const r = run(createBuiltInRegistry());
    expect(!r.ok && r.code).toBe('ROUTINE_RANDOM_UNAVAILABLE');
  });

  it('keepExisting keeps a valid UUID and generates otherwise', () => {
    const existing = '123e4567-e89b-12d3-a456-426614174000';
    expect(val(run(real, existing, { keepExisting: true }))).toBe(existing);
    expect(val(run(real, 'not-a-uuid', { keepExisting: true }))).not.toBe('not-a-uuid');
    expect(val(run(real, existing, {}))).not.toBe(existing);
  });

  it('is deterministic given fixed bytes (the randomness is injected)', () => {
    const fixed = createBuiltInRegistry({ randomBytes: () => new Array(16).fill(7) });
    expect(val(run(fixed))).toBe(val(run(fixed)));
  });
});

describe('id.deterministicUuid', () => {
  const cfg = { namespace: NS };
  it('same keys give the same UUID, different keys give different UUIDs', () => {
    const a = val(call('id.deterministicUuid', cfg, 'P100'));
    expect(val(call('id.deterministicUuid', cfg, 'P100'))).toBe(a);
    expect(val(call('id.deterministicUuid', cfg, 'P101'))).not.toBe(a);
    expect(UUID.test(a!)).toBe(true);
    expect(a![14]).toBe('5');
  });

  it('is the documented name-based UUID of the JSON-encoded key', () => {
    expect(val(call('id.deterministicUuid', cfg, 'P100'))).toBe(
      uuidV5(NS, JSON.stringify(['', 'P100'])),
    );
  });

  it('uses all source values as the key, current value first, and the encoding cannot be confused', () => {
    const a = val(call('id.deterministicUuid', cfg, 'a,b', ['a,b', 'c']));
    const b = val(call('id.deterministicUuid', cfg, 'a', ['a', 'b,c']));
    expect(a).not.toBe(b);
    expect(val(call('id.deterministicUuid', cfg, 'X', ['ignored', 'Y']))).toBe(
      val(call('id.deterministicUuid', cfg, 'X', ['X', 'Y'])),
    );
  });

  it('salt and namespace separate identifier spaces', () => {
    const base = val(call('id.deterministicUuid', cfg, 'P100'));
    expect(val(call('id.deterministicUuid', { ...cfg, salt: 'company' }, 'P100'))).not.toBe(base);
    expect(
      val(
        call('id.deterministicUuid', { namespace: '6ba7b811-9dad-11d1-80b4-00c04fd430c8' }, 'P100'),
      ),
    ).not.toBe(base);
  });

  it('Unicode keys work', () => {
    expect(val(call('id.deterministicUuid', cfg, 'Ünï😀'))).toBe(
      val(call('id.deterministicUuid', cfg, 'Ünï😀')),
    );
  });

  it('a blank key part is an error by default, or null on request', () => {
    expect(code(call('id.deterministicUuid', cfg, null))).toBe('UUID_KEY_BLANK');
    expect(code(call('id.deterministicUuid', cfg, 'A', ['A', '']))).toBe('UUID_KEY_BLANK');
    expect(val(call('id.deterministicUuid', { ...cfg, onBlank: 'null' }, null))).toBeNull();
  });

  it('the namespace must be a UUID', () => {
    expect(code(call('id.deterministicUuid', { namespace: 'nope' }, 'x'))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
    expect(code(call('id.deterministicUuid', {}, 'x'))).toBe('ROUTINE_CONFIG_INVALID');
  });
});

describe('id.fixed, id.prefix, id.suffix', () => {
  it('fixed always gives the configured value, ignoring the input', () => {
    expect(val(call('id.fixed', { value: 'ABC' }, 'anything'))).toBe('ABC');
    expect(val(call('id.fixed', { value: 'ABC' }, null))).toBe('ABC');
  });
  it('a fixed UUID can be checked', () => {
    const u = '123e4567-e89b-12d3-a456-426614174000';
    expect(val(call('id.fixed', { value: u, mustBeUuid: true }, null))).toBe(u);
    expect(code(call('id.fixed', { value: 'x', mustBeUuid: true }, null))).toBe(
      'ROUTINE_CONFIG_INVALID',
    );
    expect(code(call('id.fixed', { value: '' }, null))).toBe('ROUTINE_CONFIG_INVALID');
  });
  it('prefix and suffix add text; blanks stay blank unless an error is asked for', () => {
    expect(val(call('id.prefix', { value: 'PC_' }, '100'))).toBe('PC_100');
    expect(val(call('id.suffix', { value: '_X' }, '100'))).toBe('100_X');
    expect(val(call('id.prefix', { value: 'PC_' }, null))).toBeNull();
    expect(val(call('id.suffix', { value: '_X' }, ''))).toBeNull();
    expect(code(call('id.prefix', { value: 'PC_', onBlank: 'error' }, null))).toBe('ID_BLANK');
    expect(val(call('id.prefix', { value: 'PC_' }, ' '))).toBe('PC_ ');
  });
});
