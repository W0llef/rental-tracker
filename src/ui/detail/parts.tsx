import type { ReactNode } from 'react';
import { shortDate } from '../../domain/format';
import { AMENITY_KEYS } from '../../model';
import type { AmenityKey, Building, ISODate, NoteEntry } from '../../model';
import { Value } from '../common/Markers';
import { AMENITY_LABELS } from './text';
import type { ExternalLink } from './text';
import styles from './detail.module.css';

/** Building blocks shared by the unit and building panels (DESIGN.md §4.2). */

export function Section({
  title,
  action,
  children,
  id,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className={styles.sec} aria-labelledby={id}>
      {/* The action sits beside the heading, not in it, so the heading's name is just its title */}
      <div className={styles.secTitle}>
        <h3 className={styles.secHeading} id={id}>
          {title}
        </h3>
        {action && <span className={styles.secAction}>{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** A grid of facts; null values read "Unknown" in italic slate. */
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {items.map(([k, v]) => (
        <div key={k} className={styles.fact}>
          <dt>{k}</dt>
          <dd>
            <Value>{v}</Value>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Label · value rows (utilities, fees). */
export function Rows({ items }: { items: [label: ReactNode, value: ReactNode, key?: string][] }) {
  return (
    <dl className={styles.rows}>
      {items.map(([k, v, key], i) => (
        <div key={key ?? i} className={styles.row}>
          <dt>{k}</dt>
          <dd>
            <Value>{v}</Value>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Amenity chips: yes (filled), no (struck), unknown (dashed, "?"). Skyway uses the navy plate. */
export function Amenities({ building }: { building: Building }) {
  const order = [...AMENITY_KEYS].sort((a, b) => {
    const rank = (k: AmenityKey) => {
      const v = building.amenities[k];
      if (k === 'skywayConnected' && v) return -1;
      return v === true ? 0 : v === null ? 1 : 2;
    };
    return rank(a) - rank(b);
  });
  return (
    <ul className={styles.amen} aria-label="Amenities">
      {order.map((k) => {
        const v = building.amenities[k];
        const label = AMENITY_LABELS[k];
        if (v === true)
          return (
            <li key={k} className={k === 'skywayConnected' ? styles.amSky : styles.amYes}>
              {label}
            </li>
          );
        if (v === false)
          return (
            <li key={k} className={styles.amNo}>
              <span className={styles.visuallyHidden}>No </span>
              {label}
            </li>
          );
        return (
          <li key={k} className={styles.amUnk}>
            {label}?<span className={styles.visuallyHidden}> (unknown)</span>
          </li>
        );
      })}
    </ul>
  );
}

const NOTE_KIND: Record<NoteEntry['kind'], string> = {
  note: 'Note',
  tour: 'Tour',
  call: 'Call',
  system: 'Change',
};

export function Notes({
  notes,
  today,
}: {
  notes: readonly (NoteEntry & { authorName?: string | null })[];
  today: ISODate;
}) {
  if (!notes.length) return <p className={styles.muted}>No notes yet.</p>;
  return (
    <ol className={styles.notes}>
      {notes.map((n) => (
        <li key={n.id}>
          <div className={styles.when}>
            {shortDate(n.createdAt.slice(0, 10), today)}, {NOTE_KIND[n.kind].toLowerCase()}
            {n.authorName && <span className={styles.author}> · {n.authorName}</span>}
          </div>
          {n.text}
        </li>
      ))}
    </ol>
  );
}

export function Links({ links }: { links: readonly ExternalLink[] }) {
  if (!links.length) return <p className={styles.muted}>No links yet.</p>;
  return (
    <ul className={styles.links}>
      {links.map((l) => (
        <li key={l.key}>
          <a href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label}
            <span className={styles.visuallyHidden}> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
