import type { z } from 'zod';
import type { Diagnostic, Result } from './diagnostics.js';
import { type MappingDefinition } from './mapping.js';
import { ProjectSchema, type Project } from './project.js';
import { MappingSnapshotSchema, type MappingSnapshot } from './snapshot.js';

export const SCHEMA_VERSION = 1;
export const PROJECT_FORMAT = 'mms.project';
export const SNAPSHOT_FORMAT = 'mms.snapshot';

function fromZod(error: z.ZodError): Diagnostic[] {
  return error.issues.map((i) => ({
    severity: 'error' as const,
    code: 'MODEL_SCHEMA_INVALID',
    message: i.message,
    path: i.path
      .map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`))
      .join('')
      .replace(/^\./, ''),
  }));
}

function fail(code: string, message: string): Result<never> {
  return { ok: false, issues: [{ severity: 'error', code, message }] };
}

/** Structural validation of untrusted input. Does not check references (see validateProject). */
export function parseProject(input: unknown): Result<Project> {
  const r = ProjectSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: fromZod(r.error) };
}

export function parseSnapshot(input: unknown): Result<MappingSnapshot> {
  const r = MappingSnapshotSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: fromZod(r.error) };
}

/** Transformation chains are stored in execution order. */
function canonicalMapping(def: MappingDefinition): MappingDefinition {
  return {
    ...def,
    mappings: def.mappings.map((m) => ({
      ...m,
      transformations: [...m.transformations].sort((a, b) => a.order - b.order),
    })),
  };
}

function stringify(format: string, key: string, body: unknown): string {
  return JSON.stringify({ format, schemaVersion: SCHEMA_VERSION, [key]: body }, null, 2) + '\n';
}

/** Canonical JSON: schema key order, chains sorted by order, 2-space indent, trailing newline. */
export function serializeProject(project: Project): string {
  return stringify(PROJECT_FORMAT, 'project', {
    ...project,
    mappingDefinition: canonicalMapping(project.mappingDefinition),
  });
}

export function serializeSnapshot(snapshot: MappingSnapshot): string {
  return stringify(SNAPSHOT_FORMAT, 'snapshot', {
    ...snapshot,
    mappingDefinition: canonicalMapping(snapshot.mappingDefinition),
  });
}

function unwrap(text: string, format: string, key: string): Result<unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return fail('MODEL_JSON_INVALID', 'Input is not valid JSON.');
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc))
    return fail('MODEL_ENVELOPE_INVALID', 'Expected a JSON object.');
  const env = doc as Record<string, unknown>;
  if (env['format'] !== format) return fail('MODEL_FORMAT_UNKNOWN', `Expected format "${format}".`);
  const version = env['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('MODEL_VERSION_INVALID', 'schemaVersion must be a positive integer.');
  }
  if (version > SCHEMA_VERSION) {
    return fail(
      'MODEL_VERSION_UNSUPPORTED',
      `schemaVersion ${version} is newer than supported ${SCHEMA_VERSION}.`,
    );
  }
  // Migrations for older versions are registered here. Version 1 is the first.
  return { ok: true, value: env[key] };
}

export function deserializeProject(text: string): Result<Project> {
  const u = unwrap(text, PROJECT_FORMAT, 'project');
  return u.ok ? parseProject(u.value) : u;
}

export function deserializeSnapshot(text: string): Result<MappingSnapshot> {
  const u = unwrap(text, SNAPSHOT_FORMAT, 'snapshot');
  return u.ok ? parseSnapshot(u.value) : u;
}
