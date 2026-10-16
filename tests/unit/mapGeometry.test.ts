import fc from 'fast-check';
import { boundsOf, contains, distanceMeters } from '../../src/domain/geo';
import { mapLinks, googleMapsUrl, streetViewUrl } from '../../src/domain/links';
import {
  AUTO_FAN_REACH,
  centeredRect,
  estimatePinSize,
  layoutPins,
  lineEnd,
  overlaps,
  pinRect,
  placeFan,
  preferredAngle,
  grow,
  segmentHitsRect,
  segmentsCross,
  TRAY_EDGE,
  TRAY_PAD,
  STREET_ZOOM,
} from '../../src/domain/pinLayout';
import type { LayoutBuilding, Rect, Segment, Size } from '../../src/domain/pinLayout';
import { makeAddress, newBuilding } from '../../src/model/factories';

const plate: Size = { w: 60, h: 26 };
const b = (
  id: string,
  x: number,
  y: number,
  extra: Partial<LayoutBuilding> = {},
): LayoutBuilding => ({
  id,
  x,
  y,
  size: plate,
  forced: false,
  auto: false,
  keepFull: false,
  ...extra,
});

/** Every rectangle the layout drew in full: collapsed pins and fan plates. */
function drawn(bs: LayoutBuilding[], l: ReturnType<typeof layoutPins>): Rect[] {
  const out: Rect[] = [];
  for (const x of bs) {
    const fan = l.fans.get(x.id);
    if (fan)
      fan.forEach(([dx, dy], i) => out.push(centeredRect(x.x + dx, x.y + dy, x.unitSizes![i]!)));
    else if (l.full.has(x.id)) out.push(pinRect(x.x, x.y, x.size));
  }
  return out;
}

describe('layoutPins: plates and dots', () => {
  it('shows every pin in full when shrinking is off, at any zoom', () => {
    const bs = [b('a', 0, 0), b('b', 1, 1)];
    expect(layoutPins(bs, { zoom: 4, shrink: false }).full).toEqual(new Set(['a', 'b']));
  });

  it('shows only the selected pin in full below street zoom', () => {
    const bs = [b('a', 0, 0), b('b', 500, 500, { keepFull: true })];
    expect(layoutPins(bs, { zoom: STREET_ZOOM - 0.5, shrink: true }).full).toEqual(new Set(['b']));
  });

  it('shrinks the later pin of an overlapping pair, and keeps the selected one', () => {
    const bs = [b('cheap', 100, 100), b('pricey', 120, 105), b('far', 400, 400)];
    expect(layoutPins(bs, { zoom: 15, shrink: true }).full).toEqual(new Set(['cheap', 'far']));
    const sel = [b('cheap', 100, 100), b('selected', 110, 100, { keepFull: true })];
    expect(layoutPins(sel, { zoom: 15, shrink: true }).full).toEqual(new Set(['selected']));
  });
});

describe('layoutPins: fans', () => {
  const units = (n: number, w = 150, h = 84): Size[] => Array.from({ length: n }, () => ({ w, h }));

  it('places a fan you opened without plates covering each other or the hub', () => {
    const big = b('big', 400, 400, { forced: true, unitSizes: units(5) });
    const l = layoutPins([big], { zoom: 16, shrink: true });
    const rects = drawn([big], l);
    expect(rects).toHaveLength(5);
    for (let i = 0; i < rects.length; i++) {
      expect(overlaps(rects[i]!, { left: 387, right: 413, top: 387, bottom: 413 }, 0)).toBe(false);
      for (let j = i + 1; j < rects.length; j++)
        expect(overlaps(rects[i]!, rects[j]!, 0)).toBe(false);
    }
    // The first (cheapest) unit sits straight above the building
    const [dx, dy] = l.fans.get('big')![0]!;
    expect(dx).toBe(0);
    expect(dy).toBeLessThan(0);
  });

  it('keeps two open fans clear of each other', () => {
    const bs = [
      b('a', 300, 300, { forced: true, unitSizes: units(4, 120, 30) }),
      b('b', 380, 320, { forced: true, unitSizes: units(4, 120, 30) }),
    ];
    const rects = drawn(bs, layoutPins(bs, { zoom: 16, shrink: true }));
    expect(rects).toHaveLength(8);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(overlaps(rects[i]!, rects[j]!, 0)).toBe(false);
  });

  it('opens an automatic fan only if every unit fits nearby', () => {
    const roomy = [b('a', 300, 300, { auto: true, unitSizes: units(3, 80, 30) })];
    expect(layoutPins(roomy, { zoom: 16, shrink: true }).autoOpen).toEqual(['a']);
    // A fan already open next door leaves no room for a big one within reach
    const crowded = [
      b('open', 300, 300, { forced: true, unitSizes: units(12, 140, 40) }),
      b('auto', 330, 310, { auto: true, unitSizes: units(12, 140, 40) }),
    ];
    const l = layoutPins(crowded, { zoom: 16, shrink: true });
    expect(l.fans.has('open')).toBe(true);
    expect(l.autoOpen).toEqual([]);
    expect(AUTO_FAN_REACH).toBeLessThan(400);
  });

  it('prefers spots on screen', () => {
    const edge = b('edge', 30, 30, { forced: true, unitSizes: units(2, 80, 30) });
    const l = layoutPins([edge], { zoom: 16, shrink: true, view: { w: 800, h: 600 } });
    for (const r of drawn([edge], l)) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('never lets drawn plates overlap, whatever the buildings', () => {
    const arb = fc.array(
      fc.record({
        x: fc.integer({ min: 0, max: 600 }),
        y: fc.integer({ min: 0, max: 600 }),
        n: fc.integer({ min: 1, max: 6 }),
        open: fc.boolean(),
      }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(arb, (spec) => {
        const bs = spec.map((s, i) =>
          b(String(i), s.x, s.y, {
            auto: s.n > 1 && !s.open,
            forced: s.n > 1 && s.open,
            unitSizes: s.n > 1 ? units(s.n, 90, 28) : undefined,
          }),
        );
        // Forced fans may have to overlap when there's truly no room; check the others.
        const l = layoutPins(bs, { zoom: 16, shrink: true });
        const rects = drawn(
          bs.filter((x) => !x.forced),
          l,
        );
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++)
            expect(overlaps(rects[i]!, rects[j]!, 0)).toBe(false);
      }),
      { numRuns: 60 },
    );
  });

  it('places plates one at a time and reports when strict placement fails', () => {
    const placed: Rect[] = [{ left: -1000, right: 1000, top: -1000, bottom: 1000 }];
    expect(placeFan([0, 0], units(1), placed, { reach: 100, strict: true })).toBeNull();
    expect(placed).toHaveLength(1);
  });

  it('grows fans away from each other, still leaning up', () => {
    expect(preferredAngle([100, 100], [])).toBeCloseTo(-Math.PI / 2);
    // A fan to the right pushes this one left (and a little up)
    const a = preferredAngle([100, 100], [[200, 100]]);
    expect(Math.cos(a)).toBeLessThan(-0.8);
    expect(Math.sin(a)).toBeLessThan(0);
    // Two neighboring fans' plates end up on opposite sides of each other
    const bs = [
      b('left', 300, 300, { forced: true, unitSizes: units(3, 100, 30) }),
      b('right', 420, 300, { forced: true, unitSizes: units(3, 100, 30) }),
    ];
    const l = layoutPins(bs, { zoom: 16, shrink: true });
    const meanX = (id: string) => {
      const c = l.fans.get(id)!;
      return c.reduce((n, [x]) => n + x, 0) / c.length;
    };
    expect(meanX('left')).toBeLessThan(0);
    expect(meanX('right')).toBeGreaterThan(0);
  });

  it('keeps trays of different buildings apart, and lines off other plates', () => {
    const bs = [
      b('a', 300, 300, { forced: true, unitSizes: units(4, 110, 30) }),
      b('b', 400, 330, { forced: true, unitSizes: units(4, 110, 30) }),
      b('c', 340, 420, { forced: true, unitSizes: units(3, 110, 30) }),
    ];
    const l = layoutPins(bs, { zoom: 16, shrink: true, view: { w: 1200, h: 900 } });
    const reach = TRAY_PAD + TRAY_EDGE;
    const trays = bs.map((x) =>
      l.fans.get(x.id)!.map(([dx, dy], i) => ({
        rect: grow(centeredRect(x.x + dx, x.y + dy, x.unitSizes![i]!), reach),
        line: [[x.x, x.y], lineEnd([x.x, x.y], [x.x + dx, x.y + dy], x.unitSizes![i]!)] as Segment,
      })),
    );
    for (let i = 0; i < trays.length; i++)
      for (let j = 0; j < trays.length; j++) {
        if (i === j) continue;
        for (const p of trays[i]!)
          for (const q of trays[j]!) {
            if (i < j) expect(overlaps(p.rect, q.rect, 0)).toBe(false);
            expect(segmentHitsRect(p.line[0], p.line[1], q.rect)).toBe(false);
            expect(segmentsCross(p.line[0], p.line[1], q.line[0], q.line[1])).toBe(false);
          }
      }
  });

  it('never covers another open fan’s center', () => {
    const bs = [
      b('first', 300, 300, { forced: true, unitSizes: units(6, 140, 80) }),
      b('second', 380, 250, { forced: true, unitSizes: units(4, 140, 80) }),
    ];
    const l = layoutPins(bs, { zoom: 16, shrink: true, view: { w: 1400, h: 1000 } });
    const hub2 = { left: 380 - 14, right: 380 + 14, top: 250 - 14, bottom: 250 + 14 };
    l.fans
      .get('first')!
      .forEach(([dx, dy], i) =>
        expect(overlaps(centeredRect(300 + dx, 300 + dy, bs[0]!.unitSizes![i]!), hub2, 0)).toBe(
          false,
        ),
      );
  });

  it('tells when two segments cross', () => {
    expect(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsCross([0, 0], [10, 0], [0, 5], [10, 5])).toBe(false);
    expect(segmentsCross([0, 0], [10, 10], [10, 10], [20, 0])).toBe(false); // shared end
  });

  it('tells when a segment crosses a rectangle', () => {
    const r = { left: 0, right: 10, top: 0, bottom: 10 };
    expect(segmentHitsRect([-5, 5], [15, 5], r)).toBe(true);
    expect(segmentHitsRect([-5, -5], [-1, 20], r)).toBe(false);
    expect(segmentHitsRect([5, 5], [6, 6], r)).toBe(true);
    expect(segmentHitsRect([20, 0], [30, 10], r)).toBe(false);
  });

  it('joins a plate to its hub at the plate’s nearest edge', () => {
    expect(lineEnd([0, 0], [0, -60], { w: 80, h: 30 })).toEqual([0, -45]);
    expect(lineEnd([0, 0], [100, 0], { w: 80, h: 30 })).toEqual([60, 0]);
  });
});

describe('estimatePinSize', () => {
  it('grows with text and extras, and is small for dots', () => {
    const one = estimatePinSize('plate', ['$1,650'], { icon: false, count: false, tag: false });
    const more = estimatePinSize('plate', ['$1,650', '1 bd · 720 ft²'], {
      icon: true,
      count: true,
      tag: true,
    });
    expect(more.w).toBeGreaterThan(one.w);
    expect(estimatePinSize('dot', ['x'], { icon: true, count: true, tag: true }).w).toBe(24);
    expect(estimatePinSize('photo', ['$1,650'], { icon: false, count: false, tag: false }).h).toBe(
      82,
    );
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
