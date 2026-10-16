import { facingText } from '../../domain/format';
import { DIRECTIONS } from '../../model';
import type { Direction } from '../../model';

const ANGLE: Record<Direction, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

const point = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)].map((v) => Math.round(v * 10) / 10) as [
    number,
    number,
  ];
};

function wedge(dir: Direction, r = 46): string {
  const a = ANGLE[dir];
  const [x1, y1] = point(a - 22.5, r);
  const [x2, y2] = point(a + 22.5, r);
  return `M0 0 L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z`;
}

/**
 * Which way the unit faces (DESIGN.md §4.2 "Windows: compass + list"). The main direction
 * (first in the list, Q3) is drawn strongest.
 */
export function Compass({ directions }: { directions: readonly Direction[] }) {
  const unique = [...new Set(directions)];
  return (
    <svg
      viewBox="-60 -60 120 120"
      width="112"
      height="112"
      role="img"
      aria-label={facingText(unique)}
    >
      <circle r="46" fill="none" stroke="var(--ice)" strokeWidth="1.5" />
      <circle r="28" fill="none" stroke="var(--ice)" strokeWidth="1" />
      {unique.map((d, i) => (
        <path key={d} d={wedge(d)} fill="var(--lake)" opacity={i === 0 ? 0.85 : 0.5} />
      ))}
      <rect x="-6" y="-6" width="12" height="12" rx="2" fill="var(--river)" />
      {DIRECTIONS.filter((d) => d.length === 1).map((d) => {
        const [x, y] = point(ANGLE[d], 54);
        const on = unique.includes(d);
        return (
          <text
            key={d}
            x={x}
            y={y + 3.5}
            textAnchor="middle"
            fontSize="10"
            fontWeight={on ? 800 : 600}
            fill={on ? 'var(--ink)' : 'var(--slate)'}
          >
            {d}
          </text>
        );
      })}
    </svg>
  );
}
