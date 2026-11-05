import { expect, test, type Page } from '@playwright/test';
import { fixture, goToStage, openApp, openEditor } from './helpers';

/** Profit Center sources (M/D/YY dates) to the ISO dates of the target, through Date Format steps. */
const golden = (f: string) => fixture(`golden/input/${f}`);
const PC = 'Profit Center';
const CC = 'Company Codes';
const TR = 'Translation';

async function convertDate(
  page: Page,
  structure: string,
  field: string,
  source: string,
  neverEnds: boolean,
) {
  await openEditor(page, structure, field);
  await page.getByLabel('Target date format').fill('yyyy-MM-dd');
  await page.getByLabel('Source field', { exact: true }).selectOption({ label: source });
  await page.getByTestId('convert-to-date-format').click();
  await page.getByLabel('Step 1 input format').fill('M/d/yy');
  await page.getByLabel('Step 1 two-digit year pivot').fill('68');
  await page.getByLabel('Step 1 special values').fill(neverEnds ? '12/31/99 -> 9999-12-31' : '');
  await page.getByLabel('Step 1 invalid value behavior').selectOption('error');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
}

test('Profit Center dates are converted to the target format and tested', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  await page
    .getByTestId('source-files-input')
    .setInputFiles(['CEPC.csv', 'CEPCT.csv', 'CEPC_BUKRS.csv'].map(golden));
  await page.getByTestId('dictionary-input').setInputFiles(fixture('input/field_dictionary.csv'));
  await expect(page.getByTestId('dictionary-loaded')).toContainText('66 fields');
  for (const id of ['rel-CEPC-CEPCT', 'rel-CEPC-CEPC_BUKRS'])
    await page
      .getByTestId(`relationship-${id}`)
      .getByRole('button', { name: 'Confirm join' })
      .click();
  await goToStage(page, 'target');
  await page.getByTestId('target-file-input').setInputFiles(fixture('target/data_pc.XLSX'));
  await page.getByRole('button', { name: 'Use this target' }).click();
  await goToStage(page, 'map');

  for (const [s, f, src] of [
    [PC, 'Profit Center', 'CEPC.Profit Center'],
    [CC, 'Profit Center', 'CEPC_BUKRS.Profit Center'],
    [CC, 'Company Code', 'CEPC_BUKRS.Company Code'],
    [TR, 'Profit Center', 'CEPCT.Profit Center'],
  ] as const) {
    await openEditor(page, s, f);
    await page.getByLabel('Source field', { exact: true }).selectOption({ label: src });
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
  }
  await convertDate(page, PC, 'Valid To', 'CEPC.Valid To', true);
  await convertDate(page, PC, 'Valid From', 'CEPC.Valid From', false);
  // Company Codes has no date of its own: the end date comes from CEPC through the relationship
  await convertDate(page, CC, 'Validty End Date', 'CEPC.Valid To', true);
  await convertDate(page, TR, 'Validty End Date', 'CEPCT.Valid To', true);

  for (const [s, driver] of [
    [PC, 'CEPC'],
    [CC, 'CEPC_BUKRS'],
    [TR, 'CEPCT'],
  ] as const) {
    await page.getByTestId(`completeness-${s}`).getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Driver dataset').selectOption({ label: driver });
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  await goToStage(page, 'test');
  await page.getByRole('button', { name: 'Run test' }).click();
  // The sample data has one bad date on purpose (13/45/26 in row 3): only that row fails.
  await expect(page.getByTestId('run-summary')).toContainText('2 errors');
  await expect(page.getByTestId('run-structure-' + PC)).toContainText('2 ready');
  await expect(page.getByTestId('run-structure-' + PC)).toContainText('1 error');
  await expect(page.getByTestId('diagnostic-group-DATE_INVALID')).toContainText(
    'Cannot read "13/45/26"',
  );
  await expect(page.getByTestId('cell-1-Valid To')).toHaveText('9999-12-31');
  await expect(page.getByTestId('cell-1-Valid From')).toHaveText('2026-01-01');
  await expect(page.getByTestId('cell-2-Valid From')).toHaveText('2026-05-01');
  await page.getByRole('tab', { name: CC }).click();
  await expect(page.getByTestId('cell-1-Validty End Date')).toHaveText('9999-12-31');
  await page.getByRole('tab', { name: TR }).click();
  await expect(page.getByTestId('cell-1-Validty End Date')).toHaveText('9999-12-31');
});
