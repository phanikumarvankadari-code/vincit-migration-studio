import { describe, expect, it } from 'vitest';
import {
  archive,
  createCustomer,
  createObject,
  listObjects,
  openWorkspace,
  readProject,
  writeProject,
  type StoreContext,
} from '@mms/workspace-files';
import {
  createStudioState,
  decodeWorkspace,
  encodeWorkspace,
  reduce,
  summarizeWorkspace,
} from '@mms/studio-model';
import { MemoryPort } from '../../../packages/workspace-files/test/memory-port.js';

const AT = '2026-10-22T10:00:00.000Z';

/** M12 / SPEC-032: a customer with business objects, each holding a project that survives save and reload. */
describe('M12 customer workspace with business objects', () => {
  let n = 0;
  const ctx: StoreContext = { port: new MemoryPort(), now: () => AT, newId: () => `id-${++n}` };
  const projectText = (name: string): string => {
    const st = createStudioState({ id: `p-${name}`, name, businessEntity: name, at: AT });
    return encodeWorkspace({
      project: st.project,
      snapshots: [],
      dictionary: undefined,
      savedAt: AT,
    });
  };

  it('M12-01 one customer holds several business objects, each with its own project file', async () => {
    await openWorkspace(ctx);
    const acme = await createCustomer(ctx, 'Acme Oy');
    if (!acme.ok) throw new Error(acme.message);
    for (const name of ['Profit Center', 'Cost Center', 'Vendor']) {
      const r = await createObject(
        ctx,
        acme.value.folder,
        { name, entity: name },
        projectText(name),
      );
      expect(r.ok).toBe(true);
    }
    const objects = await listObjects(ctx.port, acme.value.folder);
    expect(objects.map((o) => o.folder)).toEqual(['Cost Center', 'Profit Center', 'Vendor']);
    expect(objects.every((o) => o.hasProject)).toBe(true);
  });

  it('M12-02 a saved project reads back as the same project, and the card summary reflects it', async () => {
    const acme = 'Acme Oy';
    const text = (await readProject(ctx.port, acme, 'Profit Center'))!;
    const decoded = decodeWorkspace(text);
    if (!decoded.ok) throw new Error('decode');
    const renamed = reduce(createStudioState({ id: 'p', name: 'x', businessEntity: 'x', at: AT }), {
      type: 'workspaceLoaded',
      workspace: decoded.value,
    });
    expect(renamed.project.name).toBe('Profit Center');
    expect(summarizeWorkspace(decoded.value)).toEqual({
      state: 'draft',
      datasets: 0,
      structures: 0,
      fields: 0,
      mapped: 0,
      snapshots: 0,
      requiredOpen: 0,
      joinsConfirmed: 0,
    });
    const saved = await writeProject(ctx, acme, 'Profit Center', text, 0);
    expect(saved).toEqual({ ok: true, value: { revision: 1 } });
  });

  it('M12-03 two sessions saving the same object: the second is told it is out of date', async () => {
    const text = (await readProject(ctx.port, 'Acme Oy', 'Cost Center'))!;
    expect((await writeProject(ctx, 'Acme Oy', 'Cost Center', text, 0)).ok).toBe(true);
    const stale = await writeProject(ctx, 'Acme Oy', 'Cost Center', text, 0);
    expect(stale).toMatchObject({ ok: false, conflict: true });
  });

  it('M12-04 archiving an object keeps all its files under _archive', async () => {
    const r = await archive(ctx, ['Acme Oy', 'Vendor']);
    expect(r.ok).toBe(true);
    expect((await listObjects(ctx.port, 'Acme Oy')).map((o) => o.folder)).toEqual([
      'Cost Center',
      'Profit Center',
    ]);
    if (r.ok)
      expect(await ctx.port.readText(['_archive', r.value.archivedAs, 'object.json'])).toContain(
        'Vendor',
      );
  });
});
