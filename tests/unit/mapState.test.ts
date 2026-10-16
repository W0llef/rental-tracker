import { defaultSettings } from '../../src/model';
import { makeAddress, newBuilding, newUnit } from '../../src/model/factories';
import { deriveDataset, deriveListView, deriveMapItems } from '../../src/state/derive';
import { loadViewport, resetUi, saveViewport, useUi } from '../../src/state/ui';

const at = { lat: 44.98, lng: -93.26, source: 'import' as const, precision: 'address' as const };
const riverlight = newBuilding({
  name: 'Riverlight',
  address: makeAddress('200 Portland Ave S', 'Minneapolis'),
  location: at,
});
const unplaced = newBuilding({ name: 'Somewhere', address: makeAddress('1 Unknown St', null) });
const empty = newBuilding({
  name: 'No units',
  address: makeAddress('5 Empty Ave', 'Minneapolis'),
  location: { ...at, lat: 44.9 },
});

const units = [
  newUnit({ buildingId: riverlight.id, unitNumber: '1504', rent: 1650 }),
  newUnit({ buildingId: riverlight.id, unitNumber: '908', rent: 1575 }),
  newUnit({ buildingId: unplaced.id, unitNumber: '2', rent: 1200 }),
];

const data = deriveDataset(
  {
    buildings: [riverlight, unplaced, empty],
    units,
    listings: [],
    notes: [],
    settings: defaultSettings(),
  },
  '2026-10-15',
);
const sort = { key: 'rent', dir: 'asc' } as const;
const sortB = { key: 'minRent', dir: 'asc' } as const;

describe('deriveMapItems', () => {
  it('puts one entry per located building with its visible units', () => {
    const items = deriveMapItems(deriveListView(data, '', sort, sortB), 'units');
    expect(items.buildings).toHaveLength(1);
    expect(items.buildings[0]).toMatchObject({ id: riverlight.id, lat: 44.98, lng: -93.26 });
    expect(items.buildings[0]?.units.map((u) => u.unit.unitNumber).sort()).toEqual(['1504', '908']);
    expect(items.needLocation).toBe(1);
  });

  it('follows the search, like the list', () => {
    const items = deriveMapItems(deriveListView(data, '1504', sort, sortB), 'units');
    expect(items.buildings[0]?.units.map((u) => u.unit.unitNumber)).toEqual(['1504']);
    expect(items.needLocation).toBe(0);
  });

  it('shows buildings with units in the Buildings view, never empty ones', () => {
    const items = deriveMapItems(deriveListView(data, '', sort, sortB), 'buildings');
    expect(items.buildings.map((b) => b.id)).toEqual([riverlight.id]);
    expect(items.needLocation).toBe(1);
  });
});

describe('map viewport memory', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a rounded viewport per database', () => {
    expect(loadViewport()).toBeNull();
    saveViewport({ longitude: -93.2651234, latitude: 44.9778999, zoom: 13.4567 });
    expect(loadViewport()).toEqual({ longitude: -93.26512, latitude: 44.9779, zoom: 13.46 });
    expect(localStorage.getItem('rental-tracker-preview.map')).not.toBeNull();
  });

  it('ignores unreadable or impossible values', () => {
    localStorage.setItem('rental-tracker-preview.map', '{oops');
    expect(loadViewport()).toBeNull();
    localStorage.setItem(
      'rental-tracker-preview.map',
      JSON.stringify({ longitude: 10, latitude: 95, zoom: 3 }),
    );
    expect(loadViewport()).toBeNull();
  });
});

describe('map UI state', () => {
  beforeEach(() => resetUi());

  it('toggles the layers panel and tracks hover and fan-out', () => {
    const ui = useUi.getState();
    ui.toggleLayers();
    expect(useUi.getState().layersOpen).toBe(true);
    ui.setHover('unit:a');
    ui.setFanned('b1');
    expect(useUi.getState()).toMatchObject({ hoverKey: 'unit:a', fannedId: 'b1' });
    resetUi();
    expect(useUi.getState()).toMatchObject({ layersOpen: false, hoverKey: null, fannedId: null });
  });
});
