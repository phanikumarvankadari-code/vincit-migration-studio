import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { csv, fixture, goToStage, openApp } from './helpers';

/** A guided mapping with a chat AI: one kit goes out; table descriptions, pairings and mappings come back by name. */
const ASSETS = csv(
  'S4H_ANLA_20261105_153937.csv',
  [
    'ANLN1\tTXT50\tASTAT\tAMT\tAKTIV',
    '000000200001\tSecret Pump Alpha\tA\t1000.00\t20190101',
    '000000200002\tSecret Valve Beta\tB\t2500.50\t20190202',
  ].join('\n'),
);

const block = (o: unknown) => `Here you go:\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\`\n`;

test('the kit, then the steps of the wizard come back: descriptions, pairing, mappings', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page);
  await page.getByTestId('source-files-input').setInputFiles([ASSETS]);
  await goToStage(page, 'target');
  await page
    .getByTestId('target-file-input')
    .setInputFiles(fixture('../fixed-asset/target/fixed_asset_template.xml'));
  await page.getByRole('button', { name: 'Use this target' }).click();
  await goToStage(page, 'map');

  // 1. One kit: prompt, catalog by names, examples
  const d = page.waitForEvent('download');
  await page.getByTestId('create-ai-kit').click();
  const files = unzipSync(new Uint8Array(readFileSync((await (await d).path())!)));
  expect(Object.keys(files).sort()).toEqual([
    'PROMPT.md',
    'README.md',
    'catalog.json',
    'catalog.md',
    'examples.json',
    'mapping.mms.json',
  ]);
  const all = Object.values(files)
    .map((f) => strFromU8(f))
    .join('\n');
  expect(all).not.toContain('Secret Pump'); // no cell values leave the app
  expect(all).not.toContain('1000.00');
  const prompt = strFromU8(files['PROMPT.md']!);
  expect(prompt).toContain('Step 2 - Which table feeds which structure');
  expect(prompt).toContain('Local-Time-Dependent f.Validtn');
  const md = strFromU8(files['catalog.md']!);
  expect(md).toContain('### ANLA');
  expect(md).not.toMatch(/`tf-General/); // names, not IDs

  // 2. Step 1 and 2 of the wizard: table description and pairing (two blocks in one paste)
  await page.getByTestId('import-ai-result').click();
  await page.getByLabel('AI answer').fill(
    block({ tableDescriptions: [{ table: 'ANLA', description: 'Asset master record segment' }] }) +
      block({
        pairings: [
          {
            structure: 'General',
            mainTable: 'ANLA',
            confidence: 'certain',
            reason: 'asset master',
          },
          { structure: 'Origin', mainTable: 'ANLA' },
        ],
      }),
  );
  await page.getByTestId('run-ai-import').click();
  await expect(page.getByTestId('ai-import-summary')).toContainText(
    '1 table description(s), 2 pairing(s)',
  );
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('pairing-status-General')).toHaveText('Suggested');
  await expect(page.getByTestId('pairing-status-Inventory')).toHaveText('No table');
  await page.getByTestId('pairing-accept-General').click();
  await expect(page.getByTestId('pairing-status-General')).toHaveText('Confirmed');
  await expect(page.getByTestId('pairing-status-Origin')).toHaveText('Suggested');
  await page.getByTestId('pairing-accept-all').click();
  await expect(page.getByTestId('pairing-status-Origin')).toHaveText('Confirmed');
  await expect(page.getByTestId('pairing-accept-all')).toHaveCount(0);

  // the description is visible in the Sources stage
  await goToStage(page, 'sources');
  await expect(page.getByTestId('dataset-ANLA')).toContainText('Asset master record segment');
  await goToStage(page, 'map');

  // 3. Step 3: mappings by names, inside other text; a date field is left to the user
  await page.getByTestId('import-ai-result').click();
  await page.getByLabel('AI answer').fill(
    block({
      mappings: [
        {
          structure: 'General',
          target: 'ANLN1',
          table: 'ANLA',
          source: 'ANLN1',
          type: 'direct',
          confidence: 'certain',
        },
        {
          structure: 'General',
          target: 'FIXEDASSETDESCRIPTION',
          table: 'ANLA',
          source: 'TXT50',
          type: 'direct',
        },
        {
          structure: 'General',
          target: 'FIXEDASSETORDERDATE',
          table: 'ANLA',
          source: 'AKTIV',
          type: 'direct',
        },
      ],
    }),
  );
  await page.getByTestId('run-ai-import').click();
  await expect(page.getByTestId('ai-import-summary')).toContainText('Imported 2 mapping(s)');
  await expect(page.getByTestId('ai-import-summary')).toContainText('Skipped 1');
  await expect(page.getByTestId('ai-import-skipped')).toContainText('date field');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('status-General-Ext./Leg. Asset Number')).toContainText(/review/i);
  await expect(page.getByTestId('status-General-Asset Description')).toContainText(/review/i);
});
