import type { PinStyle } from './pinPrefs';

/**
 * Where pins go on screen (PLAN.md §4.3, DESIGN.md §2.4). Pure: positions are screen
 * pixels supplied by the map, sizes are measured from the real pins and cards.
 *  - Bubbles (if on): at zoom 10 and below, nearby buildings merge into one count.
 *  - Cards (owner review 4): an open building shows one card listing its units, joined to
 *    its marker by a short line. A card never covers another card, pin, marker or dot, its
 *    line never crosses another card or line, and there is always a gap for the line to
 *    show. A card you opened always opens, off screen if it must; an automatic one (zoom
 *    15 and up) opens only if it fits next to its building, on screen. Cards keep their
 *    spot while it stays free, so they don't jump around as you pan.
 *  - Dots (if "shrink" is on): below zoom 11 every pin is a dot; from 11 up, a pin is a dot
 *    where it would overlap something or cover another building's point. The selected pin
 *    always shows in full.
 * Hovering never changes the layout (the map shows a preview over the dot instead), so the
 * pins under the pointer can't flicker.
 */

/** Below this zoom every pin is a dot when shrinking is on. */
export const STREET_ZOOM = 11;
/** At or below this (whole) zoom nearby buildings merge into bubbles, when that's on. */
export const CLUSTER_MAX_ZOOM = 10;
/** From this zoom up, buildings fan out by themselves where they have room ("Fan out"). */
export const AUTO_FAN_ZOOM = 15;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Point = [number, number];

export const PLATE_H = 26;
/** The larger photo beside a card row or single photo pin, and its spacing (DESIGN.md §2.4). */
export const PHOTO_PREVIEW = { w: 280, h: 200, gap: 10, margin: 8 } as const;
export const TAIL = 7;

/** Rough size of a full pin before it has been measured (plate only, no tail). */
export function estimatePinSize(
  style: PinStyle,
  texts: readonly string[],
  extras: { icon: boolean; count: boolean; tag: boolean },
): Size {
  if (style === 'dot') return { w: 24, h: 24 };
  const chars = texts.reduce((n, t) => n + t.length, 0);
  let textW = chars * 7.6 + Math.max(0, texts.length - 1) * 15; // dividers
  if (extras.icon) textW += 20;
  if (extras.count) textW += 24;
  if (extras.tag) textW += 12;
  if (style === 'photo') {
    const w = Math.max(54, Math.ceil(texts.length ? textW + 14 : 54));
    return { w, h: texts.length ? 82 : 60 };
  }
  return { w: Math.ceil(Math.max(30, 24 + textW)), h: PLATE_H };
}

/** A collapsed pin: centered horizontally on its point, its tail touching it. */
export function pinRect(x: number, y: number, s: Size): Rect {
  return { left: x - s.w / 2, right: x + s.w / 2, top: y - s.h - TAIL, bottom: y };
}

/** A rectangle of size `s` centered on a point. */
export function centeredRect(x: number, y: number, s: Size): Rect {
  return { left: x - s.w / 2, right: x + s.w / 2, top: y - s.h / 2, bottom: y + s.h / 2 };
}

const around = (x: number, y: number, r: number): Rect => ({
  left: x - r,
  right: x + r,
  top: y - r,
  bottom: y + r,
});

export function overlaps(a: Rect, b: Rect, gap = 2): boolean {
  return (
    a.left < b.right + gap &&
    b.left < a.right + gap &&
    a.top < b.bottom + gap &&
    b.top < a.bottom + gap
  );
}

const inside = (r: Rect, view: Size, margin: number) =>
  r.left >= margin && r.top >= margin && r.right <= view.w - margin && r.bottom <= view.h - margin;

/** The point of a rectangle nearest to `p` (`p` itself when inside). */
export function nearestPoint(p: Point, r: Rect): Point {
  return [Math.min(Math.max(p[0], r.left), r.right), Math.min(Math.max(p[1], r.top), r.bottom)];
}

const distanceTo = (p: Point, r: Rect) => {
  const [x, y] = nearestPoint(p, r);
  return Math.hypot(x - p[0], y - p[1]);
};

/** A rectangle grown by `d` on every side. */
export const grow = (r: Rect, d: number): Rect => ({
  left: r.left - d,
  right: r.right + d,
  top: r.top - d,
  bottom: r.bottom + d,
});

/** Whether segments a–b and c–d cross (touching at a shared end doesn't count). */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether the segment a–b passes through the rectangle (Liang–Barsky clipping). */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - r.left],
    [dx, r.right - a[0]],
    [-dy, a[1] - r.top],
    [dy, r.bottom - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

// ── Cards ──────────────────────────────────────────────────────────────────

export type Segment = [Point, Point];

/** Radius of an open building's marker (the ring at its point). */
export const MARKER_R = 11;
/** Closest a card comes to its marker's center, so a stretch of line always shows. */
export const CARD_GAP = 32;
/** An automatic card opens only if it fits this close to its building, on screen. */
export const AUTO_CARD_REACH = 150;
/** Space kept between a card and anything else. */
const CARD_SPACE = 6;
/**
 * Clearance around other buildings' points, for cards and lines: their dot or marker, and
 * up and to the right, the New tag a dot can carry.
 */
const POINT_KEEP = { left: 12, right: 28, top: 22, bottom: 12 };
/** A card you opened looks for a spot on screen this close first, then anywhere. */
const ON_SCREEN_REACH = 360;
const MAX_REACH = 5000;
/** Pixels of extra distance a card accepts per radian it turns from the preferred side. */
const TURN_COST = 30;
const SCREEN_MARGIN = 6;

const UP = -Math.PI / 2;

/** Where an open building's card sits, relative to the building's point. */
export interface Card {
  left: number;
  top: number;
  /** Where the line from the marker meets the card (its nearest edge point). */
  end: Point;
}

/** Angles to try, nearest to `prefer` first (straight up by default), every 15°. */
export function anglesFrom(prefer = UP): number[] {
  const step = Math.PI / 12;
  const out = [prefer];
  for (let d = step; d <= Math.PI + 1e-9; d += step) {
    out.push(prefer + d);
    if (d < Math.PI - 1e-9) out.push(prefer - d);
  }
  return out;
}

/**
 * The direction a card should go: up, unless other open buildings are nearby, then away
 * from them (still leaning up).
 */
export function preferredAngle(hub: Point, others: readonly Point[], near = 360): number {
  let vx = 0;
  let vy = -0.35; // a lean upward
  for (const [x, y] of others) {
    const dx = hub[0] - x;
    const dy = hub[1] - y;
    const d = Math.hypot(dx, dy);
    if (d < 1 || d > near) continue;
    const w = (near - d) / near; // closer buildings push harder
    vx += (dx / d) * w;
    vy += (dy / d) * w;
  }
  return Math.atan2(vy, vx);
}

/**
 * A card of `size` in direction `angle` from the hub (at 0,0), centered on that ray, with
 * its nearest edge `dist` away.
 */
export function cardAt(size: Size, angle: number, dist: number): Rect {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const gapAt = (t: number) =>
    Math.hypot(
      Math.max(Math.abs(t * ux) - size.w / 2, 0),
      Math.max(Math.abs(t * uy) - size.h / 2, 0),
    );
  let lo = 0;
  let hi = dist + size.w + size.h;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (gapAt(mid) < dist) lo = mid;
    else hi = mid;
  }
  return centeredRect(Math.round(hi * ux), Math.round(hi * uy), size);
}

const shift = (r: Rect, [x, y]: Point): Rect => ({
  left: r.left + x,
  right: r.right + x,
  top: r.top + y,
  bottom: r.bottom + y,
});

/** What cards placed so far take up (shared between cards, extended by each). */
export interface CardContext {
  /** Cards, pins and the map's own controls. */
  placed: Rect[];
  /** Every building's point on screen (dots, pins and markers sit there). */
  points: readonly Point[];
  /** Lines of cards already placed. */
  segments: Segment[];
}

/**
 * Finds the nearest free spot for a building's card. Returns null when `strict` (an
 * automatic card) and nothing fits close by on screen; nothing is added then.
 */
export function placeCard(
  hub: Point,
  size: Size,
  ctx: CardContext,
  opts: {
    strict: boolean;
    view?: Size;
    prefer?: number;
    /** Where the card was last time (relative to the hub): kept while still free. */
    prev?: { left: number; top: number };
  },
): Card | null {
  const others = ctx.points
    .filter(([x, y]) => Math.hypot(x - hub[0], y - hub[1]) > 0.5)
    .map(([x, y]) => ({
      left: x - POINT_KEEP.left,
      right: x + POINT_KEEP.right,
      top: y - POINT_KEEP.top,
      bottom: y + POINT_KEEP.bottom,
    }));

  /** Whether the card at `r` (screen coordinates) and its line keep clear of everything. */
  const free = (r: Rect, onScreen: boolean, lineRules: boolean): Point | null => {
    if (onScreen && opts.view && !inside(r, opts.view, SCREEN_MARGIN)) return null;
    if (distanceTo(hub, r) < CARD_GAP - 1) return null;
    if (ctx.placed.some((p) => overlaps(p, r, CARD_SPACE))) return null;
    if (others.some((p) => overlaps(p, r, 0))) return null;
    const end = nearestPoint(hub, r);
    if (!lineRules) return end;
    if (ctx.segments.some(([a, b]) => segmentHitsRect(a, b, grow(r, 3)))) return null;
    if (ctx.placed.some((p) => segmentHitsRect(hub, end, p))) return null;
    if (others.some((p) => segmentHitsRect(hub, end, p))) return null;
    if (ctx.segments.some(([a, b]) => segmentsCross(hub, end, a, b))) return null;
    return end;
  };

  const take = (r: Rect, end: Point): Card => {
    ctx.placed.push(r);
    ctx.segments.push([hub, end]);
    return { left: r.left - hub[0], top: r.top - hub[1], end: [end[0] - hub[0], end[1] - hub[1]] };
  };

  // Keep last time's spot while it's still free (and on screen, for an automatic card)
  if (opts.prev) {
    const r = shift(
      {
        left: opts.prev.left,
        top: opts.prev.top,
        right: opts.prev.left + size.w,
        bottom: opts.prev.top + size.h,
      },
      hub,
    );
    const end = free(r, opts.strict, true);
    if (end) return take(r, end);
  }

  const prefer = opts.prefer ?? UP;
  const angles = anglesFrom(prefer);
  /** The cheapest free spot within `reach`: distance plus a cost for turning away. */
  const search = (reach: number, onScreen: boolean, lineRules: boolean) => {
    let best: { r: Rect; end: Point } | null = null;
    let bestCost = Infinity;
    for (let d = CARD_GAP; d <= reach && d < bestCost; d += d < 200 ? 6 : Math.round(d * 0.04)) {
      for (const a of angles) {
        const cost = d + TURN_COST * Math.abs(a - prefer);
        if (cost >= bestCost) continue;
        const r = shift(cardAt(size, a, d), hub);
        const end = free(r, onScreen, lineRules);
        if (end) {
          best = { r, end };
          bestCost = cost;
        }
      }
    }
    return best;
  };

  // In order: close by on screen; then anywhere, off screen if need be (a card you opened);
  // then, only if truly boxed in, letting its line cross something.
  const found = opts.strict
    ? search(AUTO_CARD_REACH, true, true)
    : (search(ON_SCREEN_REACH, true, true) ??
      search(MAX_REACH, false, true) ??
      search(MAX_REACH, false, false));
  if (found) return take(found.r, found.end);
  if (opts.strict) return null;
  const r = shift(cardAt(size, prefer, CARD_GAP), hub);
  return take(r, nearestPoint(hub, r));
}

// ── The whole layout ───────────────────────────────────────────────────────

export interface LayoutBuilding {
  id: string;
  x: number;
  y: number;
  /** Its collapsed (or single-unit) pin, measured. */
  size: Size;
  /** Its card, when it can open (a building with several units). */
  cardSize?: Size;
  /** Open regardless (clicked, or holds the selected unit). */
  forced: boolean;
  /** May open by itself (automatic opening on, zoomed in, not closed by hand). */
  auto: boolean;
  /** Always drawn in full (the selected pin). */
  keepFull: boolean;
  /** Cards you opened are placed in the order you opened them. */
  order?: number;
  /** Where its card was in the last layout, relative to its point. */
  prev?: { left: number; top: number };
}

export interface Layout {
  /** Open buildings' cards, relative to the building's point. */
  cards: Map<string, Card>;
  /** Collapsed pins drawn in full; the rest are dots. */
  full: Set<string>;
  /** Cards that opened by themselves. */
  autoOpen: string[];
}

/**
 * Lays out the pins in view. `buildings` come in priority order (cheapest first): earlier
 * ones get their plate first.
 */
export function layoutPins(
  buildings: readonly LayoutBuilding[],
  opts: {
    zoom: number;
    shrink: boolean;
    view?: Size;
    /** Screen areas covered by the map's own controls (buttons, legend, notes). */
    reserved?: readonly Rect[];
  },
): Layout {
  const ctx: CardContext = {
    placed: [...(opts.reserved ?? [])],
    points: buildings.map((b) => [b.x, b.y] as Point),
    segments: [],
  };
  const cards = new Map<string, Card>();
  const full = new Set<string>();
  const autoOpen: string[] = [];
  const hubOf = (b: LayoutBuilding): Point => [b.x, b.y];

  // 1. The selected pin, when it's a single or collapsed one
  for (const b of buildings)
    if (b.keepFull && !b.forced) {
      ctx.placed.push(pinRect(b.x, b.y, b.size));
      full.add(b.id);
    }

  // 2. Without shrinking, every pin shows in full, so cards make room for them
  if (!opts.shrink)
    for (const b of buildings)
      if (!b.forced && !b.auto && !full.has(b.id)) ctx.placed.push(pinRect(b.x, b.y, b.size));

  // 3. Cards you opened (and the one holding the selected unit) always open, in the order
  // you opened them, each leaning away from the other open ones
  const forced = buildings
    .filter((b) => b.forced && b.cardSize)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const forcedHubs = forced.map(hubOf);
  for (const b of forced) {
    const card = placeCard(hubOf(b), b.cardSize as Size, ctx, {
      strict: false,
      view: opts.view,
      prefer: preferredAngle(hubOf(b), forcedHubs),
      prev: b.prev,
    });
    if (card) cards.set(b.id, card);
  }

  // 4. Automatic cards, only where they fit next to their building
  for (const b of buildings) {
    if (!b.auto || b.forced || !b.cardSize || cards.has(b.id)) continue;
    const open = [...cards.keys()].map((id) => hubOf(buildings.find((x) => x.id === id)!));
    const card = placeCard(hubOf(b), b.cardSize, ctx, {
      strict: true,
      view: opts.view,
      prefer: preferredAngle(hubOf(b), open),
      prev: b.prev,
    });
    if (card) {
      cards.set(b.id, card);
      autoOpen.push(b.id);
    }
  }

  // 5. Everything else: in full where it fits, a dot where it doesn't. A pin that would
  // cover another building's point shrinks too, so no dot hides under a plate.
  const pointRects = buildings.map((b) => ({ id: b.id, r: around(b.x, b.y, 4) }));
  for (const b of buildings) {
    if (cards.has(b.id) || full.has(b.id)) continue;
    const rect = pinRect(b.x, b.y, b.size);
    const fits =
      !ctx.placed.some((p) => overlaps(p, rect)) &&
      !ctx.segments.some(([a, c]) => segmentHitsRect(a, c, grow(rect, 2))) &&
      !pointRects.some((p) => p.id !== b.id && overlaps(p.r, rect, 0));
    if (!opts.shrink || b.keepFull || (opts.zoom >= STREET_ZOOM && fits)) {
      ctx.placed.push(rect);
      full.add(b.id);
    }
  }
  return { cards, full, autoOpen };
}
