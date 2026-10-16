import { expect, test } from './fixtures';

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
      const list = await box('List');
      expect(map.top).toBeCloseTo(56, 0);
      expect(map.height).toBeGreaterThan(viewport.height - 60);
      expect(list.height).toBeGreaterThan(viewport.height - 60);
    }
  });
}

test('live list is empty and does not offer sample data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No units yet')).toBeVisible();
  await expect(page.getByText('Adding units arrives in a later update.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'load sample data' })).toHaveCount(0);
});

test('live data check page uses the real database and offers no sample data', async ({ page }) => {
  await page.goto('/#/debug');
  await expect(page.getByRole('heading', { level: 1, name: 'Data check' })).toBeVisible();
  await expect(page.locator('main code').first()).toHaveText('rental-tracker');
  await expect(page.getByRole('button', { name: 'Load sample data' })).toHaveCount(0);
  await expect(
    page.getByText(
      'Sample data and test changes are only available in preview and development builds.',
    ),
  ).toBeVisible();
  await expect(
    page.getByTestId('record-counts').getByRole('row', { name: /^Units/ }),
  ).toContainText('0');
  await expect(page.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();
});
