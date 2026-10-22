import { expect, test, type Page } from '@playwright/test';
import { BUKRS_SMALL, goToStage, loadSmallTarget, mapSmallProject, runTest } from './helpers';

/** Files in the browser's file storage, as paths from its root (the workspace root in browser-storage mode). */
const files = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
      for await (const [n, h] of (
        dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
      ).entries()) {
        if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, `${prefix}${n}/`);
        else out.push(`${prefix}${n}`);
      }
    }
    await walk(await navigator.storage.getDirectory(), '');
    return out.sort();
  });

const readFile = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory();
    const parts = p.split('/');
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text();
  }, path);

async function openObject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Customer name').fill('Acme Oy');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await page.getByLabel('Business object name').fill('Profit Center');
  await page.getByRole('button', { name: 'Add business object' }).click();
  await page.getByTestId('object-Profit Center').getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy › Profit Center');
}

/** Small clean data, mapped, tested and approved, inside the open business object. */
async function approvedObject(page: Page): Promise<void> {
  await openObject(page);
  await page.getByTestId('source-files-input').setInputFiles([
    {
      name: 'CEPC.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Profit Center,Valid To,Valid From,Country',
          'P100,12/31/99,1/1/26,FI',
          'P200,12/31/99,5/1/26,SE',
        ].join('\n'),
      ),
    },
    {
      ...BUKRS_SMALL,
      buffer: Buffer.from(['Profit Center,Company Code', 'P100,FI01', 'P100,FI02'].join('\n')),
    },
  ]);
  await expect(page.getByTestId('dataset-CEPC')).toBeVisible();
  await page
    .getByTestId('relationship-rel-CEPC-CEPC_BUKRS')
    .getByRole('button', { name: 'Confirm join' })
    .click();
  await loadSmallTarget(page);
  await goToStage(page, 'map');
  await mapSmallProject(page);
  await runTest(page);
  await goToStage(page, 'ready');
  await page.getByLabel('Snapshot name').fill('Approved Mapping');
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await page.getByRole('button', { name: 'Mark Approved Mapping approved' }).click();
}

const RUN = 'Run on all rows and create files';

test.describe('Outputs to the workspace folder (SPEC-034)', () => {
  test('AC-3 a full run is saved into a run folder of the object, and the card shows it', async ({
    page,
  }) => {
    await approvedObject(page);
    await page.getByRole('button', { name: RUN }).click();
    await expect(page.getByTestId('output-saved')).toContainText(
      'Saved 4 files to Acme Oy/Profit Center/output/',
    );
    const out = (await files(page)).filter((f) => f.startsWith('Acme Oy/Profit Center/output/'));
    const folder = out[0]!.split('/')[3]!;
    expect(folder).toMatch(/^\d{8}-\d{6}_Approved Mapping$/);
    expect(out.map((f) => f.split('/').slice(4).join('/')).sort()).toEqual([
      'Company Codes.csv',
      'Profit Center.csv',
      'diagnostics.csv',
      'run-summary.json',
    ]);
    expect(await readFile(page, `Acme Oy/Profit Center/output/${folder}/Profit Center.csv`)).toBe(
      [
        'Profit Center,Valid From,Region,Language',
        'P100,20260101,North,EN',
        'P200,20260501,North,EN',
        '',
      ].join('\r\n'),
    );
    await page.getByTestId('back-to-customer').click();
    await expect(page.getByTestId('object-lastrun-Profit Center')).toContainText(
      `Last output: ${folder}`,
    );
  });

  test('AC-4 with the switch off nothing is saved until the button is used; each run gets its own folder', async ({
    page,
  }) => {
    await approvedObject(page);
    await page.getByLabel('Save every run into the workspace folder').uncheck();
    await page.getByRole('button', { name: RUN }).click();
    await expect(page.getByTestId('output-summary')).toBeVisible();
    await expect(page.getByTestId('output-saved')).toHaveCount(0);
    expect((await files(page)).filter((f) => f.includes('/output/'))).toEqual([]);
    await page.getByRole('button', { name: 'Save to workspace folder' }).click();
    await expect(page.getByTestId('output-saved')).toBeVisible();
    await page.getByRole('button', { name: 'Save to workspace folder' }).click(); // the same run again
    await expect(async () => {
      const folders = new Set(
        (await files(page)).filter((f) => f.includes('/output/')).map((f) => f.split('/')[3]),
      );
      expect(folders.size).toBe(2);
    }).toPass();
  });

  test('AC-5 the ZIP download still works', async ({ page }) => {
    await approvedObject(page);
    await page.getByRole('button', { name: RUN }).click();
    await expect(page.getByTestId('output-summary')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download all as ZIP' }).click();
    expect((await download).suggestedFilename()).toBe('Approved Mapping output.zip');
  });
});
