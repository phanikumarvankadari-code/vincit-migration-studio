import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DIR,
  archive,
  copyBetweenPorts,
  countFiles,
  inputPath,
  inspectRoot,
  listRuns,
  listSourceFiles,
  runFolderName,
  saveRunOutput,
  chooseWorkspace,
  findNestedWorkspaces,
  safeFileName,
  scanCustomers,
  scopedPort,
  wrongFolderMessage,
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

describe('input files (SPEC-033)', () => {
  it('keeps the extension and makes the name safe', () => {
    expect(safeFileName('CEPC.csv')).toBe('CEPC.csv');
    expect(safeFileName('con.csv')).toBe('con_.csv');
    expect(safeFileName('C:\\data\\Profit/Center?.XLSX')).toBe('Center_.XLSX');
    expect(safeFileName('..')).toBe('Untitled');
    expect(inputPath('Acme', 'PC', 'sources', 'a:b.csv')).toEqual([
      'Acme',
      'PC',
      'sources',
      'a_b.csv',
    ]);
  });

  it('lists only csv and xlsx files directly inside sources', async () => {
    const { port } = setup();
    for (const f of ['b.csv', 'a.XLSX', 'notes.txt', 'dictionary/field.csv'])
      await port.writeText(['Acme', 'PC', 'sources', ...f.split('/')], 'x');
    expect(await listSourceFiles(port, 'Acme', 'PC')).toEqual(['a.XLSX', 'b.csv']);
    expect(await listSourceFiles(port, 'Acme', 'None')).toEqual([]);
  });

  it('tells an empty folder, a workspace and any other folder apart', async () => {
    const a = setup();
    expect(await inspectRoot(a.port)).toBe('empty');
    await openWorkspace(a.ctx);
    expect(await inspectRoot(a.port)).toBe('workspace');
    const b = setup();
    await b.port.writeText(['photos', 'x.jpg'], 'x');
    expect(await inspectRoot(b.port)).toBe('other');
  });
});

describe('run outputs (SPEC-034)', () => {
  it('AC-1 run folder names sort by time and are safe', () => {
    const a = runFolderName('2026-10-22T10:05:03.000Z', 'Initial: Mapping/1');
    const b = runFolderName('2026-10-22T11:00:00.000Z', 'A');
    expect(a).toBe('20261022-100503_Initial_ Mapping_1');
    expect([b, a].sort()).toEqual([a, b]);
  });

  it('AC-2 saves each run into its own folder, lists them newest first, and never reuses a folder', async () => {
    const { port, ctx } = setup();
    const bytes = (s: string) => new TextEncoder().encode(s);
    const run = { startedAt: '2026-10-22T10:05:03.000Z', snapshotName: 'Initial' };
    const files = [
      { name: 'Profit Center.csv', bytes: bytes('a') },
      { name: 'diagnostics.csv', bytes: bytes('b') },
    ];
    const first = must(await saveRunOutput(ctx, 'Acme', 'PC', run, files));
    expect(first).toEqual({ folder: '20261022-100503_Initial', files: 2 });
    const again = must(await saveRunOutput(ctx, 'Acme', 'PC', run, files));
    expect(again.folder).toBe('20261022-100503_Initial (2)');
    const later = must(
      await saveRunOutput(
        ctx,
        'Acme',
        'PC',
        { startedAt: '2026-10-22T12:00:00.000Z', snapshotName: 'Initial' },
        [files[0]!],
      ),
    );
    expect((await listRuns(port, 'Acme', 'PC')).map((r) => [r.folder, r.files])).toEqual([
      [later.folder, 1],
      ['20261022-100503_Initial (2)', 2],
      ['20261022-100503_Initial', 2],
    ]);
    expect(await port.readText(['Acme', 'PC', 'output', first.folder, 'Profit Center.csv'])).toBe(
      'a',
    );
    expect((await saveRunOutput(ctx, 'Acme', 'PC', run, [])).ok).toBe(false);
    expect(await listRuns(port, 'Acme', 'None')).toEqual([]);
  });

  it('two files with the same name in one run get different names', async () => {
    const { port, ctx } = setup();
    const b = new Uint8Array([1]);
    const r = must(
      await saveRunOutput(
        ctx,
        'Acme',
        'PC',
        { startedAt: '2026-10-22T10:00:00.000Z', snapshotName: 'S' },
        [
          { name: 'x.csv', bytes: b },
          { name: 'X.csv', bytes: b },
        ],
      ),
    );
    expect((await port.list(['Acme', 'PC', 'output', r.folder])).map((e) => e.name).sort()).toEqual(
      ['X (2).csv'.replace('X (2)', 'X (2)'), 'x.csv'].sort(),
    );
  });
});

describe('copy between storage places (move a customer to OneDrive)', () => {
  it('copies a whole customer with its files to another port and leaves the source alone', async () => {
    const a = setup();
    await openWorkspace(a.ctx);
    const c = must(await createCustomer(a.ctx, 'Acme'));
    const o = must(await createObject(a.ctx, c.folder, { name: 'PC', entity: 'PC' }, 'project'));
    await a.port.writeBytes([c.folder, o.folder, 'sources', 'CEPC.csv'], new Uint8Array([1, 2, 3]));
    await a.port.writeBytes([c.folder, o.folder, 'output', 'run1', 'x.csv'], new Uint8Array([9]));
    const b = setup();
    const n = await copyBetweenPorts(a.port, [c.folder], b.port, ['Acme (moved)']);
    expect(n).toBe(5);
    expect(await countFiles(b.port, ['Acme (moved)'])).toBe(await countFiles(a.port, [c.folder]));
    expect(
      Array.from((await b.port.readBytes(['Acme (moved)', 'PC', 'sources', 'CEPC.csv']))!),
    ).toEqual([1, 2, 3]);
    expect(await a.port.readText([c.folder, 'customer.json'])).toContain('Acme');
    expect(await copyBetweenPorts(a.port, ['Nobody'], b.port, ['x'])).toBe(0);
  });
});

describe('choosing the wrong folder', () => {
  it('recognises a customer folder and a business-object folder and does not treat them as foreign files', async () => {
    const c = setup();
    await c.port.writeText(['customer.json'], '{}');
    await c.port.writeText(['Profit Center', 'object.json'], '{}');
    expect(await inspectRoot(c.port)).toBe('customer');
    const o = setup();
    await o.port.writeText(['object.json'], '{}');
    await o.port.writeText(['project.mms.json'], '{}');
    expect(await inspectRoot(o.port)).toBe('object');
    expect(await openWorkspace(o.ctx)).toMatchObject({
      ok: false,
      message: wrongFolderMessage('object'),
    });
    expect(wrongFolderMessage('customer')).toContain('Choose the folder that contains it');
    expect([...o.port.files.keys()].sort()).toEqual(['object.json', 'project.mms.json']);
  });
});

describe('scanning customers', () => {
  it('lists customers and says which folders could not be read as one', async () => {
    const { port, ctx } = setup();
    await openWorkspace(ctx);
    await createCustomer(ctx, 'Acme');
    await port.writeText(['Random', 'notes.txt'], 'hi');
    await port.writeText(['Broken', 'customer.json'], '{"id":1}');
    await port.writeText(['_archive', 'x', 'customer.json'], '{}');
    const r = await scanCustomers(port);
    expect(r.customers.map((c) => c.folder)).toEqual(['Acme']);
    expect(r.skipped).toEqual([
      { folder: 'Random', reason: 'it has no customer.json' },
      { folder: 'Broken', reason: 'its customer.json is not valid' },
    ]);
  });
});

describe('workspaces inside a chosen folder (the real layout: MigrationStudio/Vincit)', () => {
  async function layout() {
    const { port, ctx } = setup();
    // MigrationStudio/Vincit is the real workspace (two customers); MigrationStudio/Migration Mapping Studio is an empty leftover
    const real = { ...ctx, port: scopedPort(port, ['Vincit']) };
    await openWorkspace(real);
    await createCustomer(real, 'Fiskars');
    await createCustomer(real, 'Vincit');
    const empty = { ...ctx, port: scopedPort(port, ['Migration Mapping Studio']) };
    await openWorkspace(empty);
    await port.writeText(['.DS_Store'], 'x');
    await port.writeText(['Stray', 'a.txt'], 'x');
    return { port, ctx };
  }

  it('finds workspaces one level down, the ones with customers first', async () => {
    const { port } = await layout();
    expect(await inspectRoot(port)).toBe('other');
    expect(await findNestedWorkspaces(port)).toEqual([
      { folder: 'Vincit', customers: 2 },
      { folder: 'Migration Mapping Studio', customers: 0 },
    ]);
  });

  it('uses the one with customers when the others are empty leftovers; asks when it is not clear', async () => {
    const { port } = await layout();
    expect(chooseWorkspace(await findNestedWorkspaces(port))).toEqual({
      kind: 'one',
      folder: 'Vincit',
    });
    expect(chooseWorkspace([])).toEqual({ kind: 'none' });
    expect(chooseWorkspace([{ folder: 'A', customers: 0 }])).toEqual({ kind: 'one', folder: 'A' });
    const two = [
      { folder: 'A', customers: 1 },
      { folder: 'B', customers: 3 },
    ];
    expect(chooseWorkspace(two)).toEqual({ kind: 'many', options: two });
    const empties = [
      { folder: 'A', customers: 0 },
      { folder: 'B', customers: 0 },
    ];
    expect(chooseWorkspace(empties)).toEqual({ kind: 'many', options: empties });
  });

  it('a scoped port reads and writes inside its folder only', async () => {
    const { port } = setup();
    const inner = scopedPort(port, ['A']);
    await inner.writeText(['x.txt'], 'hi');
    expect([...port.files.keys()]).toEqual(['A/x.txt']);
    expect(await inner.readText(['x.txt'])).toBe('hi');
    expect(await inner.list([])).toEqual([{ name: 'x.txt', kind: 'file' }]);
    await inner.remove(['x.txt']);
    expect(port.files.size).toBe(0);
  });
});
