import { normalizeRecipeUrl } from './recipeUrl';

/**
 * The rule for reading the Share extension's queue — pure, and so its own file
 * rather than living beside the drain in `sharedRecipeImport.ts`: that module
 * reaches `react-native` and the native bridge, neither of which loads in the
 * `node` environment the suite runs in. Same split `recipeUrl`/`recipePage`
 * already draws.
 */

/**
 * The one address to act on, out of everything queued since the app was last
 * open, or null when none of it is usable.
 *
 * **The newest wins, and the rest are dropped rather than queued up.** Opening
 * one import sheet is all the app can do at once, and a stack of them waiting
 * behind it is a modal trap — five shares in a row would mean five sheets to
 * dismiss before reaching the list. The extension keeps only the newest 20 for
 * the same reason it keeps any: the last thing shared is the one being looked
 * for.
 *
 * Every entry is re-validated here even though `ShareViewController` already
 * dropped anything that wasn't http(s). The queue is a JSON file written by
 * another process; the app doesn't get to assume it's well-formed.
 */
export function pickSharedRecipeUrl(queued: readonly unknown[]): string | null {
  for (let i = queued.length - 1; i >= 0; i--) {
    const entry = queued[i];
    if (typeof entry !== 'string') continue;
    const normalized = normalizeRecipeUrl(entry);
    if (normalized) return normalized;
  }
  return null;
}
