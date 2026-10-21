import {
  IsoDateTimeSchema,
  MappingSnapshotSchema,
  ProjectSchema,
  parseProject,
  validateProject,
  type Diagnostic,
  type Project,
  type Result,
} from '@mms/mapping-core';
import type { DictionaryEntry, FieldDictionary } from '@mms/file-import';
import { z } from 'zod';
import type { SnapshotRecord } from './snapshots.js';

/** Everything that is saved: the draft, its snapshots and the field dictionary. Row data is never saved. */
export interface Workspace {
  project: Project;
  snapshots: SnapshotRecord[];
  dictionary: FieldDictionary | undefined;
  savedAt: string;
}

export const WORKSPACE_FORMAT = 'mms.workspace';
export const WORKSPACE_VERSION = 1;

const DictionaryEntrySchema = z.strictObject({
  table: z.string(),
  field: z.string(),
  position: z.number(),
  isKey: z.boolean(),
  mandatory: z.boolean(),
  rollName: z.string().optional(),
  checkTable: z.string().optional(),
  nativeType: z.string().optional(),
  length: z.number().optional(),
  datatype: z.enum([
    'string',
    'integer',
    'decimal',
    'boolean',
    'date',
    'dateTime',
    'time',
    'uuid',
    'unknown',
  ]),
});

const RecordSchema = z.strictObject({
  snapshot: z.unknown(),
  marker: z.enum(['none', 'ready', 'approved']),
  markedAt: IsoDateTimeSchema.optional(),
});

const fail = (code: string, message: string): Result<never> => ({
  ok: false,
  issues: [{ severity: 'error', code, message }],
});

/**
 * Canonical JSON text of a workspace. Everything goes through its schema first, so the text is the same however the
 * objects were built (same content, same bytes).
 */
export function encodeWorkspace(ws: Workspace): string {
  return (
    JSON.stringify(
      {
        format: WORKSPACE_FORMAT,
        schemaVersion: WORKSPACE_VERSION,
        savedAt: ws.savedAt,
        project: ProjectSchema.parse(ws.project),
        snapshots: ws.snapshots.map((r) => ({
          snapshot: MappingSnapshotSchema.parse(r.snapshot),
          marker: r.marker,
          ...(r.markedAt ? { markedAt: r.markedAt } : {}),
        })),
        ...(ws.dictionary
          ? { dictionary: ws.dictionary.entries.map((e) => DictionaryEntrySchema.parse(e)) }
          : {}),
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * Reads a saved workspace. Anything that is not a consistent workspace of a version this program understands gives
 * diagnostics instead of a half-loaded project.
 */
export function decodeWorkspace(text: string): Result<Workspace> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return fail('WORKSPACE_JSON_INVALID', 'The saved project is not valid JSON.');
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc))
    return fail('WORKSPACE_INVALID', 'The saved project has an unexpected shape.');
  const env = doc as Record<string, unknown>;
  if (env['format'] !== WORKSPACE_FORMAT)
    return fail('WORKSPACE_FORMAT_UNKNOWN', 'This is not a Migration Mapping Studio project file.');
  const version = env['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return fail('WORKSPACE_VERSION_INVALID', 'The project file has no valid version.');
  if (version > WORKSPACE_VERSION)
    return fail(
      'WORKSPACE_VERSION_UNSUPPORTED',
      `The project file is version ${version}; this program reads up to version ${WORKSPACE_VERSION}. Update the program.`,
    );

  const project = parseProject(env['project']);
  if (!project.ok) return { ok: false, issues: project.issues };
  const consistency = validateProject(project.value).filter((d) => d.severity === 'error');
  if (consistency.length > 0) return { ok: false, issues: consistency };

  const snapshots: SnapshotRecord[] = [];
  const raw = env['snapshots'];
  if (!Array.isArray(raw))
    return fail('WORKSPACE_INVALID', 'The project file lists no snapshots array.');
  const issues: Diagnostic[] = [];
  raw.forEach((item, i) => {
    const rec = RecordSchema.safeParse(item);
    const snap = rec.success ? MappingSnapshotSchema.safeParse(rec.data.snapshot) : undefined;
    if (!rec.success || !snap?.success) {
      issues.push({
        severity: 'error',
        code: 'WORKSPACE_SNAPSHOT_INVALID',
        message: `Snapshot ${i + 1} in the project file is not valid.`,
      });
      return;
    }
    snapshots.push({ snapshot: snap.data, marker: rec.data.marker, markedAt: rec.data.markedAt });
  });
  if (issues.length > 0) return { ok: false, issues };

  let dictionary: FieldDictionary | undefined;
  if (env['dictionary'] !== undefined) {
    const d = z.array(DictionaryEntrySchema).safeParse(env['dictionary']);
    if (!d.success)
      return fail(
        'WORKSPACE_DICTIONARY_INVALID',
        'The field dictionary in the project file is not valid.',
      );
    dictionary = { entries: d.data as DictionaryEntry[] };
  }
  const savedAt = IsoDateTimeSchema.safeParse(env['savedAt']);
  return {
    ok: true,
    value: {
      project: project.value,
      snapshots,
      dictionary,
      savedAt: savedAt.success ? savedAt.data : project.value.updatedAt,
    },
  };
}
