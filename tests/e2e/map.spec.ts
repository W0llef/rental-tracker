import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * M3: the map. Map servers are answered locally by ./fixtures, so these tests check our
 * pins, panels and choices, not anyone's tiles.
 */

const isPhone = (name: string) => name.includes('phone');

async function loadSample(page: Page) {
  await page.goto('/#/debug');
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByTestId('debug-message')).toContainText('Loaded');
  await page.goto('/#/');
  await expect(page.getByTestId('list-count')).toContainText('34 units in 10 buildings');
}

const map = (page: Page) => page.getByRole('region', { name: 'Map' });
const pins = (page: Page) => map(page).locator('[data-pin]');

async function showMap(page: Page, phone: boolean) {
  if (phone)
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('button', { name: 'Map' })
      .click();
  await expect(pins(page).first()).toBeAttached();
}

/** Zoom in until the plates show (the fitted view may shrink crowded pins to dots). */
async function zoomIn(page: Page, steps = 2) {
  for (let i = 0; i < steps; i++) {
    const before = await map(page).locator('[data-zoom]').getAttribute('data-zoom');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(map(page).locator('[data-zoom]')).not.toHaveAttribute('data-zoom', before ?? '');
  }
}

test.describe('map (preview/dev build)', () => {
  test.beforeEach(async ({ page }) => loadSample(page));

  test('shows a pin or bubble for every building, and a legend', async ({ page }, info) => {
    await showMap(page, isPhone(info.project.name));
    // Ten buildings: either drawn as pins or counted inside neighborhood bubbles
    const pinCount = await pins(page).count();
    const bubbles = await map(page).locator('[data-bubble]').count();
    expect(pinCount + bubbles).toBeGreaterThan(0);
    const inBubbles = await map(page)
      .locator('[data-bubble]')
      .evaluateAll((els) => els.reduce((n, e) => n + Number(e.getAttribute('data-bubble')), 0));
    const inPins = await pins(page).evaluateAll((els) =>
      els.reduce((n, e) => {
        const m = e.getAttribute('aria-label')?.match(/(\d+) units at/);
        return n + (m ? Number(m[1]) : 1);
      }, 0),
    );
    expect(inPins + inBubbles).toBe(34);
    if (!isPhone(info.project.name)) {
      await expect(map(page).getByRole('region', { name: 'Pin color: status' })).toBeVisible();
    }
  });

  test('selecting a card shows its pin as the navy plate', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'laptop layout: list and map side by side');
    await showMap(page, false);
    await page.getByRole('link', { name: /Unit 603.*Lowertown Flats/ }).click();
    const id = new URL(page.url()).hash.split('/').pop();
    const pin = map(page).locator(`[data-pin="unit:${id}"]`);
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await expect(pin).toHaveAttribute('data-shape', 'plate');
    // Its building is grouped, so it fans out with leader lines around the hub
    await expect(map(page).getByRole('group', { name: 'Units at Lowertown Flats' })).toBeAttached();
    await expect(
      map(page).getByRole('group', { name: 'Units at Lowertown Flats' }).locator('[data-pin]'),
    ).toHaveCount(4);
  });

  test('pointing at a card shows its pin in full', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'hover needs the list and map side by side');
    await showMap(page, false);
    // At the fitted view one crowded building is drawn as a dot
    const dot = pins(page).locator('xpath=self::*[@data-shape="dot"]').first();
    await expect(dot).toBeAttached();
    const name = (await dot.getAttribute('aria-label'))?.match(/units at ([^,]+)/)?.[1];
    expect(name).toBeTruthy();
    const pinKey = await dot.getAttribute('data-pin');
    await page
      .getByRole('list', { name: 'Units' })
      .getByRole('link', { name: new RegExp(name as string) })
      .first()
      .hover();
    await expect(map(page).locator(`[data-pin="${pinKey}"]`)).toHaveAttribute(
      'data-shape',
      'plate',
    );
    await page.mouse.move(5, 5);
    await expect(map(page).locator(`[data-pin="${pinKey}"]`)).toHaveAttribute('data-shape', 'dot');
  });

  test('a grouped pin fans out; a unit in the fan opens its details', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    await map(page)
      .getByRole('button', { name: /4 units at Lowertown Flats/ })
      .click();
    const fan = map(page).getByRole('group', { name: 'Units at Lowertown Flats' });
    await expect(fan.locator('[data-pin]')).toHaveCount(4);
    // Cheapest first, rejected last
    const labels = await fan
      .locator('[data-pin]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels[0]).toContain('$1,090');
    expect(labels[3]).toContain('rejected');

    // Esc folds the fan back into one pin
    await page.keyboard.press('Escape');
    await expect(fan).toHaveCount(0);
    await expect(
      map(page).getByRole('button', { name: /4 units at Lowertown Flats/ }),
    ).toBeAttached();

    await map(page)
      .getByRole('button', { name: /4 units at Lowertown Flats/ })
      .click();
    await fan.getByRole('button', { name: /Unit 603/ }).click();
    await expect(page).toHaveURL(/#\/unit\//);
    await expect(page.getByRole('heading', { name: 'Unit 603', level: 2 })).toBeVisible();
    if (phone) {
      await expect(
        page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Unit' }),
      ).toHaveAttribute('aria-current', 'page');
    }
  });

  test('the layers panel changes the pins and is remembered', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    if (phone) await map(page).getByRole('button', { name: 'Layers', exact: true }).click();
    else await page.keyboard.press('l');
    const panel = map(page).getByRole('region', { name: 'Map layers' });
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: 'Unit number' }).click();
    await expect(panel.getByRole('button', { name: 'Unit number' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await panel
      .getByRole('checkbox', { name: 'Shrink pins to dots when zoomed out or crowded' })
      .uncheck();
    await panel.getByRole('button', { name: 'Close map layers' }).click();
    await expect(panel).toHaveCount(0);

    // With shrinking off, every pin is a plate; the single house shows its address
    await expect(pins(page).locator('xpath=self::*[@data-shape="dot"]')).toHaveCount(0);
    await expect(map(page).getByRole('button', { name: /4 units at Lowertown Flats/ })).toHaveText(
      /Lowertown Flats/,
    );

    await page.reload();
    await showMap(page, phone);
    await expect(map(page).getByRole('button', { name: /4 units at Lowertown Flats/ })).toHaveText(
      /Lowertown Flats/,
    );
    await expect(pins(page).locator('xpath=self::*[@data-shape="dot"]')).toHaveCount(0);
  });

  test('base maps load from their own servers, and say so when one fails', async ({
    page,
    mapNet,
  }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    expect(mapNet.requests).toContain('tiles.openfreemap.org');

    await map(page).getByRole('button', { name: 'Layers', exact: true }).click();
    const panel = map(page).getByRole('region', { name: 'Map layers' });
    await panel.getByRole('button', { name: /OpenStreetMap/ }).click();
    await expect.poll(() => mapNet.requests.includes('tile.openstreetmap.org')).toBe(true);
    await panel.getByRole('button', { name: /Cycle map/ }).click();
    await expect.poll(() => mapNet.requests.includes('tile-cyclosm.openstreetmap.fr')).toBe(true);

    mapNet.failHosts.add('imageserver.gisdata.mn.gov');
    await panel.getByRole('button', { name: /Aerial photo/ }).click();
    await expect.poll(() => mapNet.requests.includes('imageserver.gisdata.mn.gov')).toBe(true);
    await expect(map(page).getByRole('status')).toHaveText(/Aerial photos couldn’t load/);

    // Switching away clears the message
    await panel.getByRole('button', { name: /Wayfinding/ }).click();
    await expect(map(page).getByRole('status')).toHaveCount(0);
  });

  test('pins color by label or rent, with a matching legend', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'the legend is laptop-only');
    await showMap(page, false);
    await page.keyboard.press('l');
    const panel = map(page).getByRole('region', { name: 'Map layers' });
    await panel
      .getByRole('group', { name: 'Pin color' })
      .getByRole('button', { name: 'Rent' })
      .click();
    await expect(map(page).getByRole('region', { name: 'Pin color: rent' })).toContainText(
      '$1,090',
    );
    await expect(map(page).getByRole('region', { name: 'Pin color: rent' })).toContainText(
      '$2,680',
    );
    await panel
      .getByRole('group', { name: 'Pin color' })
      .getByRole('button', { name: 'Label' })
      .click();
    await expect(map(page).getByRole('region', { name: 'Pin color: label' })).toBeVisible();
  });

  test('search and the Buildings view drive the map like the list', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await page.getByRole('searchbox').fill('Lowertown');
    await showMap(page, phone);
    await expect(pins(page)).toHaveCount(1);
    await expect(pins(page).first()).toHaveAccessibleName(/4 units at Lowertown Flats/);

    await page.getByRole('searchbox').fill('');
    if (phone)
      await page
        .getByRole('navigation', { name: 'Views' })
        .getByRole('button', { name: 'List' })
        .click();
    await page.getByRole('button', { name: 'Buildings' }).click();
    await showMap(page, phone);
    await expect(map(page).locator('[data-pin^="unit:"]')).toHaveCount(0);
    await zoomIn(page, 0);
    const label = await map(page)
      .locator('[data-pin^="building:"]')
      .first()
      .getAttribute('aria-label');
    expect(label).toMatch(/of your units/);
  });

  test('the unit panel links to Google Maps and Street View', async ({ page }) => {
    await page.getByRole('link', { name: /Unit 603.*Lowertown Flats/ }).click();
    const links = page.getByRole('region', { name: 'Details' });
    const maps = links.getByRole('link', { name: /Open in Google Maps/ });
    await expect(maps).toHaveAttribute(
      'href',
      /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/,
    );
    await expect(links.getByRole('link', { name: /Street View/ })).toHaveAttribute(
      'href',
      /map_action=pano&viewpoint=44\.\d+,-93\.\d+/,
    );
  });

  test('remembers where the map was', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    await zoomIn(page, 2);
    const zoom = Number(await map(page).locator('[data-zoom]').getAttribute('data-zoom'));
    await page.reload();
    await showMap(page, phone);
    await expect
      .poll(async () => Number(await map(page).locator('[data-zoom]').getAttribute('data-zoom')))
      .toBeCloseTo(zoom, 0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no accessibility violations with the layers panel open (${scheme})`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await showMap(page, isPhone(info.project.name));
      await map(page).getByRole('button', { name: 'Layers', exact: true }).click();
      await expect(map(page).getByRole('region', { name: 'Map layers' })).toBeVisible();
      const results = await new AxeBuilder({ page }).include('[data-panel="map"]').analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('has no horizontal scrolling with the map and a fan open', async ({ page }, info) => {
    await showMap(page, isPhone(info.project.name));
    await map(page)
      .getByRole('button', { name: /4 units at Lowertown Flats/ })
      .click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
