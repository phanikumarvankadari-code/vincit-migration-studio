import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { fixture, goToStage, openApp, openEditor } from './helpers';

/** The target is an SAP migration template: Field List defines the structures, the data sheets get the output. */
const golden = (f: string) => fixture(`golden/input/${f}`);
const PC = 'Profit Center';

async function convertDate(page: Page, field: string, source: string, neverEnds: boolean) {
  await openEditor(page, PC, field);
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

test('the output is written into the data sheets of the target template', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  await page.getByTestId('source-files-input').setInputFiles(['CEPC.csv'].map(golden));
  await goToStage(page, 'target');
  await page
    .getByTestId('target-file-input')
    .setInputFiles(fixture('target/data_pc_template.xlsx'));
  await expect(page.getByTestId('target-preview-summary')).toHaveText(
    '3 structures: Profit Center (31), Company Codes (3), Translation (5)',
  );
  await expect(page.getByTestId('target-template-note')).toContainText(
    'Profit Center, Company Codes, Translation',
  );
  await page.getByRole('button', { name: 'Use this target' }).click();
  await expect(page.getByTestId('target-template-loaded')).toContainText('data_pc_template.xlsx');

  await goToStage(page, 'map');
  await openEditor(page, PC, 'Profit Center');
  await page
    .getByLabel('Source field', { exact: true })
    .selectOption({ label: 'CEPC.Profit Center' });
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
  await convertDate(page, 'Valid To', 'CEPC.Valid To', true);
  await convertDate(page, 'Valid From', 'CEPC.Valid From', false);
  await page.getByTestId(`completeness-${PC}`).getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Driver dataset').selectOption({ label: 'CEPC' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await goToStage(page, 'ready');
  await page.getByLabel('Snapshot name').fill('Template run');
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await page.getByRole('button', { name: 'Mark Template run approved' }).click();
  await page.getByRole('button', { name: 'Run on all rows and create files' }).click();
  await expect(page.getByTestId('output-file-data_pc_template.xlsx')).toBeVisible();

  const d = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download data_pc_template.xlsx' }).click();
  const files = unzipSync(new Uint8Array(readFileSync((await (await d).path())!)));
  const sheet = strFromU8(files['xl/worksheets/sheet3.xml']!); // the Profit Center sheet
  expect(sheet).toContain('<row r="8"'); // the template's own header rows are still there
  for (const text of ['S_PC_1', 'S_PC_2', '9999-12-31', '2026-01-01', '2026-05-01'])
    expect(sheet).toContain(`>${text}<`);
  expect(sheet).not.toContain('>S_PC_3<'); // the failed row (bad date) is not written
  expect(sheet).toContain('<c r="A9" ');
  expect(sheet).toContain('<c r="A10" ');
  expect(strFromU8(files['xl/worksheets/sheet4.xml']!)).not.toContain('<row r="9"'); // no rows for Company Codes
});
