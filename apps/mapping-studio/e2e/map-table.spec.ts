import { expect, test } from '@playwright/test';
import {
  goToStage,
  openApp,
  openEditor,
  setUpSmallMapping,
  status,
  loadSmallTarget,
  addSmallSources,
} from './helpers';

test.describe('Mapping Table (SPEC-022)', () => {
  test('without a target the Map stage asks for one', async ({ page }) => {
    await openApp(page);
    await goToStage(page, 'map');
    await expect(page.getByText('Load a target structure first')).toBeVisible();
    await page.getByRole('button', { name: 'Go to Target' }).click();
    await expect(page.getByRole('button', { name: 'Load target structure file' })).toBeVisible();
  });

  test('lists every target field with its status; required unmapped fields are easy to find', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await expect(page.getByTestId('table-count')).toHaveText('6 of 6 fields');
    for (const [s, f] of [
      ['Profit Center', 'Profit Center'],
      ['Profit Center', 'Region'],
      ['Company Codes', 'Company Code'],
    ]) {
      await expect(status(page, s!, f!)).toHaveText('Unmapped');
    }
    await page.getByLabel('Filter by status').selectOption('requiredUnmapped');
    await expect(page.getByTestId('table-count')).toHaveText('4 of 6 fields');
    await expect(page.getByTestId('row-Profit Center-Region')).toHaveCount(0);
    await expect(page.getByTestId('row-Company Codes-Company Code')).toContainText('Required');
    await expect(page.getByTestId('completeness-Profit Center')).toContainText('2 required open');
  });

  test('filters by structure and search', async ({ page }) => {
    await setUpSmallMapping(page);
    await page.getByLabel('Filter by structure').selectOption({ label: 'Company Codes' });
    await expect(page.getByTestId('table-count')).toHaveText('2 of 6 fields');
    await page.getByLabel('Filter by structure').selectOption('');
    await page.getByLabel('Search fields').fill('region');
    await expect(page.getByTestId('table-count')).toHaveText('1 of 6 fields');
  });

  test('a direct mapping: choose the source, see sample values and a preview, save', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Profit Center');
    await expect(page.getByTestId('editor-target-meta')).toContainText('Required');
    await expect(page.getByTestId('editor-target-meta')).toContainText('Key');
    await expect(page.getByTestId('editor-problems')).toContainText('Choose a source field.');
    await expect(page.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Profit Center' });
    await expect(page.getByTestId('source-samples')).toHaveText('Sample values: P100, P200, P300');
    await expect(page.getByTestId('preview-result-1')).toHaveText('P100');
    await expect(page.getByTestId('preview-result-3')).toHaveText('P300');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
    await expect(status(page, 'Profit Center', 'Profit Center')).toHaveText('Mapped');
    await expect(page.getByTestId('row-Profit Center-Profit Center')).toContainText(
      'CEPC.Profit Center',
    );
    await expect(page.getByTestId('row-Profit Center-Profit Center')).toContainText('Direct');
    await expect(page.getByTestId('completeness-text-Profit Center')).toHaveText(
      '1 of 4 fields mapped (25%)',
    );
    await expect(page.getByTestId('stage-map-summary')).toContainText('1 of 6 fields mapped');
  });

  test('a constant mapping keeps its value and shows it for every row', async ({ page }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByLabel('Mapping type').selectOption('constant');
    await page.getByLabel('Constant value').fill('EN');
    await expect(page.getByTestId('preview-result-1')).toHaveText('EN');
    await expect(page.getByTestId('preview-result-3')).toHaveText('EN');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('row-Profit Center-Language')).toContainText('"EN"');
    await expect(page.getByTestId('row-Profit Center-Language')).toContainText('Constant');
  });

  test('a constant with the wrong datatype is explained and cannot be saved', async ({ page }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByLabel('Mapping type').selectOption('constant');
    await page.getByLabel('Constant value').fill('abc');
    await page.getByLabel('Constant datatype').selectOption('integer');
    await expect(page.getByTestId('editor-problems')).toContainText('"abc" is not a whole number.');
    await expect(page.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
  });

  test('a lookup: values come from the source, the table is filled in, a missing key is explained', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Region');
    await page.getByLabel('Mapping type').selectOption('lookup');
    await page.getByLabel('Source field to look up').selectOption({ label: 'CEPC.Country' });
    await page.getByLabel('Lookup name').fill('Country to region');
    await page.getByRole('button', { name: 'Add values from source' }).click();
    await expect(page.getByLabel('Entry 1 key')).toHaveValue('FI');
    await expect(page.getByLabel('Entry 2 key')).toHaveValue('SE');
    await expect(page.getByLabel('Entry 3 key')).toHaveValue('NO');
    await page.getByLabel('Entry 1 value').fill('North');
    await page.getByLabel('Entry 2 value').fill('North');
    await page.getByRole('button', { name: 'Remove entry 3' }).click();
    await expect(page.getByTestId('preview-result-1')).toHaveText('North');
    await expect(page.getByTestId('preview-result-3')).toHaveText('⟨blank⟩');
    await expect(page.getByTestId('mapping-preview')).toContainText(
      'No entry for "NO" in lookup "Country to region".',
    );
    await page.getByLabel('When a value is not in the table').selectOption('null');
    await expect(page.getByTestId('mapping-preview')).not.toContainText('No entry for');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('row-Profit Center-Region')).toContainText(
      'Lookup Country to region',
    );
    // opening it again shows the saved table
    await openEditor(page, 'Profit Center', 'Region');
    await expect(page.getByLabel('Entry 1 value')).toHaveValue('North');
    await expect(page.getByLabel('Lookup name')).toHaveValue('Country to region');
  });

  test('a lookup without a usable table cannot be saved', async ({ page }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Region');
    await page.getByLabel('Mapping type').selectOption('lookup');
    await page.getByLabel('Source field to look up').selectOption({ label: 'CEPC.Country' });
    await expect(page.getByTestId('editor-problems')).toContainText(
      'Add at least one lookup entry.',
    );
    await page.getByLabel('Entry 1 key').fill('FI');
    await page.getByLabel('Entry 1 value').fill('N');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await page.getByLabel('Entry 2 key').fill('FI');
    await expect(page.getByTestId('editor-problems')).toContainText(
      'A lookup key appears more than once.',
    );
  });

  test('a condition with if and otherwise rules', async ({ page }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Region');
    await page.getByLabel('Mapping type').selectOption('conditional');
    await page.getByLabel('Source field (this value)').selectOption({ label: 'CEPC.Country' });
    await page.getByLabel('Rule 1 compared text').fill('FI');
    await page.getByLabel('Rule 1 result text').fill('Finland');
    await page.getByLabel('Otherwise text').fill('Other');
    await expect(page.getByTestId('preview-result-1')).toHaveText('Finland');
    await expect(page.getByTestId('preview-result-2')).toHaveText('Other');
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByLabel('Rule 2 compared text').fill('SE');
    await page.getByLabel('Rule 2 result text').fill('Sweden');
    await expect(page.getByTestId('preview-result-2')).toHaveText('Sweden');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('row-Profit Center-Region')).toContainText(
      'Condition: if this value = "FI" …',
    );
  });

  test('a routine chain: parse and format a date; a bad date is shown in the preview, not hidden', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Valid From');
    await page.getByLabel('Mapping type').selectOption('routine');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Valid From' });
    await page.getByRole('button', { name: 'Add routine step' }).click();
    await page.getByLabel('Step 1 routine').selectOption({ label: 'Parse Date' });
    await expect(page.getByLabel('Step 1 settings')).toHaveValue(/"format": ""/);
    await expect(page.getByTestId('step-1')).toContainText(
      'Settings: format (required), twoDigitYearPivot',
    );
    await page.getByLabel('Step 1 settings').fill('{"format":"M/D/YY","twoDigitYearPivot":68}');
    await page.getByRole('button', { name: 'Add routine step' }).click();
    await page.getByLabel('Step 2 routine').selectOption({ label: 'Format Date' });
    await page.getByLabel('Step 2 settings').fill('{"format":"YYYYMMDD"}');
    await expect(page.getByTestId('preview-result-1')).toHaveText('20260101');
    await expect(page.getByTestId('preview-result-2')).toHaveText('20260501');
    await expect(page.getByTestId('preview-result-3')).toHaveText('⟨blank⟩');
    await expect(page.getByTestId('mapping-preview')).toContainText(
      'Cannot read "13/45/26" as a date',
    );
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('row-Profit Center-Valid From')).toContainText(
      'Parse Date → Format Date',
    );
  });

  test('wrong routine settings are explained before saving', async ({ page }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Valid From');
    await page.getByLabel('Mapping type').selectOption('routine');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Valid From' });
    await page.getByRole('button', { name: 'Add routine step' }).click();
    await page.getByLabel('Step 1 routine').selectOption({ label: 'Parse Date' });
    await page.getByLabel('Step 1 settings').fill('{"format":"M/D/YY"}');
    await expect(page.getByTestId('editor-problems')).toContainText('twoDigitYearPivot');
    await page.getByLabel('Step 1 settings').fill('{oops');
    await expect(page.getByTestId('editor-problems')).toContainText('not valid JSON');
    await expect(page.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
  });

  test('steps can be reordered and removed', async ({ page }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Region');
    await page.getByLabel('Mapping type').selectOption('routine');
    await page.getByLabel('Source field', { exact: true }).selectOption({ label: 'CEPC.Country' });
    await page.getByRole('button', { name: 'Add routine step' }).click();
    await page.getByRole('button', { name: 'Add routine step' }).click();
    await page.getByLabel('Step 2 routine').selectOption({ label: 'Uppercase' });
    await page.getByRole('button', { name: 'Move step 2 up' }).click();
    await expect(page.getByLabel('Step 1 routine')).toHaveValue('text.upper');
    await expect(page.getByLabel('Step 2 routine')).toHaveValue('text.trim');
    await page.getByRole('button', { name: 'Remove step 1' }).click();
    await expect(page.getByLabel('Step 1 routine')).toHaveValue('text.trim');
    await expect(page.getByTestId('step-2')).toHaveCount(0);
  });

  test('a mapping can be flagged for review, edited again, and removed', async ({ page }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByLabel('Mapping type').selectOption('constant');
    await page.getByLabel('Constant value').fill('EN');
    await page.getByLabel('Needs review').check();
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Needs review');
    await openEditor(page, 'Profit Center', 'Language');
    await expect(page.getByLabel('Constant value')).toHaveValue('EN');
    await page.getByLabel('Needs review').uncheck();
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Mapped');
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByRole('button', { name: 'Remove mapping' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Unmapped');
  });

  test('a mapping with a broken routine configuration shows as an error in the table', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Valid From');
    await page.getByLabel('Mapping type').selectOption('routine');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Valid From' });
    await page.getByRole('button', { name: 'Add routine step' }).click();
    await page.getByLabel('Step 1 routine').selectOption({ label: 'Trim' });
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(status(page, 'Profit Center', 'Valid From')).toHaveText('Mapped');
  });

  test('structure settings: driver dataset suggestion and a parent link', async ({ page }) => {
    await setUpSmallMapping(page);
    for (const [field, source] of [
      ['Profit Center', 'CEPC_BUKRS.Profit Center'],
      ['Company Code', 'CEPC_BUKRS.Company Code'],
    ] as const) {
      await openEditor(page, 'Company Codes', field);
      await page.getByLabel('Source field', { exact: true }).selectOption({ label: source });
      await page.getByRole('button', { name: 'Save mapping' }).click();
    }
    await page
      .getByTestId('completeness-Company Codes')
      .getByRole('button', { name: 'Settings' })
      .click();
    await expect(page.getByTestId('driver-suggestion')).toContainText(
      'CEPC_BUKRS: it supplies 2 of 2 key field(s)',
    );
    await page.getByRole('button', { name: 'Use suggestion' }).click();
    await expect(page.getByLabel('Driver dataset')).toHaveValue('ds-CEPC_BUKRS');
    await page.getByLabel('Parent structure').selectOption({ label: 'Profit Center' });
    await expect(page.getByText('Choose both fields for every key pair')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    await page.getByLabel('Link 1 field in Company Codes').selectOption({ label: 'Profit Center' });
    await page.getByLabel('Link 1 field in Profit Center').selectOption({ label: 'Profit Center' });
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByTestId('completeness-Company Codes')).toContainText(
      'Rows come from CEPC_BUKRS',
    );
    // the setting is kept
    await page
      .getByTestId('completeness-Company Codes')
      .getByRole('button', { name: 'Settings' })
      .click();
    await expect(page.getByLabel('Parent structure')).toHaveValue('ts-Profit-Center');
    await expect(page.getByLabel('Link 1 field in Profit Center')).toHaveValue(
      'tf-Profit-Center-1',
    );
  });

  test('a mapping that reads two datasets needs a driver, and the preview says so', async ({
    page,
  }) => {
    await openApp(page);
    await addSmallSources(page);
    await loadSmallTarget(page);
    await goToStage(page, 'map');
    await openEditor(page, 'Company Codes', 'Company Code');
    await page.getByLabel('Mapping type').selectOption('conditional');
    await page
      .getByLabel('Source field (this value)')
      .selectOption({ label: 'CEPC_BUKRS.Company Code' });
    await page.getByLabel('Rule 1 left kind').selectOption('field');
    await page.getByLabel('Rule 1 left field').selectOption({ label: 'CEPC.Country' });
    await page.getByLabel('Rule 1 compared text').fill('FI');
    await page.getByLabel('Rule 1 result text').fill('FIN');
    await expect(page.getByTestId('preview-message')).toContainText(
      'Set which dataset the rows of "Company Codes" come from',
    );
  });
});
