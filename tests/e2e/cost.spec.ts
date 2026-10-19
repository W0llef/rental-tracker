import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
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

  test('a lease length spreads one-time fees over that many months', async ({ page }) => {
    await page.goto('/#/settings/cost');
    await page.getByRole('checkbox', { name: /Spread one-time fees/ }).click();
    await expect(page.getByRole('checkbox', { name: /Spread one-time fees/ })).toBeChecked();
    await page.getByRole('link', { name: 'Back to the app' }).click();
    // Find a unit with one-time fees to spread
    const count = await cards(page).count();
    let found = false;
    for (let i = 0; i < count && !found; i++) {
      await cards(page).nth(i).click();
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
    await expect(spread).toContainText('over 24 months');
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
