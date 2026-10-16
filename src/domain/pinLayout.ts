import type { PinContent } from '../model';
import { effectivePinShow } from './pins';

/**
 * "Shrink pins to dots when crowded" (PLAN.md §4.3, DESIGN.md §2.4): below street zoom,
 * or where full pins would overlap, pins become dots. The selected and hovered pins always
 * show in full. Pure: positions are screen pixels supplied by the map.
 */

/**
 * Below this zoom every pin is a dot (when shrinking is on); from here up, pins shrink only
 * where they would overlap. 11 shows Minneapolis–St. Paul on a laptop screen: tuned so "Fit all
 * units" over Minneapolis–St. Paul shows price plates, not a field of dots.
 */
export const STREET_ZOOM = 11;
/** At or below this (whole) zoom nearby buildings merge into neighborhood bubbles. */
export const CLUSTER_MAX_ZOOM = 10;

export interface PinBox {
  id: string;
  /** Screen position of the building, in px. */
  x: number;
  y: number;
  /** Full pin size, in px (the plate sits above the point, the tail touches it). */
  w: number;
  h: number;
  /** Lower draws in full first: selected, hovered, then cheaper, then the rest. */
  priority: number;
  /** Always full (selected, hovered, fanned out). */
  keepFull: boolean;
}

/** Rough on-screen size of a full pin, from its text, without measuring the DOM. */
export function estimatePinSize(
  show: PinContent,
  text: string | null,
  extras: { icon: boolean; stars: boolean; count: boolean },
): { w: number; h: number } {
  const mode = effectivePinShow(show);
  if (mode === 'photo') return { w: 52, h: 62 };
  if (mode === 'dot') return { w: 24, h: 24 };
  const chars = text?.length ?? 0;
  let w = 22 + chars * 7.6;
  if (mode === 'type') w = 40;
  if (extras.icon && mode !== 'type') w += 20;
  if (extras.stars && mode !== 'rating') w += 26;
  if (extras.count) w += 22;
  return { w: Math.ceil(w), h: 33 };
}

/** Rectangle a full pin covers: centered horizontally on the point, sitting above it. */
function rect(b: PinBox) {
  return { left: b.x - b.w / 2, right: b.x + b.w / 2, top: b.y - b.h, bottom: b.y };
}

const GAP = 2;

function overlaps(a: PinBox, b: PinBox): boolean {
  const r1 = rect(a);
  const r2 = rect(b);
  return (
    r1.left < r2.right + GAP &&
    r2.left < r1.right + GAP &&
    r1.top < r2.bottom + GAP &&
    r2.top < r1.bottom + GAP
  );
}

/**
 * Which pins draw in full. Greedy by priority: a pin is full unless it would overlap one
 * already placed in full. Below street zoom only the kept pins are full.
 */
export function fullPins(boxes: readonly PinBox[], zoom: number, simplify: boolean): Set<string> {
  if (!simplify) return new Set(boxes.map((b) => b.id));
  if (zoom < STREET_ZOOM) return new Set(boxes.filter((b) => b.keepFull).map((b) => b.id));
  const placed: PinBox[] = [];
  const ordered = [...boxes].sort(
    (a, b) => Number(b.keepFull) - Number(a.keepFull) || a.priority - b.priority,
  );
  for (const box of ordered) {
    if (box.keepFull || !placed.some((p) => overlaps(p, box))) placed.push(box);
  }
  return new Set(placed.map((b) => b.id));
}

/**
 * Pixel offsets for fanned-out units around their building: a ring above the point, wide
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
  while (!clear(ring(radius)) && radius < 600) radius += 4;
  return ring(radius);
}
