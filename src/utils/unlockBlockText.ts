/**
 * What a locked unlock's app block is called and says, with nothing to import
 * but types: `appShield.ts` and the shield's text read it, and both are
 * deliberately free of stores. The rule that decides which unlocks block is
 * `unlockShield.ts`.
 */

export interface UnlockBlock {
  /** The unlock's id, which a release is remembered against for the day. */
  id: string;
  /** The unlock's name, for the status card and the shield screen. */
  title: string;
  /** The group as stored; the caller resolves a removed group to the fallback. */
  groupId: string;
}

/**
 * The sentence for the shield screen and the status card, written here rather
 * than on the iOS side for the reason `gateSubtitle` is: it can be tested.
 */
export function unlockBlockSubtitle(titles: readonly string[]): string {
  const named = titles.map(t => t.trim()).filter(t => t !== '');
  const tail = 'until enough of today’s work is done.';
  if (named.length === 0) return `Locked ${tail}`;
  if (named.length === 1) return `${named[0]} is locked ${tail}`;
  return `${named[0]} and ${named.length - 1} more are locked ${tail}`;
}
