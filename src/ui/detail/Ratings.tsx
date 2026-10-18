import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setOpinion } from '../../commands/people';
import { db } from '../../db/db';
import { rejectReasonText } from '../../domain/format';
import { personLabel } from '../../domain/people';
import type { PersonOpinion } from '../../domain/people';
import type { Flag, ID, OpinionFields, Rating, Settings } from '../../model';
import { useUi } from '../../state/ui';
import { PersonBadge, StarInput } from '../common/Markers';
import { Section } from './parts';
import styles from './detail.module.css';

/**
 * Everyone's rating and flag, side by side (PLAN.md §5.8): you first, then the others.
 * Until household sync, you set other people's ratings for them here (Settings → People
 * adds people). Each person's rating and flag notes are edited here, and their reject
 * reasons through the Reject dialog (M7).
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
  const [editing, setEditing] = useState(false);
  const setRejecting = useUi((st) => st.setRejecting);
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
  const startReject = () => setRejecting({ unitIds: [unitId], personId: row.person.id });
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
        onChange={(e) => {
          const flag = e.target.value as Flag;
          // Rejecting asks why (spec §6).
          if (flag === 'reject') startReject();
          else void change({ flag }, 'Flag');
        }}
      >
        {FLAG_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {editing ? (
        <OpinionNotes
          opinion={opinion}
          whose={possessive(row)}
          onSave={async (changes) => {
            await change(changes, 'Notes');
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className={styles.personNotes}>
          {opinion.flag === 'reject' && reasons && <p>Rejected: {reasons}</p>}
          {opinion.flagNote && (
            <p>
              <span className={styles.visuallyHidden}>Flag note: </span>
              {opinion.flagNote}
            </p>
          )}
          {opinion.ratingNote && (
            <p>
              <span className={styles.visuallyHidden}>Rating note: </span>
              {opinion.ratingNote}
            </p>
          )}
          <p className={styles.personActions}>
            <button type="button" className={styles.linkButton} onClick={() => setEditing(true)}>
              {opinion.flagNote || opinion.ratingNote ? 'Edit notes' : 'Add notes'}
              <span className={styles.visuallyHidden}> ({name})</span>
            </button>
            {opinion.flag === 'reject' && (
              <button type="button" className={styles.linkButton} onClick={startReject}>
                Reasons
                <span className={styles.visuallyHidden}> ({name})</span>
              </button>
            )}
          </p>
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

/** A person's flag note and rating note (spec §6: "every star rating and flag can carry a note"). */
function OpinionNotes({
  opinion,
  whose,
  onSave,
  onCancel,
}: {
  opinion: OpinionFields;
  whose: string;
  onSave: (changes: Partial<OpinionFields>) => Promise<void>;
  onCancel: () => void;
}) {
  const [flagNote, setFlagNote] = useState(opinion.flagNote ?? '');
  const [ratingNote, setRatingNote] = useState(opinion.ratingNote ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={styles.personEdit}
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSave({
          flagNote: flagNote.trim() || null,
          ratingNote: ratingNote.trim() || null,
        }).finally(() => setBusy(false));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <label className={styles.noteField}>
        <span>{whose} flag note</span>
        <input
          value={flagNote}
          onChange={(e) => setFlagNote(e.target.value)}
          placeholder="Why pick or reject it"
          autoFocus
        />
      </label>
      <label className={styles.noteField}>
        <span>{whose} rating note</span>
        <input
          value={ratingNote}
          onChange={(e) => setRatingNote(e.target.value)}
          placeholder="What the stars are for"
        />
      </label>
      <span className={styles.personActions}>
        <button type="submit" className={styles.smallSave} disabled={busy}>
          Save notes
        </button>
        <button type="button" className={styles.linkButton} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </form>
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
