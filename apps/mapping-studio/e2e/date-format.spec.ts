import { expect, test } from '@playwright/test';
import { openEditor, setUpSmallMapping } from './helpers';

test.describe('Date Format transformation', () => {
  test('is added as a step, configured with a live preview, and shown in the mapping', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Valid From');
    await page.getByLabel('Mapping type').selectOption('routine');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Valid From' });
    await page.getByTestId('add-date-format-step').click();

    // the SAP settings are the starting point
    await expect(page.getByLabel('Step 1 input format')).toHaveValue('yyyyMMdd');
    await expect(page.getByLabel('Step 1 output format')).toHaveValue('yyyy-MM-dd');
    await expect(page.getByLabel('Step 1 special values')).toHaveValue('00000000 -> ');
    await expect(page.getByTestId('date-format-result-1')).toHaveText('2026-11-05');
    await page.getByLabel('Step 1 sample value').fill('99991231');
    await expect(page.getByTestId('date-format-result-1')).toHaveText('9999-12-31');
    await page.getByLabel('Step 1 sample value').fill('00000000');
    await expect(page.getByTestId('date-format-result-1')).toHaveText('(blank)');
    await page.getByLabel('Step 1 sample value').fill('20260229');
    await expect(page.getByTestId('date-format-result-1')).toHaveText('(blank)');
    await page.getByLabel('Step 1 invalid value behavior').selectOption('error');
    await expect(page.getByTestId('date-format-result-1')).toContainText('Error');

    // any layouts
    await page.getByLabel('Step 1 input format').fill('dd.MM.yyyy');
    await page.getByLabel('Step 1 sample value').fill('05.11.2026');
    await expect(page.getByTestId('date-format-result-1')).toHaveText('2026-11-05');

    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('row-Profit Center-Valid From')).toContainText(
      'Date Format [dd.MM.yyyy → yyyy-MM-dd]',
    );
  });
});
