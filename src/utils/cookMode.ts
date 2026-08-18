import type { Recipe } from '../types';
import { cookedDishes, type ChoiceResolution } from './recipeComponents';

/**
 * Cook mode — the method a cooking actually reads, one step at a time (#1695).
 *
 * The screen this feeds is the only surface in the app built for the twenty
 * minutes of *doing* the cooking rather than preparing to: everything else
 * here plans, shops or files. So the rules below are all about being readable
 * with wet hands and half your attention, and about never inventing an
 * instruction the recipe didn't give.
 */

/** One instruction, as cook mode reads it. */
export interface CookStep {
  /**
   * Stable for the lifetime of one read: a `RecipeStep.id` for a structured
   * step, and a synthesized `<recipeId>:notes:<n>` for one derived from a
   * notes blob. Nothing persists it — a notes step has no row to key on, and
   * minting one would be writing the fallback back onto the recipe.
   */
  id: string;
  text: string;
  /** The recipe the step is written on — the root, or a component at any depth. */
  recipe: Recipe;
  /** True for the root's own steps: the meal itself rather than one of its parts. */
  whole: boolean;
  /**
   * True when this came from `notes` rather than `Recipe.steps` — a blob the
   * app split up, not a step anyone wrote as one. Cook mode says so, because a
   * split it guessed at must not read as the recipe's own numbering.
   */
  fromNotes: boolean;
}

/**
 * Split a `notes` blob into the steps cook mode reads it as.
 *
 * Every recipe that predates `Recipe.steps` has its method in `notes` (see the
 * field's own note), so a cook mode that only read the structured list would be
 * inert for most of the box. This is the fallback, and it is **display only** —
 * nothing here is ever written back to the recipe, so a bad split costs one
 * screen and is fixed by writing real steps.
 *
 * Two rules, both deliberately dumb:
 *
 * - **A blob with a blank line in it splits on blank lines; one without splits
 *   on newlines.** A method typed as paragraphs separated by blank lines wraps
 *   its own lines, so splitting every newline would cut sentences in half;
 *   a method typed one-per-line has no blank lines to find. Checking which
 *   shape the blob is in answers both without a heuristic per line.
 * - **A blob with no line breaks at all is one step.** Splitting on sentences
 *   is the tempting third rule and it is wrong: "Bake at 350. F." is what an
 *   abbreviation, a decimal ("add 1.5 cups") or a "Mr." does to it, and cook
 *   mode showing one long step is merely unhelpful where cook mode showing
 *   half a sentence is misleading. The screen, the keep-awake and the timer
 *   are worth having even for a one-step read.
 */
export function stepsFromNotes(notes: string): string[] {
  const blob = notes.trim();
  if (!blob) return [];
  // `\r` sits in the blank-line class as well as the trims below because a
  // pasted method arrives CRLF often enough, and a blob whose blank lines
  // read as "\n\r\n" would otherwise fall through to the newline split and
  // cut every wrapped line.
  const blankLine = /\n[ \t\r]*\n/;
  const parts = blankLine.test(blob) ? blob.split(blankLine) : blob.split('\n');
  return parts.map(part => stripEnumerator(part.trim())).filter(Boolean);
}

/**
 * Take a leading "1.", "2)", "(3)", "Step 4:", "-" or "•" off a step.
 *
 * Cook mode numbers the steps itself, so a blob that already numbers them
 * would otherwise read "1. 1. Preheat the oven". Only ever a *leading*
 * enumerator followed by whitespace, which is why "350 degrees" and "2 cups
 * flour, sifted" pass through untouched — neither carries a separator — and
 * why a match that would leave nothing behind is refused rather than applied.
 */
function stripEnumerator(text: string): string {
  const stripped = text.replace(
    /^(?:\(?\d{1,3}[.):]|(?:step|Step|STEP)\s*\d{1,3}\s*[.):]?|[-–—•*])\s+/,
    ''
  );
  return stripped.trim() || text;
}

/**
 * The whole method for one cooking of `recipe`: its own steps, then each
 * component's, depth-first, in component order.
 *
 * **Same walk and same order the flatteners take** (this reads `cookedDishes`,
 * which is that walk stopped at the nodes) — a component's steps come along
 * for the same reason its ingredients and prep tasks do: the mash is part of
 * what you're cooking, so its method is part of what you're reading. It is
 * deliberately *not* a fourth flatten of its own: the walk, the once-per-recipe
 * rule and the choice resolution are one implementation or they drift.
 *
 * The order is the walk's, root first — the app has no way to know that the
 * mash wants boiling before the steak is seared, and inventing an interleave
 * would be asserting a schedule nobody wrote. What it does instead is *say
 * whose step it is*: `whole` is false for every step that belongs to a
 * component, and cook mode heads those with the component's name so the
 * boundary is legible rather than silent.
 *
 * Per node, structured steps if it has any, its notes split up if it hasn't —
 * so a plain recipe whose method has always lived in `notes` gets a cook mode,
 * and a component that only has notes still contributes its half.
 */
export function cookSteps(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  resolution?: ChoiceResolution,
): CookStep[] {
  const out: CookStep[] = [];
  for (const dish of cookedDishes(recipe, recipesById, resolution)) {
    if (dish.recipe.steps.length > 0) {
      for (const step of dish.recipe.steps) {
        out.push({ id: step.id, text: step.text, recipe: dish.recipe, whole: dish.whole, fromNotes: false });
      }
      continue;
    }
    stepsFromNotes(dish.recipe.notes).forEach((text, index) => {
      out.push({
        id: `${dish.recipe.id}:notes:${index}`,
        text,
        recipe: dish.recipe,
        whole: dish.whole,
        fromNotes: true,
      });
    });
  }
  return out;
}

/**
 * Where in the method to actually render, given where the cook thinks they are.
 *
 * Cook mode reads the live recipe, so the step list can shrink underneath it —
 * a step deleted on the detail screen behind the modal, a component removed,
 * an either/or choice changed. The position is screen state (a cooking is not
 * an edit to the recipe, the same call `scale` makes), so it has nothing to
 * repair itself against; clamping at read time is what keeps a stale index
 * from rendering a blank step instead of the last one.
 *
 * Returns -1 for an empty list, which is the one case with no step to be on.
 */
export function clampStepIndex(index: number, count: number): number {
  if (count <= 0) return -1;
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.floor(index), count - 1);
}

/**
 * "Step 3 of 8" — the position line, and the only place cook mode counts.
 *
 * One-based, because the cook is being told where they are rather than
 * indexed into an array.
 */
export function describeStepPosition(index: number, count: number): string {
  const at = clampStepIndex(index, count);
  if (at < 0) return '';
  return `Step ${at + 1} of ${count}`;
}
