import type { JsonValue, SourceValue } from '@mms/mapping-core';
import type { RoutineResult } from '@mms/transformation-engine';
import { createBuiltInRegistry } from '../src/index.js';

const registry = createBuiltInRegistry();

/** Runs one routine the way the engine does. */
export function call(
  id: string,
  configuration: Record<string, JsonValue>,
  value: SourceValue,
  inputs: readonly SourceValue[] = [value],
): RoutineResult {
  const impl = registry[id];
  if (!impl) throw new Error(`no routine ${id}`);
  return impl({ value, inputs, configuration });
}

export const val = (r: RoutineResult): SourceValue => {
  if (!r.ok) throw new Error(`expected success but got ${r.code}: ${r.message}`);
  return r.value;
};
export const code = (r: RoutineResult): string => (r.ok ? 'OK' : r.code);
