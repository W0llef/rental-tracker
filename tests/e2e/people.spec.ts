import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { Dexie as DexieClass } from 'dexie';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { STORES_V1 } from '../../src/db/versions';
import { expect, test } from './fixtures';

/** M6: people and per-person ratings, and the first data-format update (v1 → v2). */

const fixtureV1 = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/backup-v1.json', import.meta.url)), 'utf8'),
) as { data: Record<string, unknown[]> };

const dexieScript = createRequire(import.meta.url).resolve('dexie/dist/dexie.js');

async function loadSample(page: Page) {
  await page.goto('/#/debug');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByTestId('debug-message')).toContainText('Loaded');
}

/** A database as v0.5 left it (data format 1), made before the app opens it. */
async function makeV1Database(page: Page) {
  // An empty page on the app's origin, so the app doesn't open (and update) the database.
  await page.route('**/__empty.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>empty</title>' }),
  );
  await page.goto('/__empty.html');
  await page.addScriptTag({ path: dexieScript });
  await page.evaluate(
    async ({ stores, data }) => {
      const { Dexie } = window as unknown as { Dexie: typeof DexieClass };
      const db = new Dexie('rental-tracker-preview');
      db.version(1).stores(stores);
      await db.open();
      for (const [table, rows] of Object.entries(data)) await db.table(table).bulkAdd(rows);
      db.close();
    },
    { stores: STORES_V1 as Record<string, string>, data: fixtureV1.data },
  );
}

test('updates a v0.5 database: offers a backup first, then your ratings are yours', async ({
  page,
}) => {
  await makeV1Database(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'This update changes how your data is stored' }),
  ).toBeVisible();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const backup = JSON.parse(readFileSync(await file.path(), 'utf8')) as {
    schemaVersion: number;
    data: { units: { rating?: number }[] };
  };
  expect(backup.schemaVersion).toBe(1); // the old format, which v0.5 can open
  expect(backup.data.units[0]?.rating).toBe(4);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  const card = page.getByRole('link', { name: /Unit 1504 Example Tower/ });
  await expect(card).toBeVisible();
  await expect(card.getByRole('img', { name: '4 of 5 stars' })).toBeVisible();
  await expect(card).toContainText('Pick');

  // Asked once for a name; the answer sticks.
  const banner = page.getByRole('region', { name: 'Your name' });
  await banner.getByRole('textbox').fill('Jordan');
  await banner.getByRole('button', { name: 'Save' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(card).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your name' })).toHaveCount(0);
  await page.goto('/#/settings/people');
  await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveValue('Jordan');
});

test('shows a sample roommate’s ratings next to yours, and saves theirs', async ({ page }) => {
  await loadSample(page);
  await page.goto('/');
  // Never backed up: the backup reminder shows, and the name question waits its turn.
  await expect(page.getByRole('region', { name: 'Backup reminder' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your name' })).toHaveCount(0);

  const rated = page.getByRole('link').filter({ has: page.getByRole('img', { name: /^Alex: / }) });
  await rated.first().click();
  const ratings = page.getByRole('region', { name: 'Ratings' });
  await expect(ratings.getByRole('listitem')).toHaveCount(2);
  await expect(ratings.getByRole('listitem').first()).toContainText('You');
  await expect(ratings.getByRole('listitem').nth(1)).toContainText('Alex');

  const alex = ratings.getByRole('group', { name: 'Alex’s rating' });
  await alex.getByRole('button', { name: '1 star', exact: true }).click();
  await expect(alex.getByRole('button', { name: '1 star', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(
    page
      .getByRole('group', { name: 'Alex’s rating' })
      .getByRole('button', { name: '1 star', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('adds someone in Settings → People and rates for them', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/settings/people');
  await page.getByRole('textbox', { name: 'New person’s name' }).fill('Sam');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('textbox', { name: 'Sam’s name' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: /Unit/ }).first().click();
  const ratings = page.getByRole('region', { name: 'Ratings' });
  await expect(ratings.getByRole('listitem')).toHaveCount(3);
  await ratings.getByRole('combobox', { name: 'Sam’s flag' }).selectOption('reject');
  await expect(ratings.getByRole('combobox', { name: 'Sam’s flag' })).toHaveValue('reject');
});

test('has no horizontal scrolling on the People page and a unit’s ratings', async ({ page }) => {
  await loadSample(page);
  await page.goto('/#/settings/people');
  await expect(page.getByRole('heading', { level: 2, name: 'People' })).toBeVisible();
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(false);
  await page.goto('/');
  await page.getByRole('link', { name: /Unit/ }).first().click();
  await expect(page.getByRole('region', { name: 'Ratings' })).toBeVisible();
  expect(await overflow()).toBe(false);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`people pages pass axe checks (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await loadSample(page);
    await page.goto('/');
    await page
      .getByRole('region', { name: 'Backup reminder' })
      .getByRole('button', { name: 'Later' })
      .click();
    await expect(page.getByRole('region', { name: 'Your name' })).toBeVisible();
    const rated = page
      .getByRole('link')
      .filter({ has: page.getByRole('img', { name: /^Alex: / }) });
    await rated.first().click();
    await expect(page.getByRole('region', { name: 'Ratings' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.goto('/#/settings/people');
    await expect(page.getByRole('textbox', { name: 'Alex’s name' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
