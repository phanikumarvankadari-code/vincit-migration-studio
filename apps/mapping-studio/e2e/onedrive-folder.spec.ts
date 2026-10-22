import { expect, test, type Page } from '@playwright/test';
import { addSmallSources, fixture, goToStage, loadSmallTarget } from './helpers';

const DISK = 'OneDrive-Test';

/** The folder picker cannot be driven in a test, so it returns a folder in the browser's own file storage. */
async function installPicker(page: Page): Promise<void> {
  await page.addInitScript((disk) => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(disk, { create: true });
    // A test can ask for the "needs permission again" case.
    if (localStorage.getItem('test:prompt')) {
      const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
      proto.queryPermission = async () =>
        localStorage.getItem('test:granted') ? 'granted' : 'prompt';
      proto.requestPermission = async () => {
        localStorage.setItem('test:granted', '1');
        return 'granted';
      };
    }
  }, DISK);
}

const disk = (page: Page) =>
  page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const out: string[] = [];
    async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
      for await (const [n, h] of (
        dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
      ).entries()) {
        if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, `${prefix}${n}/`);
        else out.push(`${prefix}${n}`);
      }
    }
    try {
      await walk(await root.getDirectoryHandle(name), '');
    } catch {
      /* not there yet */
    }
    return out.sort();
  }, DISK);

const writeDisk = (page: Page, path: string, text: string) =>
  page.evaluate(
    async ([name, p, t]) => {
      const parts = p!.split('/');
      let dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(name!, { create: true });
      for (const part of parts.slice(0, -1))
        dir = await dir.getDirectoryHandle(part, { create: true });
      const w = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
      await w.write(t!);
      await w.close();
    },
    [DISK, path, text],
  );

const readDisk = (page: Page, path: string) =>
  page.evaluate(
    async ([name, p]) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name!);
      const parts = p!.split('/');
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text();
    },
    [DISK, path],
  );

async function setUpFolder(page: Page): Promise<void> {
  await installPicker(page);
  await page.goto('/');
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByRole('button', { name: 'Choose OneDrive folder' }).click();
  await expect(page.getByTestId('storage-label')).toContainText(`folder “${DISK}”`);
}

async function customerAndObject(page: Page): Promise<void> {
  await page.getByLabel('Customer name').fill('Acme Oy');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await page.getByLabel('Business object name').fill('Profit Center');
  await page.getByRole('button', { name: 'Add business object' }).click();
  await page.getByTestId('object-Profit Center').getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy › Profit Center');
}

test.describe('OneDrive folder (SPEC-033)', () => {
  test('AC-3 choosing a folder keeps customers and objects there as plain files', async ({
    page,
  }) => {
    await setUpFolder(page);
    await page.getByLabel('Customer name').fill('Acme Oy');
    await page.getByRole('button', { name: 'Create customer' }).click();
    await page.getByLabel('Business object name').fill('Profit Center');
    await page.getByRole('button', { name: 'Add business object' }).click();
    await expect(page.getByTestId('object-Profit Center')).toBeVisible();
    expect(await disk(page)).toEqual([
      'Acme Oy/Profit Center/object.json',
      'Acme Oy/Profit Center/project.mms.json',
      'Acme Oy/customer.json',
      'mms-workspace.json',
    ]);
  });

  test('AC-2 a folder that already has other files gets its own subfolder and its files are left alone', async ({
    page,
  }) => {
    await installPicker(page);
    await page.goto('/');
    await writeDisk(page, 'holiday.jpg', 'not a workspace file');
    await page.getByRole('button', { name: 'Choose OneDrive folder' }).click();
    await expect(page.getByTestId('storage-label')).toContainText(DISK);
    await page.getByLabel('Customer name').fill('Acme Oy');
    await page.getByRole('button', { name: 'Create customer' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Acme Oy');
    const files = await disk(page);
    expect(files).toContain('holiday.jpg');
    expect(files).toContain('Migration Mapping Studio/mms-workspace.json');
    expect(files).toContain('Migration Mapping Studio/Acme Oy/customer.json');
    expect(files).not.toContain('mms-workspace.json');
    expect(await readDisk(page, 'holiday.jpg')).toBe('not a workspace file');
  });

  test('AC-4 added files are copied into the object folder, the folder is used again after a reload, and the rows come back by themselves', async ({
    page,
  }) => {
    await setUpFolder(page);
    await customerAndObject(page);
    await addSmallSources(page);
    await goToStage(page, 'target');
    await page.getByTestId('target-file-input').setInputFiles(fixture('target/data_pc.XLSX'));
    await page.getByRole('button', { name: 'Use this target' }).click();
    await expect(page.getByTestId('stage-target-summary')).toContainText('3 structures');
    await goToStage(page, 'sources');
    await page.getByTestId('dictionary-input').setInputFiles(fixture('input/field_dictionary.csv'));
    await expect(page.getByTestId('dictionary-loaded')).toBeVisible();
    await page.waitForTimeout(700); // autosave
    const files = await disk(page);
    expect(files).toContain('Acme Oy/Profit Center/sources/CEPC.csv');
    expect(files).toContain('Acme Oy/Profit Center/sources/CEPC_BUKRS.csv');
    expect(files).toContain('Acme Oy/Profit Center/target/data_pc.XLSX');
    expect(files).toContain('Acme Oy/Profit Center/dictionary/field_dictionary.csv');

    await page.reload();
    await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy › Profit Center');
    await goToStage(page, 'sources');
    await expect(page.getByTestId('dataset-CEPC')).toContainText(/\d+ rows/);
    await expect(page.getByTestId('dataset-CEPC')).not.toContainText('data not loaded');
    await expect(page.getByTestId('rows-missing-banner')).toHaveCount(0);
    await expect(page.getByTestId('stage-target-summary')).toContainText('3 structures');
  });

  test('a dataset whose file is missing from sources is named in a banner', async ({ page }) => {
    await setUpFolder(page);
    await customerAndObject(page);
    await addSmallSources(page);
    await page.waitForTimeout(700);
    // someone removes a file from the folder (the app itself never deletes)
    await page.evaluate(async (name) => {
      const root = await navigator.storage.getDirectory();
      const sources = await (
        await (
          await (await root.getDirectoryHandle(name)).getDirectoryHandle('Acme Oy')
        ).getDirectoryHandle('Profit Center')
      ).getDirectoryHandle('sources');
      await sources.removeEntry('CEPC_BUKRS.csv');
    }, DISK);
    await page.reload();
    await expect(page.getByTestId('rows-missing-banner')).toContainText('CEPC_BUKRS');
  });

  test('AC-5 a change made on disk is noticed at the next save; Load their version keeps a copy of mine', async ({
    page,
  }) => {
    await setUpFolder(page);
    await customerAndObject(page);
    await page.waitForTimeout(700);
    const obj = JSON.parse(await readDisk(page, 'Acme Oy/Profit Center/object.json'));
    await writeDisk(
      page,
      'Acme Oy/Profit Center/object.json',
      JSON.stringify({ ...obj, revision: obj.revision + 5 }),
    );
    await addSmallSources(page); // a change, so an autosave is tried
    const dialog = page.getByRole('alertdialog', { name: 'Changed elsewhere' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('changed elsewhere');
    await dialog.getByRole('button', { name: 'Load their version' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('stage-sources-summary')).toHaveText('No files yet');
    const files = await disk(page);
    expect(
      files.some((f) => /Acme Oy\/Profit Center\/project\.conflict-.*\.mms\.json$/.test(f)),
    ).toBe(true);
  });

  test('AC-5 Keep mine and overwrite saves my version', async ({ page }) => {
    await setUpFolder(page);
    await customerAndObject(page);
    await page.waitForTimeout(700);
    const obj = JSON.parse(await readDisk(page, 'Acme Oy/Profit Center/object.json'));
    await writeDisk(
      page,
      'Acme Oy/Profit Center/object.json',
      JSON.stringify({ ...obj, revision: obj.revision + 5 }),
    );
    await addSmallSources(page);
    const dialog = page.getByRole('alertdialog', { name: 'Changed elsewhere' });
    await dialog.getByRole('button', { name: 'Keep mine and overwrite' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('stage-sources-summary')).toContainText('2 datasets');
    await expect(async () => {
      const now = JSON.parse(await readDisk(page, 'Acme Oy/Profit Center/object.json'));
      expect(now.revision).toBe(obj.revision + 6);
      expect(await readDisk(page, 'Acme Oy/Profit Center/project.mms.json')).toContain('CEPC');
    }).toPass();
  });

  test('AC-6 when the browser needs permission again, Reconnect brings the folder back', async ({
    page,
  }) => {
    await setUpFolder(page);
    await page.getByLabel('Customer name').fill('Acme Oy');
    await page.getByRole('button', { name: 'Create customer' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Acme Oy');
    await page.evaluate(() => localStorage.setItem('test:prompt', '1'));
    await page.reload();
    await expect(page.getByTestId('reconnect')).toContainText(DISK);
    await page.getByRole('button', { name: 'Reconnect folder' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Acme Oy');
    await expect(page.getByTestId('reconnect')).toHaveCount(0);
  });

  test('AC-7 switching to browser storage and back keeps each place separate', async ({ page }) => {
    await setUpFolder(page);
    await page.getByLabel('Customer name').fill('Folder Customer');
    await page.getByRole('button', { name: 'Create customer' }).click();
    await page.getByRole('button', { name: 'Use browser storage' }).click();
    await expect(page.getByTestId('storage-label')).toContainText('this browser');
    await expect(page.getByText('Create your first customer')).toBeVisible();
    await page.getByRole('button', { name: 'Choose OneDrive folder' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Folder Customer');
  });

  test('a project in a folder works the same as in browser storage: work survives Back and Open', async ({
    page,
  }) => {
    await setUpFolder(page);
    await customerAndObject(page);
    await addSmallSources(page);
    await loadSmallTarget(page);
    await page.getByTestId('back-to-customer').click();
    await expect(page.getByTestId('object-summary-Profit Center')).toContainText(
      '0 of 6 fields mapped',
    );
    await page.getByTestId('object-Profit Center').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByTestId('stage-target-summary')).toHaveText('2 structures, 6 fields');
    await goToStage(page, 'sources');
    await expect(page.getByTestId('dataset-CEPC')).toContainText(/\d+ rows/);
  });
});
