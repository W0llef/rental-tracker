import { expect, test as base } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

/**
 * Every e2e test uses this `test`: it answers the map's network requests locally, so tests
 * never depend on (or put load on) OpenFreeMap, OpenStreetMap, CyclOSM or MnGeo.
 *  - style documents → a small stand-in style (background only, Wayfinding layer id)
 *  - raster tiles    → a plain 1×1 PNG
 * `mapNet.requests` records which hosts the map asked for, so tests can check the base
 * map that was chosen. Add to `mapNet.failHosts` to make a host fail (e.g. to test error messages).
 */

/** A 1×1 grey PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4ceIEAAS0AlkWLoFAAAAAAElFTkSuQmCC',
  'base64',
);

const STUB_STYLE = {
  version: 8,
  name: 'Test stand-in',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#cccccc' } }],
};

const MAP_HOSTS = [
  'tiles.openfreemap.org',
  'tile.openstreetmap.org',
  'tile-cyclosm.openstreetmap.fr',
  'imageserver.gisdata.mn.gov',
];

export interface MapNetwork {
  /** Hosts the page asked for, in order (duplicates kept). */
  requests: string[];
  /** Hosts that answer with an error instead of a stand-in. */
  failHosts: Set<string>;
}

export const test = base.extend<{ mapNet: MapNetwork }>({
  mapNet: [
    async ({ page }, use) => {
      const net: MapNetwork = { requests: [], failHosts: new Set() };
      await stubMapNetwork(page, net);
      await use(net);
    },
    { auto: true },
  ],
});

export { expect };

async function stubMapNetwork(page: Page, net: MapNetwork) {
  await page.route(
    (url) => url.protocol === 'https:',
    async (route: Route) => {
      const url = new URL(route.request().url());
      const host = url.hostname;
      const known = MAP_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
      if (!known) return route.abort('blockedbyclient'); // nothing else leaves the test
      net.requests.push(known);
      if (net.failHosts.has(known)) return route.fulfill({ status: 503, body: 'unavailable' });
      if (url.pathname.startsWith('/styles/'))
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(STUB_STYLE),
        });
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: PNG,
      });
    },
  );
}
