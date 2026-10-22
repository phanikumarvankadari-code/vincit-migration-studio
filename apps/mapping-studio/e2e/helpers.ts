import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../test-data/profit-center/', import.meta.url);
export const fixture = (p: string): string => fileURLToPath(new URL(p, root));

export const csv = (name: string, text: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text, 'utf8'),
});

/** Opens the app in classic single-project mode and lands on the Sources stage. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/?legacy=1');
  await expect(page.getByTestId('project-name')).toBeVisible();
}

export async function goToStage(
  page: Page,
  stage: 'sources' | 'target' | 'map' | 'test' | 'ready',
): Promise<void> {
  await page.getByTestId(`stage-${stage}`).click();
}

export async function addProfitCenterSources(page: Page, withDictionary = false): Promise<void> {
  await page
    .getByTestId('source-files-input')
    .setInputFiles([
      fixture('input/CEPC.csv'),
      fixture('input/CEPCT.csv'),
      fixture('input/CEPC_BUKRS.csv'),
    ]);
  await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
  if (withDictionary) {
    await page.getByTestId('dictionary-input').setInputFiles(fixture('input/field_dictionary.csv'));
    await expect(page.getByTestId('dictionary-loaded')).toBeVisible();
  }
}

export async function loadTarget(page: Page): Promise<void> {
  await goToStage(page, 'target');
  await page.getByTestId('target-file-input').setInputFiles(fixture('target/data_pc.XLSX'));
  await expect(page.getByTestId('target-preview-summary')).toContainText('3 structures');
  await page.getByRole('button', { name: 'Use this target' }).click();
  await expect(page.getByTestId('structure-Profit Center')).toBeVisible();
}

/**
 * Two small, joinable sources that make mapping tests easy to read: parents (CEPC) and children (CEPC_BUKRS).
 * The Profit Center fixture files have no values in common, so mapping and test scenarios use these.
 */
export const CEPC_SMALL = csv(
  'CEPC.csv',
  [
    'Profit Center,Valid To,Valid From,Country',
    'P100,12/31/99,1/1/26,FI',
    'P200,12/31/99,5/1/26,SE',
    'P300,12/31/99,13/45/26,NO',
  ].join('\n'),
);
export const BUKRS_SMALL = csv(
  'CEPC_BUKRS.csv',
  ['Profit Center,Company Code', 'P100,FI01', 'P100,FI02', 'P300,NO01'].join('\n'),
);

export async function addSmallSources(page: Page): Promise<void> {
  await page.getByTestId('source-files-input').setInputFiles([CEPC_SMALL, BUKRS_SMALL]);
  await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
  await expect(page.getByTestId('dataset-CEPC_BUKRS')).toBeVisible();
}

export const SMALL_TARGET = [
  'Structure,Field,Type,Length,Importance,Key',
  'Profit Center,Profit Center,Text,10,mandatory,X',
  'Profit Center,Valid From,Date,,mandatory,',
  'Profit Center,Region,Text,,,',
  'Profit Center,Language,Text,,,',
  'Company Codes,Profit Center,Text,10,mandatory,X',
  'Company Codes,Company Code,Text,4,mandatory,X',
].join('\n');

/** A small target typed in through the manual dialog. */
export async function loadSmallTarget(page: Page): Promise<void> {
  await goToStage(page, 'target');
  await page.getByRole('button', { name: 'Create target manually' }).click();
  await page.getByLabel('Target definition').fill(SMALL_TARGET);
  await page.getByRole('button', { name: 'Use this target' }).click();
  await expect(page.getByTestId('structure-Profit Center')).toBeVisible();
}

/** A target typed in through the manual dialog, from the given definition text. */
export async function loadTargetText(page: Page, text: string): Promise<void> {
  await goToStage(page, 'target');
  await page.getByRole('button', { name: 'Create target manually' }).click();
  await page.getByLabel('Target definition').fill(text);
  await page.getByRole('button', { name: 'Use this target' }).click();
  await expect(page.getByTestId(/^structure-/).first()).toBeVisible();
}

/** Small sources and small target, then the Map stage. */
export async function setUpSmallMapping(page: Page): Promise<void> {
  await openApp(page);
  await addSmallSources(page);
  await loadSmallTarget(page);
  await goToStage(page, 'map');
  await expect(page.getByRole('table', { name: 'Mapping table' })).toBeVisible();
}

export async function openEditor(page: Page, structure: string, field: string): Promise<void> {
  await page.getByTestId(`row-${structure}-${field}`).click();
  await expect(page.getByTestId('mapping-editor')).toBeVisible();
}

export const status = (page: Page, structure: string, field: string) =>
  page.getByTestId(`status-${structure}-${field}`);

async function saveDirect(page: Page, structure: string, field: string, source: string) {
  await openEditor(page, structure, field);
  await page.getByLabel('Source field', { exact: true }).selectOption({ label: source });
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
}

/**
 * Maps the small project completely through the editor:
 * Profit Center: key (direct), Valid From (parse then format), Region (lookup, NO is missing on purpose), Language (constant).
 * Company Codes: both fields direct, rows from CEPC_BUKRS, linked to Profit Center.
 */
export async function mapSmallProject(page: Page): Promise<void> {
  await saveDirect(page, 'Profit Center', 'Profit Center', 'CEPC.Profit Center');

  await openEditor(page, 'Profit Center', 'Valid From');
  await page.getByLabel('Mapping type').selectOption('routine');
  await page.getByLabel('Source field', { exact: true }).selectOption({ label: 'CEPC.Valid From' });
  await page.getByRole('button', { name: 'Add routine step' }).click();
  await page.getByLabel('Step 1 routine').selectOption({ label: 'Parse Date' });
  await page.getByLabel('Step 1 settings').fill('{"format":"M/D/YY","twoDigitYearPivot":68}');
  await page.getByRole('button', { name: 'Add routine step' }).click();
  await page.getByLabel('Step 2 routine').selectOption({ label: 'Format Date' });
  await page.getByLabel('Step 2 settings').fill('{"format":"YYYYMMDD"}');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);

  await openEditor(page, 'Profit Center', 'Region');
  await page.getByLabel('Mapping type').selectOption('lookup');
  await page.getByLabel('Source field to look up').selectOption({ label: 'CEPC.Country' });
  await page.getByLabel('Lookup name').fill('Country to region');
  await page.getByLabel('Entry 1 key').fill('FI');
  await page.getByLabel('Entry 1 value').fill('North');
  await page.getByRole('button', { name: 'Add entry' }).click();
  await page.getByLabel('Entry 2 key').fill('SE');
  await page.getByLabel('Entry 2 value').fill('North');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);

  await openEditor(page, 'Profit Center', 'Language');
  await page.getByLabel('Mapping type').selectOption('constant');
  await page.getByLabel('Constant value').fill('EN');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);

  await saveDirect(page, 'Company Codes', 'Profit Center', 'CEPC_BUKRS.Profit Center');
  await saveDirect(page, 'Company Codes', 'Company Code', 'CEPC_BUKRS.Company Code');

  await page
    .getByTestId('completeness-Company Codes')
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.getByLabel('Driver dataset').selectOption({ label: 'CEPC_BUKRS' });
  await page.getByLabel('Parent structure').selectOption({ label: 'Profit Center' });
  await page.getByLabel('Link 1 field in Company Codes').selectOption({ label: 'Profit Center' });
  await page.getByLabel('Link 1 field in Profit Center').selectOption({ label: 'Profit Center' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByTestId('completeness-Company Codes')).toContainText(
    'Rows come from CEPC_BUKRS',
  );
}

export async function runTest(page: Page, sample?: string): Promise<void> {
  await goToStage(page, 'test');
  if (sample) await page.getByLabel('Sample').selectOption(sample);
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByTestId('run-summary')).toBeVisible();
}

/** A bigger CEPC with the same four columns, for large-result tests. */
export function bigCepc(rows: number) {
  const lines = ['Profit Center,Valid To,Valid From,Country'];
  for (let i = 1; i <= rows; i++) lines.push(`P${String(i).padStart(5, '0')},12/31/99,1/1/26,FI`);
  return csv('CEPC.csv', lines.join('\n'));
}

export async function confirmJoin(page: Page): Promise<void> {
  await goToStage(page, 'sources');
  await page
    .getByTestId('relationship-rel-CEPC-CEPC_BUKRS')
    .getByRole('button', { name: 'Confirm join' })
    .click();
}

// ---- Workspace pages (customers, business objects) ----

/** Opens the application at its main page. */
export async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('home')).toBeVisible();
}

/** First run: creates the first customer, keeping files in this browser. */
export async function createFirstCustomer(page: Page, name: string): Promise<void> {
  await expect(page.getByText('Create your first customer')).toBeVisible();
  await page.getByLabel('Customer name').fill(name);
  await page.getByText('This browser only').click();
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByTestId('home-title')).toHaveText(name);
}

/** On All customers: the New customer dialog. */
export async function addCustomer(page: Page, name: string, notes = ''): Promise<void> {
  await page.getByRole('button', { name: 'New customer' }).click();
  await page.getByLabel('Customer name').fill(name);
  if (notes) await page.getByLabel('Customer notes').fill(notes);
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByTestId('home-title')).toHaveText(name);
}

/** On a customer home: the Add business object dialog. */
export async function addObject(page: Page, name: string, entity = ''): Promise<void> {
  await page.getByRole('button', { name: 'Add business object' }).first().click();
  await page.getByLabel('Business object name').fill(name);
  if (entity) await page.getByLabel('Business entity').fill(entity);
  await page.getByRole('button', { name: 'Create business object' }).click();
  await expect(page.getByTestId(`object-${name}`)).toBeVisible();
}

export async function openObjectFromRow(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
}

/** Fresh browser storage: first customer, one business object, opened on its stages. */
export async function openWorkspaceObject(
  page: Page,
  customer = 'Acme Oy',
  object = 'Profit Center',
): Promise<void> {
  await openHome(page);
  await createFirstCustomer(page, customer);
  await addObject(page, object);
  await openObjectFromRow(page, object);
  await expect(page.getByTestId('breadcrumb')).toContainText(customer);
}
