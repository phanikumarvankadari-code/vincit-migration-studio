import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addSmallSources, loadSmallTarget, openWorkspaceObject } from './helpers';

async function openDetail(page: import('@playwright/test').Page) {
  await openWorkspaceObject(page);
  await addSmallSources(page);
  await loadSmallTarget(page);
  await page.waitForTimeout(700); // autosave
  await page.getByTestId('back-to-customer').click();
  await page.getByRole('button', { name: 'Profit Center', exact: true }).click();
  return page.getByTestId('object-detail');
}

test.describe('Download and upload the mapping of a business object', () => {
  test('the mapping downloads as one file with all sources and targets', async ({ page }) => {
    const detail = await openDetail(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      detail.getByTestId('download-mapping').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^Acme Oy_Profit Center_\d{8}-\d{6}\.mms\.json$/);
    const doc = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    expect(doc.format).toBe('mms.workspace');
    expect(doc.project.sourceDefinitions.length).toBe(2);
    expect(doc.project.targetDefinition.structures.length).toBe(2);
  });

  test('an edited file replaces the mapping; a broken file is refused', async ({ page }, info) => {
    const detail = await openDetail(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      detail.getByTestId('download-mapping').click(),
    ]);
    const doc = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    doc.project.name = 'Edited outside';

    await page.getByTestId('upload-mapping-input').setInputFiles({
      name: 'broken.mms.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ not json'),
    });
    await page.getByTestId('confirm-upload').getByRole('button', { name: 'Replace' }).click();
    await expect(detail.getByTestId('detail-message')).toContainText('was not used');

    await page.getByTestId('upload-mapping-input').setInputFiles({
      name: 'edited.mms.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(doc)),
    });
    await page.getByTestId('confirm-upload').getByRole('button', { name: 'Replace' }).click();
    await expect(detail.getByTestId('detail-info')).toContainText('replaced');
    await detail.getByRole('button', { name: 'Open mapping' }).click();
    await expect(page.getByTestId('project-name')).toHaveText('Edited outside');
    void info;
  });
});
