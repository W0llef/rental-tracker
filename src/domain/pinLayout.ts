import type { PinStyle } from './pinPrefs';

/**
 * Where pins go on screen (PLAN.md §4.3, DESIGN.md §2.4). Pure: positions are screen
 * pixels supplied by the map.
 *  - Bubbles (if on): at zoom 10 and below, nearby buildings merge into one count.
 *  - Dots (if "shrink" is on): below zoom 11 every pin is a dot; from 11 up, only pins that
 *    would overlap a pin already placed. Selected, hovered and fanned pins stay full.
 *  - Fans: opened by clicking (any number at once), or automatically from zoom 15 up where
 *    a fan has room. Zooming out to bubble level folds the clicked ones.
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

export const PLATE_H = 26;
const TAIL = 7;

/** Rough on-screen size of a full pin, without measuring the DOM. */
export function estimatePinSize(
  style: PinStyle,
  texts: readonly string[],
  extras: { icon: boolean; count: boolean; tag: boolean },
): { w: number; h: number } {
  if (style === 'dot') return { w: 24, h: 24 };
  const chars = texts.reduce((n, t) => n + t.length, 0);
  let textW = chars * 7.4 + Math.max(0, texts.length - 1) * 13; // dividers
  if (extras.icon) textW += 20;
  if (extras.count) textW += 24;
  if (extras.tag) textW += 10;
  if (style === 'photo') {
    const w = Math.max(52, Math.ceil(texts.length ? textW * 0.85 + 12 : 52));
    return { w, h: texts.length ? 80 : 62 };
  }
  return { w: Math.ceil(Math.max(30, 22 + textW)), h: PLATE_H + TAIL };
}

/** Rectangle a full pin covers: centered horizontally on the point, sitting above it. */
export function pinRect(x: number, y: number, w: number, h: number): Rect {
  return { left: x - w / 2, right: x + w / 2, top: y - h, bottom: y };
}

/** Rectangle around a fan: every plate around the hub, plus the hub itself. */
export function fanRect(
  x: number,
  y: number,
  offsets: readonly [number, number][],
  w: number,
  h: number,
): Rect {
  let r: Rect = { left: x - 8, right: x + 8, top: y - 8, bottom: y + 8 };
  for (const [dx, dy] of offsets) {
    const p = pinRect(x + dx, y + dy, w, h);
    r = {
      left: Math.min(r.left, p.left),
      right: Math.max(r.right, p.right),
      top: Math.min(r.top, p.top),
      bottom: Math.max(r.bottom, p.bottom),
    };
  }
  return r;
}

const GAP = 2;

export function overlaps(a: Rect, b: Rect, gap = GAP): boolean {
  return (
    a.left < b.right + gap &&
    b.left < a.right + gap &&
    a.top < b.bottom + gap &&
    b.top < a.bottom + gap
  );
}

export interface PinBox {
  id: string;
  rect: Rect;
  /** Lower draws in full first: cheaper units first. */
  priority: number;
  /** Always full (selected, hovered, fanned out). */
  keepFull: boolean;
}

/**
 * Which pins draw in full. Greedy by priority: a pin is full unless it would overlap one
 * already placed in full, or an open fan (`blockers`). Below street zoom only kept pins
 * are full.
 */
export function fullPins(
  boxes: readonly PinBox[],
  zoom: number,
  shrink: boolean,
  blockers: readonly Rect[] = [],
): Set<string> {
  if (!shrink) return new Set(boxes.map((b) => b.id));
  if (zoom < STREET_ZOOM) return new Set(boxes.filter((b) => b.keepFull).map((b) => b.id));
  const placed: Rect[] = [...blockers];
  const full = new Set<string>();
  const ordered = [...boxes].sort(
    (a, b) => Number(b.keepFull) - Number(a.keepFull) || a.priority - b.priority,
  );
  for (const box of ordered) {
    if (box.keepFull || !placed.some((p) => overlaps(p, box.rect))) {
      placed.push(box.rect);
      full.add(box.id);
    }
  }
  return full;
}

/**
 * Which buildings fan out by themselves: in priority order, each candidate whose fan
 * doesn't overlap a fan already open (clicked ones are passed in `open`).
 */
export function autoFans(
  candidates: readonly { id: string; rect: Rect; priority: number }[],
  open: readonly Rect[],
): Set<string> {
  const placed = [...open];
  const out = new Set<string>();
  for (const c of [...candidates].sort((a, b) => a.priority - b.priority)) {
    if (placed.some((p) => overlaps(p, c.rect, 6))) continue;
    placed.push(c.rect);
    out.add(c.id);
  }
  return out;
}

/**
 * Pixel offsets for fanned-out units around their building: an arc above the point, wide
 * enough that plates don't overlap, opening upward so the tails point back at the hub.
 */
export function fanOffsets(count: number, pinWidth = 90, pinHeight = 34): [number, number][] {
  if (count <= 0) return [];
  if (count === 1) return [[0, -56]];
  // Spread over an arc above the hub; widen the radius until no two plates overlap.
  const arc = Math.min(160, 55 * (count - 1)); // degrees, kept above the hub
  const start = -90 - arc / 2;
  const step = arc / (count - 1);
  const ring = (radius: number): [number, number][] =>
    Array.from({ length: count }, (_, i) => {
      const a = ((start + step * i) * Math.PI) / 180;
      return [Math.round(radius * Math.cos(a)), Math.round(radius * Math.sin(a))];
    });
  const clear = (pts: [number, number][]) =>
    pts.every(([ax, ay], i) =>
      pts
        .slice(i + 1)
        .every(([bx, by]) => Math.abs(ax - bx) >= pinWidth || Math.abs(ay - by) >= pinHeight),
    );
  let radius = 64;
  while (!clear(ring(radius)) && radius < 800) radius += 4;
  return ring(radius);
}
