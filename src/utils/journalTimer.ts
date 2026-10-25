/**
 * The writing timer in the journal entry sheet: a countdown the person starts
 * by hand, for the length they last picked. See `docs/arch/journal.md`,
 * "The writing timer".
 *
 * It is a pace for one sitting and nothing more. The running timer lives in the
 * sheet and ends with it, nothing about it is stored on the entry, and no
 * total or streak is read from it. Only the length last picked is kept, so the
 * next sitting starts from it.
 */
import { dbGetSetting, dbSetSetting } from '../db/database';

/** The lengths the menu lists, in minutes. Any whole number in `JOURNAL_TIMER_RANGE` can be typed instead. */
export const JOURNAL_TIMER_MINUTES = [5, 10, 15, 20] as const;

/** What a typed length may be: a minute to two hours. */
export const JOURNAL_TIMER_RANGE = { min: 1, max: 120 };

export const DEFAULT_JOURNAL_TIMER_MINUTES = 10;

/** Device-local, like the draft: the remembered length is not synced. */
export const JOURNAL_TIMER_SETTING = 'journalTimerMinutes';

/** A stored length, or the default when nothing valid is there. */
export function parseJournalTimerMinutes(raw: string | null | undefined): number {
  const minutes = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(minutes) && minutes >= JOURNAL_TIMER_RANGE.min && minutes <= JOURNAL_TIMER_RANGE.max
    ? minutes
    : DEFAULT_JOURNAL_TIMER_MINUTES;
}

export function readJournalTimerMinutes(): number {
  return parseJournalTimerMinutes(dbGetSetting(JOURNAL_TIMER_SETTING));
}

export function writeJournalTimerMinutes(minutes: number): void {
  dbSetSetting(JOURNAL_TIMER_SETTING, String(parseJournalTimerMinutes(String(minutes))));
}

/** Milliseconds left, never below zero. */
export function journalTimerRemainingMs(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now);
}

/** How far through, 0 to 1. A clock set backwards reads as not started. */
export function journalTimerProgress(startedAt: number, endsAt: number, now: number): number {
  const total = endsAt - startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / total));
}

/** "9:41": whole seconds rounded up, so the display reads 0:00 only once time is up. */
export function formatJournalTimerClock(remainingMs: number): string {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
