import type { Page } from '@playwright/test';
import type { Dexie as DexieClass } from 'dexie';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { STORES_V1, STORES_V2 } from '../../src/db/versions';
import { expect, test } from './fixtures';

/**
 * M8 review: data format 3 (the update from v0.7 with its backup screen), standalone homes
 * (Q30), remembered unknowns (Q29) and complex names.
 */

const fixtureV2 = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/backup-v2.json', import.meta.url)), 'utf8'),
) as { data: Record<string, unknown[]> };

const dexieScript = createRequire(import.meta.url).resolve('dexie/dist/dexie.js');
const isPhone = (name: string) => name.includes('phone');
const panel = (page: Page) => page.getByRole('article');

/** A database as v0.7 left it (data format 2), made before the app opens it. */
async function makeV2Database(page: Page) {
  await page.route('**/__empty.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>empty</title>' }),
  );
  await page.goto('/__empty.html');
  await page.addScriptTag({ path: dexieScript });
  await page.evaluate(
    async ({ v1, v2, data }) => {
      const { Dexie } = window as unknown as { Dexie: typeof DexieClass };
      const db = new Dexie('rental-tracker-preview');
      db.version(1).stores(v1);
      db.version(2).stores(v2);
      await db.open();
      for (const [table, rows] of Object.entries(data)) await db.table(table).bulkAdd(rows);
      await db.table('meta').put({ key: 'meId', value: 'p-me' });
      db.close();
    },
    {
      v1: STORES_V1 as Record<string, string>,
      v2: STORES_V2 as Record<string, string>,
      data: fixtureV2.data,
    },
  );
}

test('updates a v0.7 database: offers a backup first, then everything is there', async ({
  page,
}) => {
  await makeV2Database(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'This update changes how your data is stored' }),
  ).toBeVisible();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const backup = JSON.parse(readFileSync(await file.path(), 'utf8')) as { schemaVersion: number };
  expect(backup.schemaVersion).toBe(2); // the old format, which v0.7 can open
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const card = page.getByRole('link', { name: /Unit 1504 Example Tower/ });
  await expect(card).toBeVisible();
  await expect(card.getByRole('img', { name: '4 of 5 stars' })).toBeVisible();
  // One safety copy of the data as it was
  await page.goto('/#/settings/backup');
  await expect(page.getByText('Before the update to data format 3')).toHaveCount(1);
});

test.describe('standalone homes and complexes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/settings/data');
    await page.getByRole('button', { name: 'Load sample data' }).click();
    await expect(page.getByTestId('debug-message')).toContainText('Loaded');
    await page.goto('/#/');
  });

  test('a house is a home: its facts in its form, opened from the Buildings view', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Buildings', exact: true }).click();
    const card = page
      .getByRole('list', { name: 'Buildings' })
      .getByRole('link')
      .filter({ hasText: '3624 15th Ave S' });
    await expect(card).toContainText('Home');
    await card.click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('3624 15th Ave S');
    await expect(panel(page).getByRole('heading', { name: 'The home' })).toBeVisible();
    await panel(page).getByRole('link', { name: /^Edit/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('3624 15th Ave S');
    await expect(page.getByRole('combobox', { name: 'Building' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Landlord or manager' }).fill('J. Lindqvist');
    await page.getByRole('button', { name: 'Mark Balcony unknown' }).click();
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(panel(page)).toContainText('Rented by J. Lindqvist');
    // The unknown is remembered next time
    await panel(page).getByRole('link', { name: /^Edit/ }).click();
    await expect(page.getByRole('button', { name: 'Mark Balcony unknown' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('names a building within a complex of several', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'Same form at both widths');
    await page.getByRole('button', { name: 'Buildings', exact: true }).click();
    await page
      .getByRole('list', { name: 'Buildings' })
      .getByRole('link')
      .filter({ hasText: 'Riverlight' })
      .click();
    await panel(page)
      .getByRole('link', { name: /^Edit building/ })
      .click();
    await page.getByRole('checkbox', { name: 'This complex has several buildings' }).check();
    await expect(page.getByRole('combobox', { name: 'Complex name' })).toHaveValue('Riverlight');
    await page.getByRole('textbox', { name: 'This building’s name' }).fill('North Tower');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
      'North Tower · Riverlight',
    );
  });
});
