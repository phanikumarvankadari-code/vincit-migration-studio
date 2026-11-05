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

test.describe('Target date format', () => {
  test('the structure default and the field format fill in the output format of a Date Format step', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await page
      .getByTestId('completeness-Profit Center')
      .getByRole('button', { name: 'Settings' })
      .click();
    await page.getByLabel('Default date format').fill('dd.MM.yyyy');
    await page.getByRole('button', { name: 'Save settings' }).click();

    await openEditor(page, 'Profit Center', 'Valid From');
    await expect(page.getByLabel('Target date format')).toHaveValue('');
    await expect(page.getByLabel('Target date format')).toHaveAttribute(
      'placeholder',
      'dd.MM.yyyy',
    );
    await page.getByLabel('Mapping type').selectOption('routine');
    await page.getByTestId('add-date-format-step').click();
    await expect(page.getByLabel('Step 1 output format')).toHaveValue('dd.MM.yyyy');

    // the field's own format wins over the structure default
    await page.getByRole('button', { name: 'Remove step 1' }).click();
    await page.getByLabel('Target date format').fill('yyyyMMdd');
    await page.getByTestId('add-date-format-step').click();
    await expect(page.getByLabel('Step 1 output format')).toHaveValue('yyyyMMdd');

    // kept after closing and reopening
    await page.getByRole('button', { name: 'Close editor' }).click();
    await openEditor(page, 'Profit Center', 'Valid From');
    await expect(page.getByLabel('Target date format')).toHaveValue('yyyyMMdd');
  });
});

test.describe('Date Format on a direct date mapping', () => {
  test('a direct mapping to a date field offers the conversion; M/D/yy sources need a pivot', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Valid From');
    await page.getByLabel('Target date format').fill('yyyy-MM-dd');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Valid From' });
    await expect(page.getByTestId('preview-result-1')).toHaveText('1/1/26');

    await page.getByTestId('convert-to-date-format').click();
    await expect(page.getByLabel('Step 1 output format')).toHaveValue('yyyy-MM-dd');
    await page.getByLabel('Step 1 input format').fill('M/d/yy');
    await page.getByLabel('Step 1 two-digit year pivot').fill('68');
    await page.getByLabel('Step 1 special values').fill('12/31/99 -> 9999-12-31');
    await page.getByLabel('Step 1 invalid value behavior').selectOption('error');
    await page.getByLabel('Step 1 sample value').fill('12/31/99');
    await expect(page.getByTestId('date-format-result-1')).toHaveText('9999-12-31');
    await expect(page.getByTestId('preview-result-1')).toHaveText('2026-01-01');
    await expect(page.getByTestId('preview-result-2')).toHaveText('2026-05-01');
  });
});
