import type { StyleSpecification } from 'maplibre-gl';
import {
  aerialStyle,
  BASE_MAPS,
  cycleStyle,
  MNGEO_WMS,
  osmStyle,
  recolorPositron,
  roleOf,
} from '../../src/ui/map/baseMaps';
import type { WayfindingPalette } from '../../src/ui/map/baseMaps';
import { BASE_LAYERS } from '../../src/model';

const palette: WayfindingPalette = {
  land: '#eef2f3',
  blocks: '#e3e9ec',
  buildings: '#d5dde1',
  water: '#b9d3e4',
  parks: '#d4e6d3',
  roads: '#ffffff',
  highways: '#f7e3b3',
  labels: '#6a7980',
};

/** A slice of the real Positron layer list (ids and types as published by OpenFreeMap). */
const positron: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': 'rgb(242,243,240)' } },
    { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: {} },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: {} },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: {} },
    {
      id: 'highway_minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      paint: {},
    },
    {
      id: 'highway_motorway_inner',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      paint: { 'line-width': 2 },
    },
    {
      id: 'highway_motorway_casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      paint: {},
    },
    {
      id: 'road_shield_us',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      layout: {},
    },
    {
      id: 'label_city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      paint: { 'text-color': '#000' },
    },
    {
      id: 'something_new',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'x',
      paint: { 'line-color': '#123' },
    },
  ],
};

const byId = (s: StyleSpecification, id: string) =>
  s.layers.find((l) => l.id === id) as never as {
    paint?: Record<string, unknown>;
    layout?: Record<string, unknown>;
  };

describe('Wayfinding recolor', () => {
  const out = recolorPositron(positron, palette);

  it('applies the DESIGN map tokens by layer role', () => {
    expect(byId(out, 'background').paint?.['background-color']).toBe(palette.land);
    expect(byId(out, 'park').paint?.['fill-color']).toBe(palette.parks);
    expect(byId(out, 'water').paint?.['fill-color']).toBe(palette.water);
    expect(byId(out, 'building').paint?.['fill-color']).toBe(palette.buildings);
    expect(byId(out, 'highway_minor').paint?.['line-color']).toBe(palette.roads);
    expect(byId(out, 'highway_motorway_inner').paint).toEqual({
      'line-width': 2,
      'line-color': palette.highways,
    });
    expect(byId(out, 'highway_motorway_casing').paint?.['line-color']).toBe(palette.buildings);
  });

  it('hides colored shields and recolors labels', () => {
    expect(byId(out, 'road_shield_us').layout?.visibility).toBe('none');
    expect(byId(out, 'label_city').paint).toEqual({
      'text-color': palette.labels,
      'text-halo-color': palette.land,
    });
  });

  it('leaves unknown layers alone and never changes the input', () => {
    expect(byId(out, 'something_new').paint?.['line-color']).toBe('#123');
    expect(byId(positron, 'background').paint?.['background-color']).toBe('rgb(242,243,240)');
    expect(roleOf('railway_transit_dashline')).toBe('land');
  });
});

describe('raster base maps', () => {
  it('lists the five base maps in the model order', () => {
    expect(BASE_MAPS.map((b) => b.id)).toEqual([...BASE_LAYERS]);
  });

  it('fetches finer tiles for OpenStreetMap and Cycle map only when asked', () => {
    const size = (st: ReturnType<typeof osmStyle>) =>
      (st.sources.base as { tileSize: number }).tileSize;
    expect(size(osmStyle())).toBe(256);
    expect(size(osmStyle(true))).toBe(128);
    expect(size(cycleStyle(true))).toBe(128);
    expect(size(aerialStyle())).toBe(256);
  });

  it('carries attribution on every raster source', () => {
    for (const style of [osmStyle(), cycleStyle(), aerialStyle()]) {
      const src = style.sources.base as { attribution?: string; tiles?: string[] };
      expect(src.attribution).toBeTruthy();
      expect(src.tiles?.length).toBeGreaterThan(0);
    }
    expect((osmStyle().sources.base as { attribution: string }).attribution).toContain(
      'OpenStreetMap',
    );
  });

  it('asks MnGeo for Web Mercator tiles of the 2025 imagery', () => {
    expect(MNGEO_WMS).toContain('/cgi-bin/wmsll?');
    expect(MNGEO_WMS).toContain('SRS=EPSG:3857');
    expect(MNGEO_WMS).toContain('BBOX={bbox-epsg-3857}');
    expect(MNGEO_WMS).toContain('LAYERS=fsa2025,met25');
    // Twice the tile size, for sharp photos on high-density screens
    expect(MNGEO_WMS).toContain('WIDTH=512&HEIGHT=512');
  });
});
