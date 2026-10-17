import { useState } from 'react';
import { Link } from 'react-router-dom';
import { backupReminder, lastBackupText } from '../../services/backup/reminders';
import { backUpNow, snoozeBackupReminder, useBackupMeta } from '../../state/useBackup';
import { useUi } from '../../state/ui';
import styles from './Banners.module.css';

/**
 * The backup reminder (PLAN.md §5.5): shown on the main screen when there's data and the
 * last backup made in this browser is older than the reminder interval, or there's never
 * been one. "Back up data" downloads straight away; "Later" hides it for a day.
 */
export function BackupBanner({
  hasData,
  remindEveryDays,
}: {
  hasData: boolean;
  remindEveryDays: number;
}) {
  const meta = useBackupMeta();
  const showNotice = useUi((s) => s.showNotice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!meta) return null;

  const { due, daysSince } = backupReminder({
    hasData,
    lastBackupAt: meta.lastBackupAt,
    remindEveryDays,
    snoozedUntil: meta.snoozedUntil,
    now: new Date(),
  });
  if (!due) return null;

  const backUp = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = await backUpNow();
      showNotice(`Backed up: ${name}`);
    } catch (e) {
      setError(`Couldn’t make the backup. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.backup} aria-label="Backup reminder">
      <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 12.5h10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className={styles.text}>
        {daysSince === null ? (
          <>
            <strong>No backup yet.</strong> Your units are stored only in this browser.
          </>
        ) : (
          <>
            <strong>Last backup {lastBackupText(daysSince)}.</strong> Back up so recent changes are
            safe too.
          </>
        )}{' '}
        <Link to="/settings/backup" className={styles.more}>
          Backup settings
        </Link>
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={backUp} disabled={busy}>
          Back up data
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => void snoozeBackupReminder()}
          disabled={busy}
        >
          Later
        </button>
      </div>
    </section>
  );
}
