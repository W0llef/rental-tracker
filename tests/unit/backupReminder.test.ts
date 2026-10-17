import { backupReminder, lastBackupText, snoozeUntil } from '../../src/services/backup/reminders';
import { bytesText } from '../../src/services/storage';

const now = new Date('2026-10-17T15:00:00');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const base = { hasData: true, lastBackupAt: null, remindEveryDays: 7, snoozedUntil: null, now };

describe('backup reminder', () => {
  it('is due when there is data and never a backup', () => {
    expect(backupReminder(base)).toEqual({ due: true, daysSince: null });
  });

  it('stays quiet with no data', () => {
    expect(backupReminder({ ...base, hasData: false }).due).toBe(false);
  });

  it('is due once the interval has passed', () => {
    expect(backupReminder({ ...base, lastBackupAt: daysAgo(6.9) }).due).toBe(false);
    expect(backupReminder({ ...base, lastBackupAt: daysAgo(7) })).toEqual({
      due: true,
      daysSince: 7,
    });
    expect(backupReminder({ ...base, lastBackupAt: daysAgo(2), remindEveryDays: 1 }).due).toBe(
      true,
    );
  });

  it('can be put off for a day', () => {
    const snoozed = { ...base, snoozedUntil: snoozeUntil(now) };
    expect(backupReminder(snoozed).due).toBe(false);
    expect(backupReminder({ ...snoozed, now: new Date(now.getTime() + 25 * 3_600_000) }).due).toBe(
      true,
    );
  });

  it('counts calendar days', () => {
    const lateLastNight = new Date('2026-10-16T23:30:00').toISOString();
    expect(backupReminder({ ...base, lastBackupAt: lateLastNight }).daysSince).toBe(1);
    expect(lastBackupText(0)).toBe('today');
    expect(lastBackupText(1)).toBe('yesterday');
    expect(lastBackupText(9)).toBe('9 days ago');
    expect(lastBackupText(null)).toBe('never');
  });
});

describe('storage sizes', () => {
  it('reads like a person would write them', () => {
    expect(bytesText(512)).toBe('512 bytes');
    expect(bytesText(1_250)).toBe('1.3 kB');
    expect(bytesText(340_000)).toBe('340 kB');
    expect(bytesText(12_400_000_000)).toBe('12 GB');
  });
});
