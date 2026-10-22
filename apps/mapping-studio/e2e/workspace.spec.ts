import { expect, test, type Page } from '@playwright/test';
import { addSmallSources, loadSmallTarget, openApp } from './helpers';

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('storage-label')).toBeVisible();
}

async function createCustomer(page: Page, name: string, notes = ''): Promise<void> {
  await page.getByLabel('Customer name').fill(name);
  if (notes) await page.getByLabel('Customer notes').fill(notes);
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByTestId('home-title')).toHaveText(name);
}

async function addObject(page: Page, name: string, entity = ''): Promise<void> {
  await page.getByLabel('Business object name').fill(name);
  if (entity) await page.getByLabel('Business entity').fill(entity);
  await page.getByRole('button', { name: 'Add business object' }).click();
  await expect(page.getByTestId(`object-${name}`)).toBeVisible();
}

test.describe('Customer workspace (SPEC-032)', () => {
  test('the main page is a customer with one card per business object', async ({ page }) => {
    await openHome(page);
    await expect(page.getByText('Create your first customer')).toBeVisible();
    await createCustomer(page, 'Acme Oy', 'Pilot customer');
    await expect(page.getByTestId('no-objects')).toBeVisible();
    await addObject(page, 'Profit Center');
    await addObject(page, 'Cost Center', 'Cost Center master');
    await expect(page.getByTestId('object-Profit Center')).toContainText('Profit Center');
    await expect(page.getByTestId('object-Cost Center')).toContainText('Cost Center master');
    await expect(page.getByTestId('object-status-Profit Center')).toHaveText('Draft');
    await expect(page.getByTestId('object-summary-Profit Center')).toContainText(
      'No target yet · 0 datasets · 0 snapshots',
    );
  });

  test('opening an object shows the stages with a breadcrumb; Back returns with the card updated', async ({
    page,
  }) => {
    await openHome(page);
    await createCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByTestId('object-Profit Center').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy › Profit Center');
    await expect(page.getByTestId('project-name')).toHaveText('Profit Center');
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
    await addSmallSources(page);
    await page.getByTestId('back-to-customer').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('object-summary-Profit Center')).toContainText('2 datasets');
  });

  test('the work is saved in the object, and a reload reopens the last object', async ({
    page,
  }) => {
    await openHome(page);
    await createCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByTestId('object-Profit Center').getByRole('button', { name: 'Open' }).click();
    await addSmallSources(page);
    await loadSmallTarget(page);
    await expect(page.getByTestId('autosave-status')).toContainText('Autosaved');
    await page.waitForTimeout(700); // the autosave waits a moment after the last change
    await page.reload();
    await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy › Profit Center');
    await expect(page.getByTestId('stage-target-summary')).toHaveText('2 structures, 6 fields');
    await expect(page.getByTestId('stage-sources-summary')).toContainText('2 datasets');
  });

  test('changes made just before Back are saved', async ({ page }) => {
    await openHome(page);
    await createCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByTestId('object-Profit Center').getByRole('button', { name: 'Open' }).click();
    await addSmallSources(page);
    await page.getByTestId('back-to-customer').click(); // straight away, before the autosave delay
    await page.getByTestId('object-Profit Center').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByTestId('stage-sources-summary')).toContainText('2 datasets');
  });

  test('customers are separate, and each has its own business objects', async ({ page }) => {
    await openHome(page);
    await createCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await createCustomer(page, 'Beta Ab');
    await expect(page.getByTestId('no-objects')).toBeVisible();
    await addObject(page, 'Vendor');
    await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Acme Oy' });
    await expect(page.getByTestId('object-Profit Center')).toBeVisible();
    await expect(page.getByTestId('object-Vendor')).toHaveCount(0);
  });

  test('archiving asks first, removes the card, and a customer can be archived too', async ({
    page,
  }) => {
    await openHome(page);
    await createCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByRole('button', { name: 'Archive Profit Center' }).click();
    await expect(page.getByRole('dialog', { name: 'Archive' })).toContainText('Nothing is deleted');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('object-Profit Center')).toBeVisible();
    await page.getByRole('button', { name: 'Archive Profit Center' }).click();
    await page
      .getByRole('dialog', { name: 'Archive' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByTestId('object-Profit Center')).toHaveCount(0);
    await page.getByRole('button', { name: 'Archive customer' }).click();
    await page
      .getByRole('dialog', { name: 'Archive' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByText('Create your first customer')).toBeVisible();
  });

  test('empty names are refused with a message', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'Create customer' }).click();
    await expect(page.getByTestId('home-message')).toHaveText('Give the customer a name.');
    await createCustomer(page, 'Acme Oy');
    await page.getByRole('button', { name: 'Add business object' }).click();
    await expect(page.getByTestId('home-message')).toHaveText('Give the business object a name.');
  });

  test('a project saved in this browser before customers existed can be moved into a customer', async ({
    page,
  }) => {
    await openApp(page); // classic mode
    await addSmallSources(page);
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Project name').fill('Old Profit Center');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(600); // autosave
    await openHome(page);
    await createCustomer(page, 'Acme Oy');
    await expect(page.getByTestId('unfiled')).toContainText('Old Profit Center');
    await page.getByRole('button', { name: 'Move Old Profit Center into Acme Oy' }).click();
    await expect(page.getByTestId('object-Old Profit Center')).toContainText('2 datasets');
    await expect(page.getByTestId('unfiled')).toHaveCount(0);
  });
});
