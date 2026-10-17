import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * M4: Quick-add, pasted listing text, duplicates and Place on map. Photon and Nominatim are
 * answered locally (./fixtures); listing text comes from tests/fixtures/listing-text.
 */

const isPhone = (name: string) => name.includes('phone');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Add a unit' });
const field = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });
const listingText = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/listing-text/${name}`, import.meta.url)), 'utf8');

async function openAdd(page: Page) {
  await page.goto('/');
  await expect(page.getByText('No units yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add unit' }).click();
  await expect(dialog(page)).toBeVisible();
}

async function pickRiverlight(page: Page) {
  await dialog(page).getByRole('combobox', { name: 'Address' }).fill('Riverl');
  await dialog(page)
    .getByRole('option', { name: /^Riverlight 201 South Example/ })
    .click();
  await expect(dialog(page).getByText('New building in Downtown East.')).toBeVisible();
}

test('adds a unit in under a minute of typing, and it shows on the list and map', async ({
  page,
}, info) => {
  await openAdd(page);
  await pickRiverlight(page);
  await field(page, 'Unit').fill('1504');
  await field(page, 'Rent').fill('1650');
  await field(page, 'Beds').fill('1');
  await field(page, 'Baths').fill('1');
  await dialog(page).getByRole('button', { name: 'Add and open' }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/unit\//);
  await expect(page.getByRole('heading', { level: 2, name: 'Unit 1504' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Unit 1504 at Riverlight added.' }),
  ).toBeVisible();
  await expect(page.getByTestId('list-count')).toHaveText('1 unit in 1 building');
  if (isPhone(info.project.name))
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('button', { name: 'Map' })
      .click();
  await expect(
    page.getByRole('region', { name: 'Map', exact: true }).locator('[data-pin]'),
  ).toHaveCount(1);
});

test('pasted Zillow text fills the boxes and chips; a second add of the same unit is caught', async ({
  page,
  geoNet,
}) => {
  await openAdd(page);
  await field(page, 'Listing link').fill(
    'https://www.zillow.com/homedetails/1234-Example-Ave-S-APT-1504-Minneapolis-MN-55401/1_zpid/',
  );
  await expect(dialog(page).getByText('Site: Zillow')).toBeVisible();
  await expect(field(page, 'Address')).toHaveValue('1234 Example Ave S, Minneapolis, MN 55401');
  await field(page, 'Paste listing text (optional)').fill(listingText('zillow-unit.txt'));
  await expect(field(page, 'Rent')).toHaveValue('1650');
  await expect(field(page, 'Unit')).toHaveValue('1504');
  const chips = dialog(page).getByRole('list', { name: 'Recognized details' });
  await expect(chips.getByRole('button', { name: /In-unit laundry/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The address isn't among Photon's suggestions, so Nominatim is asked once; here it finds
  // a different address, which is ignored: the unit is saved without a location.
  await field(page, 'Rent').press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  expect(geoNet.queries.filter((q) => q.startsWith('nominatim:'))).toEqual([
    'nominatim:1234 Example Ave S, Minneapolis, MN 55401',
  ]);
  await expect(page.getByTestId('list-count')).toHaveText('1 unit in 1 building');
  await page.getByRole('link', { name: /Unit 1504/ }).click();
  await expect(page.getByText('Needs location: not on the map yet.')).toBeVisible();
  await expect(page.getByText('In unit', { exact: true })).toBeVisible();

  // Same link again: the banner offers to add today's price to the unit you have.
  await page.getByRole('button', { name: 'Add unit' }).click();
  await field(page, 'Listing link').fill(
    'https://zillow.com/homedetails/1234-Example-Ave-S-APT-1504-Minneapolis-MN-55401/1_zpid?utm_source=share',
  );
  await expect(dialog(page).getByText(/This link is already saved for Unit 1504/)).toBeVisible();
  await field(page, 'Rent').fill('1600');
  await field(page, 'Rent').press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByTestId('list-count')).toHaveText('1 unit in 1 building');
  await expect(page.getByRole('heading', { level: 2, name: 'Unit 1504' })).toBeVisible();
  await expect(page.locator('[class*="bigNum"]')).toContainText('$1,600');
});

test('⇧⏎ adds several units to one building', async ({ page }) => {
  await openAdd(page);
  await pickRiverlight(page);
  for (const [n, rent] of [
    ['101', '1500'],
    ['102', '1550'],
  ] as const) {
    await field(page, 'Unit').fill(n);
    await field(page, 'Rent').fill(rent);
    await field(page, 'Rent').press('Shift+Enter');
    await expect(dialog(page).getByRole('status').first()).toContainText(
      `Unit ${n} at Riverlight added.`,
    );
    await expect(field(page, 'Unit')).toBeFocused();
  }
  await expect(
    dialog(page).getByText('Riverlight is in your list; adding it there.'),
  ).toBeVisible();
  await field(page, 'Unit').fill('103');
  await field(page, 'Unit').press('Enter');
  await expect(page.getByTestId('list-count')).toHaveText('3 units in 1 building');
});

test('a unit without a location can be placed on the map', async ({ page, geoNet }, info) => {
  geoNet.nominatim = null; // offline
  geoNet.photon = null;
  await openAdd(page);
  await field(page, 'Address').fill('77 Nowhere Ave, Minneapolis');
  await field(page, 'Unit').fill('3');
  await dialog(page).getByRole('button', { name: 'Add and open' }).click();
  await expect(page.getByRole('status').filter({ hasText: /isn’t on the map yet/ })).toBeVisible();
  await page.getByRole('button', { name: 'Place on map' }).click();
  const map = page.getByRole('region', { name: 'Map', exact: true });
  await expect(
    map.getByRole('status').filter({ hasText: 'Click the map where 77 Nowhere Ave is.' }),
  ).toBeVisible();
  if (isPhone(info.project.name)) await expect(map).toBeVisible(); // switched to the Map tab
  await expect(map.locator('[data-pin]')).toHaveCount(0);
  const canvas = map.locator('canvas.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 40);
  await expect(
    page.getByRole('status').filter({ hasText: '77 Nowhere Ave is on the map.' }),
  ).toBeVisible();
  await expect(map.locator('[data-pin]')).toHaveCount(1);
});

test('pasting text onto a unit adds what it lacks', async ({ page }) => {
  await openAdd(page);
  await pickRiverlight(page);
  await field(page, 'Unit').fill('908');
  await field(page, 'Rent').fill('2385');
  await dialog(page).getByRole('button', { name: 'Add and open' }).click();
  await page.getByRole('button', { name: 'Paste text' }).click();
  await page.getByLabel('Paste listing text').fill(listingText('rentcafe-unit.txt'));
  const chips = page.getByRole('list', { name: 'Recognized details' });
  await expect(chips.getByRole('button', { name: /2 bd/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.getByRole('button', { name: /\$2,385/ })).toHaveCount(0); // same rent
  await page.getByRole('button', { name: /^Apply \d+$/ }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /details added from pasted text/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Details' }).getByText('1,040 ft²').first(),
  ).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Quick-add has no accessibility violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openAdd(page);
    await dialog(page).getByRole('combobox', { name: 'Address' }).fill('Riverl');
    await expect(dialog(page).getByRole('option').first()).toBeVisible();
    await field(page, 'Paste listing text (optional)').fill(listingText('zillow-unit.txt'));
    const results = await new AxeBuilder({ page }).include('dialog').analyze();
    expect(results.violations).toEqual([]);
  });
}
