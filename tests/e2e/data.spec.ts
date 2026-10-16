import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** M1: the data check page, sample data, undo and redo, in a real browser database. */

const unitsStored = (page: Page) =>
  page
    .getByTestId('record-counts')
    .getByRole('row', { name: /^Units/ })
    .locator('td')
    .first();

test.describe('data check page (preview/dev build)', () => {
  test('is reachable from the app shell', async ({ page }, info) => {
    await page.goto('/');
    if (info.project.name.includes('phone')) {
      // The build info sits at the bottom of the list tab on phones.
      await page
        .getByRole('navigation', { name: 'Views' })
        .getByRole('button', { name: 'List' })
        .click();
    }
    await page.getByRole('link', { name: 'Data check' }).click();
    await expect(page).toHaveURL(/#\/debug$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Data check' })).toBeVisible();
    await expect(page.getByText('rental-tracker-preview')).toBeVisible();
  });

  test('loads sample data, undoes, redoes, and keeps it after a reload', async ({ page }) => {
    await page.goto('/#/debug');
    await expect(unitsStored(page)).toHaveText('0');

    await page.getByRole('button', { name: 'Load sample data' }).click();
    await expect(page.getByTestId('debug-message')).toContainText('Loaded');
    const loaded = Number(await unitsStored(page).textContent());
    expect(loaded).toBeGreaterThan(20);

    await page.getByRole('button', { name: 'Raise a rent by $25' }).click();
    await expect(page.getByRole('button', { name: 'Undo: Change rent' })).toBeVisible();

    // History and undo stack survive a reload: they live in the database, not in memory.
    await page.reload();
    await expect(unitsStored(page)).toHaveText(String(loaded));
    await page.getByRole('button', { name: 'Undo: Change rent' }).click();
    await page.getByRole('button', { name: 'Undo: Load sample data' }).click();
    await expect(unitsStored(page)).toHaveText('0');

    await page.getByRole('button', { name: 'Redo: Load sample data' }).click();
    await expect(unitsStored(page)).toHaveText(String(loaded));
    await expect(page.getByTestId('history').getByRole('listitem').first()).toContainText(
      'Redo: Load sample data',
    );
  });

  test('has no horizontal scrolling', async ({ page }) => {
    await page.goto('/#/debug');
    await page.getByRole('button', { name: 'Load sample data' }).click();
    await expect(page.getByTestId('debug-message')).toContainText('Loaded');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no accessibility violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/#/debug');
      await page.getByRole('button', { name: 'Load sample data' }).click();
      await expect(page.getByTestId('debug-message')).toContainText('Loaded');
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
