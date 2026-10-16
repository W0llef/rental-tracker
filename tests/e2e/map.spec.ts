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

const map = (page: Page) => page.getByRole('region', { name: 'Map', exact: true });
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

/** Waits until the map stops moving (Fit and zoom buttons animate). */
async function settle(page: Page) {
  const zoom = () => map(page).locator('[data-zoom]').getAttribute('data-zoom');
  let last = await zoom();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const now = await zoom();
    if (now === last) return;
    last = now;
  }
}

/** Zoom in until the map is at or past `level`. */
async function zoomTo(page: Page, level: number) {
  await settle(page);
  for (let i = 0; i < 8; i++) {
    const z = Number(await map(page).locator('[data-zoom]').getAttribute('data-zoom'));
    if (z >= level) return;
    await zoomIn(page, 1);
    await settle(page);
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

  test('selecting a card opens its building on the map, the unit marked', async ({
    page,
  }, info) => {
    test.skip(isPhone(info.project.name), 'laptop layout: list and map side by side');
    await showMap(page, false);
    await page.getByRole('link', { name: /Unit 603.*Lowertown Flats/ }).click();
    const id = new URL(page.url()).hash.split('/').pop();
    // Its building has several units, so its card opens with the unit's row selected
    const card = map(page).getByRole('group', { name: 'Units at Lowertown Flats' });
    await expect(card.locator('[data-pin]')).toHaveCount(4);
    await expect(card.locator(`[data-pin="unit:${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    // A single unit's pin is a navy plate when selected
    await page
      .getByRole('link', { name: /3624 15th Ave S/ })
      .first()
      .click();
    const single = new URL(page.url()).hash.split('/').pop();
    const pin = map(page).locator(`[data-pin="unit:${single}"]`);
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
  });

  test('pointing at a dot previews its pin without moving anything', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'hover needs a pointer');
    await showMap(page, false);
    // At the fitted view some crowded buildings are drawn as dots
    const dot = pins(page).locator('xpath=self::*[@data-shape="dot"]').first();
    await expect(dot).toBeAttached();
    const key = (await dot.getAttribute('data-pin')) as string;
    const shapes = async () =>
      pins(page).evaluateAll((els) =>
        els.map((e) => `${e.getAttribute('data-pin')}=${e.getAttribute('data-shape')}`).join(';'),
      );
    const before = await shapes();

    // Wiggle the pointer over the dot: it stays a dot, a preview shows, nothing re-lays out
    const box = (await dot.boundingBox())!;
    for (const [dx, dy] of [
      [0, 0],
      [3, -3],
      [-3, 4],
      [2, 6],
      [0, -6],
    ] as const) {
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
      await page.waitForTimeout(80);
      await expect(map(page).locator(`[data-pin="${key}"]`)).toHaveAttribute('data-shape', 'dot');
    }
    await expect(map(page).locator('[class*="peek"]')).toHaveCount(1);
    expect(await shapes()).toBe(before);

    // Its card gets highlighted too; moving away clears both
    await expect(
      page.getByRole('list', { name: 'Units' }).locator('[data-hover]').first(),
    ).toBeAttached();
    await page.mouse.move(5, 5);
    await expect(map(page).locator('[class*="peek"]')).toHaveCount(0);
  });

  test('pointing at a card previews its pin on the map', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'hover needs the list and map side by side');
    await showMap(page, false);
    const dot = pins(page).locator('xpath=self::*[@data-shape="dot"]').first();
    const name = (await dot.getAttribute('aria-label'))?.match(/units at ([^,]+)/)?.[1];
    expect(name).toBeTruthy();
    await page
      .getByRole('list', { name: 'Units' })
      .getByRole('link', { name: new RegExp(name as string) })
      .first()
      .hover();
    await expect(map(page).locator('[class*="peek"]')).toHaveCount(1);
    await page.mouse.move(5, 5);
    await expect(map(page).locator('[class*="peek"]')).toHaveCount(0);
  });

  test('a grouped pin opens a card; a unit in it opens its details', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    await map(page)
      .getByRole('button', { name: /4 units at Lowertown Flats/ })
      .click();
    const card = map(page).getByRole('group', { name: 'Units at Lowertown Flats' });
    await expect(card.locator('[data-pin]')).toHaveCount(4);
    await expect(card).toContainText('4 units');
    // Cheapest first, rejected last
    const labels = await card
      .locator('[data-pin]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels[0]).toContain('$1,090');
    expect(labels[3]).toContain('rejected');

    await card.getByRole('button', { name: /Unit 603/ }).click();
    await expect(page).toHaveURL(/#\/unit\//);
    await expect(page.getByRole('heading', { name: 'Unit 603', level: 2 })).toBeVisible();
    if (phone) {
      await expect(
        page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Unit' }),
      ).toHaveAttribute('aria-current', 'page');
      await page
        .getByRole('navigation', { name: 'Views' })
        .getByRole('button', { name: 'Map' })
        .click();
    }
    // The building's name in the header opens the building
    await card.getByRole('button', { name: 'Lowertown Flats', exact: true }).click();
    await expect(page).toHaveURL(/#\/building\//);
  });

  test('several cards stay open until closed or collapsed', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'laptop: room for several cards');
    await showMap(page, false);
    const cards = map(page).locator('[data-card]');
    await map(page)
      .getByRole('button', { name: /4 units at Lowertown Flats/ })
      .click();
    await map(page)
      .getByRole('button', { name: /3 units at Grand Terrace/ })
      .click();
    await expect(cards).toHaveCount(2);

    // Clicking empty map leaves them open, and nothing stays highlighted or dimmed
    await map(page)
      .locator('canvas')
      .click({ position: { x: 20, y: 300 } });
    await expect(page.getByRole('list', { name: 'Units' }).locator('[data-hover]')).toHaveCount(0);
    await expect(map(page).locator('[data-card][class*="dimCard"]')).toHaveCount(0);
    await expect(cards).toHaveCount(2);

    // The card's ✕ closes it, and so does its marker; Collapse all closes the rest
    await map(page).getByRole('button', { name: 'Close Grand Terrace' }).click();
    await expect(cards).toHaveCount(1);
    await map(page)
      .getByRole('button', { name: /3 units at Grand Terrace/ })
      .click();
    await expect(cards).toHaveCount(2);
    await map(page).getByRole('button', { name: 'Close units at Grand Terrace' }).click();
    await expect(cards).toHaveCount(1);
    await map(page).getByRole('button', { name: 'Collapse all' }).click();
    await expect(cards).toHaveCount(0);
    await expect(map(page).getByRole('button', { name: 'Collapse all' })).toHaveCount(0);

    // Esc closes the cards you opened before it closes the details
    await map(page)
      .getByRole('button', { name: /4 units at Lowertown Flats/ })
      .click();
    await map(page)
      .getByRole('group', { name: 'Units at Lowertown Flats' })
      .getByRole('button', { name: /Unit 201/ })
      .click();
    await map(page)
      .getByRole('button', { name: /3 units at Grand Terrace/ })
      .click();
    await expect(cards).toHaveCount(2);
    await page.keyboard.press('Escape');
    // Grand Terrace closes; Lowertown stays open because its unit is selected
    await expect(cards).toHaveCount(1);
    await expect(page).toHaveURL(/#\/unit\//);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/#\/unit\//);
  });

  test('cards never cover each other, pins or dots, even with large photo pins', async ({
    page,
  }, info) => {
    test.skip(isPhone(info.project.name), 'laptop: room for several cards');
    await showMap(page, false);
    await map(page).getByRole('button', { name: 'Pins', exact: true }).click();
    const panel = map(page).getByRole('region', { name: 'Pins' });
    await panel
      .getByRole('group', { name: 'Pin style' })
      .getByRole('button', { name: 'Photo' })
      .click();
    for (const n of ['Unit type icon', 'Beds and size', 'Unit number', 'Rating'])
      await panel.getByRole('checkbox', { name: n }).check();
    await panel.getByRole('button', { name: 'Close pins' }).click();
    await map(page).getByRole('button', { name: 'Fit all units' }).click();
    await page.waitForTimeout(400);
    const area = (await map(page).boundingBox())!;
    await page.mouse.move(area.x + area.width * 0.4, area.y + area.height * 0.45);
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(700);
    for (const name of [/units at Northloop Yards/, /units at The Larkin/, /units at Riverlight/]) {
      const pin = map(page).getByRole('button', { name });
      if (await pin.count()) await pin.first().click();
      await page.waitForTimeout(500);
    }
    await expect(map(page).locator('[data-card]')).toHaveCount(3);
    await page.waitForTimeout(600);
    const boxes = await map(page).evaluate((root) => {
      const box = (e: Element, k: string) => {
        const r = e.getBoundingClientRect();
        return { k, l: r.left, r: r.right, t: r.top, b: r.bottom };
      };
      return {
        cards: [...root.querySelectorAll('[data-card]')].map((e) =>
          box(e, `card ${e.getAttribute('data-card')}`),
        ),
        // Collapsed pins and dots (not rows inside cards), and the open buildings' markers
        others: [
          ...[...root.querySelectorAll('[data-pin]')]
            .filter((e) => !e.closest('[data-card]'))
            .map((e) => box(e, e.getAttribute('data-pin') ?? '')),
          ...[...root.querySelectorAll('[data-hub]')].map((e) =>
            box(e, `marker ${e.getAttribute('data-hub')}`),
          ),
        ],
      };
    });
    const hit = (a: (typeof boxes.cards)[0], c: (typeof boxes.cards)[0]) =>
      a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1;
    const clash: string[] = [];
    boxes.cards.forEach((a, i) => {
      for (const c of [...boxes.cards.slice(i + 1), ...boxes.others])
        if (hit(a, c)) clash.push(`${a.k} × ${c.k}`);
    });
    expect(clash).toEqual([]);

    // Pointing at one card fades the others; pointing at a thumbnail shows a larger preview
    const larkin = map(page).getByRole('group', { name: 'Units at The Larkin' });
    await larkin.locator('[data-pin]').first().hover();
    await expect(map(page).locator('[data-card][class*="dimCard"]')).toHaveCount(2);
    await larkin.locator('[data-pin] [class*="thumb"]').first().hover();
    await expect(map(page).locator('[data-preview]')).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(map(page).locator('[data-preview]')).toHaveCount(0);
  });

  test('each card is joined to its marker by a line you can see', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'laptop: room for several cards');
    await showMap(page, false);
    for (const name of [/4 units at Lowertown Flats/, /3 units at Grand Terrace/])
      await map(page).getByRole('button', { name }).click();
    await expect(map(page).locator('[data-card]')).toHaveCount(2);
    for (const id of await map(page)
      .locator('[data-card]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))) {
      const gap = await map(page).evaluate((root, id) => {
        const c = root.querySelector(`[data-card="${id}"]`)!.getBoundingClientRect();
        const m = root.querySelector(`[data-hub="${id}"]`)!.getBoundingClientRect();
        const [x, y] = [(m.left + m.right) / 2, (m.top + m.bottom) / 2];
        const nx = Math.min(Math.max(x, c.left), c.right);
        const ny = Math.min(Math.max(y, c.top), c.bottom);
        return Math.hypot(nx - x, ny - y);
      }, id);
      // The marker's radius (11) plus a visible stretch of line
      expect(gap).toBeGreaterThan(24);
    }
    // Pointing at a card makes its marker stand out
    const card = map(page).locator('[data-card]').first();
    const id = await card.getAttribute('data-card');
    const width = () =>
      map(page)
        .locator(`[data-hub="${id}"]`)
        .evaluate((e) => e.getBoundingClientRect().width);
    const before = await width();
    await card.hover();
    await expect.poll(width).toBeGreaterThan(before + 3);
  });

  test('the Pin size slider shrinks pins and cards', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    await map(page)
      .getByRole('button', { name: /4 units at Lowertown Flats/ })
      .click();
    const card = map(page).locator('[data-card]').first();
    const width = () => card.evaluate((e) => e.getBoundingClientRect().width);
    const before = await width();
    await map(page).getByRole('button', { name: 'Pins', exact: true }).click();
    const slider = map(page).getByRole('slider', { name: 'Pin size' });
    await slider.fill('70');
    await expect.poll(width).toBeLessThan(before * 0.8);
    await map(page).getByRole('button', { name: 'Reset to 100%' }).click();
    await expect.poll(width).toBeGreaterThan(before * 0.95);
  });

  test('buildings open by themselves at street zoom, where their card fits', async ({
    page,
  }, info) => {
    const phone = isPhone(info.project.name);
    await page.getByRole('searchbox').fill('Larkin');
    await showMap(page, phone);
    await map(page).getByRole('button', { name: 'Fit all units' }).click();
    await zoomTo(page, 15);
    const cards = map(page).locator('[data-card]');
    await expect(cards).toHaveCount(1);
    // Collapse all keeps it closed while you stay zoomed in…
    await map(page).getByRole('button', { name: 'Collapse all' }).click();
    await expect(cards).toHaveCount(0);
    await zoomIn(page, 1);
    await expect(cards).toHaveCount(0);
    // …and zooming out below street level and back lets it open again
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(cards).toHaveCount(0);
    await zoomTo(page, 15);
    await expect(cards).toHaveCount(1);
  });

  test('the Pins panel combines fields, per view, and is remembered', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    await map(page).getByRole('button', { name: 'Pins', exact: true }).click();
    const panel = map(page).getByRole('region', { name: 'Pins' });
    await expect(panel).toBeVisible();

    await panel.getByRole('checkbox', { name: 'Unit number' }).check();
    await panel.getByRole('checkbox', { name: 'Shrink crowded pins to dots' }).uncheck();
    await panel.getByRole('checkbox', { name: 'Group nearby buildings when zoomed out' }).uncheck();
    await panel.getByRole('button', { name: 'Close pins' }).click();
    await expect(panel).toHaveCount(0);

    // No dots, no bubbles; a building shows its rent range and name as separate segments
    await expect(pins(page).locator('xpath=self::*[@data-shape="dot"]')).toHaveCount(0);
    await expect(map(page).locator('[data-bubble]')).toHaveCount(0);
    const lowertown = map(page).getByRole('button', { name: /4 units at Lowertown Flats/ });
    await expect(lowertown).toHaveAccessibleName(/^\$1,090–\$1,815 Lowertown Flats 4 New, /);

    // Zoomed far out, still no dots or bubbles
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(map(page).locator('[data-bubble]')).toHaveCount(0);
    await expect(pins(page).locator('xpath=self::*[@data-shape="dot"]')).toHaveCount(0);

    await page.reload();
    await showMap(page, phone);
    await map(page).getByRole('button', { name: 'Fit all units' }).click();
    await expect(
      map(page).getByRole('button', { name: /4 units at Lowertown Flats/ }),
    ).toHaveAccessibleName(/Lowertown Flats 4 New/);

    // The Buildings view keeps its own settings (the panel edits the view the list shows)
    if (phone)
      await page
        .getByRole('navigation', { name: 'Views' })
        .getByRole('button', { name: 'List' })
        .click();
    await page.getByRole('button', { name: 'Buildings' }).click();
    await showMap(page, phone);
    await expect(
      map(page).getByRole('button', { name: /Lowertown Flats, 4 of your units/ }),
    ).toHaveAccessibleName(/4 of your units, \$1,090 to \$1,815$/);
  });

  test('dots carry no text, and rejected units can be hidden', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    await map(page).getByRole('button', { name: 'Pins', exact: true }).click();
    const panel = map(page).getByRole('region', { name: 'Pins' });
    await panel
      .getByRole('group', { name: 'Pin style' })
      .getByRole('button', { name: 'Dot' })
      .click();
    await expect(panel.getByRole('checkbox', { name: 'Rent' })).toBeDisabled();
    await expect(pins(page).locator('xpath=self::*[@data-shape="plate"]')).toHaveCount(0);

    await panel
      .getByRole('group', { name: 'Rejected units' })
      .getByRole('button', { name: 'Hide' })
      .click();
    await panel.getByRole('checkbox', { name: 'Group nearby buildings when zoomed out' }).uncheck();
    // Hennepin Lofts has 4 units, 2 rejected
    await expect(
      map(page).getByRole('button', { name: /2 units at Hennepin Lofts/ }),
    ).toBeAttached();
    await expect(map(page).getByRole('button', { name: /4 units at Hennepin Lofts/ })).toHaveCount(
      0,
    );
  });

  test('pointing at a pin highlights its cards', async ({ page }, info) => {
    test.skip(isPhone(info.project.name), 'hover needs the list and map side by side');
    await showMap(page, false);
    await map(page)
      .getByRole('button', { name: /4 units at Lowertown Flats/ })
      .hover();
    const cards = page.getByRole('list', { name: 'Units' }).locator('[data-hover]');
    await expect(cards).toHaveCount(4);
    await page.mouse.move(5, 5);
    await expect(cards).toHaveCount(0);
  });

  test('base maps load from their own servers, with a key, and say so when one fails', async ({
    page,
    mapNet,
  }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    expect(mapNet.requests).toContain('tiles.openfreemap.org');

    if (phone) await map(page).getByRole('button', { name: 'Layers', exact: true }).click();
    else await page.keyboard.press('l');
    const panel = map(page).getByRole('region', { name: 'Map layers' });
    await expect(panel.getByRole('list', { name: 'Wayfinding colors' })).toBeVisible();
    await panel.getByRole('button', { name: /OpenStreetMap/ }).click();
    await expect.poll(() => mapNet.requests.includes('tile.openstreetmap.org')).toBe(true);
    await panel.getByRole('button', { name: /Cycle map/ }).click();
    await expect.poll(() => mapNet.requests.includes('tile-cyclosm.openstreetmap.fr')).toBe(true);
    await expect(panel.getByRole('link', { name: /CyclOSM legend/ })).toBeVisible();

    mapNet.failHosts.add('imageserver.gisdata.mn.gov');
    await panel.getByRole('button', { name: /Aerial photo/ }).click();
    await expect.poll(() => mapNet.requests.includes('imageserver.gisdata.mn.gov')).toBe(true);
    await expect(map(page).getByRole('status')).toHaveText(/Aerial photos couldn’t load/);

    // Switching away clears the message, and the choice is remembered
    await panel.getByRole('button', { name: /Wayfinding/ }).click();
    await expect(map(page).getByRole('status')).toHaveCount(0);
    await panel.getByRole('button', { name: /Cycle map/ }).click();
    await page.reload();
    await showMap(page, phone);
    await expect
      .poll(() => mapNet.requests.filter((h) => h.includes('cyclosm')).length)
      .toBeGreaterThan(1);
  });

  test('pins color by label or rent, with a matching legend', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await showMap(page, phone);
    await map(page).getByRole('button', { name: 'Pins', exact: true }).click();
    const panel = map(page).getByRole('region', { name: 'Pins' });
    await panel
      .getByRole('group', { name: 'Pin color' })
      .getByRole('button', { name: 'Rent' })
      .click();
    // The panel carries the legend too (phones have no corner legend)
    await expect(panel).toContainText('$1,090');
    await expect(panel).toContainText('$2,680');
    if (!phone)
      await expect(map(page).getByRole('region', { name: 'Pin color: rent' })).toBeVisible();
    await panel
      .getByRole('group', { name: 'Pin color' })
      .getByRole('button', { name: 'Label' })
      .click();
    await expect(panel.getByRole('list', { name: 'Pin color: label' })).toBeVisible();
  });

  test('search and the Buildings view drive the map like the list', async ({ page }, info) => {
    const phone = isPhone(info.project.name);
    await page.getByRole('searchbox').fill('Lowertown');
    await showMap(page, phone);
    // One building: the map fits it closely enough that its card opens by itself
    await map(page).getByRole('button', { name: 'Fit all units' }).click();
    const fan = map(page).getByRole('group', { name: 'Units at Lowertown Flats' });
    await expect(fan.locator('[data-pin]')).toHaveCount(4);
    await expect(pins(page)).toHaveCount(4);

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
    test(`has no accessibility violations with each panel open (${scheme})`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await showMap(page, isPhone(info.project.name));
      await map(page)
        .getByRole('button', { name: /4 units at Lowertown Flats/ })
        .click();
      for (const [button, region] of [
        ['Layers', 'Map layers'],
        ['Pins', 'Pins'],
      ] as const) {
        await map(page).getByRole('button', { name: button, exact: true }).click();
        await expect(map(page).getByRole('region', { name: region })).toBeVisible();
        const results = await new AxeBuilder({ page }).include('[data-panel="map"]').analyze();
        expect(results.violations).toEqual([]);
      }
    });
  }

  test('has no horizontal scrolling with the map and a card open', async ({ page }, info) => {
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
