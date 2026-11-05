import { expect, test } from '@playwright/test';

test.describe('container smoke test (SPEC-030)', () => {
  test('AC-2 health endpoint answers and the app loads', async ({ page, request }) => {
    const health = await request.get('/healthz');
    expect(health.status()).toBe(200);
    await page.goto('/');
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByText('Create your first project')).toBeVisible();
  });

  test('AC-4 a file on the mounted volume is listed and downloadable', async ({ request }) => {
    const listing = await request.get('/data/profit-center/input/');
    expect(listing.status()).toBe(200);
    expect(await listing.text()).toContain('CEPC.csv');
  });

  test('AC-5 a file from the volume imports through the Sources stage', async ({
    page,
    request,
  }) => {
    const file = await request.get('/data/profit-center/input/CEPC.csv');
    expect(file.status()).toBe(200);
    await page.goto('/?legacy=1');
    await page.getByTestId('source-files-input').setInputFiles({
      name: 'CEPC.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(await file.body()),
    });
    await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
  });

  test('unknown paths fall back to the app, not an error page', async ({ page }) => {
    await page.goto('/some/deep/link');
    await expect(page.getByTestId('home')).toBeVisible();
  });
});
