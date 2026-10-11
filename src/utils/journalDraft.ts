/**
 * An unsaved new journal entry or dream, kept so a crash, a phone call or the
 * system reclaiming the app doesn't throw away what was typed.
 *
 * One draft per kind, for a new entry only (an edit already has its saved
 * text to fall back on). It lives in the settings table beside the entries
 * themselves, so it is exactly as exposed as they are: the sheet that shows
 * it sits behind the same Face ID gate, and it is never synced. Saving or
 * discarding clears it.
 */
import type { JournalKind } from '../types';
import { dbGetSetting, dbSetSetting } from '../db/database';

/** How long typing pauses before the draft is written. */
export const JOURNAL_DRAFT_DELAY_MS = 600;

export function journalDraftKey(kind: JournalKind): string {
  return `journalDraft_${kind}`;
}

/** The kept draft for `kind`, or null when there is none worth offering. */
export function readJournalDraft(kind: JournalKind): string | null {
  const raw = dbGetSetting(journalDraftKey(kind));
  return raw && raw.trim().length > 0 ? raw : null;
}

/** Keeps `text` as the draft, or clears it when nothing but space is left. */
export function writeJournalDraft(kind: JournalKind, text: string): void {
  dbSetSetting(journalDraftKey(kind), text.trim().length > 0 ? text : '');
}

export function clearJournalDraft(kind: JournalKind): void {
  dbSetSetting(journalDraftKey(kind), '');
}
