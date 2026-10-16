import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapPrefs } from '../../model';

/**
 * The five base maps (PLAN.md §4.3, DESIGN.md §2.5). All keyless. Raster servers are
 * donation-funded: the map only loads on-screen tiles, never caches or prefetches them,
 * and always shows their attribution.
 */

export type BaseLayer = MapPrefs['baseLayer'];

export interface BaseMapInfo {
  id: BaseLayer;
  name: string;
  blurb: string;
  /** Short credit shown in the layers panel; the map's own attribution has the links. */
  credit: string;
}

export const BASE_MAPS: BaseMapInfo[] = [
  {
    id: 'wayfinding',
    name: 'Wayfinding',
    blurb: 'Quiet, so pins stand out. Light and dark.',
    credit: 'OpenFreeMap, OpenStreetMap',
  },
  {
    id: 'streets',
    name: 'Detailed streets',
    blurb: 'Shops, stations, more labels',
    credit: 'OpenFreeMap, OpenStreetMap',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    blurb: 'The classic osm.org look',
    credit: 'OpenStreetMap',
  },
  { id: 'cycle', name: 'Cycle map', blurb: 'Bike lanes, trails, racks', credit: 'CyclOSM' },
  {
    id: 'aerial',
    name: 'Aerial photo',
    blurb: '2025 metro imagery, 1 ft',
    credit: 'MnGeo, Metropolitan Council',
  },
];

export const LIBERTY_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/** OpenStreetMap Standard tiles (tile.openstreetmap.org; usage policy allows this use). */
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** CyclOSM, served by OpenStreetMap France. */
export const CYCLOSM_TILES = ['a', 'b', 'c'].map(
  (s) => `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`,
);

/**
 * MnGeo's multi-projection image service (`wmsll`, the one that offers Web Mercator).
 * 2025 seven-county metro imagery (1 ft) drawn over the 2025 statewide FSA imagery, which
 * fills in outside the metro and at lower zooms.
 */
export const MNGEO_WMS =
  'https://imageserver.gisdata.mn.gov/cgi-bin/wmsll?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap' +
  '&LAYERS=fsa2025,met25&STYLES=,&SRS=EPSG:3857&BBOX={bbox-epsg-3857}' +
  // Twice the tile's size, so the photos stay sharp on high-density screens
  '&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg';

/** Source id of the raster tiles in the raster styles (used to spot tile errors). */
export const RASTER_SOURCE = 'base';

/**
 * A raster base map. `tileSize` 128 makes MapLibre fetch the next zoom level's tiles and
 * draw them at half size: sharper, at four times the downloads ("Sharper raster maps").
 */
function rasterStyle(
  tiles: string[],
  attribution: string,
  maxzoom: number,
  background: string,
  tileSize = 256,
): StyleSpecification {
  return {
    version: 8,
    sources: {
      [RASTER_SOURCE]: { type: 'raster', tiles, tileSize, maxzoom, attribution },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': background } },
      { id: RASTER_SOURCE, type: 'raster', source: RASTER_SOURCE },
    ],
  };
}

export const osmStyle = (sharper = false): StyleSpecification =>
  rasterStyle([OSM_TILES], OSM_ATTRIBUTION, 19, '#f2efe9', sharper ? 128 : 256);

export const cycleStyle = (sharper = false): StyleSpecification =>
  rasterStyle(
    CYCLOSM_TILES,
    `${OSM_ATTRIBUTION} · <a href="https://www.cyclosm.org" target="_blank" rel="noopener">CyclOSM</a>`,
    20,
    '#f4f4f0',
    sharper ? 128 : 256,
  );

export const aerialStyle = (): StyleSpecification =>
  rasterStyle(
    [MNGEO_WMS],
    'Imagery: <a href="https://gisdata.mn.gov/" target="_blank" rel="noopener">MnGeo</a>, Metropolitan Council, USDA FSA',
    20,
    '#55605a',
  );

// ── Wayfinding: OpenFreeMap Positron, recolored with the DESIGN tokens ─────

/** The map colors from DESIGN.md §2.5, read from the `--map-*` tokens for the theme. */
export interface WayfindingPalette {
  land: string;
  blocks: string;
  buildings: string;
  water: string;
  parks: string;
  roads: string;
  highways: string;
  labels: string;
}

type Role = keyof WayfindingPalette | 'hide' | 'casing' | 'boundary' | 'keep';

/**
 * Which palette role each Positron layer takes, by id. Anything unlisted keeps its own
 * colors, so a changed upstream style degrades gracefully rather than breaking.
 */
export function roleOf(id: string): Role {
  if (id === 'background' || id.startsWith('landcover_ice') || id.startsWith('landcover_glacier'))
    return 'land';
  if (id === 'park' || id.startsWith('landcover_wood')) return 'parks';
  if (id === 'water' || id === 'waterway') return 'water';
  if (id.startsWith('landuse') || id.startsWith('aeroway')) return 'blocks';
  if (id === 'building') return 'buildings';
  if (id.includes('shield')) return 'hide'; // colored road shields: only your pins have color
  if (id.endsWith('_dashline')) return 'land'; // the gaps in rail dashes
  if (id.endsWith('_casing') || id.startsWith('railway')) return 'casing';
  if (id.includes('motorway')) return 'highways';
  if (id.startsWith('highway') || id.startsWith('road')) return 'roads';
  if (id.startsWith('boundary')) return 'boundary';
  return 'keep';
}

function paintFor(layer: LayerSpecification, color: string): Record<string, unknown> | null {
  switch (layer.type) {
    case 'background':
      return { 'background-color': color };
    case 'fill':
      return { 'fill-color': color, 'fill-outline-color': color };
    case 'line':
      return { 'line-color': color };
    default:
      return null;
  }
}

/** Recolors a Positron style for the palette. Returns a new style; the input is unchanged. */
export function recolorPositron(
  style: StyleSpecification,
  p: WayfindingPalette,
): StyleSpecification {
  const layers = style.layers.map((layer): LayerSpecification => {
    if (layer.type === 'symbol') {
      if (layer.id.includes('shield'))
        return { ...layer, layout: { ...layer.layout, visibility: 'none' } };
      return {
        ...layer,
        paint: { ...layer.paint, 'text-color': p.labels, 'text-halo-color': p.land },
      } as LayerSpecification;
    }
    const role = roleOf(layer.id);
    if (role === 'keep') return layer;
    if (role === 'hide') return { ...layer, layout: { ...layer.layout, visibility: 'none' } };
    const color =
      role === 'casing'
        ? p.buildings
        : role === 'boundary'
          ? p.labels
          : p[role as keyof WayfindingPalette];
    const paint = paintFor(layer, color);
    if (!paint) return layer;
    const extra = role === 'boundary' ? { 'line-opacity': 0.4 } : {};
    return { ...layer, paint: { ...layer.paint, ...paint, ...extra } } as LayerSpecification;
  });
  return { ...style, layers };
}

/** Reads the `--map-*` tokens for whatever theme is active on the page. */
export function paletteFromTokens(el: Element = document.documentElement): WayfindingPalette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    land: v('--map-land', '#eef2f3'),
    blocks: v('--map-blk', '#e3e9ec'),
    buildings: v('--map-bldg', '#d5dde1'),
    water: v('--map-water', '#b9d3e4'),
    parks: v('--map-park', '#d4e6d3'),
    roads: v('--map-road', '#ffffff'),
    highways: v('--map-hwy', '#f7e3b3'),
    labels: v('--map-label', '#6a7980'),
  };
}

const styleCache = new Map<string, Promise<StyleSpecification>>();

/** Fetches a style document once per URL. A failed fetch isn't cached, so it can retry. */
export function fetchStyle(url: string): Promise<StyleSpecification> {
  let p = styleCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Map style ${url} answered ${r.status}`);
      return r.json() as Promise<StyleSpecification>;
    });
    p.catch(() => styleCache.delete(url));
    styleCache.set(url, p);
  }
  return p;
}

/**
 * The style for a base map. Wayfinding is fetched (from the style URL in Settings, so a
 * fallback provider can be swapped in) and recolored for the theme; Detailed streets is
 * passed to MapLibre as a URL; the rest are built here.
 */
export async function styleFor(
  base: BaseLayer,
  wayfindingUrl: string,
  palette: WayfindingPalette,
  opts: { sharper?: boolean } = {},
): Promise<StyleSpecification | string> {
  switch (base) {
    case 'wayfinding':
      return recolorPositron(await fetchStyle(wayfindingUrl), palette);
    case 'streets':
      return LIBERTY_STYLE_URL;
    case 'osm':
      return osmStyle(opts.sharper);
    case 'cycle':
      return cycleStyle(opts.sharper);
    case 'aerial':
      return aerialStyle();
  }
}
