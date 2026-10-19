import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import type { Browser, Page } from '@playwright/test';

/**
 * M5: back up, then restore into an empty browser (the same as after clearing site data),
 * and get every record back. Plus the reminder banner and the Settings pages.
 */

async function loadSample(page: Page) {
  await page.goto('/#/debug');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByTestId('debug-message')).toContainText('Loaded');
}

/** Clicks a button that downloads, and returns the file's name and parsed contents. */
async function download(page: Page, click: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await file.path();
  return {
    name: file.suggestedFilename(),
    path,
    json: JSON.parse(readFileSync(path, 'utf8')) as {
      exportedAt: string;
      data: Record<string, { id: string }[]>;
    },
  };
}

const sortedData = (data: Record<string, { id: string }[]>) =>
  Object.fromEntries(
    Object.entries(data).map(([t, rows]) => [t, [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))]),
  );

/** A fresh browser profile: empty storage, like a new computer or after clearing site data. */
async function freshPage(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL, acceptDownloads: true });
  await context.route(
    (url) => url.protocol === 'https:',
    (route) => route.abort('blockedbyclient'),
  );
  return { context, page: await context.newPage() };
}

test.describe('backup and restore (preview/dev build)', () => {
  test('a backup restores into an empty browser with nothing lost', async ({
    page,
    browser,
  }, info) => {
    await loadSample(page);
    // An undoable change since loading must survive too.
    await page.getByRole('button', { name: 'Raise a rent by $25' }).click();

    await page.goto('/#/settings/backup');
    const first = await download(page, () =>
      page.getByRole('button', { name: 'Back up data' }).click(),
    );
    expect(first.name).toMatch(/^rental-tracker-preview-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByRole('status').filter({ hasText: 'Backed up:' })).toBeVisible();
    expect(first.json.data.units!.length).toBeGreaterThan(20);

    const baseURL = info.project.use.baseURL ?? 'http://localhost:4173';
    const { context, page: other } = await freshPage(browser, baseURL);
    await other.goto('/#/settings/backup');
    await expect(other.getByTestId('last-backup')).toContainText('Never');
    await other.getByLabel('Backup file to restore').setInputFiles(first.path);
    const review = other.getByTestId('restore-review');
    await expect(review.getByTestId('restore-contains')).toContainText(
      `${first.json.data.units!.length} units`,
    );
    await expect(review).toContainText('Nothing: this browser has no data yet');
    await review.getByRole('button', { name: 'Replace with this backup' }).click();
    await expect(other.getByText(/^Restored \d+ units/)).toBeVisible();

    // Export again from the restored browser: the same records, field for field.
    const second = await download(other, () =>
      other.getByRole('button', { name: 'Back up data' }).click(),
    );
    expect(sortedData(second.json.data)).toEqual(sortedData(first.json.data));

    // And the app shows them.
    await other.goto('/#/debug');
    await expect(
      other
        .getByTestId('record-counts')
        .getByRole('row', { name: /^Units/ })
        .locator('td')
        .first(),
    ).toHaveText(String(first.json.data.units!.length));
    await context.close();
  });

  test('restoring over existing data keeps a safety copy that restores back', async ({ page }) => {
    await loadSample(page);
    await page.goto('/#/settings/backup');
    const sample = await download(page, () =>
      page.getByRole('button', { name: 'Back up data' }).click(),
    );

    // Change something, then restore the earlier file over it.
    await page.goto('/#/settings/data');
    await page.getByRole('button', { name: 'Raise a rent by $25' }).click();
    await expect(page.getByTestId('debug-message')).toContainText('Rent changed');
    await page.goto('/#/settings/backup');
    await page.getByLabel('Backup file to restore').setInputFiles(sample.path);
    await page.getByRole('button', { name: 'Replace with this backup' }).click();
    await expect(page.getByText(/kept under Safety copies/)).toBeVisible();

    const copies = page.getByTestId('snapshot-list');
    await expect(copies.getByRole('listitem')).toHaveCount(1);
    await expect(copies).toContainText('Before restoring a backup');

    // Undo history was cleared by the restore.
    await page.goto('/#/history');
    await expect(page.getByRole('article', { name: 'History' })).toContainText('No changes yet.');

    // The safety copy downloads and restores like a backup.
    await page.goto('/#/settings/backup');
    const copy = await download(page, () =>
      copies.getByRole('button', { name: /^Download safety copy/ }).click(),
    );
    expect(copy.name).toMatch(/^rental-tracker-preview-safety-copy-/);
    await copies.getByRole('button', { name: /^Restore safety copy/ }).click();
    await expect(page.getByTestId('restore-review')).toContainText('Safety copy');
    await page.getByRole('button', { name: 'Replace with this backup' }).click();
    await expect(page.getByText(/^Restored .* from the safety copy/)).toBeVisible();
    await expect(page.getByTestId('snapshot-list').getByRole('listitem')).toHaveCount(2);
  });

  test('refuses a file that isn’t a backup, and changes nothing', async ({ page }) => {
    await page.goto('/#/settings/backup');
    await page.getByLabel('Backup file to restore').setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello": "world"}'),
    });
    await expect(page.getByRole('alert')).toContainText('isn’t a backup from Rental Unit Tracker');
    await expect(page.getByTestId('restore-review')).toHaveCount(0);
  });
});

test.describe('backup reminder', () => {
  test('appears once there is data, backs up from the main screen, and stays gone', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('No units yet')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Backup reminder' })).toHaveCount(0);

    await loadSample(page);
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Backup reminder' });
    await expect(banner).toContainText('No backup yet.');
    const file = await download(page, () =>
      banner.getByRole('button', { name: 'Back up data' }).click(),
    );
    expect(file.json.data.units!.length).toBeGreaterThan(20);
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('list-count')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Backup reminder' })).toHaveCount(0);
  });

  test('Later hides it until tomorrow', async ({ page }) => {
    await loadSample(page);
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Backup reminder' });
    await banner.getByRole('button', { name: 'Later' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('list-count')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Backup reminder' })).toHaveCount(0);
  });
});

test.describe('settings pages', () => {
  test('asks the browser to keep the data after the first change', async ({ page }) => {
    await loadSample(page);
    await page.goto('/#/settings/storage');
    const fact = page.getByTestId('persisted');
    await expect(fact).toContainText(/^Persistent storage(On|Off)/);
    if ((await fact.textContent())?.includes('On')) return; // granted: nothing more to ask
    const asked = await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const req = indexedDB.open('rental-tracker-preview');
          req.onsuccess = () => {
            const get = req.result.transaction('meta').objectStore('meta').get('persistAskedAt');
            get.onsuccess = () => {
              resolve(get.result?.value ?? null);
              req.result.close();
            };
          };
        }),
    );
    expect(asked).toEqual(expect.any(String));
  });

  test('has no horizontal scrolling', async ({ page }) => {
    await loadSample(page);
    for (const section of ['backup', 'storage']) {
      await page.goto(`/#/settings/${section}`);
      await expect(
        page.getByRole('heading', { level: 2, name: /Backup and restore|Storage/ }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`passes axe checks with a restore under review (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await loadSample(page);
      await page.goto('/#/settings/backup');
      const file = await download(page, () =>
        page.getByRole('button', { name: 'Back up data' }).click(),
      );
      await page.getByLabel('Backup file to restore').setInputFiles(file.path);
      await expect(page.getByTestId('restore-review')).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.goto('/#/settings/storage');
      await expect(page.getByTestId('persisted')).not.toContainText('…');
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Backup reminder' })).toHaveCount(0);
    });

    test(`main screen with the reminder passes axe checks (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await loadSample(page);
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Backup reminder' })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .include('[aria-label="Backup reminder"]')
        .include('header')
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe('live build', () => {
  test.use({ baseURL: 'http://localhost:4174' });

  test('backs up the real database under the live name and restores it', async ({ page }) => {
    await page.goto('/#/add');
    const dialog = page.getByRole('dialog', { name: 'Add a unit' });
    await dialog.getByRole('combobox', { name: 'Address' }).fill('Riverlight');
    await dialog.getByRole('option', { name: /^Riverlight 201 South Example/ }).click();
    await dialog.getByLabel('Unit', { exact: true }).fill('1504');
    await dialog.getByLabel('Rent', { exact: true }).fill('1650');
    await dialog.getByLabel('Rent', { exact: true }).press('Enter');
    await expect(page.getByTestId('list-count')).toHaveText('1 unit in 1 building');

    const banner = page.getByRole('region', { name: 'Backup reminder' });
    await expect(banner).toContainText('No backup yet.');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/#\/settings\/backup$/);
    const file = await download(page, () =>
      page.getByRole('button', { name: 'Back up data' }).click(),
    );
    expect(file.name).toMatch(/^rental-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file.json.data.units).toHaveLength(1);

    await page.getByLabel('Backup file to restore').setInputFiles(file.path);
    await page.getByRole('button', { name: 'Replace with this backup' }).click();
    await expect(page.getByText(/^Restored 1 unit/)).toBeVisible();
    await page.getByRole('link', { name: 'Back to the app' }).first().click();
    await expect(page.getByTestId('list-count')).toHaveText('1 unit in 1 building');
    await expect(page.getByRole('region', { name: 'Backup reminder' })).toHaveCount(0);
  });
});
