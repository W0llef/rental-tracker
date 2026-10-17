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
    await expect(page.getByText(/It uses its own database/)).toHaveCount(0); // no preview banner
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

test('live list is empty, offers Quick-add and no sample data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No units yet')).toBeVisible();
  await expect(
    page.getByText('Paste a listing link or an address to add your first one.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'load sample data' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Add a unit' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a unit' })).toBeVisible();
});

test('live build adds a unit and keeps it after a reload', async ({ page, geoNet }) => {
  await page.goto('/#/add');
  const dialog = page.getByRole('dialog', { name: 'Add a unit' });
  await dialog.getByRole('combobox', { name: 'Address' }).fill('Riverlight');
  await dialog.getByRole('option', { name: /^Riverlight 201 South Example/ }).click();
  await dialog.getByLabel('Unit', { exact: true }).fill('1504');
  await dialog.getByLabel('Rent', { exact: true }).fill('1650');
  await dialog.getByLabel('Rent', { exact: true }).press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('list-count')).toHaveText('1 unit in 1 building');
  await page.reload();
  await expect(page.getByTestId('list-count')).toHaveText('1 unit in 1 building');
  expect(geoNet.queries.some((q) => q.startsWith('photon:'))).toBe(true);
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

test('live map starts on downtown with no pins and working controls', async ({
  page,
  mapNet,
}, info) => {
  await page.goto('/');
  if (info.project.name.includes('phone'))
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('button', { name: 'Map' })
      .click();
  const map = page.getByRole('region', { name: 'Map' });
  await expect(map.getByRole('button', { name: 'Layers', exact: true })).toBeVisible();
  await expect(map.locator('canvas.maplibregl-canvas')).toBeAttached();
  await expect(map.locator('[data-pin]')).toHaveCount(0);
  await expect(map.getByRole('button', { name: 'Fit all units' })).toBeDisabled();
  // The live build asks for the Wayfinding style like any other build
  await expect.poll(() => mapNet.requests.includes('tiles.openfreemap.org')).toBe(true);
});
