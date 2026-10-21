import { z } from 'zod';
import type { SourceValue } from '@mms/mapping-core';
import type { RoutineImplementation, RoutineResult } from '@mms/transformation-engine';

export type RoutineFamily = 'date' | 'identifier' | 'text' | 'numeric';

/** What a routine sees: the current chain value and all source values of the mapping. */
export interface RoutineCall {
  value: SourceValue;
  inputs: readonly SourceValue[];
}

export interface BuiltInRoutine {
  id: string;
  name: string;
  description: string;
  family: RoutineFamily;
  configSchema: z.ZodType;
  /** Validates the configuration, runs, and never throws. */
  execute: RoutineImplementation;
}

export const ok = (value: SourceValue): RoutineResult => ({ ok: true, value });
export const fail = (code: string, message: string): RoutineResult => ({
  ok: false,
  code,
  message,
});

/** A blank is null or an empty string. Spaces are a value. */
export const isBlank = (v: SourceValue): v is null | '' => v === null || v === '';

/** The value followed by the remaining source values: the inputs of a multi-field routine. */
export const parts = (call: RoutineCall): SourceValue[] => [call.value, ...call.inputs.slice(1)];

/** How a routine treats a blank input: give back a blank (default) or report an error. */
export const OnBlank = z.enum(['null', 'error']);
export type OnBlank = z.infer<typeof OnBlank>;

export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : 'configuration'}: ${i.message}`)
    .join('; ');
}

export function defineRoutine<S extends z.ZodType>(spec: {
  id: string;
  name: string;
  description: string;
  family: RoutineFamily;
  config: S;
  run: (config: z.infer<S>, call: RoutineCall) => RoutineResult;
}): BuiltInRoutine {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    family: spec.family,
    configSchema: spec.config,
    execute: ({ value, inputs, configuration }) => {
      const parsed = spec.config.safeParse(configuration);
      if (!parsed.success)
        return fail('ROUTINE_CONFIG_INVALID', `${spec.name}: ${describeIssues(parsed.error)}`);
      try {
        return spec.run(parsed.data, { value, inputs });
      } catch (e) {
        return fail(
          'ROUTINE_INTERNAL_ERROR',
          `${spec.name} failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  };
}
