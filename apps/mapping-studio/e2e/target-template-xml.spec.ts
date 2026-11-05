import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { csv, fixture, goToStage, openApp, openEditor } from './helpers';

/** The target is an Excel 2003 XML template (SAP migration cockpit download): Field List + one sheet per structure. */
const ASSETS = csv(
  'Assets.csv',
  [
    'Company,Asset,Sub,Class,Description',
    '1000,000123,0,ABC,Pump & motor',
    '1000,000124,0,ABC,Valve',
  ].join('\n'),
);
const G = 'General';

test('an Excel 2003 XML target template is read and the output is written into it as XML', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page);
  await page.getByTestId('source-files-input').setInputFiles([ASSETS]);
  await goToStage(page, 'target');
  await page
    .getByTestId('target-file-input')
    .setInputFiles(fixture('../fixed-asset/target/fixed_asset_template.xml'));
  await expect(page.getByTestId('target-preview-summary')).toContainText(
    '11 structures: General (14)',
  );
  await expect(page.getByTestId('target-template-note')).toContainText('General, Origin');
  await page.getByRole('button', { name: 'Use this target' }).click();
  await expect(page.getByTestId('target-template-loaded')).toContainText(
    'fixed_asset_template.xml',
  );

  await goToStage(page, 'map');
  for (const [field, src] of [
    ['Ext./Leg. Company Code', 'Assets.Company'],
    ['Ext./Leg. Asset Number', 'Assets.Asset'],
    ['Ext./Leg. Asset Subnumber', 'Assets.Sub'],
    ['Asset Class', 'Assets.Class'],
    ['Asset Description', 'Assets.Description'],
  ] as const) {
    await openEditor(page, G, field);
    await page.getByLabel('Source field', { exact: true }).selectOption({ label: src });
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
  }
  await page.getByTestId(`completeness-${G}`).getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Driver dataset').selectOption({ label: 'Assets' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await goToStage(page, 'ready');
  await page.getByLabel('Snapshot name').fill('Assets');
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await page.getByRole('button', { name: 'Mark Assets approved' }).click();
  await page.getByRole('button', { name: 'Run on all rows and create files' }).click();
  await expect(page.getByTestId('output-file-fixed_asset_template.xml')).toBeVisible();

  const d = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download fixed_asset_template.xml' }).click();
  const xml = readFileSync((await (await d).path())!, 'utf8');
  const general = xml.slice(
    xml.indexOf('<Worksheet ss:Name="General"'),
    xml.indexOf('</Worksheet>', xml.indexOf('<Worksheet ss:Name="General"')),
  );
  expect(general).toContain('ss:ExpandedRowCount="10"');
  for (const text of ['1000', '000123', '000124', 'ABC', 'Pump &amp; motor', 'Valve'])
    expect(general).toContain(`>${text}</Data>`);
  expect(xml).toContain('<LS>File </>'); // SAP's own markup is untouched
  expect(xml.match(/<Worksheet /g)).toHaveLength(13);
});
