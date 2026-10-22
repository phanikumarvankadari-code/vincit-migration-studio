import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DIR,
  archive,
  createCustomer,
  createObject,
  listCustomers,
  listObjects,
  openWorkspace,
  readProject,
  safeName,
  stamp,
  uniqueName,
  writeProject,
  type StoreContext,
} from '../src/index.js';
import { MemoryPort } from './memory-port.js';

function setup() {
  const port = new MemoryPort();
  let n = 0;
  let t = 0;
  const ctx: StoreContext = {
    port,
    newId: () => `id-${++n}`,
    now: () => `2026-10-22T10:00:${String(t++ % 60).padStart(2, '0')}.000Z`,
  };
  return { port, ctx };
}
const must = <T>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

describe('names (AC-2)', () => {
  it('makes unsafe, reserved and empty names safe', () => {
    expect(safeName('ACME: Plant/1?')).toBe('ACME_ Plant_1_');
    expect(safeName('  ..hidden.. ')).toBe('hidden');
    expect(safeName('CON')).toBe('CON_');
    expect(safeName('nul.txt')).toBe('nul.txt_');
    expect(safeName('')).toBe('Untitled');
    expect(safeName('...')).toBe('Untitled');
    expect(safeName('x'.repeat(200))).toHaveLength(80);
    expect(safeName('Müller & Söhne')).toBe('Müller & Söhne');
  });
  it('gives each clash its own number, ignoring case', () => {
    expect(uniqueName('Acme', [])).toBe('Acme');
    expect(uniqueName('Acme', ['acme'])).toBe('Acme (2)');
    expect(uniqueName('Acme', ['Acme', 'Acme (2)'])).toBe('Acme (3)');
  });
  it('turns a time into a folder-name stamp', () => {
    expect(stamp('2026-10-22T10:05:03.000Z')).toBe('20261022-100503');
  });
});

describe('workspace store', () => {
  it('AC-1 creates the layout and reads it back', async () => {
    const { port, ctx } = setup();
    expect(must(await openWorkspace(ctx))).toEqual({ created: true });
    expect(must(await openWorkspace(ctx))).toEqual({ created: false });
    const c = must(await createCustomer(ctx, 'Acme Oy', 'Pilot'));
    expect(c.folder).toBe('Acme Oy');
    const o = must(
      await createObject(
        ctx,
        c.folder,
        { name: 'Profit Center', entity: 'Profit Center' },
        '{"p":1}',
      ),
    );
    expect(o.hasProject).toBe(true);
    expect([...port.files.keys()].sort()).toEqual([
      'Acme Oy/Profit Center/object.json',
      'Acme Oy/Profit Center/project.mms.json',
      'Acme Oy/customer.json',
      'mms-workspace.json',
    ]);
    expect((await listCustomers(port))[0]!.customer).toMatchObject({
      name: 'Acme Oy',
      notes: 'Pilot',
    });
    expect((await listObjects(port, c.folder))[0]).toMatchObject({
      folder: 'Profit Center',
      hasProject: true,
      object: { name: 'Profit Center', revision: 0 },
    });
    expect(await readProject(port, c.folder, o.folder)).toBe('{"p":1}');
  });

  it('AC-2 two customers or objects with the same name get different folders', async () => {
    const { ctx } = setup();
    await openWorkspace(ctx);
    const a = must(await createCustomer(ctx, 'Acme'));
    const b = must(await createCustomer(ctx, 'acme'));
    expect(a.folder).toBe('Acme');
    expect(b.folder).toBe('acme (2)');
    const o1 = must(
      await createObject(ctx, a.folder, { name: 'Cost Center', entity: 'Cost Center' }),
    );
    const o2 = must(
      await createObject(ctx, a.folder, { name: 'Cost Center', entity: 'Cost Center' }),
    );
    expect(o1.folder).not.toBe(o2.folder);
    expect(o1.object.id).not.toBe(o2.object.id);
  });

  it('refuses empty names and a missing customer', async () => {
    const { ctx } = setup();
    await openWorkspace(ctx);
    expect((await createCustomer(ctx, '  ')).ok).toBe(false);
    const r = await createObject(ctx, 'Nobody', { name: 'X', entity: 'X' });
    expect(r).toMatchObject({ ok: false, message: 'That customer does not exist.' });
    const c = must(await createCustomer(ctx, 'Acme'));
    expect((await createObject(ctx, c.folder, { name: ' ', entity: 'X' })).ok).toBe(false);
  });

  it('AC-3 a save with the current revision bumps it; an old revision is a conflict and writes nothing', async () => {
    const { port, ctx } = setup();
    await openWorkspace(ctx);
    const c = must(await createCustomer(ctx, 'Acme'));
    const o = must(await createObject(ctx, c.folder, { name: 'PC', entity: 'PC' }, 'v0'));
    expect(must(await writeProject(ctx, c.folder, o.folder, 'v1', 0))).toEqual({ revision: 1 });
    expect(must(await writeProject(ctx, c.folder, o.folder, 'v2', 1))).toEqual({ revision: 2 });
    const stale = await writeProject(ctx, c.folder, o.folder, 'mine', 1);
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect(await readProject(port, c.folder, o.folder)).toBe('v2');
    expect((await listObjects(port, c.folder))[0]!.object.revision).toBe(2);
  });

  it('AC-4 archive moves a whole folder under _archive and removes the original', async () => {
    const { port, ctx } = setup();
    await openWorkspace(ctx);
    const c = must(await createCustomer(ctx, 'Acme'));
    const o = must(await createObject(ctx, c.folder, { name: 'PC', entity: 'PC' }, 'data'));
    await port.writeBytes([c.folder, o.folder, 'sources', 'CEPC.csv'], new Uint8Array([1, 2, 3]));
    const r = must(await archive(ctx, [c.folder, o.folder]));
    expect(r.archivedAs).toMatch(/^PC-20261022-1000\d\d$/);
    expect(await listObjects(port, c.folder)).toEqual([]);
    const keys = [...port.files.keys()].filter((k) => k.startsWith(`${ARCHIVE_DIR}/`)).sort();
    expect(keys).toEqual([
      `_archive/${r.archivedAs}/object.json`,
      `_archive/${r.archivedAs}/project.mms.json`,
      `_archive/${r.archivedAs}/sources/CEPC.csv`,
    ]);
    expect(
      Array.from((await port.readBytes([ARCHIVE_DIR, r.archivedAs, 'sources', 'CEPC.csv']))!),
    ).toEqual([1, 2, 3]);
    // a customer can be archived too, and the archive itself cannot
    must(await archive(ctx, [c.folder]));
    expect(await listCustomers(port)).toEqual([]);
    expect((await archive(ctx, [ARCHIVE_DIR, r.archivedAs])).ok).toBe(false);
    expect((await archive(ctx, [])).ok).toBe(false);
  });

  it('AC-5 refuses a folder with another manifest, or with other files and no manifest', async () => {
    const a = setup();
    await a.port.writeText(['mms-workspace.json'], '{"format":"other"}');
    expect(await openWorkspace(a.ctx)).toMatchObject({ ok: false });
    const b = setup();
    await b.port.writeText(['holiday.jpg'], 'x');
    expect(await openWorkspace(b.ctx)).toMatchObject({ ok: false });
    const c = setup();
    await c.port.writeText(['mms-workspace.json'], 'not json');
    expect(await openWorkspace(c.ctx)).toMatchObject({ ok: false });
  });

  it('ignores folders that are not customers or objects, and a damaged customer file', async () => {
    const { port, ctx } = setup();
    await openWorkspace(ctx);
    await port.writeText(['Random', 'notes.txt'], 'hi');
    await port.writeText(['Broken', 'customer.json'], '{"id":1}');
    const c = must(await createCustomer(ctx, 'Acme'));
    await port.writeText([c.folder, 'stray', 'a.txt'], 'x');
    expect((await listCustomers(port)).map((x) => x.folder)).toEqual(['Acme']);
    expect(await listObjects(port, c.folder)).toEqual([]);
  });
});
