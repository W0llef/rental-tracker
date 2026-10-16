import type { PinStyle } from './pinPrefs';

/**
 * Where pins go on screen (PLAN.md §4.3, DESIGN.md §2.4). Pure: positions are screen
 * pixels supplied by the map, sizes are measured from the real pins.
 *  - Bubbles (if on): at zoom 10 and below, nearby buildings merge into one count.
 *  - Fans: each unit's plate takes the nearest free spot around its building (above first,
 *    then the sides, then below), so plates never cover each other. Fans opened by clicking
 *    (or holding the selected unit) always open; automatic ones (zoom 15 and up) open only
 *    if every unit fits.
 *  - Dots (if "shrink" is on): below zoom 11 every pin is a dot; from 11 up, only pins that
 *    would overlap something already placed. The selected pin always shows in full.
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

/** A plate in a fan: centered on its spot (no tail; a leader line joins it to the hub). */
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

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Where a leader line from the hub meets a plate: the plate's nearest edge point. */
export function lineEnd(hub: Point, center: Point, s: Size): Point {
  const r = centeredRect(center[0], center[1], s);
  return [Math.min(Math.max(hub[0], r.left), r.right), Math.min(Math.max(hub[1], r.top), r.bottom)];
}

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

// ── Fans ───────────────────────────────────────────────────────────────────

/**
 * The tray drawn around a fan (DESIGN.md §2.4): its plates padded by `TRAY_PAD`, the hub
 * circle and a band of `TRAY_BAND` around each leader line, all outlined by `TRAY_EDGE`.
 */
export const TRAY_PAD = 5;
export const TRAY_BAND = 5;
export const TRAY_EDGE = 1.5;
export const TRAY_HUB = 15;
/** How far a tray reaches past its plates, plus a small gap so trays never touch. */
const TRAY_SPACE = 2 * (TRAY_PAD + TRAY_EDGE) + 2 - 4; // minus GAP, added by the check
/** How close another plate may come to a leader line (its tray band, the plate's tray, a gap). */
const BAND_SPACE = TRAY_BAND + TRAY_EDGE + TRAY_PAD + TRAY_EDGE + 2;

export type Segment = [Point, Point];

const HUB_R = 13;
/** How far other fans' lines stay from a fan's center. */
const HUB_KEEP_OUT = 40;
/** Pixels of extra distance a plate accepts per radian it turns from the preferred side. */
const TURN_COST = 40;
const GAP = 4;
const R_START = 40;
const R_STEP = 10;
/** How far an automatic fan may spread before it gives up and stays collapsed. */
export const AUTO_FAN_REACH = 190;
/** How far a fan you opened may spread looking for free spots. */
const FORCED_REACH = 420;

const UP = -Math.PI / 2;

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
 * The direction a fan should grow: up, unless other open fans are nearby, then away from
 * them (still leaning up), so each fan's plates stay together.
 */
export function preferredAngle(hub: Point, others: readonly Point[], near = 360): number {
  let vx = 0;
  let vy = -0.35; // a lean upward
  for (const [x, y] of others) {
    const dx = hub[0] - x;
    const dy = hub[1] - y;
    const d = Math.hypot(dx, dy);
    if (d < 1 || d > near) continue;
    const w = (near - d) / near; // closer fans push harder
    vx += (dx / d) * w;
    vy += (dy / d) * w;
  }
  return Math.atan2(vy, vx);
}

/**
 * Finds a spot for each plate around the hub, in order, avoiding everything in `placed`
 * (which it extends) and, when it can, the other buildings' points and the screen edge.
 * Returns plate centers relative to the hub, or null when `strict` and a plate didn't fit
 * within `reach` (nothing is added to `placed` then).
 */
export function placeFan(
  hub: Point,
  sizes: readonly Size[],
  placed: Rect[],
  opts: {
    reach: number;
    strict: boolean;
    points?: readonly Point[];
    view?: Size;
    /** Direction to try first (radians, screen coordinates); straight up by default. */
    prefer?: number;
    /** Leader lines of fans already placed (shared, extended here). */
    segments?: Segment[];
    /** Other open fans' centers: lines keep a little way off them, so no fan is boxed in. */
    hubs?: readonly Point[];
  },
): Point[] | null {
  const local: Rect[] = [around(hub[0], hub[1], HUB_R)];
  const lines: Segment[] = [];
  const prefer = opts.prefer ?? UP;
  const angles = anglesFrom(prefer);
  const centers: Point[] = [];
  const pts = (opts.points ?? []).map(([x, y]) => around(x, y, 8));
  const others = opts.segments ?? [];
  const blocked = (r: Rect) =>
    placed.some((p) => overlaps(p, r, GAP)) ||
    local.some((p) => overlaps(p, r, GAP)) ||
    others.some(([a, b]) => segmentHitsRect(a, b, grow(r, BAND_SPACE)));
  /** The line to this plate would cross another plate, tray or line (its own included). */
  const lineCrosses = (end: Point) =>
    placed.some((p) => segmentHitsRect(hub, end, p)) ||
    local.slice(1).some((p) => segmentHitsRect(hub, end, grow(p, TRAY_PAD))) ||
    others.some(([a, b]) => segmentsCross(hub, end, a, b)) ||
    (opts.hubs ?? []).some(([x, y]) => segmentHitsRect(hub, end, around(x, y, HUB_KEEP_OUT)));

  for (const size of sizes) {
    let best: { c: Point; r: Rect } | null = null;
    // Each pass takes the cheapest spot: distance from the hub plus a cost for turning away
    // from the preferred direction, so a fan keeps to its side. Passes relax in order:
    //  1. free, on screen, off other buildings' points, its line crossing nothing
    //  2. the same, but it may cover another building's point
    //  3. free and its line crossing nothing, even partly off screen (a fan you opened)
    //  4. just free
    // Plates move farther out before a line is allowed to cut through another building.
    for (const pass of [1, 2, 3, 4] as const) {
      let bestCost = Infinity;
      for (let rad = R_START; rad <= opts.reach && rad < bestCost; rad += R_STEP) {
        for (const a of angles) {
          const cost = rad + TURN_COST * Math.abs(a - prefer);
          if (cost >= bestCost) continue;
          const c: Point = [
            Math.round(hub[0] + rad * Math.cos(a)),
            Math.round(hub[1] + rad * Math.sin(a)),
          ];
          const r = centeredRect(c[0], c[1], size);
          if (blocked(r)) continue;
          // Automatic fans must always fit fully on screen
          if ((pass <= 2 || opts.strict) && opts.view && !inside(r, opts.view, 4)) continue;
          if (pass === 1 && pts.some((p) => overlaps(p, r, 0))) continue;
          if (pass <= 3 && lineCrosses(lineEnd(hub, c, size))) continue;
          best = { c, r };
          bestCost = cost;
        }
      }
      if (best) break;
    }
    if (!best) {
      if (opts.strict) return null;
      // A fan you opened always opens: take the spot that covers the least.
      let least = Infinity;
      for (let rad = R_START; rad <= FORCED_REACH; rad += R_STEP * 2)
        for (const a of angles) {
          const c: Point = [
            Math.round(hub[0] + rad * Math.cos(a)),
            Math.round(hub[1] + rad * Math.sin(a)),
          ];
          const r = centeredRect(c[0], c[1], size);
          const cover = [...placed, ...local].reduce((n, p) => n + overlapArea(p, r), 0);
          if (cover < least) {
            least = cover;
            best = { c, r };
          }
        }
    }
    const chosen = best as { c: Point; r: Rect };
    local.push(chosen.r);
    lines.push([hub, lineEnd(hub, chosen.c, size)]);
    centers.push([chosen.c[0] - hub[0], chosen.c[1] - hub[1]]);
  }
  // Others keep clear of the whole tray: its plates (grown by the tray) and its lines
  placed.push(...local.map((r) => grow(r, TRAY_SPACE)));
  others.push(...lines);
  return centers;
}

// ── The whole layout ───────────────────────────────────────────────────────

export interface LayoutBuilding {
  id: string;
  x: number;
  y: number;
  /** Its collapsed (or single-unit) pin, measured. */
  size: Size;
  /** Plates of its units in fan order, when it can fan out. */
  unitSizes?: Size[];
  /** Open regardless (clicked, or holds the selected unit). */
  forced: boolean;
  /** May open by itself (automatic fan-out on, zoomed in, not folded by hand). */
  auto: boolean;
  /** Always drawn in full (the selected pin). */
  keepFull: boolean;
}

export interface Layout {
  /** Fanned buildings: each unit's plate center, relative to the building's point. */
  fans: Map<string, Point[]>;
  /** Collapsed pins drawn in full; the rest are dots. */
  full: Set<string>;
  /** Fans that opened by themselves. */
  autoOpen: string[];
}

/**
 * Lays out the pins in view. `buildings` come in priority order (cheapest first): earlier
 * ones get their plate and their fan first.
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
  const placed: Rect[] = [...(opts.reserved ?? [])];
  const fans = new Map<string, Point[]>();
  const full = new Set<string>();
  const autoOpen: string[] = [];
  const points: Point[] = buildings.map((b) => [b.x, b.y]);
  const segments: Segment[] = [];
  const pointsBut = (id: string) => points.filter((_, i) => buildings[i]?.id !== id);

  // 1. The selected pin, when it's a single or collapsed one
  for (const b of buildings)
    if (b.keepFull && !b.forced) {
      placed.push(pinRect(b.x, b.y, b.size));
      full.add(b.id);
    }

  // 2. Fans you opened (and the one holding the selected unit) always open, each growing
  // away from the other open ones
  const forcedHubs = buildings
    .filter((b) => b.forced && b.unitSizes)
    .map((b) => [b.x, b.y] as Point);
  // Every open fan's center is taken before any plates go down, so an earlier fan's
  // plates can't cover a later fan's hub
  const hubKeep = (h: Point) => around(h[0], h[1], TRAY_HUB + TRAY_EDGE + 2);
  const hubRects = forcedHubs.map(hubKeep);
  placed.push(...hubRects);
  for (const b of buildings) {
    if (!b.forced || !b.unitSizes) continue;
    const hub: Point = [b.x, b.y];
    // Its own reserved center mustn't count against its own lines
    const own = placed.findIndex((r) => r.left === hubKeep(hub).left && r.top === hubKeep(hub).top);
    if (own >= 0) placed.splice(own, 1);
    const c = placeFan(hub, b.unitSizes, placed, {
      reach: FORCED_REACH,
      strict: false,
      points: pointsBut(b.id),
      view: opts.view,
      prefer: preferredAngle(hub, forcedHubs),
      segments,
      hubs: forcedHubs.filter(([x, y]) => x !== hub[0] || y !== hub[1]),
    });
    if (c) fans.set(b.id, c);
  }

  // 3. Automatic fans, only where every unit fits
  for (const b of buildings) {
    if (!b.auto || b.forced || !b.unitSizes || fans.has(b.id)) continue;
    // Its own collapsed pin isn't drawn when it fans out, but other plates must not cover
    // the point, so the hub reserves it.
    const hub: Point = [b.x, b.y];
    const c = placeFan(hub, b.unitSizes, placed, {
      reach: AUTO_FAN_REACH,
      strict: true,
      points: pointsBut(b.id),
      view: opts.view,
      prefer: preferredAngle(
        hub,
        [...fans.keys()].map((id) => {
          const o = buildings.find((x) => x.id === id)!;
          return [o.x, o.y] as Point;
        }),
      ),
      segments,
    });
    if (c) {
      fans.set(b.id, c);
      autoOpen.push(b.id);
    }
  }

  // 4. Everything else: in full where it fits, a dot where it doesn't
  for (const b of buildings) {
    if (fans.has(b.id) || full.has(b.id)) continue;
    const rect = pinRect(b.x, b.y, b.size);
    const fits =
      !placed.some((p) => overlaps(p, rect)) &&
      !segments.some(([a, c]) => segmentHitsRect(a, c, grow(rect, TRAY_BAND + TRAY_EDGE)));
    if (!opts.shrink || b.keepFull || (opts.zoom >= STREET_ZOOM && fits)) {
      placed.push(rect);
      full.add(b.id);
    }
  }
  return { fans, full, autoOpen };
}
