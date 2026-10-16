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

// ── Fans ───────────────────────────────────────────────────────────────────

const HUB_R = 13;
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
  },
): Point[] | null {
  const local: Rect[] = [around(hub[0], hub[1], HUB_R)];
  const angles = anglesFrom(opts.prefer ?? UP);
  const centers: Point[] = [];
  const pts = (opts.points ?? []).map(([x, y]) => around(x, y, 8));
  const blocked = (r: Rect) =>
    placed.some((p) => overlaps(p, r, GAP)) || local.some((p) => overlaps(p, r, GAP));

  for (const size of sizes) {
    let best: { c: Point; r: Rect } | null = null;
    // Pass 1: free, on screen, not covering another building. Pass 2: just free.
    for (const pass of [1, 2] as const) {
      for (let rad = R_START; rad <= opts.reach && !best; rad += R_STEP) {
        for (const a of angles) {
          const c: Point = [
            Math.round(hub[0] + rad * Math.cos(a)),
            Math.round(hub[1] + rad * Math.sin(a)),
          ];
          const r = centeredRect(c[0], c[1], size);
          if (blocked(r)) continue;
          // Automatic fans must fit fully on screen; pass 1 also keeps off other buildings
          if ((pass === 1 || opts.strict) && opts.view && !inside(r, opts.view, 4)) continue;
          if (pass === 1 && pts.some((p) => overlaps(p, r, 0))) continue;
          best = { c, r };
          break;
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
    centers.push([chosen.c[0] - hub[0], chosen.c[1] - hub[1]]);
  }
  placed.push(...local);
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
  for (const b of buildings) {
    if (!b.forced || !b.unitSizes) continue;
    const hub: Point = [b.x, b.y];
    const c = placeFan(hub, b.unitSizes, placed, {
      reach: FORCED_REACH,
      strict: false,
      points: pointsBut(b.id),
      view: opts.view,
      prefer: preferredAngle(hub, forcedHubs),
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
    const fits = !placed.some((p) => overlaps(p, rect));
    if (!opts.shrink || b.keepFull || (opts.zoom >= STREET_ZOOM && fits)) {
      placed.push(rect);
      full.add(b.id);
    }
  }
  return { fans, full, autoOpen };
}
