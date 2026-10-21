import { z } from 'zod';
import type { Diagnostic, RoutineDefinition } from '@mms/mapping-core';
import type { RoutineRegistry } from '@mms/transformation-engine';
import { dateRoutines } from './date.js';
import { identifierRoutines, type IdentifierOptions } from './identifier.js';
import { describeIssues, type BuiltInRoutine } from './kit.js';
import { numericRoutines } from './numeric.js';
import { textRoutines } from './text.js';

export type BuiltInOptions = IdentifierOptions;
export const BUILT_IN_VERSION = '1';

export function builtInRoutines(options: BuiltInOptions = {}): BuiltInRoutine[] {
  return [
    ...dateRoutines(),
    ...identifierRoutines(options),
    ...textRoutines(),
    ...numericRoutines(),
  ];
}

/** Implementations by routine ID, ready for `executeMapping({ routines })`. */
export function createBuiltInRegistry(options: BuiltInOptions = {}): RoutineRegistry {
  return Object.fromEntries(builtInRoutines(options).map((r) => [r.id, r.execute]));
}

/** Routine definitions to store in a project (scope builtIn, version 1). */
export function builtInRoutineDefinitions(): RoutineDefinition[] {
  return builtInRoutines().map((r) => ({
    id: r.id as RoutineDefinition['id'],
    name: r.name,
    scope: 'builtIn' as const,
    version: BUILT_IN_VERSION,
    description: r.description,
  }));
}

/** Documentation for a routine, with its configuration as JSON Schema (for editors and wizards). */
export function describeRoutine(
  id: string,
):
  | { id: string; name: string; description: string; family: string; configuration: unknown }
  | undefined {
  const r = builtInRoutines().find((x) => x.id === id);
  return (
    r && {
      id: r.id,
      name: r.name,
      description: r.description,
      family: r.family,
      configuration: z.toJSONSchema(r.configSchema, { io: 'input' }),
    }
  );
}

/** Checks a configuration before a run, so mistakes show up at design time instead of on every row. */
export function checkRoutineConfiguration(routineId: string, configuration: unknown): Diagnostic[] {
  const r = builtInRoutines().find((x) => x.id === routineId);
  if (!r)
    return [
      {
        severity: 'error',
        code: 'ROUTINE_UNKNOWN',
        message: `"${routineId}" is not a built-in routine.`,
        routineId: routineId as Diagnostic['routineId'],
      },
    ];
  const parsed = r.configSchema.safeParse(configuration);
  return parsed.success
    ? []
    : [
        {
          severity: 'error',
          code: 'ROUTINE_CONFIG_INVALID',
          message: `${r.name}: ${describeIssues(parsed.error)}`,
          routineId: routineId as Diagnostic['routineId'],
        },
      ];
}
