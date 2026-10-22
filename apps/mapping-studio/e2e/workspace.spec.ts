import { expect, test } from '@playwright/test';
import {
  addCustomer,
  addObject,
  addSmallSources,
  createFirstCustomer,
  loadSmallTarget,
  openApp,
  openHome,
  openObjectFromRow,
  openWorkspaceObject,
} from './helpers';

test.describe('Vincit Migration Studio: customers and business objects (SPEC-032, SPEC-035)', () => {
  test('AC-6 every page carries the Vincit logo and the product name', async ({ page }) => {
    await openHome(page);
    await expect(page).toHaveTitle('Vincit Migration Studio');
    await expect(page.getByRole('img', { name: 'Vincit logo' })).toBeVisible();
    await expect(page.getByText('Vincit Migration Studio').first()).toBeVisible();
    await createFirstCustomer(page, 'Acme Oy');
    await expect(page.getByRole('img', { name: 'Vincit logo' })).toBeVisible();
    await addObject(page, 'Profit Center');
    await openObjectFromRow(page, 'Profit Center');
    await expect(page.getByRole('img', { name: 'Vincit logo' })).toBeVisible();
    await expect(page.getByText('Vincit Migration Studio').first()).toBeVisible();
  });

  test('AC-1 the first run creates the first customer; its home lists the business objects', async ({
    page,
  }) => {
    await openHome(page);
    await createFirstCustomer(page, 'Acme Oy');
    await expect(page.getByTestId('no-objects')).toBeVisible();
    await addObject(page, 'Profit Center');
    await addObject(page, 'Cost Center', 'Cost Center master');
    await expect(page.getByTestId('object-Cost Center')).toContainText('Cost Center master');
    await expect(page.getByTestId('object-status-Profit Center')).toHaveText('Draft');
    await expect(page.getByTestId('object-summary-Profit Center')).toHaveText('No target');
    await expect(page.getByTestId('object-lastrun-Profit Center')).toHaveText('No output yet');
    await expect(page.getByTestId('kpi-Business objects')).toContainText('2');
  });

  test('AC-2 All customers shows cards and the projects of every customer', async ({ page }) => {
    await openHome(page);
    await createFirstCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await addObject(page, 'Cost Center');
    await page.getByRole('button', { name: 'All customers' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Customers');
    await expect(page.getByTestId('portfolio-summary')).toHaveText(
      '1 customer · 2 business objects · 0 runs saved',
    );
    await expect(page.getByTestId('customer-Acme Oy')).toContainText('2 business objects');
    await expect(page.getByTestId('customer-Acme Oy')).toContainText('2 draft');
    await expect(page.getByTestId('project-Acme Oy-Profit Center')).toBeVisible();
    await expect(page.getByTestId('project-Acme Oy-Cost Center')).toBeVisible();
    // search narrows the projects (and the customers that have them)
    await page.getByLabel('Search', { exact: true }).fill('cost');
    await expect(page.getByTestId('project-Acme Oy-Cost Center')).toBeVisible();
    await expect(page.getByTestId('project-Acme Oy-Profit Center')).toHaveCount(0);
    await page.getByLabel('Search', { exact: true }).fill('nothing like this');
    await expect(page.getByTestId('no-customers-match')).toBeVisible();
  });

  test('AC-2 filter to customers that need attention, and sort', async ({ page }) => {
    await openHome(page);
    await createFirstCustomer(page, 'Beta Ab');
    await page.getByRole('button', { name: 'All customers' }).click();
    await addCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center'); // no source files: needs attention
    await page.getByRole('button', { name: 'All customers' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Customers');
    await expect(page.getByTestId('customer-attention-Acme Oy')).toHaveText('1 to check');
    await page.getByRole('button', { name: /Needs attention \(1\)/ }).click();
    await expect(page.getByTestId('customer-Acme Oy')).toBeVisible();
    await expect(page.getByTestId('customer-Beta Ab')).toHaveCount(0);
    await page.getByRole('button', { name: /^All \(2\)/ }).click();
    await page.getByLabel('Sort customers').selectOption('name');
    const names = await page
      .locator('[data-testid^="customer-"][aria-label^="Open customer"]')
      .allTextContents();
    expect(names[0]).toContain('Acme Oy');
    expect(names[1]).toContain('Beta Ab');
  });

  test('AC-3 customer home: summary, continue panel, Resume and Open', async ({ page }) => {
    await openWorkspaceObject(page);
    await page.getByTestId('back-to-customer').click();
    await expect(page.getByTestId('home-title')).toHaveText('Acme Oy');
    await expect(page.getByTestId('continue-panel')).toContainText('Profit Center · Sources step');
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy');
    await expect(page.getByTestId('project-name')).toHaveText('Profit Center');
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
  });

  test('AC-3 the breadcrumb leads back through the levels', async ({ page }) => {
    await openWorkspaceObject(page);
    await page.getByRole('button', { name: 'All customers' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Customers');
    await page.getByTestId('customer-Acme Oy').click();
    await expect(page.getByTestId('home-title')).toHaveText('Acme Oy');
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('button', { name: 'All customers' })
      .click();
    await expect(page.getByTestId('home-title')).toHaveText('Customers');
  });

  test('AC-4 the object detail shows the steps, counts, files and outputs', async ({ page }) => {
    await openWorkspaceObject(page);
    await addSmallSources(page);
    await loadSmallTarget(page);
    await page.waitForTimeout(700); // autosave
    await page.getByTestId('back-to-customer').click();
    await page.getByRole('button', { name: 'Profit Center', exact: true }).click();
    const detail = page.getByTestId('object-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('step-Sources')).toHaveAttribute('data-state', 'done');
    await expect(detail.getByTestId('step-Target')).toHaveAttribute('data-state', 'done');
    await expect(detail.getByTestId('step-Map')).toHaveAttribute('data-state', 'now');
    await expect(detail.getByTestId('step-Test')).toHaveAttribute('data-state', 'todo');
    await expect(detail).toContainText('2 structures, 6 fields');
    await expect(detail.getByTestId('detail-files')).toContainText('CEPC.csv');
    await expect(detail.getByTestId('detail-files')).toContainText('CEPC_BUKRS.csv');
    await expect(detail.getByTestId('detail-runs')).toContainText('No output saved yet.');
    await detail.getByRole('button', { name: 'Open project' }).click();
    await expect(page.getByTestId('stage-target-summary')).toHaveText('2 structures, 6 fields');
  });

  test('AC-4 Archive from the detail asks first and removes the object', async ({ page }) => {
    await openHome(page);
    await createFirstCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByRole('button', { name: 'Profit Center', exact: true }).click();
    await page.getByTestId('object-detail').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('dialog', { name: 'Archive' })).toContainText('Nothing is deleted');
    await page
      .getByRole('dialog', { name: 'Archive' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByTestId('object-Profit Center')).toHaveCount(0);
    await expect(page.getByTestId('no-objects')).toBeVisible();
  });

  test('AC-5 the work is saved in the object, and a reload reopens the last object', async ({
    page,
  }) => {
    await openWorkspaceObject(page);
    await addSmallSources(page);
    await loadSmallTarget(page);
    await expect(page.getByTestId('autosave-status')).toContainText('Autosaved');
    await page.waitForTimeout(700); // the autosave waits a moment after the last change
    await page.reload();
    await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy');
    await expect(page.getByTestId('stage-target-summary')).toHaveText('2 structures, 6 fields');
    await expect(page.getByTestId('stage-sources-summary')).toContainText('2 datasets');
  });

  test('changes made just before Back are saved', async ({ page }) => {
    await openWorkspaceObject(page);
    await addSmallSources(page);
    await page.getByTestId('back-to-customer').click(); // straight away, before the autosave delay
    await expect(page.getByTestId('object-summary-Profit Center')).toBeVisible();
    await openObjectFromRow(page, 'Profit Center');
    await expect(page.getByTestId('stage-sources-summary')).toContainText('2 datasets');
  });

  test('customers are separate, each with its own business objects', async ({ page }) => {
    await openHome(page);
    await createFirstCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByRole('button', { name: 'All customers' }).click();
    await addCustomer(page, 'Beta Ab');
    await addObject(page, 'Vendor');
    await page.getByRole('button', { name: 'All customers' }).click();
    await page.getByTestId('customer-Acme Oy').click();
    await expect(page.getByTestId('object-Profit Center')).toBeVisible();
    await expect(page.getByTestId('object-Vendor')).toHaveCount(0);
  });

  test('archiving a business object asks first; a customer can be archived too', async ({
    page,
  }) => {
    await openHome(page);
    await createFirstCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByRole('button', { name: 'More actions for Profit Center' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(page.getByRole('dialog', { name: 'Archive' })).toContainText('Nothing is deleted');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('object-Profit Center')).toBeVisible();
    await page.getByRole('button', { name: 'More actions for Profit Center' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
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
    await createFirstCustomer(page, 'Acme Oy');
    await page.getByRole('button', { name: 'Add business object' }).first().click();
    await page.getByRole('button', { name: 'Create business object' }).click();
    await expect(page.getByTestId('dialog-message')).toHaveText('Give the business object a name.');
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
    await createFirstCustomer(page, 'Acme Oy');
    await expect(page.getByTestId('unfiled')).toContainText('Old Profit Center');
    await page.getByRole('button', { name: 'Move Old Profit Center into Acme Oy' }).click();
    await expect(page.getByTestId('object-summary-Old Profit Center')).toBeVisible();
    await expect(page.getByTestId('unfiled')).toHaveCount(0);
  });
});
