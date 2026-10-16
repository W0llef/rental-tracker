import fc from 'fast-check';
import { boundsOf, contains, distanceMeters } from '../../src/domain/geo';
import { mapLinks, googleMapsUrl, streetViewUrl } from '../../src/domain/links';
import { estimatePinSize, fanOffsets, fullPins, STREET_ZOOM } from '../../src/domain/pinLayout';
import type { PinBox } from '../../src/domain/pinLayout';
import { makeAddress, newBuilding } from '../../src/model/factories';

const box = (id: string, x: number, y: number, priority = 0, keepFull = false): PinBox => ({
  id,
  x,
  y,
  w: 60,
  h: 33,
  priority,
  keepFull,
});

describe('fullPins (shrink to dots when crowded)', () => {
  it('shows every pin in full when shrinking is off', () => {
    const boxes = [box('a', 0, 0), box('b', 1, 1)];
    expect(fullPins(boxes, 10, false)).toEqual(new Set(['a', 'b']));
  });

  it('shows only kept pins in full below street zoom', () => {
    const boxes = [box('a', 0, 0), box('b', 500, 500, 1, true)];
    expect(fullPins(boxes, STREET_ZOOM - 0.5, true)).toEqual(new Set(['b']));
  });

  it('shrinks the lower-priority pin of an overlapping pair', () => {
    const boxes = [box('cheap', 100, 100, 1), box('pricey', 120, 105, 2), box('far', 400, 400, 3)];
    expect(fullPins(boxes, 15, true)).toEqual(new Set(['cheap', 'far']));
  });

  it('always keeps the selected pin, even over a cheaper one', () => {
    const boxes = [box('cheap', 100, 100, 1), box('selected', 110, 100, 9, true)];
    expect(fullPins(boxes, 15, true)).toEqual(new Set(['selected']));
  });

  it('never leaves two full, unkept pins overlapping', () => {
    const arb = fc.array(
      fc.record({ x: fc.integer({ min: 0, max: 400 }), y: fc.integer({ min: 0, max: 400 }) }),
      { maxLength: 30 },
    );
    fc.assert(
      fc.property(arb, (pts) => {
        const boxes = pts.map((p, i) => box(String(i), p.x, p.y, i));
        const full = boxes.filter((b) => fullPins(boxes, 16, true).has(b.id));
        for (let i = 0; i < full.length; i++)
          for (let j = i + 1; j < full.length; j++) {
            const a = full[i] as PinBox;
            const b = full[j] as PinBox;
            const apart = Math.abs(a.x - b.x) >= 60 + 2 || Math.abs(a.y - b.y) >= 33 + 2;
            expect(apart).toBe(true);
          }
      }),
    );
  });
});

describe('estimatePinSize', () => {
  it('grows with text and extras', () => {
    const plain = estimatePinSize('rent', '$1,650', { icon: false, stars: false, count: false });
    const more = estimatePinSize('rent', '$1,650', { icon: true, stars: true, count: true });
    expect(more.w).toBeGreaterThan(plain.w);
    expect(estimatePinSize('photo', null, { icon: false, stars: false, count: false }).h).toBe(62);
  });
});

describe('fanOffsets', () => {
  it('places units above the hub without overlapping plates', () => {
    for (const n of [2, 3, 5, 8]) {
      const offs = fanOffsets(n, 90);
      expect(offs).toHaveLength(n);
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const [ax, ay] = offs[i] as [number, number];
          const [bx, by] = offs[j] as [number, number];
          const apart = Math.abs(ax - bx) >= 88 || Math.abs(ay - by) >= 34;
          expect(apart).toBe(true);
        }
    }
    expect(fanOffsets(1)).toEqual([[0, -56]]);
    expect(fanOffsets(0)).toEqual([]);
  });
});

describe('geo helpers', () => {
  it('computes bounds and containment', () => {
    const b = boundsOf([
      { lng: -93.3, lat: 44.9 },
      { lng: -93.1, lat: 45.0 },
    ]);
    expect(b).toEqual([
      [-93.3, 44.9],
      [-93.1, 45.0],
    ]);
    expect(contains(b!, { lng: -93.2, lat: 44.95 })).toBe(true);
    expect(contains(b!, { lng: -93.0, lat: 44.95 })).toBe(false);
    expect(boundsOf([])).toBeNull();
  });

  it('measures distance in metres', () => {
    // Downtown Minneapolis to downtown St. Paul is about 14.5 km
    const d = distanceMeters({ lng: -93.265, lat: 44.9778 }, { lng: -93.09, lat: 44.9537 });
    expect(d).toBeGreaterThan(13_500);
    expect(d).toBeLessThan(15_000);
  });
});

describe('Google Maps links', () => {
  const b = newBuilding({
    name: 'Riverlight',
    address: makeAddress('200 Portland Ave S', 'Minneapolis'),
  });

  it('opens the address in Google Maps without a key', () => {
    const url = googleMapsUrl(b);
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    expect(decodeURIComponent(url!.split('query=')[1]!)).toContain('200 Portland Ave S');
  });

  it('only offers Street View with a location', () => {
    expect(streetViewUrl(b)).toBeNull();
    expect(mapLinks(b).map((l) => l.label)).toEqual(['Open in Google Maps']);
    const located = {
      ...b,
      location: {
        lat: 44.98,
        lng: -93.26,
        source: 'import' as const,
        precision: 'address' as const,
      },
    };
    expect(streetViewUrl(located)).toBe(
      'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=44.980000,-93.260000',
    );
    expect(mapLinks(located).map((l) => l.label)).toEqual(['Open in Google Maps', 'Street View']);
  });
});
