const NBSP = ' ';

/** The most a pair of words can total and still be held on one line of a sheet heading. */
export const KEEP_TOGETHER_MAX_CHARS = 16;

/**
 * Joins a title's last two words with a non-breaking space, so a name wraps
 * as "Catch up with / Helen Song" rather than leaving "Song" alone on the second
 * line. Left as it is when the pair is too long to fit one line, where a
 * non-breaking space would split it mid-word instead of at the space.
 */
export function keepTailTogether(title: string): string {
  const match = /^(.*\S)\s+(\S+)\s+(\S+)$/.exec(title.trim());
  if (!match) return title;
  const [, head, second, last] = match;
  if (second.length + 1 + last.length > KEEP_TOGETHER_MAX_CHARS) return title;
  return `${head} ${second}${NBSP}${last}`;
}
