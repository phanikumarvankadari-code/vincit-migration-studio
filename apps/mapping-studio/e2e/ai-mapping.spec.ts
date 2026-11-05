import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { csv, fixture, goToStage, openApp } from './helpers';

/** A first mapping with the help of a chat AI: a kit goes out, the AI's answer comes back as "needs review". */
const ASSETS = csv(
  'S4H_ANLA_20261105_153937.csv',
  [
    'ANLN1\tTXT50\tASTAT\tAMT\tAKTIV',
    '000000200001\tSecret Pump Alpha\tA\t1000.00\t20190101',
    '000000200002\tSecret Valve Beta\tB\t2500.50\t20190202',
  ].join('\n'),
);

test('create the AI kit, import an answer, see the draft mappings and the report', async ({
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

  // 1. The kit
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
  expect(strFromU8(files['PROMPT.md']!)).toContain('Local-Time-Dependent f.Validtn');
  const catalog = JSON.parse(strFromU8(files['catalog.json']!));
  const general = catalog.structures[0];
  const field = (tech: string) =>
    general.fields.find((f: { technicalName: string }) => f.technicalName === tech);
  const src = (name: string) =>
    catalog.datasets[0].fields.find((f: { name: string }) => f.name === name);
  const ds = catalog.datasets[0].id;
  const direct = (tech: string, source: string) => ({
    targetStructureId: general.id,
    targetFieldId: field(tech).id,
    mappingType: 'direct',
    sourceReferences: [{ datasetId: ds, fieldId: src(source).id }],
  });

  // 2. The answer: two good mappings, one on a date field (the user's job), written inside other text
  const answer = [
    'Here is the General tab:',
    '```json',
    JSON.stringify({
      mappings: [
        { ...direct('ANLN1', 'ANLN1'), confidence: 'certain', reason: 'same key' },
        direct('FIXEDASSETDESCRIPTION', 'TXT50'),
        direct('FIXEDASSETORDERDATE', 'AKTIV'),
      ],
    }),
    '```',
    'Shall I continue?',
  ].join('\n');
  await page.getByTestId('import-ai-result').click();
  await page.getByLabel('AI answer').fill(answer);
  await page.getByTestId('run-ai-import').click();
  await expect(page.getByTestId('ai-import-summary')).toContainText('Imported 2 mapping(s)');
  await expect(page.getByTestId('ai-import-summary')).toContainText('Skipped 1');
  await expect(page.getByTestId('ai-import-skipped')).toContainText('date field');
  await page.getByRole('button', { name: 'Close' }).click();

  // 3. The mappings are drafts to review
  await expect(page.getByTestId('status-General-Ext./Leg. Asset Number')).toContainText(/review/i);
  await expect(page.getByTestId('status-General-Asset Description')).toContainText(/review/i);
  const dateName = field('FIXEDASSETORDERDATE').name;
  await expect(page.getByTestId(`status-General-${dateName}`)).not.toContainText(/review/i); // the date is still yours
});
