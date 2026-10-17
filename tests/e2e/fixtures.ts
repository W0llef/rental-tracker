import { expect, test as base } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every e2e test uses this `test`: it answers the map's and the geocoders' network requests
 * locally, so tests never depend on (or put load on) OpenFreeMap, OpenStreetMap, CyclOSM,
 * MnGeo, Photon or Nominatim.
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

/**
 * The geocoders (M4) answered locally too: Photon with `photon` (GeoJSON), Nominatim with
 * `nominatim` (a JSON array). Set either to null to make it fail (as when offline).
 * `queries` records what was asked, as "photon:<q>" or "nominatim:<q>".
 */
export interface GeoNetwork {
  photon: unknown;
  nominatim: unknown;
  queries: string[];
}

const geoFixture = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/geocode/${name}`, import.meta.url)), 'utf8'),
  ) as unknown;

export const test = base.extend<{ mapNet: MapNetwork; geoNet: GeoNetwork }>({
  mapNet: [
    async ({ page }, use) => {
      const net: MapNetwork = { requests: [], failHosts: new Set() };
      await stubMapNetwork(page, net);
      await use(net);
    },
    { auto: true },
  ],
  geoNet: [
    // Registered after the map stubs, so it answers first for the geocoder hosts.
    async ({ page, mapNet }, use) => {
      void mapNet;
      const net: GeoNetwork = {
        photon: geoFixture('photon-riverlight.json'),
        nominatim: geoFixture('nominatim-1010.json'),
        queries: [],
      };
      await page.route(
        (url) =>
          url.hostname === 'photon.komoot.io' || url.hostname === 'nominatim.openstreetmap.org',
        async (route) => {
          const url = new URL(route.request().url());
          const which = url.hostname.startsWith('photon') ? 'photon' : 'nominatim';
          net.queries.push(`${which}:${url.searchParams.get('q') ?? ''}`);
          const body = net[which];
          if (body === null) return route.abort('internetdisconnected');
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(body),
          });
        },
      );
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
