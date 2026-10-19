import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/** Settings → Data (the M1 data check page, moved in the M7 review), sample data, undo. */

const unitsStored = (page: Page) =>
  page
    .getByTestId('record-counts')
    .getByRole('row', { name: /^Units/ })
    .locator('td')
    .first();

test.describe('Settings → Data (preview/dev build)', () => {
  test('is reachable from Settings, and old #/debug links land there', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Data' })
      .click();
    await expect(page).toHaveURL(/#\/settings\/data$/);
    await expect(page.getByText('rental-tracker-preview')).toBeVisible();
    await page.goto('/#/debug');
    await expect(page).toHaveURL(/#\/settings\/data$/);
  });

  test('loads sample data, undoes and redoes from the keyboard, and keeps it after a reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name.includes('phone'), 'Undo keys are for laptops');
    await page.goto('/#/settings/data');
    await expect(unitsStored(page)).toHaveText('0');
    await page.getByRole('button', { name: 'Load sample data' }).click();
    await expect(page.getByTestId('debug-message')).toContainText('Loaded');
    await expect(unitsStored(page)).not.toHaveText('0'); // the counts follow the database
    const loaded = Number(await unitsStored(page).textContent());
    expect(loaded).toBeGreaterThan(20);

    // History and undo survive a reload: they live in the database, not in memory.
    await page.reload();
    await expect(unitsStored(page)).toHaveText(String(loaded));
    await page.goto('/#/');
    await expect(page.getByTestId('list-count')).toContainText(`${loaded} units`);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('list-count')).toContainText('0 units');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.getByTestId('list-count')).toContainText(`${loaded} units`);
  });

  test('has no horizontal scrolling', async ({ page }) => {
    await page.goto('/#/settings/data');
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
      await page.goto('/#/settings/data');
      await page.getByRole('button', { name: 'Load sample data' }).click();
      await expect(page.getByTestId('debug-message')).toContainText('Loaded');
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
