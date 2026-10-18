import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { updatePerson } from '../../commands/people';
import { db } from '../../db/db';
import { getMeta, META_KEYS, setMeta } from '../../db/meta';
import type { Person } from '../../model';
import { useUi } from '../../state/ui';
import styles from './Banners.module.css';

/**
 * Asks once for your name (PLAN.md §5.8): on first run and after the update that brought
 * people (v0.6). Shown until you save a name or choose "Not now"; Settings → People can
 * change it any time. Your name sits next to your ratings ("You ★4 · Alex ★3" shows
 * "You" here, your name for others once household sharing arrives).
 */
export function NameBanner({ me }: { me: Person }) {
  const askedAt = useLiveQuery(
    async () => (await getMeta<string>(db, META_KEYS.nameAskedAt)) ?? '',
    [],
  );
  const showNotice = useUi((s) => s.showNotice);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (askedAt === undefined || askedAt !== '' || me.name !== 'Me' || !me.id) return null;

  const done = () => setMeta(db, META_KEYS.nameAskedAt, new Date().toISOString());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const saved = await updatePerson(db, me.id, { name });
      await done();
      showNotice(`Hi, ${saved.name}. You can change your name in Settings → People.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className={styles.welcome} aria-label="Your name">
      <form className={styles.nameForm} onSubmit={(e) => void save(e)}>
        <label className={styles.text} htmlFor="your-name">
          <strong>What’s your name?</strong> It goes with your ratings and notes, so they stay apart
          from anyone you’re looking with.
        </label>
        <input
          id="your-name"
          className={styles.input}
          value={name}
          maxLength={40}
          autoComplete="given-name"
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
        />
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!name.trim()}>
            Save
          </button>
          <button type="button" className={styles.button} onClick={() => void done()}>
            Not now
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
