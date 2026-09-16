/**
 * "Close enough to be a typo of" — the one string-similarity test the app
 * shares, kept deliberately small.
 *
 * It lived in `ingredientCatalogMatch.ts` first, where it decides whether a
 * recipe's ingredient line is a misspelling of a catalog row. `eventTasks.ts`
 * wants the same question asked of an event title against a rule's cue, and
 * importing a groceries module into the calendar half of the app to get it
 * would be the wrong shape — so it moved here, unchanged.
 *
 * There is no general edit distance here on purpose, and that refusal is the
 * module: see `withinOneEdit`'s own note for why a tunable threshold is worse
 * than a fixed bound of one.
 */

/**
 * Below this many characters a one-character edit is too much of the word to
 * be evidence of anything: at three characters "ham"/"jam"/"yam" are all
 * within one edit of each other and all real.
 */
export const MIN_SIMILAR_LENGTH = 4;

/**
 * Whether two keys are within one insertion, deletion or substitution.
 *
 * Bounded at one on purpose rather than being a general edit distance with a
 * tunable threshold: two edits is where "lime"/"line"/"lint" and
 * "butter"/"batter" start colliding, and every one of those pairs is two real
 * groceries. One edit catches the transposition and the dropped letter that
 * actually happen when typing, and is cheap enough to run against the whole
 * catalog per line.
 *
 * Not Damerau — a transposition ("yoghurt"/"yogurth") counts as two
 * substitutions here and so is *not* offered. That's the conservative side of
 * the same trade, and the fuzzy picker (`CatalogLinkPicker`) is still there for
 * anything this declines.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.length - shorter.length > 1) return false;

  let i = 0;
  let j = 0;
  let edited = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (edited) return false;
    edited = true;
    // Same length means a substitution (step both); different means the extra
    // character is in `longer` alone (step only it).
    if (shorter.length === longer.length) i++;
    j++;
  }
  return true;
}

/**
 * Whether two keys differ by exactly one swap of adjacent characters —
 * "dentsit"/"dentist", "yoghurt"/"yoghrut".
 *
 * Deliberately a separate function rather than folding Damerau into
 * `withinOneEdit`, because the two have different callers and different costs.
 * A transposition is one of the most common typing slips there is, so a
 * surface *asking* "did you mean this?" wants it. A surface that writes to a
 * row on the answer does not: `withinOneEdit`'s own note explains why
 * `ingredientCatalogMatch` refuses it, and that refusal stands unchanged.
 *
 * Same length only, by construction: a swap moves characters, it never adds or
 * removes one.
 */
export function isSingleTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  let first = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (first === -1) { first = i; continue; }
    // A second difference is only allowed if it is the other half of the swap,
    // and the swap has to be of adjacent characters.
    return i === first + 1
      && a[first] === b[i]
      && a[i] === b[first]
      && a.slice(i + 1) === b.slice(i + 1);
  }
  return false;
}
