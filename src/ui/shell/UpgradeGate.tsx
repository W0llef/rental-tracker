import { useState } from 'react';
import type { PendingUpgrade } from '../../db/upgradeCheck';
import { localDate } from '../../domain/format';
import {
  backupFileName,
  backupJson,
  makeEnvelope,
  withoutSecrets,
} from '../../services/backup/exportJson';
import type { BackupData } from '../../services/backup/exportJson';
import { summarize, summaryText } from '../../services/backup/restore';
import { downloadText } from '../common/download';
import { PreviewBanner } from './PreviewBanner';
import styles from '../settings/settings.module.css';

/**
 * Shown instead of the app when this version would change how the data in this browser is
 * stored (PLAN.md §3.7 step 7). The backup is made from the data as it is now, in its old
 * format, so it opens in the previous version of the app as well as in this one.
 */
export function UpgradeGate({
  pending,
  data,
  onContinue,
}: {
  pending: PendingUpgrade;
  data: BackupData;
  /** Opens the app (which updates the data). Passes the backup's time if one was made. */
  onContinue: (backedUpAt: string | null) => void;
}) {
  const [backedUpAt, setBackedUpAt] = useState<string | null>(null);

  const download = () => {
    const now = new Date();
    const envelope = makeEnvelope(withoutSecrets(data), pending.fromVersion, now.toISOString());
    downloadText(backupFileName(localDate(now)), backupJson(envelope));
    setBackedUpAt(envelope.exportedAt);
  };

  return (
    <div className={styles.page}>
      <PreviewBanner />
      <main className={styles.gate} aria-labelledby="gate-heading">
        <h1 id="gate-heading" className={styles.title}>
          This update changes how your data is stored
        </h1>
        <p className={styles.lead}>
          Download a backup before continuing. Your data stays in this browser and is updated when
          you continue; the backup lets you go back to the previous version of the app if anything
          goes wrong.
        </p>
        <section className={styles.card} aria-label="Your data">
          <p className={styles.fact}>
            <span className={styles.factLabel}>In this browser</span>
            <span className={styles.factValue}>{summaryText(summarize(data))}</span>
          </p>
          <p className={styles.fact}>
            <span className={styles.factLabel}>Data format</span>
            <span className={styles.factValue}>
              {pending.fromVersion} → {pending.toVersion}
            </span>
          </p>
          <div className={styles.buttons}>
            <button
              type="button"
              className={backedUpAt ? styles.button : styles.primary}
              onClick={download}
            >
              {backedUpAt ? 'Download again' : 'Download backup'}
            </button>
            <button
              type="button"
              className={backedUpAt ? styles.primary : styles.button}
              onClick={() => onContinue(backedUpAt)}
            >
              {backedUpAt ? 'Continue' : 'Continue without a backup'}
            </button>
          </div>
          <p className={styles.message} role="status">
            {backedUpAt && 'Backup downloaded. Keep it until you’re happy with this version.'}
          </p>
        </section>
      </main>
    </div>
  );
}
