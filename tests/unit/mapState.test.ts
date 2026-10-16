import { defaultSettings } from '../../src/model';
import { makeAddress, newBuilding, newUnit } from '../../src/model/factories';
import { deriveDataset, deriveListView, deriveMapItems } from '../../src/state/derive';
import { loadMapMemory, loadViewport, resetUi, saveViewport, useUi } from '../../src/state/ui';

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
  beforeEach(() => {
    localStorage.clear();
    resetUi();
  });

  it('opens one panel at a time and tracks hover', () => {
    const ui = useUi.getState();
    ui.togglePanel('layers');
    expect(useUi.getState().panel).toBe('layers');
    ui.togglePanel('pins');
    expect(useUi.getState().panel).toBe('pins');
    ui.togglePanel('pins');
    expect(useUi.getState().panel).toBeNull();
    ui.setHover('unit:a');
    expect(useUi.getState().hoverKey).toBe('unit:a');
  });

  it('keeps several fans open until folded, collapsed or zoomed out', () => {
    const ui = useUi.getState();
    ui.openFan('b1');
    ui.openFan('b2');
    expect(useUi.getState().openFans).toEqual(['b1', 'b2']);
    ui.foldFan('b1');
    expect(useUi.getState()).toMatchObject({ openFans: ['b2'], foldedFans: ['b1'] });
    ui.openFan('b1');
    expect(useUi.getState().foldedFans).toEqual([]);
    // Collapse all also folds the ones that opened by themselves
    ui.collapseFans(['b3']);
    expect(useUi.getState()).toMatchObject({ openFans: [], foldedFans: ['b3'] });
    ui.openFan('b4');
    ui.forgetFans({ clicked: true, folded: true });
    expect(useUi.getState()).toMatchObject({ openFans: [], foldedFans: [] });
  });

  it('remembers pin choices per view and the base map, per database', () => {
    const ui = useUi.getState();
    ui.setBaseLayer('cycle');
    ui.setPinPrefs('buildings', { ...ui.map.pins.buildings, style: 'dot' });
    expect(useUi.getState().map.pins.units.style).toBe('plate');
    const stored = JSON.parse(localStorage.getItem('rental-tracker-preview.mapPrefs') ?? '{}');
    expect(stored).toMatchObject({ baseLayer: 'cycle', pins: { buildings: { style: 'dot' } } });
    expect(loadMapMemory().pins.buildings.style).toBe('dot');
  });
});
