import fc from 'fast-check';
import {
  bedsSizeText,
  buildingRangeText,
  edgeColor,
  effectivePinShow,
  fanOrder,
  groupPinLabel,
  leadUnit,
  legendFor,
  PIN_SHOW_PENDING,
  pinText,
  PRICE_STEPS,
  priceScale,
  priceStep,
  starText,
  unitPinLabel,
} from '../../src/domain/pins';
import type { PinUnit } from '../../src/domain/pins';
import { PIN_CONTENTS } from '../../src/model';
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

describe('pins show options', () => {
  it('falls back to rent for options that are not ready yet', () => {
    expect(effectivePinShow('total')).toBe('rent');
    expect(effectivePinShow('psf')).toBe('rent');
    expect(effectivePinShow('travel')).toBe('rent');
    expect(effectivePinShow('beds')).toBe('beds');
  });

  it('marks exactly total, cost per ft² and travel time as pending', () => {
    expect(Object.keys(PIN_SHOW_PENDING).sort()).toEqual(['psf', 'total', 'travel']);
    // Every option has a defined effective mode
    for (const show of PIN_CONTENTS) expect(PIN_CONTENTS).toContain(effectivePinShow(show));
  });
});

describe('pinText', () => {
  const u = row({ unitNumber: '1504', rent: 1650, bedrooms: 1, squareFeet: 720, rating: 4 });

  it('shows rent, with + on a grouped pin', () => {
    expect(pinText(u, 'rent', false)).toBe('$1,650');
    expect(pinText(u, 'rent', true)).toBe('$1,650+');
    expect(pinText(u, 'total', false)).toBe('$1,650'); // until M8
  });

  it('shows "from" for floor-plan pricing and ? for unknown rent', () => {
    expect(pinText(row({ rent: 2560, rentIsFrom: true }), 'rent', false)).toBe('from $2,560');
    expect(pinText(row({ rent: null }), 'rent', true)).toBe('?');
  });

  it('shows beds and size, rating and unit number', () => {
    expect(pinText(u, 'beds', false)).toBe('1 bd 720 ft²');
    expect(bedsSizeText({ bedrooms: 0, squareFeet: 480 })).toBe('Studio 480 ft²');
    expect(bedsSizeText({ bedrooms: null, squareFeet: null })).toBe('? bd ? ft²');
    expect(pinText(u, 'rating', false)).toBe('★4');
    expect(starText(0)).toBe('☆');
    expect(pinText(u, 'unit', false)).toBe('1504');
    expect(pinText(u, 'unit', true)).toBe('Riverlight');
    expect(pinText(row({ isFloorPlanOnly: true, floorPlanName: 'Plan C' }), 'unit', false)).toBe(
      'Plan C',
    );
  });

  it('has no text for photo, type and dot pins', () => {
    expect(pinText(u, 'photo', false)).toBeNull();
    expect(pinText(u, 'type', false)).toBeNull();
    expect(pinText(u, 'dot', false)).toBeNull();
  });
});

describe('lead unit and fan order', () => {
  const cheapRejected = row({ unitNumber: 'A', rent: 1200, flag: 'reject' });
  const mid = row({ unitNumber: 'B', rent: 1500 });
  const unknown = row({ unitNumber: 'C', rent: null });
  const high = row({ unitNumber: 'D', rent: 1900 });

  it('leads with the cheapest unit that is not rejected; unknown rents last', () => {
    expect(leadUnit([high, unknown, cheapRejected, mid])?.unit.unitNumber).toBe('B');
    expect(leadUnit([unknown, high])?.unit.unitNumber).toBe('D');
  });

  it('leads with the cheapest rejected unit when all are rejected', () => {
    const r2 = row({ unitNumber: 'E', rent: 1000, flag: 'reject' });
    expect(leadUnit([cheapRejected, r2])?.unit.unitNumber).toBe('E');
    expect(leadUnit([])).toBeUndefined();
  });

  it('fans out cheapest first with rejected units at the end', () => {
    expect(fanOrder([high, cheapRejected, unknown, mid]).map((r) => r.unit.unitNumber)).toEqual([
      'B',
      'D',
      'C',
      'A',
    ]);
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

  it('names a grouped pin with its count and lowest rent', () => {
    expect(groupPinLabel(riverlight, [row({ rent: 1900 }), row({ rent: 1575 })])).toBe(
      '2 units at Riverlight, from $1,575',
    );
  });

  it('gives a building pin its rent range', () => {
    expect(buildingRangeText([row({ rent: 1900 }), row({ rent: 1575 }), row({ rent: null })])).toBe(
      '$1,575–$1,900',
    );
    expect(buildingRangeText([row({ rent: 1575 })])).toBe('$1,575');
    expect(buildingRangeText([row({ rent: null })])).toBe('?');
  });
});

describe('pin color', () => {
  it('colors by status and label tokens', () => {
    const u = row({ status: 'toured', colorLabel: 'green' }).unit;
    expect(edgeColor(u, 'status', null)).toBe('var(--st-toured)');
    expect(edgeColor(u, 'label', null)).toBe('var(--lb-green)');
    expect(edgeColor(row({}).unit, 'label', null)).toBe('var(--ice)');
  });

  it('spans the price scale over known, non-rejected rents', () => {
    const units = [
      row({ rent: 1000 }),
      row({ rent: 3000 }),
      row({ rent: 500, flag: 'reject' }),
      row({ rent: null }),
    ].map((r) => r.unit);
    const scale = priceScale(units);
    expect(scale).toEqual({ min: 1000, max: 3000 });
    expect(edgeColor(units[0] as Unit, 'price', scale)).toBe(PRICE_STEPS[0]);
    expect(edgeColor(units[1] as Unit, 'price', scale)).toBe(PRICE_STEPS[4]);
    expect(edgeColor(units[3] as Unit, 'price', scale)).toBe('var(--ice)');
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
  const units = [
    row({ status: 'toured', colorLabel: 'green', rent: 1500 }),
    row({ status: 'new', rent: 2100 }),
  ].map((r) => r.unit);

  it('lists only the statuses on the map, in pipeline order', () => {
    const l = legendFor(units, 'status', labelNames);
    expect(l.kind === 'status' && l.rows.map((r) => r.label)).toEqual(['New', 'Toured']);
  });

  it('uses your label names and adds "No label"', () => {
    const l = legendFor(units, 'label', labelNames);
    expect(l.kind === 'label' && l.rows.map((r) => r.label)).toEqual(['Both like', 'No label']);
  });

  it('shows the rent range for price colors', () => {
    const l = legendFor(units, 'price', labelNames);
    expect(l).toMatchObject({
      kind: 'price',
      min: '$1,500',
      max: '$2,100',
      title: 'Pin color: rent',
    });
    expect(legendFor([], 'price', labelNames).kind).toBe('price-empty');
  });
});
