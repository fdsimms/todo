/**
 * The queries the Search screen offers back when the field is empty.
 *
 * Search used to open onto a single "Find any task" empty state, which is an
 * odd thing to meet on the one screen you arrive at *because* you are already
 * looking for something. Looking the same thing up twice is the common case
 * (the task you couldn't find yesterday, the recipe you half-remember), and
 * nothing was keeping it.
 *
 * Deliberately not synced (it isn't in `SYNCED_SETTING_KEYS`): what you typed
 * into a field on this phone five minutes ago is device-local the way a scroll
 * position is, and a second device offering back a search you ran on the first
 * is noise rather than continuity.
 */

/** How many past queries are kept. Enough to cover a session, short enough to read at a glance. */
export const RECENT_SEARCH_LIMIT = 8;

/**
 * A query pushed onto the front of the list: most recent first, no duplicates,
 * capped at `limit`.
 *
 * Matching for the duplicate check is case- and whitespace-insensitive, but the
 * *stored* string is the one just typed — searching "milk" after "Milk" leaves
 * one entry reading "milk", because the version you reached for most recently
 * is the one you're most likely to reach for again. A blank or whitespace-only
 * query is not a search and returns the list untouched.
 */
/** The form a query is stored in: trimmed, inner runs of whitespace collapsed. */
const tidy = (query: string) => query.trim().replace(/\s+/g, ' ');

export function addRecentSearch(list: string[], query: string, limit = RECENT_SEARCH_LIMIT): string[] {
  const trimmed = tidy(query);
  if (!trimmed) return list;
  // Both sides go through `tidy` before folding case. Everything written here
  // is already tidied, but `parseRecentSearches` will hand back whatever an
  // older build or a hand-edited database left in the setting — comparing a
  // raw stored string against a tidied one is how "pay  rent" and "pay rent"
  // end up as two entries.
  const folded = trimmed.toLowerCase();
  return [trimmed, ...list.filter(q => tidy(q).toLowerCase() !== folded)].slice(0, limit);
}

/**
 * Reads back the JSON array written to the `recentSearches` setting, tolerant
 * of anything a hand-edited database or an older build left there — same
 * contract as the other stored string lists in useSettingsStore. Also re-applies
 * the cap, so a list written by a build with a larger limit doesn't stay long.
 */
export function parseRecentSearches(raw: string | null, limit = RECENT_SEARCH_LIMIT): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .slice(0, limit);
  } catch {
    return [];
  }
}
