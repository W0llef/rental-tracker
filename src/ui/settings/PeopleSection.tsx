import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { addPerson, removePerson, updatePerson } from '../../commands/people';
import { undoAction } from '../../commands/undo';
import { db } from '../../db/db';
import { readMeId } from '../../db/me';
import { PERSON_COLOR_LABELS } from '../../domain/people';
import { PERSON_COLORS } from '../../model';
import type { Person, PersonColor } from '../../model';
import { useUi } from '../../state/ui';
import { PersonBadge } from '../common/Markers';
import styles from './settings.module.css';

/**
 * People (PLAN.md §5.8, Q15): your name, and anyone you're looking with. Each person has
 * their own ratings, flags and notes on them; facts, status and listings are shared.
 */

async function readPeople() {
  const [people, meId] = await Promise.all([db.people.toArray(), readMeId(db)]);
  const live = people
    .filter((p) => !p.deletedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return {
    me: live.find((p) => p.id === meId) ?? null,
    others: live.filter((p) => p.id !== meId),
  };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function NameForm({
  person,
  label,
  saveLabel,
  onSaved,
}: {
  person: Person;
  label: string;
  saveLabel: string;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(person.name);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== person.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    setError(null);
    try {
      const saved = await updatePerson(db, person.id, { name });
      setName(saved.name);
      onSaved(saved.name);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <form className={styles.inline} onSubmit={(e) => void submit(e)}>
      <label className={styles.inlineLabel}>
        <span className={styles.visuallyHidden}>{label}</span>
        <input
          className={styles.input}
          value={name}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button type="submit" className={styles.button} disabled={!changed}>
        {saveLabel}
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ColorPicker({ person, label }: { person: Person; label: string }) {
  return (
    <label className={styles.inlineLabel}>
      <span className={styles.visuallyHidden}>{label}</span>
      <select
        className={styles.select}
        value={person.color}
        onChange={(e) => void updatePerson(db, person.id, { color: e.target.value as PersonColor })}
      >
        {PERSON_COLORS.map((c) => (
          <option key={c} value={c}>
            {PERSON_COLOR_LABELS[c]}
          </option>
        ))}
      </select>
    </label>
  );
}

function OtherPerson({ person }: { person: Person }) {
  const showNotice = useUi((s) => s.showNotice);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setError(null);
    try {
      const actionId = await removePerson(db, person.id);
      showNotice(`${person.name} removed.`, null, () => {
        void undoAction(db, actionId).then((ok) => {
          if (!ok) showNotice('Couldn’t undo: something else changed since.');
        });
      });
    } catch (e) {
      setError(`Couldn’t remove ${person.name}. ${errorText(e)}`);
    }
  };

  return (
    <li className={styles.personItem}>
      <div className={styles.personHead}>
        <PersonBadge person={person} size="medium" named />
        <NameForm
          key={person.name}
          person={person}
          label={`${person.name}’s name`}
          saveLabel="Rename"
          onSaved={(name) => showNotice(`Renamed to ${name}.`)}
        />
        <ColorPicker person={person} label={`${person.name}’s color`} />
        {!asking && (
          <button type="button" className={styles.button} onClick={() => setAsking(true)}>
            Remove…
          </button>
        )}
      </div>
      {asking && (
        <div className={styles.confirmBox} role="group" aria-label={`Remove ${person.name}`}>
          <p className={styles.text}>
            Remove {person.name}? Their ratings and flags are removed too; notes they wrote stay.
            You can undo this.
          </p>
          <div className={styles.buttons}>
            <button type="button" className={styles.danger} onClick={() => void remove()}>
              Remove {person.name}
            </button>
            <button type="button" className={styles.button} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function AddPerson() {
  const showNotice = useUi((s) => s.showNotice);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const p = await addPerson(db, name);
      setName('');
      showNotice(`${p.name} added. Rate units for them in a unit’s Ratings section.`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <form className={styles.inline} onSubmit={(e) => void submit(e)}>
      <label className={styles.inlineLabel}>
        <span className={styles.visuallyHidden}>New person’s name</span>
        <input
          className={styles.input}
          value={name}
          maxLength={40}
          placeholder="Name, e.g. Alex"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button type="submit" className={styles.primary} disabled={!name.trim()}>
        Add person
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function PeopleSection() {
  const data = useLiveQuery(readPeople, []);
  const showNotice = useUi((s) => s.showNotice);
  if (!data) return null;
  const { me, others } = data;

  return (
    <>
      <p className={styles.lead}>
        Looking with someone? Each person keeps their own ratings, flags and notes on them, shown
        side by side on every unit. Facts, status, listings and the shared color label belong to
        everyone.
      </p>

      <section className={styles.card} aria-labelledby="people-you">
        <h3 id="people-you" className={styles.cardTitle}>
          You
        </h3>
        {me ? (
          <div className={styles.personHead}>
            <PersonBadge person={me} size="medium" named />
            <NameForm
              key={`${me.id}:${me.name}`}
              person={me}
              label="Your name"
              saveLabel="Save name"
              onSaved={(name) => showNotice(`Saved. You’re ${name} in this copy.`)}
            />
            <ColorPicker person={me} label="Your color" />
          </div>
        ) : (
          <p className={styles.text}>Setting up…</p>
        )}
        <p className={styles.note}>
          Your name is kept with your ratings and notes, so others see it once household sharing
          arrives. This browser remembers that it’s yours.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="people-others">
        <h3 id="people-others" className={styles.cardTitle}>
          Other people
        </h3>
        {others.length > 0 ? (
          <ul className={styles.personList}>
            {others.map((p) => (
              <OtherPerson key={p.id} person={p} />
            ))}
          </ul>
        ) : (
          <p className={styles.text}>Nobody else yet.</p>
        )}
        <AddPerson />
        <p className={styles.note}>
          Until household sharing arrives (after Phase 1), you enter other people’s ratings for them
          in each unit’s Ratings section.
        </p>
      </section>
    </>
  );
}
