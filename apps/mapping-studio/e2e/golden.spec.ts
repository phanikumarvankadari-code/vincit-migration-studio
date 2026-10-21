import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, goToStage, openApp, openEditor } from './helpers';

/**
 * SPEC-029: the Profit Center golden scenario, from the supplied files to generated output, through the real screens.
 * Uses the supplied field dictionary and target workbook, and the key-aligned companion sources in
 * test-data/profit-center/golden (the supplied sources share no key values, so they cannot show a join).
 */
const golden = (f: string) => fixture(`golden/input/${f}`);
const PC = 'Profit Center';
const CC = 'Company Codes';
const TR = 'Translation';
const PARSE_DATE = '{"format":"M/D/YY","twoDigitYearPivot":68}';
const PARSE_NEVER_ENDS =
  '{"format":"M/D/YY","twoDigitYearPivot":68,"specialValues":{"12/31/99":"9999-12-31"}}';

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByTestId('mapping-editor')).toHaveCount(0);
}
async function direct(page: Page, structure: string, field: string, source: string) {
  await openEditor(page, structure, field);
  await page.getByLabel('Source field', { exact: true }).selectOption({ label: source });
  await save(page);
}
async function constant(page: Page, structure: string, field: string, value: string) {
  await openEditor(page, structure, field);
  await page.getByLabel('Mapping type').selectOption('constant');
  await page.getByLabel('Constant value').fill(value);
  await save(page);
}
async function dateChain(
  page: Page,
  structure: string,
  field: string,
  source: string,
  parse: string,
) {
  await openEditor(page, structure, field);
  await page.getByLabel('Mapping type').selectOption('routine');
  await page.getByLabel('Source field', { exact: true }).selectOption({ label: source });
  await page.getByRole('button', { name: 'Add routine step' }).click();
  await page.getByLabel('Step 1 routine').selectOption({ label: 'Parse Date' });
  await page.getByLabel('Step 1 settings').fill(parse);
  await page.getByRole('button', { name: 'Add routine step' }).click();
  await page.getByLabel('Step 2 routine').selectOption({ label: 'Format Date' });
  await page.getByLabel('Step 2 settings').fill('{"format":"YYYYMMDD"}');
  await save(page);
}
async function settings(page: Page, structure: string, driver: string) {
  await page
    .getByTestId(`completeness-${structure}`)
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.getByLabel('Driver dataset').selectOption({ label: driver });
  if (structure !== PC) {
    await page.getByLabel('Parent structure').selectOption({ label: PC });
    await page.getByLabel('Link 1 field in ' + structure).selectOption({ label: 'Profit Center' });
    await page.getByLabel('Link 1 field in Profit Center').selectOption({ label: 'Profit Center' });
    await page.getByRole('button', { name: 'Add key pair' }).click();
    await page
      .getByLabel('Link 2 field in ' + structure)
      .selectOption({ label: 'Validty End Date' });
    await page.getByLabel('Link 2 field in Profit Center').selectOption({ label: 'Valid To' });
  }
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** A small CSV reader for the downloaded files: rows of cells, quotes and doubled quotes handled. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  return rows;
}
const column = (rows: string[][], name: string): string[] => {
  const i = rows[0]!.indexOf(name);
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
  return rows.slice(1).map((r) => r[i]!);
};

async function download(page: Page, button: string): Promise<string> {
  const d = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  return readFileSync((await (await d).path())!, 'utf8');
}

const SOURCES = ['CEPC.csv', 'CEPCT.csv', 'CEPC_BUKRS.csv'] as const;

test('Profit Center golden scenario: import to generated output', async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page);

  // 1. Import and profile -----------------------------------------------------------------------------
  await page.getByTestId('source-files-input').setInputFiles(SOURCES.map(golden));
  await page.getByTestId('dictionary-input').setInputFiles(fixture('input/field_dictionary.csv'));
  await expect(page.getByTestId('dictionary-loaded')).toContainText('66 fields');
  await expect(page.getByTestId('dataset-CEPC')).toContainText('3 rows, 48 fields');
  await expect(page.getByTestId('dataset-CEPCT')).toContainText('3 rows, 8 fields');
  await expect(page.getByTestId('dataset-CEPC_BUKRS')).toContainText('4 rows, 10 fields');
  await page.getByTestId('dataset-CEPC').click();
  await expect(page.getByTestId('fill-CEPC-Client')).toHaveText('100%'); // the supplied blank Client is filled in the golden data
  await expect(
    page
      .getByRole('table', { name: 'Fields of CEPC' })
      .getByRole('row', { name: /Postal Code POSTL|Postal Code PSTLZ/ }),
  ).toContainText('00330'); // leading zeros survive

  // 2. Relationships (composite keys) -----------------------------------------------------------------
  const ct = page.getByTestId('relationship-rel-CEPC-CEPCT');
  const bk = page.getByTestId('relationship-rel-CEPC-CEPC_BUKRS');
  await expect(bk).toContainText('oneToMany');
  for (const key of ['Client', 'Profit Center', 'Controlling Area'])
    await expect(bk).toContainText(key);
  for (const key of ['Client', 'Profit Center', 'Valid To', 'Controlling Area'])
    await expect(ct).toContainText(key);
  await ct.getByRole('button', { name: 'Confirm join' }).click();
  await bk.getByRole('button', { name: 'Confirm join' }).click();
  await page
    .getByTestId('relationship-rel-CEPCT-CEPC_BUKRS')
    .getByRole('button', { name: 'Reject' })
    .click();
  await expect(page.getByTestId('stage-sources-summary')).toHaveText(
    '3 datasets, 2 joins confirmed',
  );

  // 3. Parse the target -------------------------------------------------------------------------------
  await goToStage(page, 'target');
  await page.getByTestId('target-file-input').setInputFiles(fixture('target/data_pc.XLSX'));
  await expect(page.getByTestId('target-preview-summary')).toHaveText(
    '3 structures: Profit Center (31), Company Codes (3), Translation (5)',
  );
  await page.getByRole('button', { name: 'Use this target' }).click();
  await expect(page.getByTestId('stage-target-summary')).toHaveText('3 structures, 39 fields');

  // 4. Map: direct, constants, date routines, a lookup, several structures, one-to-many ---------------
  await goToStage(page, 'map');
  await direct(page, PC, 'Profit Center', 'CEPC.Profit Center');
  await dateChain(page, PC, 'Valid To', 'CEPC.Valid To', PARSE_NEVER_ENDS);
  await dateChain(page, PC, 'Valid From', 'CEPC.Valid From', PARSE_DATE);
  await direct(page, PC, 'Profit Center Name', 'CEPCT.Name');
  await direct(page, PC, 'Description', 'CEPCT.Long Text');
  await direct(page, PC, 'Person Responsible', 'CEPC.Person Responsible for Profit Center');
  await direct(page, PC, 'User Responsible', 'CEPC.User Responsible');
  await constant(page, PC, 'Standard Hierarchy Node', 'H1000');
  await constant(page, PC, 'Segment', 'SEG01');
  await direct(page, PC, 'Department', 'CEPC.Department');
  await direct(page, PC, 'City', 'CEPC.City');
  await direct(page, PC, 'Postal Code', 'CEPC.Postal Code');
  await openEditor(page, PC, 'Language Key');
  await page.getByLabel('Mapping type').selectOption('lookup');
  await page.getByLabel('Source field to look up').selectOption({ label: 'CEPC.Language Key' });
  await page.getByLabel('Lookup name').fill('Language to SAP code');
  await page.getByRole('button', { name: 'Add values from source' }).click();
  await page.getByLabel('Entry 1 value').fill('E');
  await save(page);

  await direct(page, CC, 'Profit Center', 'CEPC_BUKRS.Profit Center');
  await dateChain(page, CC, 'Validty End Date', 'CEPC.Valid To', PARSE_NEVER_ENDS);
  await direct(page, CC, 'Company Code', 'CEPC_BUKRS.Company Code');

  await direct(page, TR, 'Profit Center', 'CEPCT.Profit Center');
  await dateChain(page, TR, 'Validty End Date', 'CEPCT.Valid To', PARSE_NEVER_ENDS);
  await direct(page, TR, 'Language Key', 'CEPCT.Language Key');
  await direct(page, TR, 'Profit Center Name', 'CEPCT.Name');
  await direct(page, TR, 'Profit Center Description', 'CEPCT.Long Text');

  await settings(page, PC, 'CEPC');
  await settings(page, CC, 'CEPC_BUKRS');
  await settings(page, TR, 'CEPCT');
  await expect(page.getByTestId('completeness-' + PC)).toContainText('Required fields mapped');
  await expect(page.getByTestId('completeness-text-' + PC)).toHaveText(
    '13 of 31 fields mapped (41.94%)',
  );
  await expect(page.getByTestId('completeness-text-' + CC)).toHaveText(
    '3 of 3 fields mapped (100%)',
  );
  await expect(page.getByTestId('completeness-text-' + TR)).toHaveText(
    '5 of 5 fields mapped (100%)',
  );
  await expect(page.getByTestId('stage-map-summary')).toHaveText('21 of 39 fields mapped');

  // 5. Test, validate, inspect the result and the lineage --------------------------------------------
  await goToStage(page, 'test');
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByTestId('run-summary')).toContainText('The test ran with errors.');
  await expect(page.getByTestId('run-structure-' + PC)).toContainText(
    '3 rows from 3 of 3 source rows',
  );
  await expect(page.getByTestId('run-structure-' + PC)).toContainText(
    '2 ready · 0 warning · 1 error',
  );
  await expect(page.getByTestId('run-structure-' + CC)).toContainText(
    '4 rows from 4 of 4 source rows',
  ); // S_PC_1 has three company codes, S_PC_2 one, S_PC_3 none
  await expect(page.getByTestId('run-structure-' + TR)).toContainText(
    '3 rows from 3 of 3 source rows',
  );
  await expect(page.getByTestId('cell-1-Valid From')).toHaveText('20260101');
  await expect(page.getByTestId('cell-1-Valid To')).toHaveText('99991231');
  await expect(page.getByTestId('cell-1-Postal Code')).toHaveText('00330');
  await expect(page.getByTestId('cell-1-Language Key')).toHaveText('E');
  await expect(page.getByTestId('cell-1-Segment')).toHaveText('SEG01');
  await expect(page.getByTestId('cell-3-Valid From')).toHaveText('blank');
  // diagnostics for the bad date
  await expect(page.getByTestId('diagnostic-group-DATE_INVALID')).toContainText(
    'Cannot read "13/45/26"',
  );
  await page.getByTestId('rownum-3').click();
  await expect(page.getByTestId('row-inspector')).toContainText('From row 3 of the source dataset');
  // lineage: a routine chain, a lookup, and a value reached through a join
  await page.getByTestId('cell-3-Valid From').click();
  await expect(page.getByTestId('lineage-issues')).toContainText('month 13 is not valid');
  await page.getByTestId('cell-2-Valid From').click();
  await expect(page.getByTestId('lineage-step-2')).toContainText('"5/1/26" → "2026-05-01"');
  await expect(page.getByTestId('lineage-source-1')).toContainText('CEPC.Valid From');
  await page.getByTestId('cell-1-Language Key').click();
  await expect(page.getByTestId('lineage-step-2')).toContainText('Lookup: Language to SAP code');
  await expect(page.getByTestId('lineage-step-2')).toContainText('"EN" → "E"');
  await page.getByTestId('cell-1-Profit Center Name').click();
  await expect(page.getByTestId('lineage-source-1')).toContainText('CEPCT.Name'); // from the joined text row
  await expect(page.getByTestId('lineage-source-1')).toContainText('Original value: "Finance 1"');
  await page.getByRole('tab', { name: CC }).click();
  await expect(page.getByTestId('cell-1-Company Code')).toHaveText('FI11');
  await expect(page.getByTestId('cell-2-Company Code')).toHaveText('FI12');
  await expect(page.getByTestId('cell-3-Company Code')).toHaveText('SE11');
  await expect(page.getByTestId('cell-4-Profit Center')).toHaveText('S_PC_2'); // one-to-many: three rows for S_PC_1, one for S_PC_2
  await page.getByTestId('cell-2-Validty End Date').click();
  await expect(page.getByTestId('lineage-source-1')).toContainText('CEPC.Valid To');
  await expect(page.getByTestId('lineage-source-1')).toContainText('Row 1 of the dataset'); // the parent row reached through the join
  await page.getByRole('tab', { name: TR }).click();
  await expect(page.getByTestId('cell-3-Profit Center Description')).toHaveText(
    'Finance profit center 3',
  );

  // 6. Snapshot: save, approve, change the draft, reload the snapshot ---------------------------------
  await goToStage(page, 'ready');
  await page.getByLabel('Snapshot name').fill('Initial Mapping');
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await page.getByRole('button', { name: 'Mark Initial Mapping approved' }).click();
  await expect(page.getByTestId('marker-Initial Mapping')).toHaveText('Approved');
  await goToStage(page, 'map');
  await openEditor(page, PC, 'Department');
  await page.getByRole('button', { name: 'Remove mapping' }).click();
  await expect(page.getByTestId('stage-map-summary')).toHaveText('20 of 39 fields mapped');
  await goToStage(page, 'ready');
  await expect(page.getByTestId('draft-status')).toHaveText(
    'The draft has changes since "Initial Mapping".',
  );
  await page.getByRole('button', { name: 'Reload Initial Mapping as draft' }).click();
  await page.getByRole('button', { name: 'Reload anyway' }).click();
  await expect(page.getByTestId('draft-status')).toHaveText(
    'The draft is the same as "Initial Mapping".',
  );
  await goToStage(page, 'map');
  await expect(page.getByTestId('stage-map-summary')).toHaveText('21 of 39 fields mapped');

  // 7. Close and reopen: the saved project comes back; the rows are loaded again ----------------------
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId('restored-banner')).toBeVisible();
  await expect(page.getByTestId('stage-map-summary')).toHaveText('21 of 39 fields mapped');
  await page.getByTestId('reattach-input').setInputFiles(SOURCES.map(golden));
  await expect(page.getByTestId('missing-data-banner')).toHaveCount(0);

  // 8. Full local run and output (no AI, no cloud) ----------------------------------------------------
  await goToStage(page, 'ready');
  await page.getByRole('button', { name: 'Run on all rows and create files' }).click();
  await expect(page.getByTestId('output-status')).toContainText('The run finished with errors.');
  await expect(page.getByTestId('output-structure-' + PC)).toContainText('Profit Center2100');
  const pcText = await download(page, 'Download Profit Center.csv');
  const pcRows = csvRows(pcText);
  expect(pcRows[0]).toHaveLength(31); // every field of the target structure is a column
  expect(column(pcRows, 'Profit Center')).toEqual(['S_PC_1', 'S_PC_2']); // the failed row is not in the output
  expect(column(pcRows, 'Valid From')).toEqual(['20260101', '20260501']);
  expect(column(pcRows, 'Valid To')).toEqual(['99991231', '99991231']);
  expect(column(pcRows, 'Postal Code')).toEqual(['00330', '00330']);
  expect(column(pcRows, 'Language Key')).toEqual(['E', 'E']);
  expect(column(pcRows, 'Profit Center Name')).toEqual(['Finance 1', 'Finance 2']);
  const errRows = csvRows(await download(page, 'Download Profit Center.errors.csv'));
  expect(errRows).toHaveLength(2);
  expect(column(errRows, 'Profit Center')).toEqual(['S_PC_3']);
  expect(column(errRows, 'Problems')[0]).toContain('Cannot read "13/45/26" as a date');
  const ccRows = csvRows(await download(page, 'Download Company Codes.csv'));
  expect(ccRows[0]).toEqual(['Profit Center', 'Validty End Date', 'Company Code']);
  expect(ccRows.slice(1)).toEqual([
    ['S_PC_1', '99991231', 'FI11'],
    ['S_PC_1', '99991231', 'FI12'],
    ['S_PC_1', '99991231', 'SE11'],
    ['S_PC_2', '99991231', 'FI11'],
  ]);
  const trRows = csvRows(await download(page, 'Download Translation.csv'));
  expect(column(trRows, 'Language Key')).toEqual(['EN', 'EN', 'EN']);
  expect(column(trRows, 'Profit Center Name')).toEqual(['Finance 1', 'Finance 2', 'Finance 3']);
  const diag = await download(page, 'Download diagnostics.csv');
  expect(diag).toContain('DATE_INVALID');
  const summary = JSON.parse(await download(page, 'Download run-summary.json'));
  expect(summary).toMatchObject({
    snapshotName: 'Initial Mapping',
    status: 'completedWithErrors',
    inputRecordCounts: { 'ds-CEPC': 3, 'ds-CEPCT': 3, 'ds-CEPC_BUKRS': 4 },
  });
  expect(
    summary.structures.map(
      (s: { name: string; produced: number; written: number; errors: number }) => [
        s.name,
        s.produced,
        s.written,
        s.errors,
      ],
    ),
  ).toEqual([
    [PC, 3, 2, 1],
    [CC, 4, 4, 0],
    [TR, 3, 3, 0],
  ]);
  expect(summary.files.map((f: { name: string }) => f.name)).toEqual([
    'Profit Center.csv',
    'Profit Center.errors.csv',
    'Company Codes.csv',
    'Translation.csv',
    'diagnostics.csv',
    'run-summary.json',
  ]);
});
