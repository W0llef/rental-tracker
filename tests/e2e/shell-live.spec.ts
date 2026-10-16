import { expect, test } from '@playwright/test';

/**
 * The live app has no banner above the top bar. Layout must not depend on it
 * (a layout that assumed the banner once squeezed the whole app into 56 px).
 */
test.use({ baseURL: 'http://localhost:4174' });

for (const scheme of ['light', 'dark'] as const) {
  test(`live build fills the screen (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveCount(0); // no preview banner
    await expect(page.getByTestId('build-info')).toContainText('Live build');
    await expect(page.getByTestId('build-info')).toContainText('rental-tracker');

    const box = async (name: string) => {
      const region = page.getByRole('region', { name, exact: true });
      return region.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, height: r.height };
      });
    };
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    const main = await page.locator('main').evaluate((el) => el.getBoundingClientRect().height);

    // Main area = everything below the 56 px top bar (minus phone tabs, 56 px)
    expect(main).toBeGreaterThan(viewport.height - 56 - 60 - 1);

    if (viewport.width >= 760) {
      const map = await box('Map');
      const list = await box('Units');
      expect(map.top).toBeCloseTo(56, 0);
      expect(map.height).toBeGreaterThan(viewport.height - 60);
      expect(list.height).toBeGreaterThan(viewport.height - 60);
    }
  });
}
