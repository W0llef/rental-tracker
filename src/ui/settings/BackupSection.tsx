import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSettings, updateSettings } from '../../commands/records';
import { db } from '../../db/db';
import { getMe } from '../../db/me';
import { SCHEMA_VERSION } from '../../model';
import { backupFileName, readBackupData } from '../../services/backup/exportJson';
import { lastBackupText, REMIND_OPTIONS, backupReminder } from '../../services/backup/reminders';
import {
  checkBackupFile,
  checkBackupText,
  isEmpty,
  listSnapshots,
  restoreBackup,
  snapshotFile,
  summarize,
  summaryText,
} from '../../services/backup/restore';
import type { CheckedBackup, SnapshotInfo } from '../../services/backup/restore';
import { backUpNow, dateTimeText, useBackupMeta } from '../../state/useBackup';
import { localDate } from '../../domain/format';
import { downloadText } from '../common/download';
import styles from './settings.module.css';

/** Backup and restore (DESIGN.md §4.5; PLAN.md §5.5). */

type Source =
  | { kind: 'file'; name: string }
  | {
      kind: 'snapshot';
      seq: number;
      at: string;
      reason: SnapshotInfo['reason'];
      toVersion: number;
    };

type Restore =
  | { step: 'idle' }
  | { step: 'checking'; name: string }
  | { step: 'error'; name: string; message: string }
  | { step: 'review'; source: Source; checked: Extract<CheckedBackup, { ok: true }> }
  | { step: 'restoring'; source: Source; checked: Extract<CheckedBackup, { ok: true }> }
  | { step: 'done'; message: string };

const snapshotTitle = (s: { reason: SnapshotInfo['reason']; toVersion: number }) =>
  s.reason === 'restore'
    ? 'Before restoring a backup'
    : `Before the update to data format ${s.toVersion}`;

export function BackupSection() {
  const meta = useBackupMeta();
  const settings = useLiveQuery(() => getSettings(db), []);
  const current = useLiveQuery(async () => summarize(await readBackupData(db)), []);
  const snapshots = useLiveQuery(() => listSnapshots(db), []);

  const [backing, setBacking] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [restore, setRestore] = useState<Restore>({ step: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);

  const reviewing = restore.step === 'review';
  useEffect(() => {
    if (reviewing) reviewHeading.current?.focus();
  }, [reviewing]);
  const finished = restore.step === 'done' || restore.step === 'error';
  useEffect(() => {
    if (finished) resultRef.current?.focus();
  }, [finished]);

  const backUp = async () => {
    setBacking(true);
    setBackupMessage(null);
    try {
      const name = await backUpNow();
      setBackupMessage({ text: `Backed up: ${name} is in your downloads.` });
    } catch (e) {
      setBackupMessage({
        text: `Couldn’t make the backup. ${e instanceof Error ? e.message : ''}`.trim(),
        error: true,
      });
    } finally {
      setBacking(false);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setRestore({ step: 'checking', name: file.name });
    const checked = await checkBackupFile(file, await getMe(db));
    setRestore(
      checked.ok
        ? { step: 'review', source: { kind: 'file', name: file.name }, checked }
        : { step: 'error', name: file.name, message: checked.message },
    );
    if (fileInput.current) fileInput.current.value = '';
  };

  const reviewSnapshot = async (info: SnapshotInfo) => {
    const file = await snapshotFile(db, info.seq);
    if (!file) return;
    const checked = checkBackupText(file.json, await getMe(db));
    const name = snapshotTitle(info);
    setRestore(
      checked.ok
        ? {
            step: 'review',
            source: {
              kind: 'snapshot',
              seq: info.seq,
              at: info.at,
              reason: info.reason,
              toVersion: info.toVersion,
            },
            checked,
          }
        : { step: 'error', name, message: checked.message },
    );
  };

  const downloadSnapshot = async (info: SnapshotInfo) => {
    const file = await snapshotFile(db, info.seq);
    if (file)
      downloadText(
        backupFileName(localDate(new Date(info.at)), undefined, 'safety-copy'),
        file.json,
      );
  };

  const replace = async () => {
    if (restore.step !== 'review') return;
    const { source, checked } = restore;
    setRestore({ step: 'restoring', source, checked });
    try {
      const result = await restoreBackup(db, checked.backup);
      const from =
        source.kind === 'file'
          ? `the backup of ${dateTimeText(checked.backup.exportedAt)}`
          : `the safety copy of ${dateTimeText(source.at)}`;
      const message = `Restored ${summaryText(result.summary)} from ${from}.${
        result.snapshotSeq !== null ? ' What was here before is kept under Safety copies.' : ''
      }`;
      setRestore({ step: 'done', message });
    } catch (e) {
      setRestore({
        step: 'error',
        name: source.kind === 'file' ? source.name : snapshotTitle(source),
        message:
          `Couldn’t restore, so nothing was changed. ${e instanceof Error ? e.message : ''}`.trim(),
      });
    }
  };

  const reminder = meta
    ? backupReminder({
        hasData: !!current && !isEmpty(current),
        lastBackupAt: meta.lastBackupAt,
        remindEveryDays: settings?.backup.remindEveryDays ?? 7,
        snoozedUntil: null,
        now: new Date(),
      })
    : null;

  return (
    <>
      <p className={styles.lead}>
        Your data lives only in this browser, at this web address. A backup is one file with all of
        it: buildings, units, listings, notes and settings. Keep it somewhere safe, like a cloud
        drive.
      </p>

      {/* ── Back up ─────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="backup-now">
        <h3 id="backup-now" className={styles.cardTitle}>
          Back up
        </h3>
        <p className={styles.fact} data-testid="last-backup">
          <span className={styles.factLabel}>Last backup from this browser</span>
          <span className={styles.factValue}>
            {!meta
              ? '…'
              : meta.lastBackupAt
                ? `${lastBackupText(reminder?.daysSince ?? null)} (${dateTimeText(meta.lastBackupAt)})`
                : 'Never'}
          </span>
        </p>
        {current && (
          <p className={styles.fact}>
            <span className={styles.factLabel}>In this browser now</span>
            <span className={styles.factValue}>{summaryText(current)}</span>
          </p>
        )}
        <div className={styles.buttons}>
          <button type="button" className={styles.primary} onClick={backUp} disabled={backing}>
            Back up data
          </button>
        </div>
        <p
          className={backupMessage?.error ? styles.error : styles.message}
          role={backupMessage?.error ? 'alert' : 'status'}
        >
          {backupMessage?.text}
        </p>
        <p className={styles.note}>
          Backups with photos (.zip) arrive with the photo archive. The file leaves out your undo
          history and any API keys.
        </p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Remind me to back up</span>
          <select
            className={styles.select}
            value={settings?.backup.remindEveryDays ?? 7}
            disabled={!settings}
            onChange={(e) => {
              const days = Number(e.target.value);
              void updateSettings(
                db,
                (s) => ({ ...s, backup: { ...s.backup, remindEveryDays: days } }),
                'Change backup reminder',
              );
            }}
          >
            {REMIND_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? 'Every day' : `After ${d} days`}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* ── Restore ─────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="restore">
        <h3 id="restore" className={styles.cardTitle}>
          Restore
        </h3>
        <p className={styles.text}>
          Restoring replaces everything in this browser with what’s in the file, and clears the undo
          history. A safety copy of what’s here now is kept first.
        </p>
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.button}
            onClick={() => fileInput.current?.click()}
            disabled={restore.step === 'checking' || restore.step === 'restoring'}
          >
            Restore from file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className={styles.visuallyHidden}
            aria-label="Backup file to restore"
            tabIndex={-1}
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        </div>

        {restore.step === 'checking' && (
          <p className={styles.message} role="status">
            Checking {restore.name}…
          </p>
        )}

        {restore.step === 'error' && (
          <p className={styles.error} role="alert" tabIndex={-1} ref={resultRef}>
            {restore.name}: {restore.message}
          </p>
        )}

        {restore.step === 'done' && (
          <p className={styles.success} role="status" tabIndex={-1} ref={resultRef}>
            {restore.message} <Link to="/">Back to the app</Link>
          </p>
        )}

        {(restore.step === 'review' || restore.step === 'restoring') && (
          <div className={styles.review} data-testid="restore-review">
            <h4 className={styles.reviewTitle} tabIndex={-1} ref={reviewHeading}>
              {restore.source.kind === 'file'
                ? restore.source.name
                : `Safety copy: ${snapshotTitle(restore.source).toLowerCase()}`}
            </h4>
            <dl className={styles.reviewFacts}>
              <dt>Made</dt>
              <dd>
                {dateTimeText(restore.checked.backup.exportedAt)}
                {restore.source.kind === 'file' &&
                  ` by app version ${restore.checked.backup.appVersion}`}
              </dd>
              <dt>Contains</dt>
              <dd data-testid="restore-contains">{summaryText(restore.checked.summary)}</dd>
              {restore.checked.fileVersion < SCHEMA_VERSION && (
                <>
                  <dt>Format</dt>
                  <dd>
                    An older data format ({restore.checked.fileVersion}); it’s updated as it’s
                    restored.
                  </dd>
                </>
              )}
              <dt>Replaces</dt>
              <dd>
                {!current
                  ? '…'
                  : !isEmpty(current)
                    ? `${summaryText(current)} in this browser now`
                    : 'Nothing: this browser has no data yet'}
              </dd>
            </dl>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.danger}
                onClick={replace}
                disabled={restore.step === 'restoring'}
              >
                {restore.step === 'restoring' ? 'Restoring…' : 'Replace with this backup'}
              </button>
              {current && !isEmpty(current) && (
                <button
                  type="button"
                  className={styles.button}
                  onClick={backUp}
                  disabled={backing || restore.step === 'restoring'}
                >
                  Download what’s here first
                </button>
              )}
              <button
                type="button"
                className={styles.button}
                onClick={() => setRestore({ step: 'idle' })}
                disabled={restore.step === 'restoring'}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Safety copies ───────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="snapshots">
        <h3 id="snapshots" className={styles.cardTitle}>
          Safety copies
        </h3>
        <p className={styles.text}>
          Kept in this browser automatically before a restore or an update that changes how data is
          stored (the last 3 of each). They aren’t backups: clearing this site’s data removes them
          too.
        </p>
        {snapshots && snapshots.length === 0 && <p className={styles.note}>None yet.</p>}
        {snapshots && snapshots.length > 0 && (
          <ul className={styles.list} data-testid="snapshot-list">
            {snapshots.map((s) => (
              <li key={s.seq} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>{snapshotTitle(s)}</span>
                  <span className={styles.rowMeta}>
                    {dateTimeText(s.at)}: {summaryText(s.summary)}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => void downloadSnapshot(s)}
                    aria-label={`Download safety copy from ${dateTimeText(s.at)}`}
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => void reviewSnapshot(s)}
                    aria-label={`Restore safety copy from ${dateTimeText(s.at)}`}
                    disabled={restore.step === 'restoring'}
                  >
                    Restore…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
