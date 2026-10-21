import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RoutineDefinitionSchema } from '@mms/mapping-core';
import {
  builtInRoutineDefinitions,
  builtInRoutines,
  checkRoutineConfiguration,
  createBuiltInRegistry,
  describeRoutine,
} from '../src/index.js';
import { call } from './helpers.js';

describe('built-in routine registry', () => {
  it('has the 26 required routines with unique IDs and a description each', () => {
    const r = builtInRoutines();
    expect(r).toHaveLength(26);
    expect(new Set(r.map((x) => x.id)).size).toBe(26);
    expect(r.every((x) => x.description.length > 20 && x.name.length > 0)).toBe(true);
    expect(Object.keys(createBuiltInRegistry()).sort()).toEqual(r.map((x) => x.id).sort());
  });

  it('covers every routine named in the specs', () => {
    const names = builtInRoutines().map((x) => x.name);
    for (const n of [
      'Parse Date',
      'Format Date',
      'Default Date',
      'SAP Zero Date to Null',
      'Date Validation',
      'Preserve UUID',
      'Generate UUID v4',
      'Deterministic UUID',
      'Fixed Identifier',
      'Prefix Identifier',
      'Suffix Identifier',
      'Trim',
      'Uppercase',
      'Lowercase',
      'Concatenate',
      'Replace',
      'Substring',
      'Left Pad',
      'Right Pad',
      'Maximum Length',
      'Null and Empty Handling',
      'Parse Number',
      'Format Number',
      'Round',
      'Multiply',
      'Divide',
    ]) {
      expect(names, n).toContain(n);
    }
  });

  it('produces project routine definitions that fit the model', () => {
    const defs = builtInRoutineDefinitions();
    expect(defs).toHaveLength(26);
    for (const d of defs) {
      expect(RoutineDefinitionSchema.safeParse(d).success, d.id).toBe(true);
      expect(d).toMatchObject({ scope: 'builtIn', version: '1' });
    }
  });

  it('describes a routine with its configuration as JSON Schema', () => {
    const d = describeRoutine('date.parse')!;
    expect(d.name).toBe('Parse Date');
    expect(d.family).toBe('date');
    expect(JSON.stringify(d.configuration)).toContain('twoDigitYearPivot');
    expect(describeRoutine('nope')).toBeUndefined();
    for (const r of builtInRoutines()) expect(() => describeRoutine(r.id), r.id).not.toThrow();
  });

  it('checks a configuration before a run', () => {
    expect(
      checkRoutineConfiguration('date.parse', { format: 'M/D/YY', twoDigitYearPivot: 68 }),
    ).toEqual([]);
    const bad = checkRoutineConfiguration('date.parse', { format: 'M/D/YY' });
    expect(bad[0]).toMatchObject({
      severity: 'error',
      code: 'ROUTINE_CONFIG_INVALID',
      routineId: 'date.parse',
    });
    expect(bad[0]!.message).toContain('twoDigitYearPivot');
    expect(checkRoutineConfiguration('nope', {})[0]!.code).toBe('ROUTINE_UNKNOWN');
  });

  it('every routine tolerates null input and junk configuration without throwing', () => {
    for (const r of builtInRoutines()) {
      for (const config of [{}, { x: 1 }, { format: 5 }, { length: 'a' }]) {
        const result = call(r.id, config as never, null);
        expect(typeof result.ok, r.id).toBe('boolean');
      }
    }
  });

  it('is repeatable: the same call gives the same result (except UUID v4)', () => {
    for (const r of builtInRoutines().filter((x) => x.id !== 'id.uuidV4')) {
      expect(call(r.id, {}, 'abc'), r.id).toEqual(call(r.id, {}, 'abc'));
    }
  });
});

describe('routine-library boundaries', () => {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
  it('imports only zod, mapping-core, the engine types and relative modules; no Node, DOM, clock or randomness', () => {
    for (const f of readdirSync(join(pkg, 'src')).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(pkg, 'src', f), 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        expect(
          ['zod', '@mms/mapping-core', '@mms/transformation-engine'].includes(m[1]!) ||
            m[1]!.startsWith('./'),
          `${f}: ${m[1]}`,
        ).toBe(true);
      }
      expect(text, f).not.toMatch(
        /node:|\bprocess\.|\bBuffer\b|document\.|window\.|TextEncoder|Math\.random|Date\.now|new Date|\beval\(|new Function|globalThis\.crypto/,
      );
    }
  });
});
