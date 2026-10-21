import { describe, expect, it } from 'vitest';
import { deserializeProject, parseProject, serializeProject, type Project } from '../src/index.js';
import { profitCenterRaw } from './fixtures/profit-center.js';

function load(raw: unknown = profitCenterRaw()): Project {
  const r = parseProject(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

describe('project parsing', () => {
  it('parses the Profit Center reference project', () => {
    const p = load();
    expect(p.targetDefinition?.structures).toHaveLength(3);
    expect(p.sourceDefinitions).toHaveLength(3);
  });

  it('a project may exist before a target is loaded', () => {
    const raw = profitCenterRaw();
    delete raw['targetDefinition'];
    expect(parseProject(raw).ok).toBe(true);
  });

  it('rejects a Date object timestamp and a non-UTC string', () => {
    expect(parseProject({ ...profitCenterRaw(), createdAt: new Date() }).ok).toBe(false);
    expect(parseProject({ ...profitCenterRaw(), createdAt: '2026-10-21 10:00' }).ok).toBe(false);
  });

  it('returns structured issues with a path, never throws', () => {
    const r = parseProject({ ...profitCenterRaw(), name: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]).toMatchObject({
        severity: 'error',
        code: 'MODEL_SCHEMA_INVALID',
        path: 'name',
      });
    }
    expect(parseProject(42).ok).toBe(false);
    expect(parseProject(null).ok).toBe(false);
  });
});

describe('serialization (AC-007)', () => {
  it('AC-007 round-trips a complete project to an equal object', () => {
    const p = load();
    const back = deserializeProject(serializeProject(p));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value).toEqual(p);
  });

  it('output is byte-stable: serialize(deserialize(x)) === x', () => {
    const text = serializeProject(load());
    const back = deserializeProject(text);
    expect(back.ok && serializeProject(back.value)).toBe(text);
  });

  it('output does not depend on input key order', () => {
    const raw = profitCenterRaw();
    const reversed = Object.fromEntries(Object.entries(raw).reverse());
    expect(serializeProject(load(reversed))).toBe(serializeProject(load(raw)));
  });

  it('writes an envelope with format and schemaVersion and ends with a newline', () => {
    const text = serializeProject(load());
    const doc = JSON.parse(text);
    expect(doc.format).toBe('mms.project');
    expect(doc.schemaVersion).toBe(1);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('serializes a chain in execution order even if stored out of order', () => {
    const raw = profitCenterRaw() as any;
    const m = raw.mappingDefinition.mappings.find((x: any) => x.id === 'm-validfrom');
    m.transformations.reverse();
    const doc = JSON.parse(serializeProject(load(raw)));
    const out = doc.project.mappingDefinition.mappings.find((x: any) => x.id === 'm-validfrom');
    expect(out.transformations.map((t: any) => t.routineId)).toEqual([
      'r-zero-date',
      'r-parse-date',
      'r-format-date',
    ]);
  });

  it('does not store row data or UI layout', () => {
    const text = serializeProject(load());
    expect(text).not.toMatch(/"rows"|"position"|"nodes"/);
  });

  it('matches the stored golden JSON', async () => {
    await expect(serializeProject(load())).toMatchFileSnapshot(
      './fixtures/profit-center.project.json',
    );
  });
});

describe('deserialization errors', () => {
  const doc = (over: object) =>
    JSON.stringify({
      format: 'mms.project',
      schemaVersion: 1,
      project: profitCenterRaw(),
      ...over,
    });

  it.each([
    ['not json', 'MODEL_JSON_INVALID', '{oops'],
    ['not an object', 'MODEL_ENVELOPE_INVALID', '[]'],
    ['wrong format', 'MODEL_FORMAT_UNKNOWN', doc({ format: 'other' })],
    ['bad version', 'MODEL_VERSION_INVALID', doc({ schemaVersion: 'one' })],
    ['newer version', 'MODEL_VERSION_UNSUPPORTED', doc({ schemaVersion: 2 })],
  ])('%s -> %s', (_n, code, text) => {
    const r = deserializeProject(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe(code);
  });

  it('reports schema problems inside a valid envelope', () => {
    const r = deserializeProject(doc({ project: { ...profitCenterRaw(), projectState: 'weird' } }));
    expect(r.ok).toBe(false);
  });
});
