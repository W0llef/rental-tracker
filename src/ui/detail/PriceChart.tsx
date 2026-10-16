import { daysBetween } from '../../domain/format';
import { priceHistoryText } from '../../domain/listings';
import type { PricePoint } from '../../domain/listings';
import type { ISODate } from '../../model';

/**
 * Step chart of rent over time (DESIGN.md §4.2 "Listings and price"). Drawn only when the
 * price changed at least once; runs from the first price seen to today.
 */
export function PriceChart({ points, today }: { points: readonly PricePoint[]; today: ISODate }) {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) return null;

  const W = 360;
  const H = 56;
  const top = 14;
  const bottom = H - 6;
  const span = Math.max(1, daysBetween(first.date, today));
  const rents = points.map((p) => p.rent);
  const lo = Math.min(...rents);
  const hi = Math.max(...rents);
  const x = (d: ISODate) => Math.min(W, (daysBetween(first.date, d) / span) * W);
  const y = (r: number) =>
    hi === lo ? (top + bottom) / 2 : bottom - ((r - lo) / (hi - lo)) * (bottom - top);

  let d = `M0 ${y(first.rent)}`;
  for (const p of points.slice(1)) d += ` H${x(p.date).toFixed(1)} V${y(p.rent).toFixed(1)}`;
  d += ` H${W}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={H}
      role="img"
      aria-label={priceHistoryText(points, today)}
      style={{ display: 'block', marginTop: 8, overflow: 'visible' }}
    >
      <path
        d={d}
        fill="none"
        stroke="var(--lake)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
