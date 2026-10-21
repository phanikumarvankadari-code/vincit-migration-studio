import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JavaScriptDefinition, SourceValue } from '@mms/mapping-core';
import { createJavaScriptSandbox, type JavaScriptSandbox } from '../src/index.js';

let sandbox: JavaScriptSandbox;
let quick: JavaScriptSandbox;
beforeAll(async () => {
  sandbox = await createJavaScriptSandbox();
  quick = await createJavaScriptSandbox({ timeoutMs: 150 });
});
afterAll(() => {
  sandbox.dispose();
  quick.dispose();
});

const def = (code: string, declaredLookupIds: string[] = []): JavaScriptDefinition => ({
  code,
  declaredLookupIds: declaredLookupIds as never,
});
const run = (
  code: string,
  value: SourceValue = null,
  extra: {
    inputs?: SourceValue[];
    row?: Record<string, SourceValue>;
    lookups?: Record<string, Record<string, SourceValue>>;
    declared?: string[];
    box?: JavaScriptSandbox;
  } = {},
) =>
  (extra.box ?? sandbox).execute({
    definition: def(code, extra.declared),
    value,
    inputs: extra.inputs ?? [value],
    row: extra.row ?? {},
    lookup: (id, key) =>
      key !== null && extra.lookups?.[id] && key in extra.lookups[id]!
        ? extra.lookups[id]![key]
        : undefined,
  });
const value = (r: ReturnType<typeof run>) => (r.ok ? r.value : `ERR ${r.code}: ${r.message}`);

describe('custom JavaScript sandbox (SPEC-019)', () => {
  describe('valid routines', () => {
    it('a valid routine executes: the code is the body of transform(value, row, context)', () => {
      expect(value(run('return value.trim().toUpperCase();', '  ab '))).toBe('AB');
    });

    it('gets the current row (by field ID) and all source values', () => {
      expect(
        value(
          run("return row['f-1'] + '-' + context.inputs.join('+');", 'x', {
            row: { 'f-1': 'R' },
            inputs: ['x', 'y'],
          }),
        ),
      ).toBe('R-x+y');
    });

    it('can return text, numbers, true/false, or nothing', () => {
      expect(value(run('return 42;'))).toBe('42');
      expect(value(run('return 1.5;'))).toBe('1.5');
      expect(value(run('return true;'))).toBe('true');
      expect(value(run('return null;'))).toBeNull();
      expect(value(run('return undefined;'))).toBeNull();
      expect(value(run('// no return'))).toBeNull();
      expect(value(run("return '';"))).toBe('');
    });

    it('null and Unicode values pass through correctly', () => {
      expect(value(run('return value === null ? "was null" : value;', null))).toBe('was null');
      expect(value(run('return [...value].length + ":" + value;', 'é😀 日本'))).toBe('5:é😀 日本');
      expect(value(run('return value;', 'quote " backslash \\ newline \n'))).toBe(
        'quote " backslash \\ newline \n',
      );
    });

    it('JSON, Math, string and array built-ins work', () => {
      expect(
        value(
          run('return JSON.stringify({a: [1, 2]}) + Math.max(1, 5) + [3, 1, 2].sort().join("");'),
        ),
      ).toBe('{"a":[1,2]}5123');
    });

    it('dates with explicit arguments work and are repeatable', () => {
      expect(value(run('return new Date(Date.UTC(2026, 0, 31)).toISOString().slice(0, 10);'))).toBe(
        '2026-01-31',
      );
    });

    it('is repeatable: the same input gives the same output', () => {
      const code = 'return value.split("").reverse().join("");';
      expect(value(run(code, 'abc'))).toBe(value(run(code, 'abc')));
    });
  });

  describe('approved lookup helper', () => {
    const lookups = { lk: { FI: 'Finland' } };
    it('looks up declared lookups', () => {
      expect(
        value(run('return context.lookup("lk", value);', 'FI', { lookups, declared: ['lk'] })),
      ).toBe('Finland');
    });
    it('a key without an entry gives undefined, which the code can handle', () => {
      expect(
        value(
          run('return context.lookup("lk", value) ?? "none";', 'XX', { lookups, declared: ['lk'] }),
        ),
      ).toBe('none');
      expect(
        value(
          run('return context.lookup("lk", null) ?? "none";', null, { lookups, declared: ['lk'] }),
        ),
      ).toBe('none');
    });
    it('an undeclared lookup is refused with an error', () => {
      const r = run('return context.lookup("lk", value);', 'FI', { lookups, declared: [] });
      expect(r).toMatchObject({ ok: false, code: 'JS_RUNTIME_ERROR' });
      expect(!r.ok && r.message).toContain('Lookup "lk" is not declared');
    });
  });

  describe('errors are structured and never crash the run', () => {
    it('syntax errors are reported with the line of the user code', () => {
      const r = run('const a = 1;\nreturn a +;\n');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('JS_SYNTAX_ERROR');
        expect(r.message).toContain('line 2');
      }
    });

    it('runtime errors are reported with the line', () => {
      const r = run('const a = null;\nreturn a.b.c;');
      expect(r).toMatchObject({ ok: false, code: 'JS_RUNTIME_ERROR' });
      expect(!r.ok && r.message).toContain('TypeError');
      expect(!r.ok && r.message).toContain('line 2');
    });

    it('a thrown error is reported with its message', () => {
      const r = run('throw new Error("bad value " + value);', 'X');
      expect(r).toMatchObject({ ok: false, code: 'JS_RUNTIME_ERROR' });
      expect(!r.ok && r.message).toContain('bad value X');
    });

    it('a long-running routine is terminated', () => {
      const t0 = Date.now();
      const r = run('while (true) {}', null, { box: quick });
      expect(r).toMatchObject({ ok: false, code: 'JS_TIMEOUT' });
      expect(Date.now() - t0).toBeLessThan(2000);
    });

    it('a heavy loop that finishes in time is fine', () => {
      expect(value(run('let s = 0; for (let i = 0; i < 100000; i++) s += i; return s;'))).toBe(
        '4999950000',
      );
    });

    it('memory use is limited', () => {
      const r = run('const a = []; while (true) { a.push({ k: a.length }); }', null, {
        box: quick,
      });
      expect(r.ok).toBe(false);
      expect(!r.ok && ['JS_MEMORY_LIMIT', 'JS_TIMEOUT']).toContain(!r.ok && r.code);
    });

    it('huge strings cannot stall the sandbox: repeat, padStart and padEnd refuse big results at once', () => {
      for (const code of [
        'return "x".repeat(10000000);',
        'return "x".padStart(10000000);',
        'return "x".padEnd(10000000, "y");',
        'return "ab".repeat(60000);',
      ]) {
        const t0 = Date.now();
        expect(run(code), code).toMatchObject({ ok: false, code: 'JS_RUNTIME_ERROR' });
        expect(Date.now() - t0, code).toBeLessThan(1000);
      }
      expect(value(run('return "ab".repeat(3) + "x".padStart(3, "-") + "y".padEnd(3, "+");'))).toBe(
        'abababk'.slice(0, 6) + '--x' + 'y++',
      );
    });

    it('endless recursion is a runtime error, not a crash', () => {
      const r = run('function f() { return f() + 1; } return f();');
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe('JS_RUNTIME_ERROR');
    });

    it('objects, arrays, functions and non-finite numbers cannot be returned', () => {
      for (const code of [
        'return {a: 1};',
        'return [1];',
        'return function () {};',
        'return NaN;',
        'return Infinity;',
      ]) {
        expect(run(code), code).toMatchObject({ ok: false, code: 'JS_BAD_RETURN' });
      }
    });

    it('the sandbox keeps working after errors and timeouts', () => {
      run('while (true) {}', null, { box: quick });
      expect(value(run('return "still ok";', null, { box: quick }))).toBe('still ok');
      run('throw 1;');
      expect(value(run('return "ok";'))).toBe('ok');
    });

    it('a disposed sandbox reports an error instead of throwing', async () => {
      const s = await createJavaScriptSandbox();
      s.dispose();
      s.dispose();
      expect(
        s.execute({
          definition: def('return 1;'),
          value: null,
          inputs: [],
          row: {},
          lookup: () => undefined,
        }),
      ).toMatchObject({ ok: false, code: 'JS_SANDBOX_DISPOSED' });
    });
  });

  describe('forbidden capabilities are inaccessible', () => {
    it.each([
      ['process', 'typeof process'],
      ['require', 'typeof require'],
      ['module', 'typeof module'],
      ['fetch', 'typeof fetch'],
      ['XMLHttpRequest', 'typeof XMLHttpRequest'],
      ['WebSocket', 'typeof WebSocket'],
      ['setTimeout', 'typeof setTimeout'],
      ['console', 'typeof console'],
      ['Buffer', 'typeof Buffer'],
      ['WebAssembly', 'typeof WebAssembly'],
      ['globalThis.process', 'typeof globalThis.process'],
      [
        'the Function constructor route to process',
        '(function () {}).constructor("return typeof process")()',
      ],
      [
        'the global constructor route',
        'globalThis.constructor.constructor("return typeof require")()',
      ],
    ])('%s is not available', (_name, expr) => {
      expect(value(run(`return ${expr};`))).toBe('undefined');
    });

    it('dynamic import of a module (file system, network, packages) fails', () => {
      for (const spec of ['fs', 'node:fs', 'child_process', 'https://example.com/x.js', './x.js']) {
        const r = run(`return import(${JSON.stringify(spec)});`);
        expect(r.ok, spec).toBe(false);
      }
    });

    it('static import syntax is not accepted', () => {
      expect(run('import fs from "fs"; return 1;')).toMatchObject({
        ok: false,
        code: 'JS_SYNTAX_ERROR',
      });
    });

    it('environment variables, the OS and credentials have no route in', () => {
      expect(
        value(
          run(
            'return typeof process === "undefined" && typeof globalThis.env === "undefined" && typeof os === "undefined";',
          ),
        ),
      ).toBe('true');
    });

    it('the internal helper names are not a way out (the host function only answers declared lookups)', () => {
      expect(value(run('return typeof globalThis.__lookup;'))).toBe('function');
      expect(
        run('return globalThis.__lookup("secret", "k");', null, {
          lookups: { secret: { k: 'leak' } },
          declared: [],
        }),
      ).toMatchObject({ ok: false, code: 'JS_RUNTIME_ERROR' });
    });
  });

  describe('repeatable results', () => {
    it('Math.random is not available', () => {
      expect(run('return Math.random();')).toMatchObject({ ok: false, code: 'JS_RUNTIME_ERROR' });
    });
    it('the clock is not available: Date.now, new Date(), Date()', () => {
      expect(run('return Date.now();')).toMatchObject({ ok: false, code: 'JS_RUNTIME_ERROR' });
      expect(run('return new Date().getTime();')).toMatchObject({
        ok: false,
        code: 'JS_RUNTIME_ERROR',
      });
      expect(run('return Date();')).toMatchObject({ ok: false, code: 'JS_RUNTIME_ERROR' });
    });
    it('the clock cannot be reached through a date object either', () => {
      expect(run('return new Date(0).constructor.now();')).toMatchObject({
        ok: false,
        code: 'JS_RUNTIME_ERROR',
      });
      expect(run('return new (new Date(0).constructor)().getTime();')).toMatchObject({
        ok: false,
        code: 'JS_RUNTIME_ERROR',
      });
      expect(run('return Object.getPrototypeOf(new Date(0)).constructor.now();')).toMatchObject({
        ok: false,
        code: 'JS_RUNTIME_ERROR',
      });
    });
    it('the error says why', () => {
      const r = run('return Math.random();');
      expect(!r.ok && r.message).toContain('must give the same result every time');
    });
  });

  describe('isolation between rows', () => {
    it('changes to globals do not carry over to the next call', () => {
      const code =
        'globalThis.counter = (globalThis.counter || 0) + 1; Array.prototype.polluted = true; return String(globalThis.counter) + typeof [].polluted;';
      expect(value(run(code))).toBe('1boolean');
      expect(value(run(code))).toBe('1boolean');
      expect(value(run('return typeof globalThis.counter + typeof [].polluted;'))).toBe(
        'undefinedundefined',
      );
    });
  });

  describe('sample testing', () => {
    it('runs the code on sample data and reports each result', () => {
      const results = sandbox.test(
        def(
          'if (value === "bad") throw new Error("nope"); return context.lookup("lk", value) ?? value.toUpperCase();',
          ['lk'],
        ),
        [
          { value: 'ab' },
          { value: 'FI', lookups: { lk: { FI: 'Finland' } } },
          { value: 'bad' },
          { value: null },
        ],
      );
      expect(results.map((r) => (r.ok ? r.value : r.code))).toEqual([
        'AB',
        'Finland',
        'JS_RUNTIME_ERROR',
        'JS_RUNTIME_ERROR',
      ]);
    });
    it('a syntax error shows up for every sample', () => {
      expect(
        sandbox
          .test(def('return ;;;('), [{ value: 'a' }, { value: 'b' }])
          .map((r) => !r.ok && r.code),
      ).toEqual(['JS_SYNTAX_ERROR', 'JS_SYNTAX_ERROR']);
    });
  });

  describe('performance', () => {
    it('runs a thousand rows quickly', () => {
      const t0 = Date.now();
      for (let i = 0; i < 1000; i++)
        expect(value(run('return value + "!";', String(i)))).toBe(`${i}!`);
      expect(Date.now() - t0).toBeLessThan(5000);
    });
  });
});
