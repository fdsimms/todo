/**
 * What the Food log's list says when nothing in it can be logged, and what to
 * do next.
 *
 * Pulled out of `FoodLogEntrySheet` because the sentence has to name only the
 * ways forward that are actually on screen. The offers above the list are
 * "Add nutrition" (always, once something is typed), the food database
 * (searching it, or adding the key that unlocks it), and Estimate (only where
 * an Anthropic key or the on-device model can answer). A note naming an offer
 * that isn't there sends someone looking for a button; a note that names none
 * was the dead end this replaced ("Nothing has figures yet" with a key to get
 * from another company's website, or a grocery item to edit first).
 *
 * "Nutrition", not "figures": the rest of the app says nutrition (the barcode
 * sheet's "Add nutrition", the grocery item's "Nutrition"), and "figures" is
 * what this sheet's code calls it.
 */

export interface FoodListEmptyNoteInput {
  /** Names of recipes matching the search that are missing the nutrition to total. */
  unfiguredRecipes: readonly string[];
  /** Whether any food or recipe at all has nutrition to log. */
  anyLoggable: boolean;
  /**
   * Whether logged-before rows are showing above the note. It then can't say
   * there is nothing to log while offering something to log.
   */
  hasHelpings: boolean;
  /** What is typed in the search field. */
  query: string;
  /** Whether a FoodData Central key is saved, so the database can be searched. */
  hasFdcKey: boolean;
  /** Whether Estimate is offered. */
  canEstimate: boolean;
}

/** The next steps for a typed food, in the order their buttons appear. */
export function foodLookupHint(hasFdcKey: boolean, canEstimate: boolean): string {
  const database = hasFdcKey
    ? 'search a food database'
    : 'search a food database (it needs a free FoodData Central key)';
  return canEstimate
    ? `Add the nutrition from the label, ${database}, or let Estimate work it out.`
    : `Add the nutrition from the label, or ${database}.`;
}

export function foodListEmptyNote(input: FoodListEmptyNoteInput): string {
  const { unfiguredRecipes, anyLoggable, hasHelpings, hasFdcKey, canEstimate } = input;
  const query = input.query.trim();
  if (unfiguredRecipes.length > 0) {
    const who = unfiguredRecipes.length === 1
      ? `${unfiguredRecipes[0]} has no nutrition yet`
      : `${unfiguredRecipes.length} matching recipes have no nutrition yet`;
    return `${who}. Too few of its ingredients have nutrition to work out a total. Add nutrition to more of them, or describe it with Estimate.`;
  }
  if (!anyLoggable) {
    if (query === '') {
      return `${hasHelpings ? 'Nothing in your catalog has nutrition yet' : 'No food has nutrition yet'}. A food can be logged once it has nutrition. Type a food above to add its nutrition or search a food database.`;
    }
    const first = hasHelpings
      ? 'Nothing in your catalog has nutrition yet'
      : `No food with nutrition matches “${query}”`;
    return `${first}. ${foodLookupHint(hasFdcKey, canEstimate)}`;
  }
  const first = hasHelpings ? 'Nothing in your catalog matches' : 'No matching food';
  const tail = 'Only foods and recipes with nutrition can be logged.';
  return query === ''
    ? `${first}. ${tail}`
    : `${first}. ${tail} ${foodLookupHint(hasFdcKey, canEstimate)}`;
}
