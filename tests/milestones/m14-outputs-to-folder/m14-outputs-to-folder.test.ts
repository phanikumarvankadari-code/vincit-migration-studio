import { describe, expect, it } from 'vitest';
import { listRuns, saveRunOutput, type StoreContext } from '@mms/workspace-files';
import { MemoryPort } from '../../../packages/workspace-files/test/memory-port.js';

/** M14 / SPEC-034: the files of a run are kept under the object, one folder per run, nothing replaced. */
describe('M14 outputs saved into the object folder', () => {
  const port = new MemoryPort();
  const ctx: StoreContext = { port, now: () => '2026-10-22T10:00:00.000Z', newId: () => 'id' };
  const enc = new TextEncoder();
  const files = [
    { name: 'Profit Center.csv', bytes: enc.encode('Profit Center\r\nP100\r\n') },
    { name: 'Profit Center.errors.csv', bytes: enc.encode('row,reason\r\n') },
    { name: 'diagnostics.csv', bytes: enc.encode('severity\r\n') },
    { name: 'run-summary.json', bytes: enc.encode('{}') },
  ];

  it('M14-01 a run is saved under output/<time>_<snapshot> with every file', async () => {
    const r = await saveRunOutput(
      ctx,
      'Acme',
      'Profit Center',
      { startedAt: '2026-10-22T10:05:03.000Z', snapshotName: 'Approved Mapping' },
      files,
    );
    expect(r).toEqual({
      ok: true,
      value: { folder: '20261022-100503_Approved Mapping', files: 4 },
    });
    expect(
      (await port.list(['Acme', 'Profit Center', 'output', '20261022-100503_Approved Mapping']))
        .map((e) => e.name)
        .sort(),
    ).toEqual([
      'Profit Center.csv',
      'Profit Center.errors.csv',
      'diagnostics.csv',
      'run-summary.json',
    ]);
  });

  it('M14-02 a second run with the same name and time gets its own folder; the first is untouched', async () => {
    const r = await saveRunOutput(
      ctx,
      'Acme',
      'Profit Center',
      { startedAt: '2026-10-22T10:05:03.000Z', snapshotName: 'Approved Mapping' },
      [{ name: 'Profit Center.csv', bytes: enc.encode('changed') }],
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.value.folder).toBe('20261022-100503_Approved Mapping (2)');
    expect(
      await port.readText([
        'Acme',
        'Profit Center',
        'output',
        '20261022-100503_Approved Mapping',
        'Profit Center.csv',
      ]),
    ).toBe('Profit Center\r\nP100\r\n');
  });

  it('M14-03 runs are listed newest first with their file counts', async () => {
    await saveRunOutput(
      ctx,
      'Acme',
      'Profit Center',
      { startedAt: '2026-10-23T08:00:00.000Z', snapshotName: 'Approved Mapping' },
      files.slice(0, 2),
    );
    expect((await listRuns(port, 'Acme', 'Profit Center')).map((r) => [r.folder, r.files])).toEqual(
      [
        ['20261023-080000_Approved Mapping', 2],
        ['20261022-100503_Approved Mapping (2)', 1],
        ['20261022-100503_Approved Mapping', 4],
      ],
    );
  });
});
