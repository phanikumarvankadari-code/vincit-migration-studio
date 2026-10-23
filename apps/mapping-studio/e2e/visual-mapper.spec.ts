import { expect, test, type Page } from '@playwright/test';
import { openEditor, setUpSmallMapping, status } from './helpers';

const node = (page: Page, id: string) => page.locator(`[data-id="${id}"]`);
const src = (page: Page, n: number) => page.getByTestId(`src-f-CEPC-${n}`); // 1 Profit Center, 2 Valid To, 3 Valid From, 4 Country
const tgt = (page: Page, n: number) => page.getByTestId(`tgt-tf-Profit-Center-${n}`); // 1 Profit Center, 2 Valid From, 3 Region, 4 Language
const link = (page: Page, n: number) => page.getByTestId(`link-tf-Profit-Center-${n}`);

async function mapDirect(page: Page, structure: string, field: string, source: string) {
  await openEditor(page, structure, field);
  await page.getByLabel('Source field', { exact: true }).selectOption({ label: source });
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
}

async function openVisual(page: Page) {
  await page.getByRole('tab', { name: 'Visual Mapper' }).click();
  await expect(page.getByTestId('mapper')).toBeVisible();
}

test.describe('Two-panel mapper (SPEC-031)', () => {
  test('shows every source field on the left and the target fields on the right from the start', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    for (const n of [1, 2, 3, 4]) await expect(src(page, n)).toBeVisible();
    await expect(src(page, 4)).toContainText('Country');
    await expect(page.getByTestId('dataset-group-CEPC_BUKRS')).toBeVisible();
    for (const n of [1, 2, 3, 4]) await expect(tgt(page, n)).toBeVisible();
    await expect(tgt(page, 1)).toContainText('Key');
    await expect(tgt(page, 1)).toContainText('Unmapped');
    await expect(page.locator('[data-testid^="link-"]')).toHaveCount(0);
  });

  test('draws the mapping as lines, and a routine chain gets a function box', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Profit Center', 'CEPC.Profit Center');
    await openEditor(page, 'Profit Center', 'Valid From');
    await page.getByLabel('Mapping type').selectOption('routine');
    await page
      .getByLabel('Source field', { exact: true })
      .selectOption({ label: 'CEPC.Valid From' });
    await page.getByRole('button', { name: 'Add routine step' }).click();
    await page.getByLabel('Step 1 routine').selectOption({ label: 'Parse Date' });
    await page.getByLabel('Step 1 settings').fill('{"format":"M/D/YY","twoDigitYearPivot":68}');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await openVisual(page);
    await expect(link(page, 1)).toHaveCount(1); // a direct copy: one line, no box
    await expect(page.getByTestId('fn-tf-Profit-Center-1')).toHaveCount(0);
    await expect(page.getByTestId('fn-tf-Profit-Center-2')).toContainText('Parse Date');
    await expect(link(page, 2)).toHaveCount(2); // source to box, box to target
    await expect(tgt(page, 1)).toContainText('Mapped');
    await expect(tgt(page, 3)).toContainText('Unmapped');
  });

  test('a constant has a function box and no source line', async ({ page }) => {
    await setUpSmallMapping(page);
    await openEditor(page, 'Profit Center', 'Language');
    await page.getByLabel('Mapping type').selectOption('constant');
    await page.getByLabel('Constant value').fill('EN');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await openVisual(page);
    await expect(page.getByTestId('fn-tf-Profit-Center-4')).toContainText('Constant');
    await expect(link(page, 4)).toHaveCount(1); // only box to target
  });

  test('dragging a source field onto a target field creates a mapping the table also shows', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 4).dragTo(tgt(page, 3));
    await expect(page.getByTestId('graph-message')).toHaveText('Mapping created.');
    await expect(link(page, 3)).toHaveCount(1);
    await expect(tgt(page, 3)).toContainText('Mapped');
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(status(page, 'Profit Center', 'Region')).toHaveText('Mapped');
    await expect(page.getByTestId('row-Profit Center-Region')).toContainText('CEPC.Country');
    await expect(page.getByTestId('completeness-text-Profit Center')).toHaveText(
      '1 of 4 fields mapped (25%)',
    );
  });

  test('clicking a source field and then a target field also maps them', async ({ page }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await src(page, 4).click();
    await expect(page.getByTestId('pick-target')).toContainText('CEPC.Country is selected');
    await tgt(page, 4).click();
    await expect(page.getByTestId('graph-message')).toHaveText('Mapping created.');
    await expect(page.getByTestId('pick-target')).toHaveCount(0);
    await expect(link(page, 4)).toHaveCount(1);
  });

  test('a mapping made in the table appears in the picture without any extra step', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await openVisual(page);
    await expect(tgt(page, 4)).toContainText('Mapped');
    await expect(link(page, 4)).toHaveCount(1);
  });

  test('a mapped target is not overwritten by a stray drag', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Profit Center', 'CEPC.Profit Center');
    await openVisual(page);
    await src(page, 4).dragTo(tgt(page, 1));
    await expect(page.getByTestId('graph-message')).toContainText(
      '"Profit Center" already has a mapping',
    );
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(page.getByTestId('row-Profit Center-Profit Center')).toContainText(
      'CEPC.Profit Center',
    );
  });

  test('selecting a target field offers to edit or remove its mapping', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await openVisual(page);
    await tgt(page, 4).click();
    await expect(page.getByTestId('target-panel')).toContainText('Language');
    await expect(page.getByTestId('target-panel')).toContainText('CEPC.Country');
    await page.getByRole('button', { name: 'Edit mapping' }).click();
    await expect(page.getByTestId('mapping-editor')).toBeVisible();
    await expect(page.getByLabel('Source field', { exact: true })).toHaveValue('ds-CEPC|f-CEPC-4');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Remove mapping' }).click();
    await expect(link(page, 4)).toHaveCount(0);
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Unmapped');
  });

  test('clicking a line selects its target, and Delete removes the mapping', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await openVisual(page);
    await link(page, 4).click({ force: true });
    await expect(page.getByTestId('target-panel')).toContainText('Language');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('graph-message')).toHaveText('Mapping removed.');
    await expect(link(page, 4)).toHaveCount(0);
  });

  test('a hidden or collapsed source keeps its line', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await openVisual(page);
    await page.getByLabel('Search source fields').fill('Valid');
    await expect(src(page, 4)).toHaveCount(0);
    await expect(src(page, 3)).toBeVisible();
    await expect(link(page, 4)).toHaveCount(1);
    await page.getByLabel('Search source fields').fill('');
    await page.getByTestId('dataset-group-CEPC').click();
    await expect(src(page, 1)).toHaveCount(0);
    await expect(link(page, 4)).toHaveCount(1);
    await page.getByTestId('dataset-group-CEPC').click();
    await expect(src(page, 4)).toBeVisible();
  });

  test('target fields can be searched and filtered to the unmapped ones', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await openVisual(page);
    await page.getByLabel('Show target fields').selectOption('unmapped');
    await expect(tgt(page, 4)).toHaveCount(0);
    await expect(tgt(page, 3)).toBeVisible();
    await page.getByLabel('Show target fields').selectOption('requiredUnmapped');
    await expect(tgt(page, 3)).toHaveCount(0); // Region is optional
    await expect(tgt(page, 1)).toBeVisible();
    await page.getByLabel('Show target fields').selectOption('all');
    await page.getByLabel('Search target fields').fill('lang');
    await expect(tgt(page, 4)).toBeVisible();
    await expect(tgt(page, 1)).toHaveCount(0);
  });

  test('the structure can be changed; each structure has its own picture', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await mapDirect(page, 'Company Codes', 'Company Code', 'CEPC_BUKRS.Company Code');
    await openVisual(page);
    await expect(tgt(page, 4)).toBeVisible();
    await page.getByLabel('Structure', { exact: true }).selectOption({ label: 'Company Codes' });
    await expect(page.getByTestId('tgt-tf-Company-Codes-2')).toContainText('Mapped');
    await expect(tgt(page, 4)).toHaveCount(0);
    await expect(page.getByTestId('link-tf-Company-Codes-2')).toHaveCount(1);
  });

  test('the joins picture shows datasets and joins; a join can be confirmed from it', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByLabel('Picture').selectOption('relationships');
    await expect(node(page, 'ds|ds-CEPC')).toContainText('CEPC');
    await expect(node(page, 'ds|ds-CEPC_BUKRS')).toContainText('CEPC_BUKRS');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(
      page.locator('.react-flow__edge-textwrapper, .react-flow__edge-text').first(),
    ).toContainText('Profit Center (oneToMany)');
    await page.locator('.react-flow__edge').first().click({ force: true });
    await expect(page.getByTestId('relationship-panel')).toContainText('suggested');
    await page.getByRole('button', { name: 'Confirm join' }).click();
    await expect(page.getByTestId('relationship-panel')).toContainText('confirmed');
    await expect(page.getByTestId('stage-sources-summary')).toContainText('1 join confirmed');
  });
});
