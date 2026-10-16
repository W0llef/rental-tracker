import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/** M2: the unit list, search, sort, Units/Buildings and the read-only detail panels. */

const isPhone = (name: string) => name.includes('phone');

async function loadSample(page: Page) {
  await page.goto('/#/debug');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByTestId('debug-message')).toContainText('Loaded');
  await page.goto('/#/');
  await expect(page.getByTestId('list-count')).toContainText('34 units in 10 buildings');
}

const cards = (page: Page) => page.getByRole('list', { name: 'Units' }).getByRole('link');
const rents = async (page: Page) =>
  (await cards(page).allTextContents()).map((t) => {
    const m = t.match(/\$([\d,]+)\/mo rent/);
    return m ? Number(m[1]?.replace(/,/g, '')) : null;
  });

test.describe('unit list and detail (preview/dev build)', () => {
  test.beforeEach(async ({ page }) => loadSample(page));

  test('sorts by rent both ways, unknowns last', async ({ page }) => {
    const asc = await rents(page);
    const known = asc.filter((r): r is number => r !== null);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    expect(asc.indexOf(null) === -1 || asc.slice(asc.indexOf(null)).every((r) => r === null)).toBe(
      true,
    );

    await page.getByRole('button', { name: /Sorted low to high/ }).click();
    const desc = (await rents(page)).filter((r): r is number => r !== null);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));

    // The sort is remembered after a reload
    await page.reload();
    await expect(page.getByRole('button', { name: /Sorted high to low/ })).toBeVisible();
  });

  test('sorts by size with unknown sizes at the end', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption('squareFeet');
    const sizes = (await cards(page).allTextContents()).map((t) => {
      const m = t.match(/([\d,?]+) ft²/);
      return m?.[1] === '?' ? null : Number(m?.[1]?.replace(/,/g, ''));
    });
    const firstUnknown = sizes.indexOf(null);
    expect(firstUnknown).toBeGreaterThan(0); // the sample data has some unknown sizes
    expect(sizes.slice(firstUnknown).every((s) => s === null)).toBe(true);
    const known = sizes.slice(0, firstUnknown) as number[];
    expect(known).toEqual([...known].sort((a, b) => b - a));
  });

  test('opens a unit, shows its details, and Back closes it', async ({ page }, info) => {
    const first = cards(page).first();
    const title = (await first.locator('[class*="unitTitle"]').textContent()) ?? '';
    await first.click();
    await expect(page).toHaveURL(/#\/unit\/[\w-]+$/);

    const details = page.getByRole('region', { name: 'Details' });
    await expect(details.getByRole('heading', { level: 2 })).toHaveText(title);
    for (const section of ['Lease and fees', 'Unit', 'Utilities', 'Listings and price', 'Notes'])
      await expect(
        details.getByRole('heading', { level: 3, name: section, exact: true }),
      ).toBeVisible();

    if (isPhone(info.project.name)) {
      const tabs = page.getByRole('navigation', { name: 'Views' });
      await expect(tabs.getByRole('button', { name: 'Unit' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('region', { name: 'List' })).toBeHidden();
    } else {
      // List, details and map side by side (or details over the map)
      await expect(page.getByRole('region', { name: 'List' })).toBeVisible();
      await expect(first).toHaveAttribute('aria-current', 'true');
    }

    await page.goBack();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('region', { name: 'List' })).toBeVisible();
    if (!isPhone(info.project.name)) await expect(details).toBeHidden();
  });

  test('searches and shows a clear way out of no results', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: /Search units/ });
    await search.fill('riverlight');
    await expect(page.getByTestId('list-count')).toContainText('of 34 units match');
    for (const text of await cards(page).allTextContents()) expect(text).toContain('Riverlight');

    await search.fill('no such place anywhere');
    await expect(page.getByText(/No units match/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByTestId('list-count')).toContainText('34 units in 10 buildings');
  });

  test('switches to buildings and opens one', async ({ page }) => {
    await page.getByRole('button', { name: 'Buildings' }).click();
    const buildings = page.getByRole('list', { name: 'Buildings' }).getByRole('link');
    await expect(buildings).toHaveCount(10);
    await buildings.filter({ hasText: 'Riverlight' }).click();
    const details = page.getByRole('region', { name: 'Details' });
    await expect(details.getByRole('heading', { level: 2 })).toHaveText('Riverlight');
    await expect(details.getByRole('heading', { name: 'Your units here' })).toBeVisible();
    await details
      .getByRole('link', { name: /^Unit / })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/unit\//);
  });

  test('moves through units with the keyboard', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'keyboard shortcuts are for laptops');
    await page.keyboard.press('j');
    await expect(page).toHaveURL(/#\/unit\//);
    const firstUrl = page.url();
    await page.keyboard.press('j');
    await expect(page).not.toHaveURL(firstUrl);
    await page.keyboard.press('k');
    await expect(page).toHaveURL(firstUrl);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/$/);
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox')).toBeFocused();
  });

  test('has no horizontal scrolling with a unit open', async ({ page }) => {
    await cards(page).first().click();
    await expect(
      page.getByRole('region', { name: 'Details' }).getByRole('heading', { level: 2 }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`list and detail have no accessibility violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      // A rejected unit and a selected card are both on screen
      await cards(page).nth(1).click();
      await expect(
        page.getByRole('region', { name: 'Details' }).getByRole('heading', { level: 2 }),
      ).toBeVisible();
      const unitResults = await new AxeBuilder({ page }).analyze();
      expect(unitResults.violations).toEqual([]);

      await page.goto('/#/');
      await page.getByRole('button', { name: 'Buildings' }).click();
      await page.getByRole('list', { name: 'Buildings' }).getByRole('link').first().click();
      await expect(
        page.getByRole('region', { name: 'Details' }).getByRole('heading', { level: 2 }),
      ).toBeVisible();
      const buildingResults = await new AxeBuilder({ page }).analyze();
      expect(buildingResults.violations).toEqual([]);
    });
  }
});
