import { expect, test } from '@playwright/test';
import { addProfitCenterSources, fixture, goToStage, loadTarget, openApp } from './helpers';

test.describe('application shell (SPEC-021)', () => {
  test('shows the project context and all five stages with a status each', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('project-name')).toHaveText('New migration project');
    await expect(page.getByTestId('project-entity')).toHaveText('Business object');
    for (const [id, label] of [
      ['sources', 'Sources'],
      ['target', 'Target'],
      ['map', 'Map'],
      ['test', 'Test'],
      ['ready', 'Ready'],
    ] as const) {
      await expect(page.getByTestId(`stage-${id}`)).toContainText(label);
    }
    await expect(page.getByTestId('stage-sources-summary')).toHaveText('No files yet');
    await expect(page.getByTestId('stage-target-summary')).toHaveText('No target yet');
    await expect(page.getByTestId('stage-test-summary')).toHaveText('Not run yet');
  });

  test('navigating the whole shell keeps the project context and the work already done', async ({
    page,
  }) => {
    await openApp(page);
    await addProfitCenterSources(page);
    for (const stage of ['target', 'map', 'test', 'ready', 'sources'] as const) {
      await goToStage(page, stage);
      await expect(page.getByTestId('project-name')).toHaveText('New migration project');
      await expect(page.getByTestId(`stage-${stage}`)).toHaveAttribute('aria-current', 'step');
    }
    await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
    await expect(page.getByTestId('stage-sources-summary')).toContainText('3 datasets');
  });

  test('the project can be renamed and the name stays visible on every stage', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Project name').fill('Profit Center SIT');
    await page.getByLabel('Business entity').fill('Profit Center');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await goToStage(page, 'map');
    await expect(page.getByTestId('project-name')).toHaveText('Profit Center SIT');
    await expect(page.getByTestId('project-entity')).toHaveText('Profit Center');
  });
});

test.describe('Sources stage (SPEC-002 to 006 in the UI)', () => {
  test('loads the Profit Center files and shows their profile', async ({ page }) => {
    await openApp(page);
    await addProfitCenterSources(page);
    await expect(page.getByTestId('dataset-CEPC')).toContainText('3 rows, 48 fields');
    await expect(page.getByTestId('dataset-CEPCT')).toContainText('1 rows, 8 fields');
    await expect(page.getByTestId('dataset-CEPC_BUKRS')).toContainText('1 rows, 10 fields');
    await page.getByTestId('dataset-CEPC').click();
    await expect(page.getByTestId('fill-CEPC-Client')).toHaveText('33.33%');
    await expect(page.getByTestId('fill-CEPC-Profit Center')).toHaveText('100%');
    await expect(page.getByRole('table', { name: 'Fields of CEPC' })).toContainText(
      'S_PC_1, S_PC_2, S_PC_3',
    );
  });

  test('a field dictionary adds technical names and keys', async ({ page }) => {
    await openApp(page);
    await addProfitCenterSources(page, true);
    await expect(page.getByTestId('dictionary-loaded')).toContainText('66 fields');
    await page.getByTestId('dataset-CEPC').click();
    const row = page
      .getByRole('table', { name: 'Fields of CEPC' })
      .getByRole('row', { name: /Profit Center PRCTR/ });
    await expect(row).toContainText('Key');
  });

  test('suggests joins, explains them, and only a confirmed join counts', async ({ page }) => {
    await openApp(page);
    await addProfitCenterSources(page, true);
    await expect(page.getByTestId('stage-sources-summary')).toContainText('3 joins suggested');
    const card = page.getByTestId('relationship-rel-CEPC-CEPCT');
    await expect(card).toContainText('CEPC ⇄ CEPCT');
    await expect(card).toContainText('Suggested');
    await expect(card).toContainText('Why: same technical name');
    await expect(card).toContainText('no key value appears in both CEPC and CEPCT'); // the sample files share no key values
    await card.getByRole('button', { name: 'Confirm join' }).click();
    await expect(page.getByTestId('relationship-status-rel-CEPC-CEPCT')).toHaveText('Confirmed');
    await page
      .getByTestId('relationship-rel-CEPC-CEPC_BUKRS')
      .getByRole('button', { name: 'Reject' })
      .click();
    await expect(page.getByTestId('relationship-status-rel-CEPC-CEPC_BUKRS')).toHaveText(
      'Rejected',
    );
    await expect(page.getByTestId('stage-sources-summary')).toContainText('1 join suggested');
    await card.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('relationship-status-rel-CEPC-CEPCT')).toHaveText('Suggested');
  });

  test('joins are optional: Reject all rejects every suggestion, and nothing blocks the stage', async ({
    page,
  }) => {
    await openApp(page);
    await addProfitCenterSources(page, true);
    await page
      .getByTestId('relationship-rel-CEPC-CEPCT')
      .getByRole('button', { name: 'Confirm join' })
      .click();
    await expect(page.getByTestId('stage-sources-summary')).toContainText('1 join confirmed');
    await page.getByTestId('reject-all-joins').click();
    await expect(page.getByTestId('relationship-status-rel-CEPC-CEPC_BUKRS')).toHaveText(
      'Rejected',
    );
    await expect(page.getByTestId('relationship-status-rel-CEPC-CEPCT')).toHaveText('Confirmed');
    await expect(page.getByTestId('stage-sources-summary')).not.toContainText('suggested');
    await expect(page.getByTestId('reject-all-joins')).toHaveCount(0);
  });

  test('the join type can be changed', async ({ page }) => {
    await openApp(page);
    await addProfitCenterSources(page);
    const select = page
      .getByTestId('relationship-rel-CEPC-CEPCT')
      .getByRole('combobox', { name: 'Join type' });
    await expect(select).toHaveValue('left');
    await select.selectOption('inner');
    await expect(select).toHaveValue('inner');
  });

  test('a file that is not a source is refused with a clear message, and a source can be removed', async ({
    page,
  }) => {
    await openApp(page);
    await page
      .getByTestId('source-files-input')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByText('only .csv and .xlsx files can be used as sources')).toBeVisible();
    await page.getByTestId('source-files-input').setInputFiles(fixture('input/CEPCT.csv'));
    await expect(page.getByTestId('dataset-CEPCT')).toBeVisible();
    await page.getByRole('button', { name: 'Remove CEPCT.csv' }).click();
    await expect(page.getByTestId('dataset-CEPCT')).toHaveCount(0);
    await expect(page.getByTestId('stage-sources-summary')).toHaveText('No files yet');
  });

  test('import warnings are shown: a short row is padded and reported', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('source-files-input').setInputFiles({
      name: 'Short.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('a,b,c\n1,2\n'),
    });
    await expect(page.getByText('Row 1 has 2 values but the header has 3')).toBeVisible();
  });
});

test.describe('Target stage (SPEC-007 in the UI)', () => {
  test('loads the target workbook: the header row and columns are found automatically', async ({
    page,
  }) => {
    await openApp(page);
    await goToStage(page, 'target');
    await page.getByTestId('target-file-input').setInputFiles(fixture('target/data_pc.XLSX'));
    await expect(page.getByTestId('target-wizard')).toBeVisible();
    await expect(page.getByLabel('Header row')).toHaveValue('4');
    await expect(page.getByLabel('How structures are listed')).toHaveValue('sectionRows');
    await expect(page.getByLabel('Field name', { exact: true })).toHaveValue('Field Description');
    await expect(page.getByTestId('target-preview-summary')).toHaveText(
      '3 structures: Profit Center (31), Company Codes (3), Translation (5)',
    );
    await page.getByRole('button', { name: 'Use this target' }).click();
    await expect(page.getByTestId('target-wizard')).toHaveCount(0);
    await expect(page.getByTestId('stage-target-summary')).toHaveText('3 structures, 39 fields');
    await expect(page.getByTestId('structure-Profit Center')).toContainText(
      '31 fields, 7 required, 2 key',
    );
    await expect(page.getByTestId('structure-Company Codes')).toContainText(
      '3 fields, 3 required, 3 key',
    );
  });

  test('the user can correct the reading: another header row or column changes the preview', async ({
    page,
  }) => {
    await openApp(page);
    await goToStage(page, 'target');
    await page.getByTestId('target-file-input').setInputFiles(fixture('target/data_pc.XLSX'));
    await expect(page.getByTestId('target-preview-summary')).toBeVisible();
    await page.getByLabel('Header row').fill('1');
    await expect(page.getByText(/was not found in/).first()).toBeVisible();
    await page.getByLabel('Header row').fill('4');
    await expect(page.getByTestId('target-preview-summary')).toBeVisible();
    await page.getByLabel('Structure name').selectOption('');
    await expect(page.getByText('needs a structure column')).toBeVisible();
  });

  test('shows the fields of a structure with required and key flags', async ({ page }) => {
    await openApp(page);
    await loadTarget(page);
    await page
      .getByTestId('structure-Company Codes')
      .getByRole('button', { name: 'Show fields' })
      .click();
    const table = page.getByRole('table', { name: 'Fields of Company Codes' });
    await expect(table).toContainText('Company Code');
    await expect(table).toContainText('COMPANYCODEFOREDIT');
    await expect(table.getByRole('row')).toHaveCount(4);
  });

  test('a target can be typed in', async ({ page }) => {
    await openApp(page);
    await goToStage(page, 'target');
    await page.getByRole('button', { name: 'Create target manually' }).click();
    await page.getByRole('button', { name: 'Use this target' }).click();
    await expect(page.getByTestId('structure-Header')).toContainText('2 fields, 1 required, 1 key');
    await expect(page.getByTestId('structure-Lines')).toBeVisible();
  });

  test('a file that is not a target definition says so', async ({ page }) => {
    await openApp(page);
    await goToStage(page, 'target');
    await page
      .getByTestId('target-file-input')
      .setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('A,B\n1,2\n') });
    await expect(page.getByText('No header row with a field name column was found')).toBeVisible();
  });
});
