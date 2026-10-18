import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setOpinion } from '../../commands/people';
import { db } from '../../db/db';
import { rejectReasonText } from '../../domain/format';
import { personLabel } from '../../domain/people';
import type { PersonOpinion } from '../../domain/people';
import type { Flag, ID, OpinionFields, Rating, Settings } from '../../model';
import { PersonBadge, StarInput } from '../common/Markers';
import { Section } from './parts';
import styles from './detail.module.css';

/**
 * Everyone's rating and flag, side by side (PLAN.md §5.8): you first, then the others.
 * Until household sync, you set other people's ratings for them here (Settings → People
 * adds people). Notes and reject reasons are shown; editing them arrives with triage (M7).
 */

const FLAG_OPTIONS: { value: Flag; label: string }[] = [
  { value: 'none', label: 'No flag' },
  { value: 'pick', label: 'Pick' },
  { value: 'reject', label: 'Reject' },
];

const possessive = (row: PersonOpinion) => (row.isMe ? 'Your' : `${row.person.name}’s`);

function PersonRow({
  unitId,
  row,
  settings,
}: {
  unitId: ID;
  row: PersonOpinion;
  settings: Settings;
}) {
  const [error, setError] = useState<string | null>(null);
  const { opinion } = row;
  const name = personLabel(row);

  const change = async (changes: Partial<OpinionFields>, what: string) => {
    setError(null);
    try {
      await setOpinion(db, unitId, row.person.id, changes, `${what} (${name})`);
    } catch (e) {
      setError(`Couldn’t save that. ${e instanceof Error ? e.message : ''}`.trim());
    }
  };

  const reasons = rejectReasonText(opinion.rejectReasonIds, settings);
  return (
    <li className={styles.personRow} data-me={row.isMe || undefined}>
      <span className={styles.personName}>
        <PersonBadge person={row.person} size="medium" named />
        <span>{name}</span>
      </span>
      <StarInput
        rating={opinion.rating}
        label={`${possessive(row)} rating`}
        onChange={(rating: Rating) => void change({ rating }, rating ? 'Rate' : 'Clear rating')}
      />
      <select
        className={styles.flagSelect}
        value={opinion.flag}
        aria-label={`${possessive(row)} flag`}
        data-flag={opinion.flag}
        onChange={(e) => void change({ flag: e.target.value as Flag }, 'Flag')}
      >
        {FLAG_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {(reasons || opinion.flagNote || opinion.ratingNote) && (
        <div className={styles.personNotes}>
          {opinion.flag === 'reject' && reasons && <p>Rejected: {reasons}</p>}
          {opinion.flagNote && <p>{opinion.flagNote}</p>}
          {opinion.ratingNote && <p>{opinion.ratingNote}</p>}
        </div>
      )}
      {error && (
        <p className={styles.personError} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function RatingsSection({
  unitId,
  rows,
  settings,
}: {
  unitId: ID;
  rows: PersonOpinion[];
  settings: Settings;
}) {
  return (
    <Section title="Ratings" id="unit-ratings">
      <ul className={styles.people}>
        {rows.map((r) => (
          <PersonRow key={r.person.id} unitId={unitId} row={r} settings={settings} />
        ))}
      </ul>
      {rows.length === 1 && (
        <p className={styles.muted}>
          Rating a place with someone? <Link to="/settings/people">Add them in Settings</Link> to
          see your ratings side by side.
        </p>
      )}
    </Section>
  );
}
