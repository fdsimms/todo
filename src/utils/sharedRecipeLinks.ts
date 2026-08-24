import { normalizeRecipeUrl } from './recipeUrl';

/**
 * The queue of recipe pages shared into dundundun from another app's share
 * sheet — NYT Cooking, Safari, anything that offers a web address.
 *
 * Everything here is pure. The native drain and the App Group container are in
 * `src/hooks/useSharedRecipeLinks.ts`, the queue's own state and its persistence
 * in `src/store/useSharedLinkStore.ts`; this is the arithmetic both of them
 * share, kept apart from either so it can be tested in the `node` environment
 * like the rest of `src/utils`.
 *
 * **Nothing here fetches, and that's the design.** A share extension is a
 * separate process with a hard memory cap, no access to the app's SQLite file
 * and no way to reach the API key in the app's keychain, so all it can honestly
 * say is *which page*. The import that follows is the one a pasted link already
 * gets (`RecipeCreateSheet` → `fetchRecipePage` → `extractRecipe`), which is
 * also why a shared link waits for a tap rather than importing itself: that run
 * spends Anthropic tokens, and spending them for something shared three days ago
 * without being asked is not a thing to do quietly.
 */

/**
 * How many shared pages are kept. The same number the extension caps its own
 * file at (`SharedRecipeQueue.maxQueued`), applied again here because the two
 * queues are merged — a drain that finds 20 on top of a persisted 20 must not
 * come out at 40.
 */
export const SHARED_LINK_QUEUE_CAP = 20;

/**
 * The queue after `incoming` is added to `existing`.
 *
 * - Addresses are canonicalised through `normalizeRecipeUrl`, so the queue holds
 *   exactly what the import would accept. Anything that isn't a web address is
 *   dropped here rather than sitting in the banner waiting to fail with "that
 *   doesn't look like a web address" on the tap that opens it.
 * - Duplicates collapse to the *earlier* position. Sharing the same recipe twice
 *   is one thing to import, and the queue is worked front to back, so keeping
 *   the first slot means a re-share doesn't quietly push the page behind
 *   everything queued since.
 * - The cap drops from the front. A queue nobody has drained has stopped being a
 *   list of intentions, so the page shared most recently is the one that
 *   survives — the same call `SharedRecipeQueue.append` makes on its side.
 */
export function mergeSharedLinks(existing: string[], incoming: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...existing, ...incoming]) {
    const normalized = normalizeRecipeUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged.length > SHARED_LINK_QUEUE_CAP
    ? merged.slice(merged.length - SHARED_LINK_QUEUE_CAP)
    : merged;
}

/**
 * The queue as stored in the `settings` table, or an empty one.
 *
 * Anything unreadable reads as empty rather than throwing: the value is a
 * convenience copy of a queue whose real contents have already been deleted from
 * the App Group file, so there is nothing to recover by failing loudly, and a
 * store that can't initialize would take the Recipes screen with it.
 */
export function parseSharedLinkQueue(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return mergeSharedLinks(parsed.filter((entry): entry is string => typeof entry === 'string'), []);
  } catch {
    return [];
  }
}

export function serializeSharedLinkQueue(urls: string[]): string {
  return JSON.stringify(urls);
}

/**
 * What a queued page is called before anything has been fetched off it — its
 * host, minus a leading `www.`.
 *
 * The host and not the path: the banner is one line saying what's waiting, and
 * "cooking.nytimes.com" is recognisable in a way that a slug truncated at the
 * screen edge isn't. The page's real title only exists after the import runs.
 */
export function sharedLinkLabel(url: string): string {
  const normalized = normalizeRecipeUrl(url) ?? url;
  const withoutScheme = normalized.replace(/^https?:\/\//i, '');
  const cut = withoutScheme.search(/[/?#:]/);
  const host = cut === -1 ? withoutScheme : withoutScheme.slice(0, cut);
  return host.replace(/^www\./i, '') || url;
}
