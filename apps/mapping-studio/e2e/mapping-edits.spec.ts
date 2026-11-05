import { expect, test, type Page } from '@playwright/test';
import {
  addSmallSources,
  goToStage,
  loadTargetText,
  openApp,
  setUpSmallMapping,
  status,
} from './helpers';

const src = (page: Page, n: number) => page.getByTestId(`src-f-CEPC-${n}`); // 1 Profit Center, 2 Valid To, 3 Valid From, 4 Country
const tgt = (page: Page, n: number) => page.getByTestId(`tgt-tf-Profit-Center-${n}`); // 1 Profit Center, 2 Valid From, 3 Region, 4 Language
const T = (n: number) => `tf-Profit-Center-${n}`;

async function openVisual(page: Page) {
  await page.getByRole('tab', { name: 'Visual Mapper' }).click();
  await expect(page.getByTestId('mapper')).toBeVisible();
}

test.describe('Hard-coded values', () => {
  const TARGET = [
    'Structure,Field,Type,Length,Importance,Key',
    'Profit Center,Profit Center,Text,10,mandatory,X',
    'Profit Center,Valid From,Date,,mandatory,',
    'Profit Center,Valid To,Date,,mandatory,',
    'Profit Center,Language,Text,,,',
  ].join('\n');
  const VT = 'tf-Profit-Center-3';

  test('a field nothing can fill can be hard-coded from the mapper', async ({ page }) => {
    await openApp(page);
    await addSmallSources(page);
    await loadTargetText(page, TARGET);
    await goToStage(page, 'map');
    await openVisual(page);
    await page.getByTestId(`tgt-${VT}`).click();
    await page.getByTestId('hard-code').click();
    await expect(page.getByTestId('mapping-editor')).toBeVisible();
    await expect(page.getByLabel('Mapping type')).toHaveValue('constant');
    await page.getByLabel('Constant datatype').selectOption('date');
    await page.getByLabel('Constant value').fill('9999-12-31');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId(`fn-${VT}`)).toContainText('Constant');
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(page.getByTestId('row-Profit Center-Valid To')).toContainText('9999-12-31');
  });
});

test.describe('Deleting mappings, with undo', () => {
  test('AC-6 table: remove one mapping from its row, then undo', async ({ page }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 1).dragTo(tgt(page, 1));
    await src(page, 4).dragTo(tgt(page, 4));
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await page.getByRole('button', { name: 'Delete Profit Center Language' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Unmapped');
    await expect(status(page, 'Profit Center', 'Profit Center')).toHaveText('Mapped');
    await expect(page.getByTestId('undo-bar')).toContainText('Mapping removed: Language');
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Mapped');
    await expect(page.getByTestId('undo-bar')).toHaveCount(0);
  });

  test('AC-6 table: delete several selected mappings after a confirmation, then undo', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 1).dragTo(tgt(page, 1));
    await src(page, 4).dragTo(tgt(page, 3));
    await src(page, 4).dragTo(tgt(page, 4));
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(page.getByTestId('delete-selected')).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Select Region' }).check();
    await page.getByRole('checkbox', { name: 'Select Language' }).check();
    await expect(page.getByTestId('delete-selected')).toHaveText('Delete selected (2)');
    await page.getByTestId('delete-selected').click();
    await expect(page.getByRole('dialog', { name: 'Delete mappings' })).toContainText(
      'You can undo this right after',
    );
    await page
      .getByRole('dialog', { name: 'Delete mappings' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(status(page, 'Profit Center', 'Region')).toHaveText('Unmapped');
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Unmapped');
    await expect(status(page, 'Profit Center', 'Profit Center')).toHaveText('Mapped');
    await expect(page.getByTestId('undo-bar')).toContainText('2 mappings removed');
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(status(page, 'Profit Center', 'Region')).toHaveText('Mapped');
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Mapped');
  });

  test('AC-6 table: select all selects every mapped row', async ({ page }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 1).dragTo(tgt(page, 1));
    await src(page, 4).dragTo(tgt(page, 3));
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await page.getByRole('checkbox', { name: 'Select all mapped fields' }).check();
    await expect(page.getByTestId('delete-selected')).toHaveText('Delete selected (2)');
  });

  test('AC-6 mapper: Remove mapping and the Delete key both remove a mapping and offer undo', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 4).dragTo(tgt(page, 3));
    await tgt(page, 3).click();
    await page.getByRole('button', { name: 'Remove mapping', exact: true }).click();
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(0);
    await expect(page.getByTestId('undo-bar')).toBeVisible();
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(1);
    await tgt(page, 3).click();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('graph-message')).toHaveText('Mapping removed.');
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(0);
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId(`link-${T(3)}`)).toHaveCount(1);
  });
});

test.describe('Conflicts in mappings in place', () => {
  test('one source feeding two target fields is flagged in the mapper and the table', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 4).dragTo(tgt(page, 3));
    await src(page, 4).dragTo(tgt(page, 4));
    await expect(page.getByTestId('conflict-sourceReused')).toContainText(
      'CEPC.Country feeds 2 fields: Region, Language',
    );
    await expect(page.getByTestId(`conflict-marker-${T(3)}`)).toBeVisible();
    await expect(page.getByTestId(`conflict-marker-${T(4)}`)).toBeVisible();
    await expect(page.getByTestId(`tgt-conflict-${T(3)}`)).toContainText('1 conflict');
    await page.getByTestId(`conflict-marker-${T(3)}`).click();
    await expect(page.getByTestId('panel-conflict')).toContainText('CEPC.Country feeds 2 fields');
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(page.getByTestId('conflicts-Profit Center-Region')).toContainText(
      'CEPC.Country feeds 2 fields',
    );
    await page.getByLabel('Filter by conflicts').selectOption('has');
    await expect(page.getByTestId('table-count')).toHaveText('2 of 6 fields');
  });
});
