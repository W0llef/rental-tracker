import fc from 'fast-check';
import {
  allRejected,
  bedsSizeText,
  buildingPinLabel,
  edgeColor,
  edgeStripes,
  fanOrder,
  legendFor,
  lowestRent,
  pinContent,
  pinnedUnits,
  PRICE_STEPS,
  priceScale,
  priceStep,
  starText,
  summarizedUnits,
  unitPinLabel,
} from '../../src/domain/pins';
import type { PinUnit } from '../../src/domain/pins';
import {
  activeFields,
  defaultMapMemory,
  fieldEnabled,
  parseMapMemory,
  toggleField,
} from '../../src/domain/pinPrefs';
import type { PinPrefs } from '../../src/domain/pinPrefs';
import type { Unit } from '../../src/model';
import { makeAddress, newBuilding, newUnit } from '../../src/model/factories';

const riverlight = newBuilding({
  name: 'Riverlight',
  address: makeAddress('200 Portland Ave S', 'Minneapolis'),
});

const row = (input: Partial<Unit>): PinUnit => ({
  unit: newUnit({ buildingId: riverlight.id, ...input }),
  building: riverlight,
});

const labelNames = {
  red: 'Red',
  yellow: 'Needs a call',
  green: 'Both like',
  blue: 'Blue',
  purple: 'Purple',
};

const units = defaultMapMemory().pins.units;
const prefs = (patch: Partial<PinPrefs>): PinPrefs => ({ ...units, ...patch });
const texts = (c: ReturnType<typeof pinContent>) => c.segments.map((s) => s.text);

describe('pin preferences', () => {
  it('starts with rent on a plate, the New tag, rejected units faded', () => {
    expect(units).toMatchObject({
      style: 'plate',
      fields: ['rent'],
      newBadge: 'tag',
      rejected: 'fade',
      autoFan: true,
      shrink: true,
      bubbles: true,
      size: 100,
    });
    expect(defaultMapMemory().pins.buildings.autoFan).toBe(false);
  });

  it('greys out text fields for dots and pending fields everywhere', () => {
    expect(fieldEnabled({ style: 'dot' }, 'rent')).toBe(false);
    expect(fieldEnabled({ style: 'photo' }, 'rent')).toBe(true);
    expect(fieldEnabled({ style: 'plate' }, 'total')).toBe(false);
    expect(fieldEnabled({ style: 'plate' }, 'travel')).toBe(false);
    expect(activeFields({ style: 'dot', fields: ['rent', 'beds'] })).toEqual([]);
  });

  it('keeps ticked fields in display order and never stores pending ones', () => {
    let p = toggleField(units, 'rating', true);
    p = toggleField(p, 'type', true);
    expect(p.fields).toEqual(['type', 'rent', 'rating']);
    expect(toggleField(p, 'rent', false).fields).toEqual(['type', 'rating']);
    expect(
      parseMapMemory({ pins: { units: { fields: ['rating', 'total', 'rent', 'nope'] } } }).pins
        .units.fields,
    ).toEqual(['rent', 'rating']);
  });

  it('keeps every valid stored choice and defaults the rest', () => {
    const m = parseMapMemory({
      baseLayer: 'aerial',
      pins: { units: { style: 'photo', newBadge: 'loud', shrink: false }, buildings: 'x' },
    });
    expect(m.baseLayer).toBe('aerial');
    expect(m.pins.units).toMatchObject({ style: 'photo', newBadge: 'tag', shrink: false });
    expect(m.pins.buildings).toEqual(defaultMapMemory().pins.buildings);
    expect(parseMapMemory(null)).toEqual(defaultMapMemory());
    expect(parseMapMemory({ baseLayer: 'moon' }).baseLayer).toBe('wayfinding');
    expect(parseMapMemory(null).sharperRaster).toBe(false);
    expect(parseMapMemory({ sharperRaster: true }).sharperRaster).toBe(true);
    expect(parseMapMemory({ sharperRaster: 'yes' }).sharperRaster).toBe(false);
  });

  it('keeps a pin size within 70–130%, defaulting older saved choices to 100%', () => {
    const size = (v: unknown) => parseMapMemory({ pins: { units: { size: v } } }).pins.units.size;
    expect(size(85)).toBe(85);
    expect(size(undefined)).toBe(100);
    expect(size(300)).toBe(100);
    expect(size(12.5)).toBe(100);
    expect(parseMapMemory({ pins: { units: { style: 'dot' } } }).pins.units.size).toBe(100);
  });
});

describe('pin content for one unit', () => {
  const u = row({
    unitNumber: '1504',
    rent: 1650,
    bedrooms: 1,
    squareFeet: 720,
    rating: 4,
    type: 'apartment',
  });
  const all = prefs({ fields: ['type', 'rent', 'beds', 'unit', 'rating'] });

  it('prints one segment per ticked field, in order', () => {
    const c = pinContent([u], all, false);
    expect(c.typeIcon).toBe('apartment');
    expect(texts(c)).toEqual(['$1,650', '1 bd · 720 ft²', '1504', '★4']);
  });

  it('says "from" for floor-plan pricing and ? for unknowns', () => {
    expect(texts(pinContent([row({ rent: 2560, rentIsFrom: true })], units, false))).toEqual([
      'from $2,560',
    ]);
    expect(texts(pinContent([row({ rent: null })], units, false))).toEqual(['?']);
    expect(bedsSizeText({ bedrooms: 0, squareFeet: 480 })).toBe('Studio · 480 ft²');
    expect(bedsSizeText({ bedrooms: null, squareFeet: null })).toBe('? bd · ? ft²');
    expect(starText(0)).toBe('☆');
  });

  it('prints nothing on a dot', () => {
    expect(pinContent([u], prefs({ style: 'dot', fields: ['rent'] }), false).segments).toEqual([]);
  });
});

describe('pin content for a building (only what is true of all its units)', () => {
  const group = [
    row({
      unitNumber: 'A',
      rent: 1090,
      bedrooms: 0,
      squareFeet: 547,
      rating: 4,
      type: 'apartment',
    }),
    row({
      unitNumber: 'B',
      rent: 1815,
      bedrooms: 1,
      squareFeet: 690,
      rating: 0,
      type: 'apartment',
    }),
    row({
      unitNumber: 'C',
      rent: 1395,
      bedrooms: 0,
      squareFeet: 521,
      rating: 1,
      type: 'apartment',
    }),
  ];
  const all = prefs({ fields: ['type', 'rent', 'beds', 'unit', 'rating'] });

  it('shows ranges and the building name', () => {
    const c = pinContent(group, all, true);
    expect(c.typeIcon).toBe('apartment');
    expect(texts(c)).toEqual(['$1,090–$1,815', 'Studio–1 bd · 521–690 ft²', 'Riverlight', '★1–4']);
  });

  it('can show the lowest rent with + instead of the range', () => {
    expect(texts(pinContent(group, prefs({ priceMode: 'lowest' }), true))).toEqual(['$1,090+']);
  });

  it('drops the type icon when the units differ', () => {
    const mixed = [...group, row({ type: 'condo', rent: 1500 })];
    expect(pinContent(mixed, all, true).typeIcon).toBeNull();
  });

  it('treats a one-unit building like that unit, but by name', () => {
    expect(texts(pinContent([group[0]!], prefs({ fields: ['rent', 'unit'] }), true))).toEqual([
      '$1,090',
      'Riverlight',
    ]);
  });
});

describe('rejected units', () => {
  const live = row({ unitNumber: 'A', rent: 1500 });
  const rej = row({ unitNumber: 'B', rent: 1000, flag: 'reject' });

  it('Show counts them, Fade and Hide leave them out of the summary', () => {
    expect(summarizedUnits([live, rej], 'show')).toHaveLength(2);
    expect(summarizedUnits([live, rej], 'fade')).toEqual([live]);
    expect(summarizedUnits([rej], 'fade')).toEqual([rej]);
  });

  it('Hide takes them off the map, unless selected', () => {
    expect(pinnedUnits([live, rej], 'fade')).toHaveLength(2);
    expect(pinnedUnits([live, rej], 'hide')).toEqual([live]);
    expect(pinnedUnits([live, rej], 'hide', rej.unit.id)).toHaveLength(2);
    expect(allRejected([rej])).toBe(true);
    expect(allRejected([live, rej])).toBe(false);
  });

  it('fans out cheapest first with rejected units at the end', () => {
    const high = row({ unitNumber: 'D', rent: 1900 });
    const unknown = row({ unitNumber: 'C', rent: null });
    expect(fanOrder([high, rej, unknown, live]).map((r) => r.unit.unitNumber)).toEqual([
      'A',
      'D',
      'C',
      'B',
    ]);
    expect(lowestRent([high, unknown])).toBe(1900);
    expect(lowestRent([unknown])).toBe(Infinity);
  });
});

describe('spoken labels', () => {
  it('names a unit pin with its building, price and status', () => {
    expect(unitPinLabel(row({ unitNumber: '1504', rent: 1650, status: 'shortlisted' }))).toBe(
      'Riverlight, Unit 1504, $1,650 rent, Shortlisted',
    );
    expect(unitPinLabel(row({ rent: null, flag: 'reject' }))).toBe(
      'Riverlight, rent unknown, New, rejected',
    );
  });

  it('names a building pin with its count and rent range', () => {
    const two = [row({ rent: 1900 }), row({ rent: 1575 })];
    expect(buildingPinLabel(riverlight, two, 'units')).toBe(
      '2 units at Riverlight, $1,575 to $1,900',
    );
    expect(buildingPinLabel(riverlight, [row({ rent: 1575 })], 'buildings')).toBe(
      'Riverlight, 1 of your units, $1,575',
    );
  });
});

describe('pin color', () => {
  it('colors by status and label tokens', () => {
    const u = row({ status: 'toured', colorLabel: 'green' }).unit;
    expect(edgeColor(u, 'status', null)).toBe('var(--st-toured)');
    expect(edgeColor(u, 'label', null)).toBe('var(--lb-green)');
    expect(edgeColor(row({}).unit, 'label', null)).toBe('var(--ice)');
  });

  it('gives a building one stripe per unit, like colors together', () => {
    const us = [row({ status: 'toured' }), row({ status: 'new' }), row({ status: 'toured' })];
    expect(edgeStripes(us, 'status', null)).toEqual([
      'var(--st-new)',
      'var(--st-toured)',
      'var(--st-toured)',
    ]);
  });

  it('spans the price scale over known, non-rejected rents', () => {
    const us = [
      row({ rent: 1000 }),
      row({ rent: 3000 }),
      row({ rent: 500, flag: 'reject' }),
      row({ rent: null }),
    ].map((r) => r.unit);
    const scale = priceScale(us);
    expect(scale).toEqual({ min: 1000, max: 3000 });
    expect(edgeColor(us[0] as Unit, 'price', scale)).toBe(PRICE_STEPS[0]);
    expect(edgeColor(us[1] as Unit, 'price', scale)).toBe(PRICE_STEPS[4]);
    expect(edgeColor(us[3] as Unit, 'price', scale)).toBe('var(--ice)');
    expect(priceScale([row({ rent: null }).unit])).toBeNull();
  });

  it('keeps every price step within 0–4 and ordered by value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: -1000, max: 25_000 }),
        fc.integer({ min: -1000, max: 25_000 }),
        (a, b, v1, v2) => {
          const scale = { min: Math.min(a, b), max: Math.max(a, b) };
          const s1 = priceStep(v1, scale);
          const s2 = priceStep(v2, scale);
          expect(s1).toBeGreaterThanOrEqual(0);
          expect(s1).toBeLessThanOrEqual(4);
          if (v1 <= v2) expect(s1).toBeLessThanOrEqual(s2);
          expect(priceStep(scale.min, scale)).toBe(0);
        },
      ),
    );
  });
});

describe('legend', () => {
  const us = [
    row({ status: 'toured', colorLabel: 'green', rent: 1500 }),
    row({ status: 'new', rent: 2100 }),
  ].map((r) => r.unit);

  it('lists only the statuses on the map, in pipeline order', () => {
    const l = legendFor(us, 'status', labelNames);
    expect(l.kind === 'status' && l.rows.map((r) => r.label)).toEqual(['New', 'Toured']);
  });

  it('uses your label names and adds "No label"', () => {
    const l = legendFor(us, 'label', labelNames);
    expect(l.kind === 'label' && l.rows.map((r) => r.label)).toEqual(['Both like', 'No label']);
  });

  it('shows the rent range for price colors', () => {
    const l = legendFor(us, 'price', labelNames);
    expect(l).toMatchObject({
      kind: 'price',
      min: '$1,500',
      max: '$2,100',
      title: 'Pin color: rent',
    });
    expect(legendFor([], 'price', labelNames).kind).toBe('price-empty');
  });
});
