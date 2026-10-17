import { daysBetween, localDate } from '../../domain/format';

/**
 * When to remind about backups (PLAN.md §5.5): when there's data and the last backup made in
 * this browser is older than the interval in Settings (default 7 days), or there's never
 * been one. "Later" hides the reminder for a day. Pure, so it's easy to test.
 */

export const REMIND_OPTIONS = [1, 3, 7, 14, 30] as const;
export const SNOOZE_HOURS = 24;

export interface ReminderInput {
  /** Whether there's anything worth backing up (a building or unit that isn't deleted). */
  hasData: boolean;
  lastBackupAt: string | null;
  remindEveryDays: number;
  snoozedUntil: string | null;
  now: Date;
}

export interface ReminderState {
  due: boolean;
  /** Calendar days since the last backup; null when there has never been one. */
  daysSince: number | null;
}

const DAY = 86_400_000;

export function backupReminder(input: ReminderInput): ReminderState {
  const last = input.lastBackupAt ? Date.parse(input.lastBackupAt) : NaN;
  const daysSince = Number.isNaN(last)
    ? null
    : Math.max(0, daysBetween(localDate(new Date(last)), localDate(input.now)));
  if (!input.hasData) return { due: false, daysSince };
  const snoozed =
    input.snoozedUntil !== null && Date.parse(input.snoozedUntil) > input.now.getTime();
  const old = Number.isNaN(last) || input.now.getTime() - last >= input.remindEveryDays * DAY;
  return { due: old && !snoozed, daysSince };
}

export function snoozeUntil(now: Date): string {
  return new Date(now.getTime() + SNOOZE_HOURS * 3_600_000).toISOString();
}

/** "today", "yesterday", "9 days ago", "never". */
export function lastBackupText(daysSince: number | null): string {
  if (daysSince === null) return 'never';
  if (daysSince === 0) return 'today';
  if (daysSince === 1) return 'yesterday';
  return `${daysSince} days ago`;
}
