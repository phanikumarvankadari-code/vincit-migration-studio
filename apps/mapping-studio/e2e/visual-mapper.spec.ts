import { expect, test, type Page } from '@playwright/test';
import { openEditor, setUpSmallMapping, status } from './helpers';

const node = (page: Page, id: string) => page.locator(`[data-id="${id}"]`);
const srcId = (n: number) => `src|f-CEPC-${n}`; // 1 Profit Center, 2 Valid To, 3 Valid From, 4 Country
const tgtId = (n: number) => `tgt|tf-Profit-Center-${n}`; // 1 Profit Center, 2 Valid From, 3 Region, 4 Language

async function mapDirect(page: Page, structure: string, field: string, source: string) {
  await openEditor(page, structure, field);
  await page.getByLabel('Source field', { exact: true }).selectOption({ label: source });
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
}

async function openVisual(page: Page) {
  await page.getByRole('tab', { name: 'Visual Mapper' }).click();
  await expect(page.getByTestId('visual-canvas')).toBeVisible();
}

test.describe('Visual Mapper (SPEC-023)', () => {
  test('renders the canonical mapping: sources, steps and target fields with their links', async ({
    page,
  }) => {
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
    await expect(node(page, srcId(1))).toContainText('Profit Center');
    await expect(node(page, srcId(1))).toContainText('CEPC');
    await expect(node(page, srcId(3))).toContainText('Valid From');
    await expect(node(page, 'step|m-tf-Profit-Center-2|0')).toContainText('Parse Date');
    for (const n of [1, 2, 3, 4]) await expect(node(page, tgtId(n))).toBeVisible();
    await expect(node(page, tgtId(3))).toContainText('Not mapped');
    await expect(node(page, tgtId(2))).toContainText('Required'.slice(0, 0) + 'Routine');
    // source to target (1 link), and source to step to target (2 links)
    await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  });

  test('connecting a source field to an unmapped target field creates a mapping the table also shows', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await openVisual(page);
    await page.getByLabel('Show all source fields').check();
    await expect(node(page, srcId(4))).toContainText('Country');
    await node(page, srcId(4))
      .locator('.source')
      .dragTo(node(page, tgtId(3)).locator('.target'));
    await expect(page.getByTestId('graph-message')).toHaveText('Mapping created.');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(node(page, tgtId(3))).toContainText('Direct');
    // the same mapping is in the Mapping Table
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(status(page, 'Profit Center', 'Region')).toHaveText('Mapped');
    await expect(page.getByTestId('row-Profit Center-Region')).toContainText('CEPC.Country');
    await expect(page.getByTestId('completeness-text-Profit Center')).toHaveText(
      '1 of 4 fields mapped (25%)',
    );
  });

  test('a mapping made in the table appears in the picture without any extra step', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await openVisual(page);
    await expect(node(page, tgtId(4))).toContainText('Direct');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('a mapped target is not overwritten by a stray drag', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Profit Center', 'CEPC.Profit Center');
    await openVisual(page);
    await page.getByLabel('Show all source fields').check();
    await node(page, srcId(4))
      .locator('.source')
      .dragTo(node(page, tgtId(1)).locator('.target'));
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
    await node(page, tgtId(4)).click();
    await expect(page.getByTestId('target-panel')).toContainText('Language');
    await expect(page.getByTestId('target-panel')).toContainText('CEPC.Country');
    await page.getByRole('button', { name: 'Edit mapping' }).click();
    await expect(page.getByTestId('mapping-editor')).toBeVisible();
    await expect(page.getByLabel('Source field', { exact: true })).toHaveValue('ds-CEPC|f-CEPC-4');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await node(page, tgtId(4)).click();
    await page.getByRole('button', { name: 'Remove mapping' }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await expect(status(page, 'Profit Center', 'Language')).toHaveText('Unmapped');
  });

  test('a link can be selected and deleted with the keyboard', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await openVisual(page);
    await page.locator('.react-flow__edge').first().click({ force: true });
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('graph-message')).toHaveText('Mapping removed.');
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  });

  test('the structure can be changed; each structure has its own picture', async ({ page }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await mapDirect(page, 'Company Codes', 'Company Code', 'CEPC_BUKRS.Company Code');
    await openVisual(page);
    await expect(node(page, tgtId(4))).toBeVisible();
    await page.getByLabel('Structure', { exact: true }).selectOption({ label: 'Company Codes' });
    await expect(node(page, 'tgt|tf-Company-Codes-2')).toContainText('Direct');
    await expect(node(page, tgtId(4))).toHaveCount(0);
  });

  test('dragging a node keeps its place when switching views and coming back (layout is remembered)', async ({
    page,
  }) => {
    await setUpSmallMapping(page);
    await mapDirect(page, 'Profit Center', 'Language', 'CEPC.Country');
    await openVisual(page);
    const target = node(page, tgtId(4));
    const before = (await target.boundingBox())!;
    await target.hover();
    await page.mouse.down();
    await page.mouse.move(before.x + 40, before.y + 120, { steps: 12 });
    await page.mouse.up();
    const moved = (await target.boundingBox())!;
    // the canvas may pan a little while dragging near its edge, so only require a clear move
    expect(Math.abs(moved.y - before.y)).toBeGreaterThan(20);
    await page.getByRole('tab', { name: 'Mapping Table' }).click();
    await openVisual(page);
    const again = (await node(page, tgtId(4)).boundingBox())!;
    expect(Math.abs(again.y - moved.y)).toBeLessThan(30);
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
