import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { updatePerson } from '../../commands/people';
import { getSettings } from '../../commands/records';
import { addReason, nameSharedLabel, renameReason, setReasonArchived } from '../../commands/triage';
import { db } from '../../db/db';
import { getMe } from '../../db/me';
import { LABEL_COLOR_VAR } from '../../domain/pins';
import { LABEL_COLORS } from '../../model';
import type { LabelColor } from '../../model';
import styles from './settings.module.css';

/**
 * Labels and reasons (DESIGN.md §4.5, Q16): name the shared labels (everyone's) and your
 * private ones (yours only); add, rename and archive reject reasons. Every change can be
 * undone.
 */

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const colorName = (c: LabelColor) => c.charAt(0).toUpperCase() + c.slice(1);

function NameRow({
  color,
  name,
  label,
  onSave,
}: {
  color: LabelColor;
  name: string;
  label: string;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const changed = value.trim() !== name;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    setError(null);
    try {
      await onSave(value);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <li className={styles.labelRow}>
      <form className={styles.inline} onSubmit={(e) => void submit(e)}>
        <span
          className={styles.labelSwatch}
          style={{ '--c': `var(${LABEL_COLOR_VAR[color]})` } as CSSProperties}
          aria-hidden="true"
        />
        <label className={styles.inlineLabel}>
          <span className={styles.visuallyHidden}>{label}</span>
          <input
            className={styles.input}
            value={value}
            maxLength={40}
            placeholder={colorName(color)}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button type="submit" className={styles.button} disabled={!changed}>
          Save<span className={styles.visuallyHidden}> {label}</span>
        </button>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}

function ReasonRow({ id, label, archived }: { id: string; label: string; archived: boolean }) {
  const [value, setValue] = useState(label);
  const [error, setError] = useState<string | null>(null);
  const changed = value.trim() !== label;
  return (
    <li className={styles.row} data-archived={archived || undefined}>
      <form
        className={styles.inline}
        onSubmit={(e) => {
          e.preventDefault();
          if (!changed) return;
          setError(null);
          void renameReason(db, id, value).catch((err: unknown) => setError(errorText(err)));
        }}
      >
        <label className={styles.inlineLabel}>
          <span className={styles.visuallyHidden}>Reason</span>
          <input
            className={styles.input}
            value={value}
            maxLength={40}
            disabled={archived}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {!archived && (
          <button type="submit" className={styles.button} disabled={!changed}>
            Rename<span className={styles.visuallyHidden}> {label}</span>
          </button>
        )}
        <button
          type="button"
          className={styles.button}
          onClick={() =>
            void setReasonArchived(db, id, !archived).catch((err: unknown) =>
              setError(errorText(err)),
            )
          }
        >
          {archived ? 'Bring back' : 'Archive'}
          <span className={styles.visuallyHidden}> {label}</span>
        </button>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}

function AddReason() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={styles.inline}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        void addReason(db, value)
          .then(() => setValue(''))
          .catch((err: unknown) => setError(errorText(err)));
      }}
    >
      <label className={styles.inlineLabel}>
        <span className={styles.visuallyHidden}>New reason</span>
        <input
          className={styles.input}
          value={value}
          maxLength={40}
          placeholder="e.g. Noisy street"
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" className={styles.button} disabled={!value.trim()}>
        Add reason
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function LabelsSection() {
  const data = useLiveQuery(async () => {
    const [settings, me] = await Promise.all([getSettings(db), getMe(db)]);
    return { settings, me };
  }, []);
  if (!data) return null;
  const { settings, me } = data;
  const live = settings.rejectReasons.filter((r) => !r.archived);
  const archived = settings.rejectReasons.filter((r) => r.archived);

  return (
    <>
      <p className={styles.lead}>
        Color labels mean whatever you like, such as “Blue = roommate likes”. Each unit can have a
        shared label, which everyone sees, and a private label of your own. Keys 6–9 set your label
        and ⇧6–9 the shared one (red, yellow, green, blue); purple is in the menus.
      </p>

      <section className={styles.card} aria-labelledby="labels-shared">
        <h3 id="labels-shared" className={styles.cardTitle}>
          Shared labels
        </h3>
        <ul className={styles.labelList}>
          {LABEL_COLORS.map((c) => (
            <NameRow
              key={`${c}:${settings.labelNames[c]}`}
              color={c}
              name={settings.labelNames[c] ?? colorName(c)}
              label={`Name of the shared ${c} label`}
              onSave={(name) => nameSharedLabel(db, c, name)}
            />
          ))}
        </ul>
        <p className={styles.note}>Everyone in the household sees these names.</p>
      </section>

      <section className={styles.card} aria-labelledby="labels-mine">
        <h3 id="labels-mine" className={styles.cardTitle}>
          Your private labels
        </h3>
        <ul className={styles.labelList}>
          {LABEL_COLORS.map((c) => (
            <NameRow
              key={`${c}:${me.labelNames[c]}`}
              color={c}
              name={me.labelNames[c] ?? colorName(c)}
              label={`Name of your ${c} label`}
              onSave={(name) =>
                updatePerson(db, me.id, { labelNames: { [c]: name.trim() || colorName(c) } })
              }
            />
          ))}
        </ul>
        <p className={styles.note}>Only you see your private labels and their names.</p>
      </section>

      <section className={styles.card} aria-labelledby="labels-reasons">
        <h3 id="labels-reasons" className={styles.cardTitle}>
          Reject reasons
        </h3>
        <p className={styles.text}>
          Offered when you reject a unit (X). Archived reasons stay on the units that have them.
        </p>
        <ul className={styles.list}>
          {live.map((r) => (
            <ReasonRow key={`${r.id}:${r.label}`} id={r.id} label={r.label} archived={false} />
          ))}
        </ul>
        <AddReason />
        {archived.length > 0 && (
          <>
            <h4 className={styles.subTitle}>Archived</h4>
            <ul className={styles.list}>
              {archived.map((r) => (
                <ReasonRow key={`${r.id}:${r.label}`} id={r.id} label={r.label} archived />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
