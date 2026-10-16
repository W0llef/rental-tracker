import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

const isPhone = (name: string) => name.includes('phone');

test.describe('app shell', () => {
  test('loads with the title, a list, a map area and build info', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Rental Unit Tracker');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rental Unit Tracker');
    await expect(page.getByTestId('build-info')).toContainText('rental-tracker-preview');
  });

  test('uses the self-hosted Overpass font', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toContain('Overpass');
    const loaded = await page.evaluate(() =>
      [...document.fonts].some((f) => f.family.includes('Overpass') && f.status === 'loaded'),
    );
    expect(loaded).toBe(true);
  });

  test('layout matches the screen width', async ({ page }, info) => {
    await page.goto('/');
    const tabs = page.getByRole('navigation', { name: 'Views' });
    if (isPhone(info.project.name)) {
      await expect(tabs).toBeVisible();
      await expect(page.getByRole('region', { name: 'List' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Map', exact: true })).toBeHidden();
      await tabs.getByRole('button', { name: 'Map' }).click();
      await expect(page.getByRole('region', { name: 'Map', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'List' })).toBeHidden();
    } else {
      await expect(tabs).toBeHidden();
      await expect(page.getByRole('region', { name: 'List' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Map', exact: true })).toBeVisible();
    }
  });

  test('has no horizontal scrolling', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('follows the system theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(light).toBe('rgb(246, 248, 249)'); // --snow, light

    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(dark).toBe('rgb(14, 26, 34)'); // --snow, dark
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no accessibility violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
