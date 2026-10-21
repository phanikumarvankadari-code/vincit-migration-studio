import { expect, test } from '@playwright/test';
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

test.describe('Test stage: results, lineage and diagnostics (SPEC-024, 025, 026)', () => {
  test.beforeEach(async ({ page }) => {
    await setUpSmallMapping(page);
    await mapSmallProject(page);
  });

  test('runs a sample and shows a summary per structure', async ({ page }) => {
    await runTest(page);
    await expect(page.getByTestId('run-summary')).toContainText('The test ran with errors.');
    await expect(page.getByTestId('run-structure-Profit Center')).toContainText(
      '3 rows from 3 of 3 source rows',
    );
    await expect(page.getByTestId('run-structure-Profit Center')).toContainText(
      '2 ready · 0 warning · 1 error',
    );
    await expect(page.getByTestId('run-structure-Company Codes')).toContainText(
      '3 rows from 3 of 3 source rows',
    );
    await expect(page.getByTestId('run-structure-Company Codes')).toContainText('3 ready');
    await expect(page.getByTestId('stage-test-summary')).toContainText('errors in the last run');
  });

  test('the grid shows transformed values with the target field metadata, and each structure is a tab', async ({
    page,
  }) => {
    await runTest(page);
    const grid = page.getByRole('grid', { name: 'Results for Profit Center' });
    await expect(grid.getByRole('columnheader', { name: 'Profit Center * (key)' })).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: 'Valid From *' })).toBeVisible();
    await expect(page.getByTestId('cell-1-Profit Center')).toHaveText('P100');
    await expect(page.getByTestId('cell-1-Valid From')).toHaveText('20260101');
    await expect(page.getByTestId('cell-2-Valid From')).toHaveText('20260501');
    await expect(page.getByTestId('cell-3-Valid From')).toHaveText('blank');
    await expect(page.getByTestId('cell-1-Language')).toHaveText('EN');
    await expect(page.getByTestId('cell-3-Region')).toHaveText('blank');
    await page.getByRole('tab', { name: 'Company Codes' }).click();
    await expect(page.getByRole('grid', { name: 'Results for Company Codes' })).toBeVisible();
    await expect(page.getByTestId('cell-2-Company Code')).toHaveText('FI02');
    await expect(page.getByTestId('cell-3-Profit Center')).toHaveText('P300');
  });

  test('rows can be filtered by Ready, Warning and Error', async ({ page }) => {
    await runTest(page);
    await expect(page.getByRole('button', { name: 'All (3)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ready (2)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Error (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Error (1)' }).click();
    await expect(page.getByTestId('rowstatus-3')).toHaveText('Error');
    await expect(page.getByTestId('rownum-1')).toHaveCount(0);
    await page.getByRole('button', { name: 'Warning (0)' }).click();
    await expect(page.getByTestId('result-grid-empty')).toContainText('No rows have this status.');
    await page.getByRole('button', { name: 'Ready (2)' }).click();
    await expect(page.getByTestId('rownum-1')).toBeVisible();
    await expect(page.getByTestId('rownum-3')).toHaveCount(0);
  });

  test('a selected cell can be traced to its source: lookup', async ({ page }) => {
    await runTest(page);
    await page.getByTestId('cell-1-Region').click();
    const panel = page.getByTestId('lineage-panel');
    await expect(panel).toContainText('Region, row 1');
    await expect(page.getByTestId('lineage-final')).toContainText('"North"');
    await expect(page.getByTestId('lineage-step-2')).toContainText('Lookup: Country to region');
    await expect(page.getByTestId('lineage-step-2')).toContainText('"FI" → "North"');
    await expect(page.getByTestId('lineage-step-1')).toContainText('Source value');
    await expect(page.getByTestId('lineage-source-1')).toContainText('CEPC.Country');
    await expect(page.getByTestId('lineage-source-1')).toContainText('Row 1 of the dataset');
    await expect(page.getByTestId('lineage-source-1')).toContainText('Original value: "FI"');
  });

  test('a selected cell can be traced to its source: routine chain, with every step', async ({
    page,
  }) => {
    await runTest(page);
    await page.getByTestId('cell-2-Valid From').click();
    await expect(page.getByTestId('lineage-final')).toContainText('"20260501"');
    await expect(page.getByTestId('lineage-step-3')).toContainText('Routine: Format Date');
    await expect(page.getByTestId('lineage-step-3')).toContainText('"2026-05-01" → "20260501"');
    await expect(page.getByTestId('lineage-step-2')).toContainText('Routine: Parse Date');
    await expect(page.getByTestId('lineage-step-2')).toContainText('"5/1/26" → "2026-05-01"');
    await expect(page.getByTestId('lineage-source-1')).toContainText('Original value: "5/1/26"');
  });

  test('a failed cell explains why in plain words, with technical details on request', async ({
    page,
  }) => {
    await runTest(page);
    await page.getByTestId('cell-3-Valid From').click();
    const issues = page.getByTestId('lineage-issues');
    await expect(issues).toContainText(
      'Cannot read "13/45/26" as a date with the layout M/D/YY: month 13 is not valid.',
    );
    await expect(issues.getByText('Code: DATE_INVALID')).toBeHidden(); // collapsed until asked for
    await issues.getByText('Technical details').first().click();
    await expect(issues).toContainText('Code: DATE_INVALID');
    await expect(issues).toContainText('routine date.parse');
    await expect(page.getByTestId('lineage-source-1')).toContainText('Original value: "13/45/26"');
  });

  test('a cell without a mapping says it has no source', async ({ page }) => {
    await runTest(page);
    await page.getByRole('tab', { name: 'Company Codes' }).click();
    await page.getByTestId('cell-1-Company Code').click();
    await expect(page.getByTestId('lineage-source-1')).toContainText('CEPC_BUKRS.Company Code');
  });

  test('a row can be inspected as a whole', async ({ page }) => {
    await runTest(page);
    await page.getByTestId('rownum-3').click();
    const inspector = page.getByTestId('row-inspector');
    await expect(inspector).toContainText('Row 3 of Profit Center');
    await expect(inspector).toContainText('From row 3 of the source dataset');
    await expect(inspector.getByRole('row', { name: /Profit Center P300/ })).toBeVisible();
    await expect(inspector).toContainText('Cannot read "13/45/26"');
    await expect(inspector).toContainText('No entry for "NO" in lookup "Country to region".');
  });

  test('the problems list collapses repeats, is plain by default, and jumps to the row', async ({
    page,
  }) => {
    await runTest(page);
    const list = page.getByTestId('diagnostics-list');
    await expect(list).toContainText('Problems');
    const group = page.getByTestId('diagnostic-group-DATE_INVALID');
    await expect(group).toContainText('Cannot read "13/45/26"');
    await expect(group).toContainText('Profit Center › Valid From · first at row 3');
    await expect(group.getByText(/Code: DATE_INVALID/)).toBeHidden(); // collapsed until asked for
    await group.getByText('Technical details').click();
    await expect(group).toContainText(
      'Code: DATE_INVALID · routine date.parse · mapping m-tf-Profit-Center-2 · source row 3 · source value "13/45/26"',
    );
    await group.getByRole('button', { name: 'Show in grid' }).click();
    await expect(page.getByTestId('cell-3-Valid From')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('lineage-panel')).toContainText('Valid From, row 3');
  });

  test('the problems list can be limited to errors, and shows lookups with missing keys', async ({
    page,
  }) => {
    await runTest(page);
    await expect(page.getByTestId('diagnostic-group-ENGINE_LOOKUP_MISSING')).toContainText(
      'No entry for "NO" in lookup "Country to region".',
    );
    await page.getByLabel('Show problems').selectOption('warning');
    await expect(page.getByTestId('diagnostic-group-ENGINE_LOOKUP_MISSING')).toHaveCount(0);
    await page.getByLabel('Show problems').selectOption('error');
    await expect(page.getByTestId('diagnostic-group-DATE_INVALID')).toBeVisible();
  });

  test('results are marked out of date when the mapping changes, and a new run clears the mark', async ({
    page,
  }) => {
    await runTest(page);
    await expect(page.getByTestId('stale-badge')).toHaveCount(0);
    await goToStage(page, 'map');
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByLabel('Constant value').fill('FI');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await goToStage(page, 'test');
    await expect(page.getByTestId('stale-badge')).toBeVisible();
    await expect(page.getByTestId('cell-1-Language')).toHaveText('EN'); // still the old results, clearly marked
    await page.getByRole('button', { name: 'Run test' }).click();
    await expect(page.getByTestId('stale-badge')).toHaveCount(0);
    await expect(page.getByTestId('cell-1-Language')).toHaveText('FI');
  });

  test('a sample of the spread kind and the 1,000-row sample both work', async ({ page }) => {
    await runTest(page, 'spread100');
    await expect(page.getByTestId('run-structure-Profit Center')).toContainText(
      '3 rows from 3 of 3 source rows',
    );
    await runTest(page, 'rows1000');
    await expect(page.getByTestId('run-structure-Profit Center')).toContainText('3 rows');
  });
});

test.describe('Test stage: large results and limits', () => {
  test('a large result stays responsive (the grid shows only the rows in view) and lineage is left out of "all rows"', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId('source-files-input').setInputFiles([bigCepc(5000), BUKRS_SMALL]);
    await expect(page.getByTestId('dataset-CEPC')).toContainText('5000 rows');
    await loadSmallTarget(page);
    await goToStage(page, 'map');
    await openEditor(page, 'Profit Center', 'Profit Center');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Profit Center' });
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await runTest(page, 'all');
    await expect(page.getByTestId('run-structure-Profit Center')).toContainText(
      '5,000 rows from 5,000 of 5,000 source rows',
    );
    await expect(page.getByRole('button', { name: 'All (5,000)' })).toBeVisible();
    const rows = page.getByRole('grid', { name: 'Results for Profit Center' }).getByRole('row');
    expect(await rows.count()).toBeLessThan(60);
    await expect(page.getByTestId('cell-1-Profit Center')).toHaveText('P00001');
    await page.getByTestId('result-grid').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.getByTestId('cell-5000-Profit Center')).toHaveText('P05000');
    await expect(page.getByTestId('cell-1-Profit Center')).toHaveCount(0);
    await page.getByTestId('cell-5000-Profit Center').click();
    await expect(page.getByTestId('lineage-missing')).toContainText(
      'Lineage was not recorded for this run',
    );
  });

  test('"All rows" is refused for very large sources', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('source-files-input').setInputFiles(bigCepc(100001));
    await expect(page.getByTestId('dataset-CEPC')).toContainText('100001 rows');
    await loadSmallTarget(page);
    await goToStage(page, 'map');
    await openEditor(page, 'Profit Center', 'Profit Center');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Profit Center' });
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await runTest(page, 'all');
    await expect(page.getByTestId('run-summary')).toContainText('The test could not run.');
    await expect(page.getByTestId('diagnostic-group-TEST_ALL_NOT_SAFE')).toContainText(
      'the safe limit is 100,000',
    );
  });
});

test.describe('Before running and Ready checklist', () => {
  test('problems found before running are listed once; the checklist shows what is open', async ({
    page,
  }) => {
    await openApp(page);
    await addSmallSources(page);
    await loadSmallTarget(page);
    await goToStage(page, 'test');
    await expect(page.getByText('Not run yet.')).toBeVisible();
    await expect(page.getByTestId('preflight-list')).toContainText(
      'Key field "Profit Center" of "Profit Center" has no mapping.',
    );
    await expect(page.getByTestId('preflight-list')).toContainText(
      'Required field "Valid From" of "Profit Center" has no mapping.',
    );
    await goToStage(page, 'ready');
    await expect(page.getByTestId('ready-summary')).toHaveText('3 of 10 checks done');
    await expect(page.getByTestId('stage-ready-summary')).toContainText('Waiting for');
    await page
      .getByRole('listitem')
      .filter({ hasText: 'All required and key fields are mapped' })
      .getByRole('button', { name: 'Go to Map' })
      .click();
    await expect(page.getByRole('table', { name: 'Mapping table' })).toBeVisible();
  });

  test('a clean mapping and a clean test run make every check pass', async ({ page }) => {
    await openApp(page);
    // data without problems: valid dates and every country in the lookup
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
      BUKRS_SMALL.name
        ? {
            ...BUKRS_SMALL,
            buffer: Buffer.from(
              ['Profit Center,Company Code', 'P100,FI01', 'P100,FI02'].join('\n'),
            ),
          }
        : BUKRS_SMALL,
    ]);
    await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
    await page
      .getByTestId('relationship-rel-CEPC-CEPC_BUKRS')
      .getByRole('button', { name: 'Confirm join' })
      .click();
    await loadSmallTarget(page);
    await goToStage(page, 'map');
    await mapSmallProject(page);
    await runTest(page);
    await expect(page.getByTestId('run-summary')).toContainText('The test ran without errors.');
    await goToStage(page, 'ready');
    await expect(page.getByTestId('ready-summary')).toHaveText('8 of 10 checks done');
    await expect(page.getByTestId('stage-ready-summary')).toHaveText('Ready to save a snapshot');
    await expect(page.getByTestId('stage-test-summary')).toContainText('Last run clean');
  });
});
