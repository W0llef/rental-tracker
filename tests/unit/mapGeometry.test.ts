import fc from 'fast-check';
import { boundsOf, contains, distanceMeters } from '../../src/domain/geo';
import { mapLinks, googleMapsUrl, streetViewUrl } from '../../src/domain/links';
import {
  AUTO_CARD_REACH,
  CARD_GAP,
  cardAt,
  estimatePinSize,
  layoutPins,
  nearestPoint,
  overlaps,
  pinRect,
  placeCard,
  preferredAngle,
  segmentHitsRect,
  segmentsCross,
  STREET_ZOOM,
} from '../../src/domain/pinLayout';
import type { LayoutBuilding, Point, Rect, Segment, Size } from '../../src/domain/pinLayout';
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

const card = (n: number, w = 190): Size => ({ w, h: 30 + n * 32 });

type Drawn = { id: string; rect: Rect; card: boolean; line?: Segment };

/** Everything the layout drew in full: cards (with their lines) and collapsed pins. */
function drawn(bs: LayoutBuilding[], l: ReturnType<typeof layoutPins>): Drawn[] {
  const out: Drawn[] = [];
  for (const x of bs) {
    const c = l.cards.get(x.id);
    if (c) {
      const s = x.cardSize!;
      const rect = {
        left: x.x + c.left,
        top: x.y + c.top,
        right: x.x + c.left + s.w,
        bottom: x.y + c.top + s.h,
      };
      out.push({
        id: x.id,
        rect,
        card: true,
        line: [
          [x.x, x.y],
          [x.x + c.end[0], x.y + c.end[1]],
        ],
      });
    } else if (l.full.has(x.id))
      out.push({ id: x.id, rect: pinRect(x.x, x.y, x.size), card: false });
  }
  return out;
}

const around = ([x, y]: Point, r: number): Rect => ({
  left: x - r,
  right: x + r,
  top: y - r,
  bottom: y + r,
});

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

  it('shrinks a pin that would cover another building’s dot', () => {
    // "pricey" sits right under where "cheap"'s plate would go
    const bs = [b('cheap', 100, 100), b('pricey', 100, 80)];
    const full = layoutPins(bs, { zoom: 15, shrink: true }).full;
    expect(full.has('cheap')).toBe(false);
    expect(full.has('pricey')).toBe(true);
  });
});

describe('layoutPins: cards', () => {
  const view = { w: 1200, h: 800 };

  it('opens a card you opened next to its building, with a gap for the line', () => {
    const x = b('big', 400, 400, { forced: true, cardSize: card(5) });
    const l = layoutPins([x], { zoom: 16, shrink: true, view });
    const [d] = drawn([x], l);
    const gap = Math.hypot(...([d!.line![1][0] - 400, d!.line![1][1] - 400] as [number, number]));
    expect(gap).toBeGreaterThanOrEqual(CARD_GAP - 1);
    expect(gap).toBeLessThan(CARD_GAP + 10);
    // Straight above by default
    expect(d!.rect.bottom).toBeLessThan(400);
    // The line ends on the card's edge
    expect(nearestPoint([400, 400], d!.rect)).toEqual(d!.line![1]);
  });

  it('never covers another building’s point, pin or card, and lines cross nothing', () => {
    const bs = [
      b('a', 300, 300, { forced: true, cardSize: card(5), order: 0 }),
      b('b', 420, 320, { forced: true, cardSize: card(4), order: 1 }),
      b('c', 340, 430, { forced: true, cardSize: card(3), order: 2 }),
      b('d', 370, 250),
      b('e', 250, 360),
    ];
    const l = layoutPins(bs, { zoom: 16, shrink: true, view });
    const all = drawn(bs, l);
    const cards = all.filter((d) => d.card);
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      for (const o of bs)
        if (o.id !== c.id) expect(overlaps(c.rect, around([o.x, o.y], 8), 0)).toBe(false);
      for (const o of all) {
        if (o === c) continue;
        expect(overlaps(c.rect, o.rect, 0)).toBe(false);
        expect(segmentHitsRect(c.line![0], c.line![1], o.rect)).toBe(false);
        if (o.line) expect(segmentsCross(c.line![0], c.line![1], o.line[0], o.line[1])).toBe(false);
      }
    }
  });

  it('goes off screen rather than covering anything, for a card you opened', () => {
    // A building near the top-left corner with the space around it taken by controls
    const reserved = [{ left: 0, top: 0, right: 1200, bottom: 20 }];
    const x = b('corner', 40, 60, { forced: true, cardSize: card(12, 260) });
    const l = layoutPins([x], { zoom: 16, shrink: true, view: { w: 400, h: 300 }, reserved });
    expect(l.cards.has('corner')).toBe(true);
    const [d] = drawn([x], l);
    expect(overlaps(d!.rect, reserved[0]!, 0)).toBe(false);
  });

  it('opens an automatic card only if it fits close by on screen', () => {
    const roomy = [b('a', 500, 400, { auto: true, cardSize: card(3) })];
    expect(layoutPins(roomy, { zoom: 16, shrink: true, view }).autoOpen).toEqual(['a']);
    // Too big for the screen: stays a pin
    const tall = [b('a', 500, 400, { auto: true, cardSize: card(40) })];
    expect(layoutPins(tall, { zoom: 16, shrink: true, view }).autoOpen).toEqual([]);
    expect(AUTO_CARD_REACH).toBeLessThan(300);
  });

  it('keeps a card where it was while that spot is still free', () => {
    const prev = { left: 40, top: -50 };
    const x = b('a', 500, 400, { forced: true, cardSize: card(2), prev });
    const c = layoutPins([x], { zoom: 16, shrink: true, view }).cards.get('a')!;
    expect([c.left, c.top]).toEqual([40, -50]);
    // A spot that's no longer free is given up
    const blocked = [x, b('other', 560, 380)];
    const c2 = layoutPins(blocked, { zoom: 16, shrink: true, view }).cards.get('a')!;
    expect([c2.left, c2.top]).not.toEqual([40, -50]);
  });

  it('never lets cards and full pins overlap, or cards cover points, whatever the buildings', () => {
    const arb = fc.array(
      fc.record({
        x: fc.integer({ min: 0, max: 900 }),
        y: fc.integer({ min: 0, max: 700 }),
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
            cardSize: s.n > 1 ? card(s.n, 170) : undefined,
            order: i,
          }),
        );
        const l = layoutPins(bs, { zoom: 16, shrink: true, view: { w: 1000, h: 800 } });
        const all = drawn(bs, l);
        for (let i = 0; i < all.length; i++)
          for (let j = i + 1; j < all.length; j++)
            expect(overlaps(all[i]!.rect, all[j]!.rect, 0)).toBe(false);
        for (const c of all.filter((d) => d.card))
          for (const o of bs)
            if (
              o.id !== c.id &&
              (o.x !== bs.find((q) => q.id === c.id)!.x || o.y !== bs.find((q) => q.id === c.id)!.y)
            )
              expect(overlaps(c.rect, around([o.x, o.y], 6), 0)).toBe(false);
      }),
      { numRuns: 80 },
    );
  });

  it('reports when an automatic card doesn’t fit, adding nothing', () => {
    const ctx = {
      placed: [{ left: -1000, right: 1000, top: -1000, bottom: 1000 }],
      points: [],
      segments: [],
    };
    expect(placeCard([0, 0], card(1), ctx, { strict: true })).toBeNull();
    expect(ctx.placed).toHaveLength(1);
    expect(ctx.segments).toHaveLength(0);
  });

  it('turns cards away from other open buildings, still leaning up', () => {
    expect(preferredAngle([100, 100], [])).toBeCloseTo(-Math.PI / 2);
    const a = preferredAngle([100, 100], [[200, 100]]);
    expect(Math.cos(a)).toBeLessThan(-0.8);
    expect(Math.sin(a)).toBeLessThan(0);
  });

  it('puts a card’s nearest edge the asked distance away', () => {
    const r = cardAt({ w: 100, h: 40 }, 0, 30); // to the right
    expect(r.left).toBeCloseTo(30, 0);
    expect((r.top + r.bottom) / 2).toBeCloseTo(0, 0);
    const up = cardAt({ w: 100, h: 40 }, -Math.PI / 2, 30);
    expect(up.bottom).toBeCloseTo(-30, 0);
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
