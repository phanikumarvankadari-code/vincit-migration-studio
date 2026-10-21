import { expect, test } from '@playwright/test';
import { addSmallSources, openApp } from './helpers';

test.describe('Project library (M10)', () => {
  test('an earlier project can be found and opened again after starting a new one', async ({
    page,
  }) => {
    await openApp(page);
    await addSmallSources(page);
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Project name').fill('Profit Center SIT');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(500); // autosave

    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByRole('button', { name: 'Start new project' }).click();
    await expect(page.getByTestId('project-name')).toHaveText('New migration project');

    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const old = page.getByTestId('project-Profit Center SIT');
    await expect(old).toBeVisible();
    await old.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByTestId('project-name')).toHaveText('Profit Center SIT');
    await expect(page.getByTestId('restored-banner')).toContainText('was restored');
    await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
  });

  test('an empty new project is not listed, and a listed project can be deleted', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(page.getByTestId('projects-empty')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await addSmallSources(page);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByRole('button', { name: 'Start new project' }).click();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const old = page.getByTestId('project-New migration project');
    await expect(old).toHaveCount(1); // the first project; the empty current one is not listed
    await page.getByRole('button', { name: 'Delete New migration project' }).click();
    await expect(page.getByTestId('projects-empty')).toBeVisible();
  });

  test('Fresh start refreshes the whole screen with a new empty project and keeps the old one in Projects', async ({
    page,
  }) => {
    await openApp(page);
    await addSmallSources(page);
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Project name').fill('Before refresh');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(500); // autosave
    await page.getByRole('button', { name: 'Fresh start' }).click();
    await page.getByRole('button', { name: 'Start new project' }).click();
    await expect(page.getByTestId('project-name')).toHaveText('New migration project');
    await expect(page.getByTestId('stage-sources-summary')).toHaveText('No files yet');
    await expect(page.getByTestId('restored-banner')).toHaveCount(0);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(page.getByTestId('project-Before refresh')).toBeVisible();
  });
});
