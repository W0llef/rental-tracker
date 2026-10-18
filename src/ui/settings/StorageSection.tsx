import { useEffect, useState } from 'react';
import { dbName } from '../../config';
import { db } from '../../db/db';
import { bytesText, requestPersistence, storageStatus } from '../../services/storage';
import type { StorageStatus } from '../../services/storage';
import styles from './settings.module.css';

/** Storage (DESIGN.md §4.5): space used, and whether the browser has promised to keep it. */
export function StorageSection() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void storageStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);

  const ask = async () => {
    setAsking(true);
    const granted = await requestPersistence(db);
    const next = await storageStatus();
    setStatus(next);
    setAnswer(
      granted
        ? 'The browser will keep this site’s data.'
        : granted === null
          ? 'This browser can’t be asked.'
          : 'The browser said no for now. Browsers often agree once you’ve used a site for a while, bookmarked it or installed it. Keep backing up.',
    );
    setAsking(false);
  };

  return (
    <>
      <p className={styles.lead}>
        Browsers can clear a website’s stored data when the disk is nearly full, unless the site has
        asked to keep it. The app asks after your first change.
      </p>

      <section className={styles.card} aria-labelledby="storage-kept">
        <h3 id="storage-kept" className={styles.cardTitle}>
          Kept by the browser
        </h3>
        <p className={styles.fact} data-testid="persisted">
          <span className={styles.factLabel}>Persistent storage</span>
          <span className={styles.factValue}>
            {!status
              ? '…'
              : status.persisted === true
                ? 'On: the browser won’t clear it to make room'
                : status.persisted === false
                  ? 'Off: the browser may clear it when space runs low'
                  : 'This browser doesn’t say'}
          </span>
        </p>
        {status?.persisted === false && (
          <div className={styles.buttons}>
            <button type="button" className={styles.button} onClick={ask} disabled={asking}>
              Ask the browser to keep it
            </button>
          </div>
        )}
        <p className={styles.message} role="status">
          {answer}
        </p>
        <p className={styles.note}>
          Even when it’s kept, data in a browser goes away if you clear this site’s data or switch
          browsers or computers. Backups are what protect it.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="storage-used">
        <h3 id="storage-used" className={styles.cardTitle}>
          Space
        </h3>
        <p className={styles.fact}>
          <span className={styles.factLabel}>Used by this site</span>
          <span className={styles.factValue}>
            {status?.usage != null ? bytesText(status.usage) : status ? 'Not known' : '…'}
          </span>
        </p>
        <p className={styles.fact}>
          <span className={styles.factLabel}>Available to it</span>
          <span className={styles.factValue}>
            {status?.quota != null
              ? `About ${bytesText(status.quota)}`
              : status
                ? 'Not known'
                : '…'}
          </span>
        </p>
        <p className={styles.fact}>
          <span className={styles.factLabel}>Database</span>
          <span className={styles.factValue}>
            <code>{dbName}</code> in this browser, at {location.host || 'this address'}
          </span>
        </p>
      </section>
    </>
  );
}
