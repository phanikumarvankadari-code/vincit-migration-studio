import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten';
import type { JavaScriptDefinition, SourceValue } from '@mms/mapping-core';
import type { JavaScriptExecutor, RoutineResult } from '@mms/transformation-engine';

export interface SandboxOptions {
  /** Longest run of one transformation. Default 1000 ms. */
  timeoutMs?: number;
  /** Memory limit of the sandbox. Default 16 MiB. */
  memoryLimitBytes?: number;
  /** Stack limit. Default 256 KiB. */
  stackSizeBytes?: number;
}

export interface SampleInput {
  value: SourceValue;
  inputs?: readonly SourceValue[];
  row?: Readonly<Record<string, SourceValue>>;
  /** Lookup entries available as context.lookup(id, key), by lookup ID. */
  lookups?: Readonly<Record<string, Readonly<Record<string, SourceValue>>>>;
}

export type SampleResult =
  { ok: true; value: SourceValue } | { ok: false; code: string; message: string };

export interface JavaScriptSandbox {
  /** Plug into `executeMapping({ javascript })`. Never throws. */
  execute: JavaScriptExecutor;
  /** Tries the code on sample data, for the "test with sample data" step of the editor. */
  test(definition: JavaScriptDefinition, samples: readonly SampleInput[]): SampleResult[];
  dispose(): void;
}

/**
 * Makes code deterministic: no random numbers and no clock. (Date with explicit arguments still works.)
 * Date.prototype.constructor is replaced too, so the real Date cannot be reached from a date object.
 */
const PRELUDE = `(function () {
  const refuse = function (what) {
    throw new Error(what + ' is not available: a transformation must give the same result every time');
  };
  Math.random = function () { refuse('Math.random'); };
  const RealDate = Date;
  const SafeDate = new Proxy(RealDate, {
    construct: function (target, args) {
      if (args.length === 0) refuse('new Date() without arguments');
      return Reflect.construct(target, args);
    },
    apply: function () { refuse('Date()'); },
    get: function (target, key) {
      if (key === 'now') return function () { refuse('Date.now'); };
      return Reflect.get(target, key);
    },
  });
  RealDate.prototype.constructor = SafeDate;
  globalThis.Date = SafeDate;

  // One native call cannot be interrupted, so builtins that build big strings get a size limit.
  const LIMIT = 100000;
  const limit = function (name, size) {
    if (size > LIMIT) {
      throw new RangeError(name + ': the result would be longer than ' + LIMIT + ' characters, which is not allowed in a transformation');
    }
  };
  const repeat = String.prototype.repeat;
  String.prototype.repeat = function (count) {
    limit('String.prototype.repeat', String(this).length * Number(count));
    return repeat.call(this, count);
  };
  for (const name of ['padStart', 'padEnd']) {
    const original = String.prototype[name];
    String.prototype[name] = function (target, fill) {
      limit('String.prototype.' + name, Number(target));
      return original.call(this, target, fill);
    };
  }
})();`;

const WRAP_HEAD =
  '"use strict";\n(function () {\n  const transform = function (value, row, context) {\n';
const HEAD_LINES = 3;
const WRAP_TAIL = `
  };
  const a = globalThis.__args;
  const context = Object.freeze({
    inputs: Object.freeze(a.inputs),
    lookup: function (lookupId, key) { return globalThis.__lookup(lookupId, key); },
  });
  return transform(a.value, a.row, context);
})()`;

const fail = (code: string, message: string): RoutineResult => ({ ok: false, code, message });

interface VmError {
  name?: string;
  message?: string;
  stack?: string;
}

/** Turns an error from the sandbox into a structured result. Line numbers refer to the user's code. */
function classify(e: VmError): RoutineResult {
  const name = e.name ?? 'Error';
  const message = e.message ?? String(e);
  const line = /transform\.js:(\d+)/.exec(e.stack ?? '');
  const at = line ? ` (line ${Math.max(1, Number(line[1]) - HEAD_LINES)})` : '';
  if (message === 'interrupted')
    return fail('JS_TIMEOUT', 'The code ran too long and was stopped.');
  if (/out of memory/i.test(message))
    return fail('JS_MEMORY_LIMIT', 'The code used too much memory and was stopped.');
  if (name === 'SyntaxError') return fail('JS_SYNTAX_ERROR', `Syntax error${at}: ${message}`);
  return fail('JS_RUNTIME_ERROR', `${name}${at}: ${message}`);
}

export async function createJavaScriptSandbox(
  options: SandboxOptions = {},
): Promise<JavaScriptSandbox> {
  const quickjs: QuickJSWASMModule = await getQuickJS();
  const runtime: QuickJSRuntime = quickjs.newRuntime();
  runtime.setMemoryLimit(options.memoryLimitBytes ?? 16 * 1024 * 1024);
  runtime.setMaxStackSize(options.stackSizeBytes ?? 256 * 1024);
  const timeoutMs = options.timeoutMs ?? 1000;
  let deadline = Infinity;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  let disposed = false;

  const execute: JavaScriptExecutor = ({ definition, value, inputs, row, lookup }) => {
    if (disposed) return fail('JS_SANDBOX_DISPOSED', 'The sandbox has been disposed.');
    let context: QuickJSContext | undefined;
    try {
      deadline = Date.now() + timeoutMs;
      context = runtime.newContext();
      const ctx = context;
      const prelude = ctx.evalCode(PRELUDE, 'prelude.js');
      if (prelude.error) {
        prelude.error.dispose();
        return fail('JS_SANDBOX_ERROR', 'The sandbox could not start.');
      }
      prelude.value.dispose();

      const declared = new Set<string>(definition.declaredLookupIds);
      const fn = ctx.newFunction('__lookup', (idHandle, keyHandle) => {
        const id = ctx.dump(idHandle);
        const key = ctx.dump(keyHandle);
        if (typeof id !== 'string' || !declared.has(id)) {
          throw new Error(`Lookup "${String(id)}" is not declared for this transformation`);
        }
        const found = typeof key === 'string' ? lookup(id, key) : undefined;
        return found === undefined
          ? ctx.undefined
          : found === null
            ? ctx.null
            : ctx.newString(found);
      });
      ctx.setProp(ctx.global, '__lookup', fn);
      fn.dispose();

      const payload = JSON.stringify({ value, inputs: [...inputs], row });
      const setup = ctx.evalCode(
        `globalThis.__args = JSON.parse(${JSON.stringify(payload)});`,
        'setup.js',
      );
      if (setup.error) {
        setup.error.dispose();
        return fail('JS_SANDBOX_ERROR', 'The sandbox could not receive the data.');
      }
      setup.value.dispose();

      const result = ctx.evalCode(WRAP_HEAD + definition.code + WRAP_TAIL, 'transform.js');
      if (result.error) {
        const err = ctx.dump(result.error) as VmError;
        result.error.dispose();
        return classify(err);
      }
      const kind = ctx.typeof(result.value);
      // Dumping a function would give its source text, so look at the type first.
      const out: unknown =
        kind === 'function' || kind === 'symbol' || kind === 'bigint'
          ? Symbol('not a plain value')
          : ctx.dump(result.value);
      result.value.dispose();
      if (out === undefined || out === null) return { ok: true, value: null };
      if (typeof out === 'string') return { ok: true, value: out };
      if (typeof out === 'boolean') return { ok: true, value: String(out) };
      if (typeof out === 'number' && Number.isFinite(out)) return { ok: true, value: String(out) };
      return fail('JS_BAD_RETURN', 'The code must return text, a number, true or false, or null.');
    } catch (e) {
      return classify(
        e instanceof Error ? { name: e.name, message: e.message } : { message: String(e) },
      );
    } finally {
      context?.dispose();
      deadline = Infinity;
    }
  };

  return {
    execute,
    test: (definition, samples) =>
      samples.map((s) =>
        execute({
          definition,
          value: s.value,
          inputs: s.inputs ?? [s.value],
          row: s.row ?? {},
          lookup: (id, key) => {
            const entries = s.lookups?.[id];
            return entries && key !== null && Object.prototype.hasOwnProperty.call(entries, key)
              ? entries[key]
              : undefined;
          },
        }),
      ),
    dispose: () => {
      if (!disposed) {
        disposed = true;
        runtime.dispose();
      }
    },
  };
}
