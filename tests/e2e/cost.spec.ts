import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { Dexie as DexieClass } from 'dexie';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { STORES_V1, STORES_V2 } from '../../src/db/versions';
import { expect, test } from './fixtures';

/**
 * M9: the cost profile in Settings, the unit's Monthly cost with its lease length selector
 * and per-unit estimates, totals on cards, sorting by them, and cost limits. "Change an
 * electric estimate or lease length; totals update everywhere."
 */

async function loadSample(page: Page) {
  await page.goto('/#/settings/data');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByTestId('debug-message')).toContainText('Loaded');
  await page.goto('/#/');
  await expect(page.getByTestId('list-count')).toContainText('34 units in 10 buildings');
}

const cards = (page: Page) => page.getByRole('list', { name: 'Units' }).getByRole('link');
const panel = (page: Page) => page.getByRole('article');
const cost = (page: Page) => page.getByRole('region', { name: 'Monthly cost' });
const totalLine = (page: Page) =>
  cost(page)
    .getByRole('listitem')
    .filter({ hasText: /^Total/ });
/** Opens the i-th card and waits until its details show (the panel names the same unit). */
async function openCard(page: Page, i: number) {
  const card = cards(page).nth(i);
  const title = await card.locator('[class*="unitTitle"]').textContent();
  await card.click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(title ?? '');
  await expect(totalLine(page)).toBeAttached();
}

const money = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''));

test.describe('cost profile and lease length', () => {
  test.beforeEach(async ({ page }) => loadSample(page));

  test('changing the electric estimate updates the card, the panel and the plate', async ({
    page,
  }) => {
    await cards(page).first().click();
    const title = await panel(page).getByRole('heading', { level: 2 }).textContent();
    const before = money(await totalLine(page).locator('[class*="costAmount"]').textContent());
    const electric = cost(page)
      .getByRole('listitem')
      .filter({ hasText: /^Electric/ });
    const electricBefore = money(await electric.locator('[class*="costAmount"]').textContent());

    await page.goto('/#/settings/cost');
    const box = page.getByRole('textbox', { name: 'Electric per month' });
    await box.fill('155');
    await box.press('Enter');
    await page.getByRole('link', { name: 'Back to the app' }).click();
    await cards(page)
      .filter({ hasText: title ?? '' })
      .first()
      .click();
    const electricAfter = money(await electric.locator('[class*="costAmount"]').textContent());
    expect(electricAfter).toBeGreaterThan(electricBefore);
    const after = money(await totalLine(page).locator('[class*="costAmount"]').textContent());
    expect(after - before).toBe(electricAfter - electricBefore);
    await expect(panel(page).locator('header')).toContainText(`$${after.toLocaleString('en-US')}`);
    // Undo puts it back
    await page.keyboard.press('ControlOrMeta+z');
    await expect(totalLine(page)).toContainText(`$${before.toLocaleString('en-US')}`);
  });

  test('a lease length spreads one-time fees over that many months', async ({ page }, info) => {
    test.skip(info.project.name.includes('phone'), 'looks through the list beside the details');
    await page.goto('/#/settings/cost');
    await page.getByRole('checkbox', { name: /Spread one-time fees/ }).click();
    await expect(page.getByRole('checkbox', { name: /Spread one-time fees/ })).toBeChecked();
    await page.getByRole('link', { name: 'Back to the app' }).click();
    // Find a unit with one-time fees to spread
    await expect(page.getByTestId('list-count')).toContainText('34 units in 10 buildings');
    const count = await cards(page).count();
    let found = false;
    for (let i = 0; i < count && !found; i++) {
      await openCard(page, i);
      found =
        (await cost(page)
          .getByRole('listitem')
          .filter({ hasText: /^One-time fees/ })
          .count()) > 0;
    }
    expect(found).toBe(true);
    const spread = cost(page)
      .getByRole('listitem')
      .filter({ hasText: /^One-time fees/ });
    await expect(spread).toContainText('over 12 months');
    await cost(page).getByRole('combobox', { name: 'Lease length' }).selectOption('other');
    await cost(page).getByRole('textbox', { name: 'Months' }).fill('24');
    await cost(page).getByRole('textbox', { name: 'Months' }).press('Enter');
    // A unit that lists other lengths (12 and 15) is priced at the nearest one it lists.
    await expect(spread).toContainText(/over (24|15) months/);
    const listsOthers = (await cost(page).getByText('No 24-month lease').count()) > 0;
    await expect(spread).toContainText(listsOthers ? 'over 15 months' : 'over 24 months');
  });

  test('sorts by cost per ft² and limits the list by total', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption('psf');
    const first = await cards(page).first().textContent();
    await page.getByRole('button', { name: 'Cost limits' }).click();
    await page.getByRole('textbox', { name: 'Total up to' }).fill('1800');
    await page.getByRole('checkbox', { name: /Keep units whose cost/ }).uncheck();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('list-count')).toContainText(/of 34 units match/);
    for (const text of await cards(page).allTextContents()) {
      expect(money(text.match(/\$[\d,]+\/mo/)?.[0] ?? '')).toBeLessThanOrEqual(1800);
    }
    expect(first).toBeTruthy();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByTestId('list-count')).toContainText('34 units in 10 buildings');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`passes axe checks: monthly cost, cost limits, cost profile (${scheme})`, async ({
      page,
    }, info) => {
      test.slow();
      await page.emulateMedia({ colorScheme: scheme });
      const axe = () => new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze();
      await cards(page).first().click();
      await cost(page)
        .getByRole('button', { name: /^Set .* for this unit$/ })
        .first()
        .click();
      // On a phone the list is its own tab; the limits are checked with the laptop.
      if (!info.project.name.includes('phone'))
        await page.getByRole('button', { name: 'Cost limits' }).click();
      await page.mouse.move(1, 1);
      expect((await axe()).violations).toEqual([]);
      await page.goto('/#/settings/cost');
      await expect(page.getByRole('heading', { name: 'Cost profile' })).toBeVisible();
      expect((await axe()).violations).toEqual([]);
    });
  }

  test('works at phone width', async ({ page }, info) => {
    test.skip(!info.project.name.includes('phone'), 'phone only');
    await cards(page).first().click();
    await expect(cost(page)).toBeVisible();
    for (const path of ['/#/', '/#/settings/cost']) {
      if (path !== '/#/') await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});

// ── M9 review: charges by lease length (data format 4), and units without your length ──

const fixtureV3 = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/backup-v3.json', import.meta.url)), 'utf8'),
) as { data: Record<string, unknown[]> };
const dexieScript = createRequire(import.meta.url).resolve('dexie/dist/dexie.js');

/** A database as v0.8 left it (data format 3), made before the app opens it. */
async function makeV3Database(page: Page) {
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
      db.version(3).stores({});
      await db.open();
      for (const [table, rows] of Object.entries(data)) await db.table(table).bulkAdd(rows);
      await db.table('meta').put({ key: 'meId', value: 'p-me' });
      db.close();
    },
    {
      v1: STORES_V1 as Record<string, string>,
      v2: STORES_V2 as Record<string, string>,
      data: fixtureV3.data,
    },
  );
}

test('updates a v0.8 database to data format 4, offering a backup first', async ({ page }) => {
  await makeV3Database(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'This update changes how your data is stored' }),
  ).toBeVisible();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const backup = JSON.parse(readFileSync(await file.path(), 'utf8')) as { schemaVersion: number };
  expect(backup.schemaVersion).toBe(3); // the old format, which v0.8 can open
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('link', { name: /Unit 1504 Example Tower/ })).toBeVisible();
  await page.goto('/#/settings/backup');
  await expect(page.getByText('Before the update to data format 4')).toHaveCount(1);
});

test.describe('lease lengths', () => {
  test.beforeEach(async ({ page }) => loadSample(page));

  test('a smaller deposit on the longer lease shows in the move-in cost', async ({
    page,
  }, info) => {
    test.skip(info.project.name.includes('phone'), 'looks through the list beside the details');
    // Sample units with 12- and 15-month rents have half the deposit on 15 months.
    const count = await cards(page).count();
    for (let i = 0; i < count; i++) {
      await openCard(page, i);
      if (await cost(page).getByRole('combobox', { name: 'Lease length' }).count()) break;
    }
    const moveIn = cost(page)
      .locator('div')
      .filter({ has: page.getByText('Move-in cost', { exact: true }) })
      .last();
    const at12 = await moveIn.textContent();
    await cost(page).getByRole('combobox', { name: 'Lease length' }).selectOption('15');
    await expect(
      cost(page)
        .getByRole('listitem')
        .filter({ hasText: /^Rent\$/ }),
    ).toContainText('for a 15-month lease');
    await expect(moveIn).not.toHaveText(at12 ?? '');
    await expect(moveIn).toContainText('Deposit');

    // The form shows the deposit priced by length, and can make it the same again.
    await panel(page)
      .getByRole('link', { name: /^Edit$/ })
      .click();
    // Layout C (Q37): a row per lease length, the deposit as a column while it varies.
    const table = page.getByRole('table', { name: 'Prices by lease length' });
    await expect(table.getByRole('textbox', { name: 'Deposit on a 15-month lease' })).toBeVisible();
    await page
      .getByRole('button', { name: 'Deposit: make it the same for all lease lengths' })
      .first()
      .click();
    await expect(table.getByRole('textbox', { name: 'Deposit on a 15-month lease' })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'Deposit varies by lease length' }),
    ).toBeVisible();

    // Lease terms take ranges: 9 to 18 gives ten rows.
    const terms = page.getByRole('textbox', { name: 'Lease terms' });
    await terms.fill('9-18');
    await expect(table.getByRole('rowheader')).toHaveCount(10);
    await expect(page.getByText('(10 lease lengths)')).toBeVisible();
  });

  test('units without your lease length are marked on cards and the map, and can be left out', async ({
    page,
  }, info) => {
    await page.goto('/#/settings/cost');
    const box = page.getByRole('textbox', { name: 'Lease length you expect to sign' });
    await box.fill('18');
    await box.press('Enter');
    await page.getByRole('link', { name: 'Back to the app' }).click();
    const marked = cards(page).filter({ hasText: 'No 18-month lease' });
    await expect(marked.first()).toBeVisible();
    await expect(marked.first().getByTitle(/so its costs use the 15-month lease/)).toBeVisible();

    if (!info.project.name.includes('phone')) {
      // On the map, an open building's card marks the row and says why in its name.
      await page.getByRole('link', { name: /Unit 603.*Lowertown Flats/ }).click();
      const card = page
        .getByRole('region', { name: 'Map', exact: true })
        .getByRole('group', { name: 'Units at Lowertown Flats' });
      await expect(
        card.getByRole('button', { name: /Doesn’t list an 18-month lease/ }).first(),
      ).toBeAttached();
      await expect(card.locator('[title*="18-month lease"]').first()).toBeAttached();
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Cost limits' }).click();
      await page.getByRole('checkbox', { name: /Only units that list your lease length/ }).check();
      await page.getByRole('button', { name: 'Apply' }).click();
      // No sample unit lists 18 months
      await expect(page.getByText('No units within your cost limits')).toBeVisible();
    }
  });

  test('Settings → Lease length marks: all marks off, or only some, with a live preview', async ({
    page,
  }) => {
    await expect(cards(page).filter({ hasText: 'No lease terms entered' }).first()).toBeVisible();
    await page.goto('/#/settings/lease-marks');
    const preview = page.getByRole('region', { name: /^Preview/ });
    await expect(preview.getByText('No lease terms entered').first()).toBeVisible();
    await page.getByRole('checkbox', { name: 'No lease terms are entered yet' }).uncheck();
    await expect(preview.getByText('No lease terms entered')).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to the app' }).click();
    await expect(cards(page).filter({ hasText: 'No lease terms entered' })).toHaveCount(0);

    await page.goto('/#/settings/lease-marks');
    await page.getByRole('switch', { name: 'Show lease length marks' }).uncheck();
    await expect(
      page.getByRole('checkbox', { name: 'Its lease terms are unknown' }),
    ).toBeDisabled();
    // Remembered in this browser
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Show lease length marks' })).not.toBeChecked();
    await page.goto('/#/settings/cost');
    const box = page.getByRole('textbox', { name: 'Lease length you expect to sign' });
    await box.fill('18');
    await box.press('Enter');
    await page.getByRole('link', { name: 'Back to the app' }).click();
    await expect(cards(page).first()).toBeVisible();
    await expect(
      cards(page).filter({ hasText: /No 18-month lease|Lease terms unknown/ }),
    ).toHaveCount(0);
  });

  test('a unit’s own lease length is tagged, and comparing every unit at yours hides it', async ({
    page,
  }, info) => {
    test.skip(info.project.name.includes('phone'), 'uses the list beside the details');
    const first = cards(page).first();
    const title = (await first.locator('[class*="unitTitle"]').textContent()) ?? '';
    await openCard(page, 0);
    await panel(page)
      .getByRole('link', { name: /^Edit$/ })
      .click();
    await page.getByRole('combobox', { name: 'Lease you’d sign' }).selectOption('other');
    await page.getByRole('textbox', { name: 'Lease you’d sign, in months' }).fill('15');
    await page.getByRole('button', { name: /^Save/ }).click();
    const card = cards(page).filter({ hasText: title });
    await expect(card.first()).toContainText('15-month lease');

    await page.goto('/#/settings/cost');
    // Saved as a cost-profile change, so wait for it rather than for the click
    const compare = page.getByRole('checkbox', { name: 'Compare every unit at this lease length' });
    await compare.click();
    await expect(compare).toBeChecked();
    await page.getByRole('link', { name: 'Back to the app' }).click();
    await expect(card.first()).not.toContainText('15-month lease');
    await card.first().click();
    await expect(cost(page)).toContainText('At the 15-month lease you’d sign here:');
    await expect(cost(page).getByRole('combobox', { name: 'Lease you’d sign here' })).toBeVisible();
  });
});
