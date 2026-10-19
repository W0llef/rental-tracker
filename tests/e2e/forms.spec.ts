import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * M8: the full unit and building forms, research mode (⌘/Ctrl+↓ to the next empty field,
 * `?` for unknown), essentials and their prompts, price history editing, new units from a
 * plan, and Edit together for buildings.
 */

const isPhone = (name: string) => name.includes('phone');

async function loadSample(page: Page) {
  await page.goto('/#/settings/data');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByTestId('debug-message')).toContainText('Loaded');
  await page.goto('/#/');
  await expect(page.getByTestId('list-count')).toContainText('34 units in 10 buildings');
}

const cards = (page: Page) => page.getByRole('list', { name: 'Units' }).getByRole('link');
const panel = (page: Page) => page.getByRole('article');
const toast = (page: Page) => page.getByRole('status').filter({ has: page.locator('p') });

/** Opens the cheapest unit (Unit 603 at Lowertown Flats in the sample data). */
async function openFirst(page: Page) {
  await cards(page).first().click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 603');
}

/** The field the keyboard is in, by its row's data-field. */
const focusedField = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[data-field]')?.getAttribute('data-field'));

/**
 * What to type for each field research mode stops at. Selects take their first letter,
 * yes/no fields Y or N, utilities I, E or Y; anything else gets `?` (unknown).
 */
const ANSWERS: Record<string, string[]> = {
  'unit.type': ['a'],
  'unit.bedrooms': ['1'],
  'unit.bathrooms': ['1'],
  'unit.squareFeet': ['7', '2', '0'],
  'unit.floor': ['6'],
  'unit.exposure': [' '], // the focused direction (N)
  'unit.laundry': ['i'],
  'unit.dishwasher': ['y'],
  'unit.acType': ['c'],
  'unit.heatingType': ['f'],
  'unit.balcony': ['n'],
  'unit.fireplace': ['n'],
  'unit.flooring': ['H', 'a', 'r', 'd', 'w', 'o', 'o', 'd'],
  'unit.furnished': ['u'],
  'unit.leaseTermsMonths': ['1', '2'],
  'unit.deposit': ['5', '0', '0'],
  'unit.applicationFee': ['5', '0'],
  'unit.utilities.heat': ['i'],
  'unit.utilities.electric': ['y'],
  'unit.utilities.waterSewer': ['e'],
  'unit.utilities.trash': ['i'],
  'unit.utilities.gas': ['?'],
  'unit.utilities.internet': ['y'],
  'unit.parking.type': ['g'],
  'unit.parking.spacesIncluded': ['0'],
  'unit.parking.extraSpaceCost': ['1', '5', '0'],
  'unit.storage.included': ['n'],
};

test.describe('forms', () => {
  test.beforeEach(async ({ page }) => loadSample(page));

  test('fills a unit completely by keyboard, then its building', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'Research mode is for laptops');
    test.slow();
    await openFirst(page);
    await page.keyboard.press('e');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lowertown Flats · Unit 603');

    const seen: string[] = [];
    const nothingLeft = page.getByText('Nothing left empty.');
    let moved = false; // `?` marks unknown and moves on by itself
    for (let i = 0; i < 60; i++) {
      if (!moved) await page.keyboard.press('ControlOrMeta+ArrowDown');
      moved = false;
      if (await nothingLeft.isVisible()) break;
      const field = await focusedField(page);
      if (!field) throw new Error('Nothing focused');
      expect(seen, `${field} came back`).not.toContain(field);
      seen.push(field);
      if (field === 'unit.windows') {
        // The first control is "+ Add window": a row, then its room.
        await page.keyboard.press('Enter');
        await expect(page.getByRole('textbox', { name: 'Window 1 room' })).toBeFocused();
        await page.keyboard.type('Living');
        continue;
      }
      if (field === 'unit.recurringFees') {
        await page.keyboard.press('Tab'); // "+ Add a fee" → "No monthly fees"
        await page.keyboard.press('Enter');
        continue;
      }
      const keys = ANSWERS[field] ?? ['?'];
      for (const key of keys) await page.keyboard.press(key);
      if (keys[0] === '?') {
        moved = true;
        await expect
          .poll(async () => (await nothingLeft.isVisible()) || (await focusedField(page)) !== field)
          .toBe(true);
      }
    }
    await expect(page.getByText('Nothing left empty.')).toBeVisible();
    expect(seen).toContain('unit.windows');
    expect(seen).toContain('unit.storage.cost'); // appears once storage isn't included

    const summary = page.getByRole('complementary', { name: 'Summary' });
    await expect(summary.getByText('Essentials 10 of 11')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+s');
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 603');
    await expect(toast(page)).toContainText('on Unit 603 at Lowertown Flats');

    // Only the building's pet policy is missing: its prompt opens the building form there.
    const prompts = panel(page).getByRole('list', { name: 'Missing essentials' });
    await expect(prompts.getByRole('link')).toHaveCount(1);
    await prompts.getByRole('link', { name: /pet policy/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lowertown Flats · building');
    await expect.poll(() => focusedField(page)).toBe('building.pets.cats');
    await page.keyboard.press('y');
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    expect(await focusedField(page)).toBe('building.pets.dogs');
    await page.keyboard.press('n');
    await page.keyboard.press('ControlOrMeta+s');
    // Back where it came from, now ready to compare
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 603');
    await expect(panel(page).getByText('Ready to compare')).toBeVisible();

    // The detail panel shows what was filled in
    await expect(panel(page)).toContainText('Hardwood');
    await expect(panel(page)).toContainText('Living');
    // One undo takes the building's save back
    await page.keyboard.press('ControlOrMeta+z');
    await expect(panel(page).getByText('Essentials 10 of 11')).toBeVisible();
  });

  test('edits the price history and the rent follows it', async ({ page }, info) => {
    await openFirst(page);
    await panel(page).getByRole('link', { name: /^Edit/ }).click();
    const listing = page.getByRole('group', { name: /^Listing 1/ });
    await listing.getByRole('button', { name: '+ Add price' }).click();
    const rents = listing.getByRole('textbox', { name: /: rent$/ });
    const last = rents.last();
    await last.fill('1,045');
    await expect(page.getByText(/Saving sets the rent to \$1,045/)).toBeVisible();
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 603');
    await expect(panel(page).getByText('$1,045').first()).toBeVisible();
    if (!isPhone(info.project.name)) await expect(cards(page).first()).toContainText('$1,045');
  });

  test('makes a new unit from a floor plan', async ({ page }) => {
    await page.getByRole('searchbox').fill('Plan A');
    await cards(page).first().click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Plan A');
    await panel(page).getByRole('link', { name: 'New unit from Plan A' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('New unit at The Larkin');
    await expect(page.getByRole('textbox', { name: 'Unit number' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Unit number' }).fill('2210');
    await page.getByRole('textbox', { name: 'Rent' }).fill('1525');
    await page.getByRole('button', { name: /^Add unit/ }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 2210');
    await expect(panel(page)).toContainText('Studio'); // copied from the plan
    await expect(toast(page)).toContainText('Added Unit 2210 at The Larkin');
  });

  test('going between a unit’s form and its building’s keeps one form to leave', async ({
    page,
  }) => {
    await openFirst(page);
    await panel(page).getByRole('link', { name: /^Edit/ }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('link', { name: 'Edit building' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Lowertown Flats · building',
      );
      await page.getByRole('link', { name: 'Unit 603' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Lowertown Flats · Unit 603',
      );
    }
    // Changes, then a jump to the building: asked once, then gone
    await page.getByRole('textbox', { name: 'Flooring' }).fill('Tile');
    await page.getByRole('link', { name: 'Edit building' }).click();
    await page
      .getByRole('dialog', { name: 'Leave without saving?' })
      .getByRole('button', { name: 'Discard changes' })
      .click();
    await page.getByRole('textbox', { name: 'Year renovated' }).fill('2018');
    await page.getByRole('button', { name: /^Save/ }).click();
    // Straight back to the main screen, with no form left over
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 603');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel(page)).not.toContainText('Tile');
  });

  test('asks before leaving with unsaved changes', async ({ page }) => {
    await openFirst(page);
    await panel(page).getByRole('link', { name: /^Edit/ }).click();
    await page.getByRole('textbox', { name: 'Flooring' }).fill('Carpet');
    await page.getByRole('button', { name: 'Cancel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Unit 603');
    await expect(panel(page)).not.toContainText('Carpet');
  });

  test('edits several buildings together from the list and the map', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), '⌘/Ctrl-click is for laptops');
    await page.keyboard.press('b');
    const buildings = page.getByRole('list', { name: 'Buildings' }).getByRole('link');
    await buildings.nth(0).click({ modifiers: ['ControlOrMeta'] });
    await buildings.nth(1).click({ modifiers: ['ControlOrMeta'] });
    const bar = page.getByRole('region', { name: 'Selected buildings' });
    await expect(bar).toContainText('2 buildings selected');
    await bar.getByRole('button', { name: 'Edit together…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit 2 buildings together' });
    await dialog.getByRole('combobox', { name: 'Bike storage' }).selectOption('Yes');
    await dialog.getByRole('combobox', { name: 'Cats allowed' }).selectOption('Yes');
    await dialog.getByRole('button', { name: 'Apply to 2 buildings' }).click();
    await expect(toast(page)).toContainText('Bike storage');
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await buildings.nth(0).click();
    const amenities = panel(page).getByRole('list', { name: 'Amenities' });
    await expect(amenities.getByRole('listitem').filter({ hasText: /^Bike storage$/ })).toHaveCount(
      1,
    );
  });

  test('the forms work at phone width', async ({ page }, info) => {
    test.skip(!isPhone(info.project.name), 'Phone layout');
    await openFirst(page);
    await panel(page).getByRole('link', { name: /^Edit/ }).click();
    await page.getByRole('textbox', { name: 'Flooring' }).fill('Vinyl plank');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(panel(page)).toContainText('Vinyl plank');
    // Nothing spills sideways
    await panel(page).getByRole('link', { name: /^Edit/ }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`passes axe checks: unit form, building form, essentials (${scheme})`, async ({
      page,
    }) => {
      test.slow();
      await page.emulateMedia({ colorScheme: scheme });
      await openFirst(page);
      const axe = () => new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze();
      await page.mouse.move(1, 1);
      expect((await axe()).violations).toEqual([]);
      await panel(page).getByRole('link', { name: /^Edit/ }).click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Mark one unknown, leave a typo, add a window: every state on screen
      await page.getByRole('button', { name: 'Mark Balcony unknown' }).click();
      await page.getByRole('textbox', { name: 'Deposit' }).fill('lots');
      await page.getByRole('button', { name: '+ Add window' }).click();
      expect((await axe()).violations).toEqual([]);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page
        .getByRole('dialog', { name: 'Leave without saving?' })
        .getByRole('button', { name: 'Discard changes' })
        .click();
      await page.goto('/#/settings/essentials');
      await expect(page.getByRole('heading', { name: 'Essential fields' })).toBeVisible();
      expect((await axe()).violations).toEqual([]);
      await page.goto('/#/');
      await page.keyboard.press('b');
      await page.getByRole('list', { name: 'Buildings' }).getByRole('link').first().click();
      await panel(page)
        .getByRole('link', { name: /^Edit building/ })
        .click();
      await expect(page.getByRole('heading', { level: 1 })).toContainText('building');
      expect((await axe()).violations).toEqual([]);
    });
  }
});
