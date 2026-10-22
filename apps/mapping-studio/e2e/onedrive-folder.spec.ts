import { expect, test, type Page } from '@playwright/test';
import {
  addCustomer,
  addObject,
  addSmallSources,
  createFirstCustomer,
  fixture,
  goToStage,
  loadSmallTarget,
  openApp,
  openHome,
  openObjectFromRow,
} from './helpers';

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

/** First run, choosing a OneDrive folder, creating the first customer in it. */
/** Makes the browser forget the chosen folder, as on a new computer: the folder itself is left as it is. */
async function forgetFolder(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        localStorage.removeItem('mms:lastOpen');
        const r = indexedDB.deleteDatabase('mms');
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
}

async function setUpFolder(page: Page, customer = 'Acme Oy'): Promise<void> {
  await installPicker(page);
  await openHome(page);
  await page.getByLabel('Customer name').fill(customer);
  await page.getByRole('button', { name: 'Choose folder and create customer' }).click();
  await expect(page.getByTestId('home-title')).toHaveText(customer);
  await expect(page.getByTestId('storage-label')).toContainText(`OneDrive folder “${DISK}”`);
}

async function customerAndObject(page: Page): Promise<void> {
  await setUpFolder(page);
  await addObject(page, 'Profit Center');
  await openObjectFromRow(page, 'Profit Center');
  await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy');
}

test.describe('OneDrive folder (SPEC-033)', () => {
  test('AC-3 choosing a folder keeps customers and objects there as plain files', async ({
    page,
  }) => {
    await setUpFolder(page);
    await addObject(page, 'Profit Center');
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
    await openHome(page);
    await writeDisk(page, 'holiday.jpg', 'not a workspace file');
    await page.getByLabel('Customer name').fill('Acme Oy');
    await page.getByRole('button', { name: 'Choose folder and create customer' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Acme Oy');
    const files = await disk(page);
    expect(files).toContain('holiday.jpg');
    expect(files).toContain('Migration Mapping Studio/mms-workspace.json');
    expect(files).toContain('Migration Mapping Studio/Acme Oy/customer.json');
    expect(files).not.toContain('mms-workspace.json');
    expect(await readDisk(page, 'holiday.jpg')).toBe('not a workspace file');
  });

  test('closing the picker without choosing a folder creates nothing and says so', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => {
        throw new DOMException('cancelled', 'AbortError');
      };
    });
    await openHome(page);
    await page.getByLabel('Customer name').fill('Acme Oy');
    await page.getByRole('button', { name: 'Choose folder and create customer' }).click();
    await expect(page.getByTestId('home-message')).toContainText('No folder was chosen');
    await expect(page.getByText('Create your first customer')).toBeVisible();
  });

  test('AC-4 added files are copied into the object folder, the folder is used again after a reload, and the rows come back by themselves', async ({
    page,
  }) => {
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
    await expect(page.getByTestId('breadcrumb')).toContainText('Acme Oy');
    await goToStage(page, 'sources');
    await expect(page.getByTestId('dataset-CEPC')).toContainText(/\d+ rows/);
    await expect(page.getByTestId('dataset-CEPC')).not.toContainText('data not loaded');
    await expect(page.getByTestId('rows-missing-banner')).toHaveCount(0);
    await expect(page.getByTestId('stage-target-summary')).toContainText('3 structures');
  });

  test('a dataset whose file is missing from sources is named in a banner', async ({ page }) => {
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
    await page.evaluate(() => localStorage.setItem('test:prompt', '1'));
    await page.reload();
    await expect(page.getByTestId('reconnect')).toContainText(DISK);
    await page.getByRole('button', { name: 'Reconnect folder' }).click();
    await expect(page.getByTestId('customer-Acme Oy')).toBeVisible();
    await expect(page.getByTestId('reconnect')).toHaveCount(0);
  });

  test('AC-7 the storage chip switches to browser storage and back; customers left in the browser can be moved into the folder', async ({
    page,
  }) => {
    await setUpFolder(page, 'Folder Customer');
    await page.getByTestId('storage-label').click();
    await page.getByRole('button', { name: 'Use browser storage' }).click();
    await expect(page.getByTestId('storage-label')).toContainText('This browser');
    await expect(page.getByText('Create your first customer')).toBeVisible();
    await createFirstCustomer(page, 'Browser Customer');
    await page.getByTestId('storage-label').click();
    await page.getByRole('button', { name: 'Choose OneDrive folder' }).click();
    await expect(page.getByTestId('storage-label')).toContainText(`OneDrive folder “${DISK}”`);
    await expect(page.getByTestId('customer-Folder Customer')).toBeVisible();
    await expect(page.getByTestId('customer-Browser Customer')).toHaveCount(0);
    // the customer left in the browser is not lost: the page offers to move it
    const banner = page.getByTestId('browser-customers-banner');
    await expect(banner).toContainText('1 customer is still kept in this browser');
    await banner.getByRole('button', { name: 'Move it to the folder' }).click();
    await expect(page.getByTestId('customer-Browser Customer')).toBeVisible();
    await expect(banner).toHaveCount(0);
    expect(await disk(page)).toContain('Browser Customer/customer.json');
  });

  test('changing an existing browser workspace to an empty folder does not strand its customers on the create page', async ({
    page,
  }) => {
    await installPicker(page);
    await openHome(page);
    await createFirstCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByTestId('storage-label').click();
    await page.getByRole('button', { name: 'Choose OneDrive folder' }).click();
    // the empty folder shows the first-run page, with a clear way to bring the customer over
    await expect(page.getByText('Create your first customer')).toBeVisible();
    await expect(page.getByTestId('storage-label')).toContainText(`OneDrive folder “${DISK}”`);
    await page
      .getByTestId('browser-customers-banner')
      .getByRole('button', { name: 'Move it to the folder' })
      .click();
    await expect(page.getByTestId('customer-Acme Oy')).toBeVisible();
    await page.getByTestId('customer-Acme Oy').click();
    await expect(page.getByTestId('object-Profit Center')).toBeVisible();
    expect(await disk(page)).toContain('Acme Oy/Profit Center/project.mms.json');
  });

  test('choosing a customer folder instead of the workspace says so and writes nothing', async ({
    page,
  }) => {
    await installPicker(page);
    await openHome(page);
    await writeDisk(
      page,
      'customer.json',
      '{"id":"x","name":"Acme","createdAt":"2026-10-22T10:00:00.000Z"}',
    );
    await page.getByLabel('Customer name').fill('Whatever');
    await page.getByRole('button', { name: 'Choose folder and create customer' }).click();
    await expect(page.getByTestId('home-message')).toContainText('This is a customer folder');
    expect(await disk(page)).toEqual(['customer.json']);
  });

  test('an existing customer kept in this browser can be moved to the OneDrive folder, with its files', async ({
    page,
  }) => {
    await installPicker(page);
    await openHome(page);
    await createFirstCustomer(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await openObjectFromRow(page, 'Profit Center');
    await addSmallSources(page);
    await page.waitForTimeout(700); // autosave
    await page.getByTestId('back-to-customer').click();
    await expect(page.getByTestId('storage-label')).toContainText('This browser');

    await page.getByRole('button', { name: 'Move to OneDrive folder' }).click();
    await expect(page.getByRole('dialog', { name: 'Move to OneDrive folder' })).toContainText(
      'Nothing is deleted',
    );
    await page.getByRole('button', { name: 'Choose folder and move' }).click();

    await expect(page.getByTestId('storage-label')).toContainText(`OneDrive folder “${DISK}”`);
    await expect(page.getByTestId('home-title')).toHaveText('Acme Oy');
    await expect(page.getByTestId('object-Profit Center')).toBeVisible();
    // the customer, its project and its source files are in the folder
    const files = await disk(page);
    expect(files).toContain('mms-workspace.json');
    expect(files).toContain('Acme Oy/customer.json');
    expect(files).toContain('Acme Oy/Profit Center/project.mms.json');
    expect(files).toContain('Acme Oy/Profit Center/sources/CEPC.csv');
    // the browser copy was archived, not deleted
    await page.getByTestId('storage-label').click();
    await page.getByRole('button', { name: 'Use browser storage' }).click();
    await expect(page.getByText('Create your first customer')).toBeVisible();
    const browserFiles = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const out: string[] = [];
      async function walk(dir: FileSystemDirectoryHandle, prefix: string, depth: number) {
        for await (const [n, h] of (
          dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
        ).entries()) {
          if (h.kind === 'directory') {
            if (depth < 4) await walk(h as FileSystemDirectoryHandle, `${prefix}${n}/`, depth + 1);
          } else out.push(`${prefix}${n}`);
        }
      }
      await walk(root, '', 0);
      return out;
    });
    expect(
      browserFiles.some((f) => /^_archive\/Acme Oy-.*\/Profit Center\/sources\/CEPC\.csv$/.test(f)),
    ).toBe(true);
    expect(browserFiles).not.toContain('Acme Oy/customer.json');
  });

  test('a folder customer cannot be moved again (the button is only for browser storage)', async ({
    page,
  }) => {
    await setUpFolder(page);
    await expect(page.getByRole('button', { name: 'Move to OneDrive folder' })).toHaveCount(0);
  });

  test('a project in a folder works the same as in browser storage: work survives Back and Open', async ({
    page,
  }) => {
    await customerAndObject(page);
    await addSmallSources(page);
    await loadSmallTarget(page);
    await page.getByTestId('back-to-customer').click();
    await expect(page.getByTestId('object-summary-Profit Center')).toHaveText('0 of 6');
    await openObjectFromRow(page, 'Profit Center');
    await expect(page.getByTestId('stage-target-summary')).toHaveText('2 structures, 6 fields');
    await goToStage(page, 'sources');
    await expect(page.getByTestId('dataset-CEPC')).toContainText(/\d+ rows/);
  });

  test('Open workspace from OneDrive folder loads every customer of an existing workspace and lands on All customers', async ({
    page,
  }) => {
    await setUpFolder(page, 'Acme Oy');
    await addObject(page, 'Profit Center');
    await page.getByRole('button', { name: 'All customers' }).click();
    await addCustomer(page, 'Beta Ab');
    // a new computer: the browser knows nothing about the folder
    await forgetFolder(page);
    await expect(page.getByTestId('storage-label')).toContainText('This browser');
    await expect(page.getByText('Create your first customer')).toBeVisible();
    await page.getByTestId('open-workspace-folder').click();
    await expect(page.getByTestId('home-title')).toHaveText('Customers');
    await expect(page.getByTestId('storage-label')).toContainText(`OneDrive folder “${DISK}”`);
    await expect(page.getByTestId('customer-Acme Oy')).toContainText('1 business object');
    await expect(page.getByTestId('customer-Beta Ab')).toBeVisible();
    await page.getByTestId('customer-Acme Oy').click();
    await expect(page.getByTestId('object-Profit Center')).toBeVisible();
    // the folder is remembered from now on
    await page.reload();
    await expect(page.getByTestId('storage-label')).toContainText(`OneDrive folder “${DISK}”`);
  });

  test('choosing the folder that contains the Migration Mapping Studio folder opens the workspace inside it', async ({
    page,
  }) => {
    await installPicker(page);
    await openHome(page);
    await writeDisk(page, 'holiday.jpg', 'not a workspace file');
    await page.getByLabel('Customer name').fill('Acme Oy');
    await page.getByRole('button', { name: 'Choose folder and create customer' }).click();
    await expect(page.getByTestId('home-title')).toHaveText('Acme Oy');
    const before = await disk(page);
    await forgetFolder(page);
    await page.getByTestId('open-workspace-folder').click();
    await expect(page.getByTestId('customer-Acme Oy')).toBeVisible();
    expect(await disk(page)).toEqual(before); // nothing was written
  });

  test('a folder with no workspace in it is refused with a clear message and nothing is created', async ({
    page,
  }) => {
    await installPicker(page);
    await openHome(page);
    await page.getByTestId('open-workspace-folder').click();
    await expect(page.getByTestId('home-message')).toContainText(
      'There is no workspace in that folder',
    );
    expect(await disk(page)).toEqual([]);
    await writeDisk(page, 'holiday.jpg', 'x');
    await page.getByTestId('open-workspace-folder').click();
    await expect(page.getByTestId('home-message')).toContainText('No workspace was found');
    expect(await disk(page)).toEqual(['holiday.jpg']);
    await expect(page.getByText('Create your first customer')).toBeVisible();
  });

  test('closing the picker changes nothing', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => {
        throw new DOMException('cancelled', 'AbortError');
      };
    });
    await openHome(page);
    await page.getByTestId('open-workspace-folder').click();
    await expect(page.getByTestId('home-message')).toHaveCount(0);
    await expect(page.getByText('Create your first customer')).toBeVisible();
  });

  test('from All customers, a workspace in a OneDrive folder can be opened instead of the browser one', async ({
    page,
  }) => {
    await setUpFolder(page, 'Folder Customer');
    await forgetFolder(page);
    await createFirstCustomer(page, 'Browser Customer');
    await page.getByRole('button', { name: 'All customers' }).click();
    await page.getByTestId('open-workspace-folder').click();
    await expect(page.getByTestId('customer-Folder Customer')).toBeVisible();
    await expect(page.getByTestId('customer-Browser Customer')).toHaveCount(0);
    // the customer left in the browser is still offered a move
    await expect(page.getByTestId('browser-customers-banner')).toContainText(
      '1 customer is still kept in this browser',
    );
  });

  test('the storage dialog offers Open existing workspace', async ({ page }) => {
    await setUpFolder(page, 'Acme Oy');
    await forgetFolder(page);
    await page.getByTestId('storage-label').click();
    await page.getByTestId('storage-open-workspace').click();
    await expect(page.getByTestId('customer-Acme Oy')).toBeVisible();
  });

  test('in single-project mode there is a way to the customer workspace', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('go-to-workspace').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByText('Create your first customer')).toBeVisible();
  });
});
