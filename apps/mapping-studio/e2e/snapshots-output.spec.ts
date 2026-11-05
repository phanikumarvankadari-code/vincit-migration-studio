import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  addSmallSources,
  bigCepc,
  BUKRS_SMALL,
  goToStage,
  loadSmallTarget,
  mapSmallProject,
  openApp,
  openEditor,
  runTest,
  setUpSmallMapping,
} from './helpers';

/** Small data without problems, so a snapshot can be saved after a clean test. */
async function cleanProject(page: Page) {
  await openApp(page);
  await page.getByTestId('source-files-input').setInputFiles([
    {
      name: 'CEPC.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Profit Center,Valid To,Valid From,Country',
          'P100,12/31/99,1/1/26,FI',
          'P200,12/31/99,5/1/26,SE',
        ].join('\n'),
      ),
    },
    {
      ...BUKRS_SMALL,
      buffer: Buffer.from(['Profit Center,Company Code', 'P100,FI01', 'P100,FI02'].join('\n')),
    },
  ]);
  await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
  await page
    .getByTestId('relationship-rel-CEPC-CEPC_BUKRS')
    .getByRole('button', { name: 'Confirm join' })
    .click();
  await loadSmallTarget(page);
  await goToStage(page, 'map');
  await mapSmallProject(page);
}

async function saveSnapshot(page: Page, name: string) {
  await goToStage(page, 'ready');
  await page.getByLabel('Snapshot name').fill(name);
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await expect(page.getByTestId(`snapshot-${name}`)).toBeVisible();
}

test.describe('Snapshots and history (SPEC-027)', () => {
  test('a snapshot cannot be saved until the mapping is usable, and the reasons are listed', async ({
    page,
  }) => {
    await openApp(page);
    await goToStage(page, 'ready');
    await expect(page.getByTestId('snapshot-blockers')).toContainText(
      'Load a target structure before saving a snapshot.',
    );
    await expect(page.getByTestId('snapshot-blockers')).toContainText(
      'There are no mappings to save yet.',
    );
    await expect(page.getByRole('button', { name: 'Save snapshot' })).toBeDisabled();
    await expect(page.getByTestId('draft-status')).toHaveText('No snapshot saved yet.');
  });

  test('saves named snapshots with a history, marks them Ready or Approved, and keeps older ones unchanged', async ({
    page,
  }) => {
    await cleanProject(page);
    await saveSnapshot(page, 'Initial Mapping');
    await expect(page.getByTestId('draft-status')).toHaveText(
      'The draft is the same as "Initial Mapping".',
    );
    await expect(page.getByTestId('marker-Initial Mapping')).toHaveText('Not marked');
    await expect(page.getByTestId('snapshot-Initial Mapping')).toContainText(
      '2 structures · 6 mappings',
    );

    // change the draft: the status says so, and the saved snapshot is not affected
    await goToStage(page, 'map');
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByLabel('Constant value').fill('FI');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await goToStage(page, 'ready');
    await expect(page.getByTestId('draft-status')).toHaveText(
      'The draft has changes since "Initial Mapping".',
    );
    await page.getByLabel('Snapshot name').fill('SIT Cycle 1');
    await page.getByRole('button', { name: 'Save snapshot' }).click();
    const rows = page.getByRole('table', { name: 'Snapshot history' }).getByRole('row');
    await expect(rows).toHaveCount(3); // header + 2
    await expect(rows.nth(1)).toContainText('SIT Cycle 1'); // newest first
    await expect(rows.nth(2)).toContainText('Initial Mapping');

    await page.getByRole('button', { name: 'Mark SIT Cycle 1 ready' }).click();
    await expect(page.getByTestId('marker-SIT Cycle 1')).toHaveText('Ready');
    await page.getByRole('button', { name: 'Mark SIT Cycle 1 approved' }).click();
    await expect(page.getByTestId('marker-SIT Cycle 1')).toHaveText('Approved');
    await page.getByRole('button', { name: 'Clear mark of SIT Cycle 1' }).click();
    await expect(page.getByTestId('marker-SIT Cycle 1')).toHaveText('Not marked');
  });

  test('names must be given and be unique', async ({ page }) => {
    await cleanProject(page);
    await goToStage(page, 'ready');
    await page.getByRole('button', { name: 'Save snapshot' }).click();
    await expect(page.getByTestId('snapshot-error')).toContainText('Give the snapshot a name');
    await saveSnapshot(page, 'Initial Mapping');
    await page.getByLabel('Snapshot name').fill('initial mapping');
    await page.getByRole('button', { name: 'Save snapshot' }).click();
    await expect(page.getByTestId('snapshot-error')).toContainText('already exists');
  });

  test('a snapshot can be reloaded as the draft: the draft behaves as it did when saved', async ({
    page,
  }) => {
    await cleanProject(page);
    await saveSnapshot(page, 'Initial Mapping');
    await goToStage(page, 'map');
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByLabel('Constant value').fill('FI');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByRole('button', { name: 'Remove mapping' }).click();
    await expect(page.getByTestId('completeness-text-Profit Center')).toHaveText(
      '3 of 4 fields mapped (75%)',
    );
    await goToStage(page, 'ready');
    // the draft has changes that no snapshot has: reloading asks first
    await page.getByRole('button', { name: 'Reload Initial Mapping as draft' }).click();
    await expect(page.getByRole('dialog', { name: 'Reload snapshot' })).toContainText(
      'not in any snapshot',
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Reload Initial Mapping as draft' }).click();
    await page.getByRole('button', { name: 'Reload anyway' }).click();
    await expect(page.getByTestId('draft-status')).toHaveText(
      'The draft is the same as "Initial Mapping".',
    );
    await goToStage(page, 'map');
    await expect(page.getByTestId('completeness-text-Profit Center')).toHaveText(
      '4 of 4 fields mapped (100%)',
    );
    await runTest(page);
    await expect(page.getByTestId('run-summary')).toContainText('The test ran without errors.');
    await expect(page.getByTestId('cell-1-Language')).toHaveText('EN');
  });

  test('the Ready checklist follows: snapshot saved, then marked', async ({ page }) => {
    await cleanProject(page);
    await runTest(page);
    await goToStage(page, 'ready');
    await expect(page.getByTestId('ready-summary')).toHaveText('7 of 9 checks done');
    await expect(page.getByTestId('stage-ready-summary')).toHaveText('Ready to save a snapshot');
    await saveSnapshot(page, 'Initial Mapping');
    await expect(page.getByTestId('ready-summary')).toHaveText('8 of 9 checks done');
    await page.getByRole('button', { name: 'Mark Initial Mapping approved' }).click();
    await expect(page.getByTestId('ready-summary')).toHaveText('9 of 9 checks done');
    await expect(page.getByTestId('stage-ready-summary')).toHaveText(
      'Snapshot "Initial Mapping" is approved',
    );
  });
});

test.describe('Autosave and project files (SPEC-027)', () => {
  test('the draft and its snapshots are saved automatically and come back after a reload; rows are not kept and can be loaded again', async ({
    page,
  }) => {
    await cleanProject(page);
    await saveSnapshot(page, 'Initial Mapping');
    await page.getByRole('button', { name: 'Mark Initial Mapping ready' }).click();
    await expect(page.getByTestId('autosave-status')).toContainText('Autosaved');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('restored-banner')).toContainText('was restored');
    await expect(page.getByTestId('project-name')).toHaveText('New migration project');
    await expect(page.getByTestId('stage-sources-summary')).toHaveText(
      '2 datasets, data not loaded',
    );
    await expect(page.getByTestId('stage-map-summary')).toContainText('6 of 6 fields mapped');
    await expect(page.getByTestId('marker-Initial Mapping')).toHaveCount(0); // we are on Sources
    await expect(page.getByTestId('missing-data-banner')).toContainText(
      'The rows of 2 datasets are not loaded (CEPC, CEPC_BUKRS)',
    );
    await expect(page.getByTestId('dataset-CEPC')).toContainText('data not loaded');
    // reload the rows from the same files
    await page.getByTestId('reattach-input').setInputFiles([
      {
        name: 'CEPC.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          [
            'Profit Center,Valid To,Valid From,Country',
            'P100,12/31/99,1/1/26,FI',
            'P200,12/31/99,5/1/26,SE',
          ].join('\n'),
        ),
      },
      {
        name: 'CEPC_BUKRS.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(['Profit Center,Company Code', 'P100,FI01', 'P100,FI02'].join('\n')),
      },
    ]);
    await expect(page.getByTestId('missing-data-banner')).toHaveCount(0);
    await expect(page.getByTestId('dataset-CEPC')).toContainText('2 rows');
    await runTest(page);
    await expect(page.getByTestId('run-summary')).toContainText('The test ran without errors.');
    await goToStage(page, 'ready');
    await expect(page.getByTestId('marker-Initial Mapping')).toHaveText('Ready');
  });

  test('a file with other columns is refused when reloading rows, with the reason', async ({
    page,
  }) => {
    await cleanProject(page);
    await page.waitForTimeout(500);
    await page.reload();
    await page.getByTestId('reattach-input').setInputFiles({
      name: 'CEPC.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Profit Center,Other\nP100,x\n'),
    });
    await expect(
      page.getByText(
        'does not fit: the project expects the columns Profit Center, Valid To, Valid From, Country but the file has Profit Center, Other',
      ),
    ).toBeVisible();
    await expect(page.getByTestId('missing-data-banner')).toBeVisible();
  });

  test('a project can be saved to a file and opened again, including snapshots, and the file holds no rows', async ({
    page,
  }) => {
    await cleanProject(page);
    await saveSnapshot(page, 'Initial Mapping');
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Project name').fill('Profit Center SIT');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save project file' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Profit Center SIT.mms.json');
    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({ format: 'mms.workspace', schemaVersion: 1 });
    expect(doc.snapshots).toHaveLength(1);
    expect(text).not.toContain('P100');
    // a new project is empty ...
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByRole('button', { name: 'Start new project' }).click();
    await expect(page.getByTestId('project-name')).toHaveText('New migration project');
    await expect(page.getByTestId('stage-sources-summary')).toHaveText('No files yet');
    // ... and the saved file brings everything back
    await page.getByTestId('project-file-input').setInputFiles(path);
    await expect(page.getByTestId('project-name')).toHaveText('Profit Center SIT');
    await expect(page.getByTestId('stage-map-summary')).toContainText('6 of 6 fields mapped');
    await goToStage(page, 'ready');
    await expect(page.getByTestId('snapshot-Initial Mapping')).toBeVisible();
  });

  test('a file that is not a project is refused, and a damaged saved project is reported instead of half loaded', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId('project-file-input').setInputFiles({
      name: 'x.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":"other"}'),
    });
    await expect(page.getByTestId('open-error')).toContainText(
      'This is not a Migration Mapping Studio project file.',
    );
    await page.evaluate(() =>
      window.localStorage.setItem(
        'mms:workspace',
        '{"format":"mms.workspace","schemaVersion":1,"project":{}}',
      ),
    );
    await page.reload();
    await expect(page.getByTestId('unreadable-banner')).toContainText(
      'could not be read and was not loaded',
    );
    await expect(page.getByTestId('stage-sources-summary')).toHaveText('No files yet');
  });

  test('starting a new project asks first when there is work, and clears the saved copy', async ({
    page,
  }) => {
    await openApp(page);
    await addSmallSources(page);
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.getByRole('dialog', { name: 'Start a new project' })).toContainText(
      'Save a project file first',
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByRole('button', { name: 'Start new project' }).click();
    await expect(page.getByTestId('stage-sources-summary')).toHaveText('No files yet');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('restored-banner')).toContainText('was restored'); // the empty new project was saved
    await expect(page.getByTestId('stage-sources-summary')).toHaveText('No files yet');
  });
});

test.describe('Full local run and output (SPEC-028)', () => {
  async function approved(page: Page) {
    await cleanProject(page);
    await runTest(page);
    await saveSnapshot(page, 'Approved Mapping');
    await page.getByRole('button', { name: 'Mark Approved Mapping approved' }).click();
  }

  test('output needs a snapshot that is marked Ready or Approved', async ({ page }) => {
    await cleanProject(page);
    await goToStage(page, 'ready');
    await expect(page.getByTestId('output-needs-marker')).toBeVisible();
    await saveSnapshot(page, 'Initial Mapping');
    await expect(page.getByTestId('output-needs-marker')).toBeVisible();
    await page.getByRole('button', { name: 'Mark Initial Mapping ready' }).click();
    await expect(page.getByTestId('output-needs-marker')).toHaveCount(0);
    await expect(page.getByLabel('Snapshot to run')).toContainText('Initial Mapping (Ready)');
  });

  test('runs on all rows and offers the files, with a summary', async ({ page }) => {
    await approved(page);
    await page.getByRole('button', { name: 'Run on all rows and create files' }).click();
    await expect(page.getByTestId('output-summary')).toBeVisible();
    await expect(page.getByTestId('output-status')).toHaveText('The run finished without errors.');
    await expect(page.getByTestId('output-snapshot')).toContainText('Snapshot “Approved Mapping”');
    await expect(page.getByTestId('output-structure-Profit Center')).toContainText(
      'Profit Center2000',
    );
    await expect(page.getByTestId('output-structure-Company Codes')).toContainText(
      'Company Codes2000',
    );
    await expect(page.getByTestId('output-file-Profit Center.csv')).toContainText('2');
    await expect(page.getByTestId('output-file-diagnostics.csv')).toBeVisible();
    await expect(page.getByTestId('output-file-run-summary.json')).toBeVisible();
  });

  test('downloaded CSV files hold the transformed rows; the run summary is complete', async ({
    page,
  }) => {
    await approved(page);
    await page.getByRole('button', { name: 'Run on all rows and create files' }).click();
    await expect(page.getByTestId('output-summary')).toBeVisible();
    const pc = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Profit Center.csv' }).click();
    const text = readFileSync((await (await pc).path())!, 'utf8');
    expect(text).toBe(
      [
        'Profit Center,Valid From,Region,Language',
        'P100,20260101,North,EN',
        'P200,20260501,North,EN',
        '',
      ].join('\r\n'),
    );
    const cc = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Company Codes.csv' }).click();
    expect(readFileSync((await (await cc).path())!, 'utf8')).toBe(
      ['Profit Center,Company Code', 'P100,FI01', 'P100,FI02', ''].join('\r\n'),
    );
    const summary = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download run-summary.json' }).click();
    const s = JSON.parse(readFileSync((await (await summary).path())!, 'utf8'));
    expect(s).toMatchObject({
      snapshotName: 'Approved Mapping',
      status: 'completed',
      errorCount: 0,
    });
    expect(s.structures.map((x: { name: string; written: number }) => [x.name, x.written])).toEqual(
      [
        ['Profit Center', 2],
        ['Company Codes', 2],
      ],
    );
    expect(s.files.map((f: { name: string }) => f.name)).toEqual([
      'Profit Center.csv',
      'Company Codes.csv',
      'diagnostics.csv',
      'run-summary.json',
    ]);
    expect(s.startedAt <= s.completedAt).toBe(true);
  });

  test('an Excel workbook and a ZIP of everything can be created', async ({ page }) => {
    await approved(page);
    await page.getByLabel('Excel workbook').check();
    await page.getByRole('button', { name: 'Run on all rows and create files' }).click();
    await expect(page.getByTestId('output-file-New migration project.xlsx')).toBeVisible();
    const xlsx = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download New migration project.xlsx' }).click();
    const bytes = readFileSync((await (await xlsx).path())!);
    expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a zip-based workbook
    const zip = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download all as ZIP' }).click();
    const z = await zip;
    expect(z.suggestedFilename()).toBe('Approved Mapping output.zip');
    expect(
      readFileSync((await z.path())!)
        .subarray(0, 2)
        .toString(),
    ).toBe('PK');
  });

  test('failed rows go to a separate errors file with the reasons, and are not in the output', async ({
    page,
  }) => {
    // the standard small data has a bad date and an unknown country on P300
    await setUpSmallMapping(page);
    await mapSmallProject(page);
    await confirmAll(page);
    await goToStage(page, 'ready');
    await page.getByLabel('Snapshot name').fill('SIT Cycle 1');
    await page.getByRole('button', { name: 'Save snapshot' }).click();
    await page.getByRole('button', { name: 'Mark SIT Cycle 1 ready' }).click();
    await page.getByRole('button', { name: 'Run on all rows and create files' }).click();
    await expect(page.getByTestId('output-status')).toContainText('The run finished with errors.');
    await expect(page.getByTestId('output-structure-Profit Center')).toContainText(
      'Profit Center2100',
    ); // 2 written, 1 error
    await expect(page.getByTestId('output-file-Profit Center.errors.csv')).toBeVisible();
    const errors = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Profit Center.errors.csv' }).click();
    const text = readFileSync((await (await errors).path())!, 'utf8');
    expect(text).toContain('Row,Source row,Problems,Profit Center,Valid From,Region,Language');
    expect(text).toContain('Cannot read ""13/45/26"" as a date');
    expect(text).toContain('No entry for ""NO"" in lookup');
    const good = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Profit Center.csv' }).click();
    expect(readFileSync((await (await good).path())!, 'utf8')).not.toContain('P300');
  });

  test('a full run needs the rows to be loaded', async ({ page }) => {
    await approved(page);
    await page.waitForTimeout(500);
    await page.reload();
    await goToStage(page, 'ready');
    await expect(page.getByTestId('output-needs-data')).toContainText(
      'The rows of CEPC, CEPC_BUKRS are not loaded',
    );
    await expect(
      page.getByRole('button', { name: 'Run on all rows and create files' }),
    ).toBeDisabled();
  });

  test('a large source runs in full, beyond the test limit', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('source-files-input').setInputFiles([bigCepc(100001), BUKRS_SMALL]);
    await expect(page.getByTestId('dataset-CEPC')).toContainText('100001 rows');
    await loadSmallTarget(page);
    await goToStage(page, 'map');
    await openEditor(page, 'Profit Center', 'Profit Center');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Profit Center' });
    await page.getByRole('button', { name: 'Save mapping' }).click();
    // keep it simple: save a snapshot even though most required fields are unmapped (they are only warnings)
    await goToStage(page, 'ready');
    await page.getByLabel('Snapshot name').fill('Big');
    await page.getByRole('button', { name: 'Save snapshot' }).click();
    await page.getByRole('button', { name: 'Mark Big ready' }).click();
    await page.getByRole('button', { name: 'Run on all rows and create files' }).click();
    await expect(page.getByTestId('output-summary')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('output-structure-Profit Center')).toContainText('100,001');
  });
});

async function confirmAll(page: Page) {
  await goToStage(page, 'sources');
  const card = page.getByTestId('relationship-rel-CEPC-CEPC_BUKRS');
  if (await card.getByRole('button', { name: 'Confirm join' }).count())
    await card.getByRole('button', { name: 'Confirm join' }).click();
}
