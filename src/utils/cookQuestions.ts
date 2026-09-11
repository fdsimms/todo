import { RECIPE_STEP_NOTE_MAX_LENGTH } from '../types';
import type { CookStep } from './cookMode';
import type { FlatIngredient } from './recipeComponents';
import { scaleQuantity } from './recipeScale';
import { convertQuantity, type UnitSystem } from './unitConvert';

/**
 * Asking about the step you're standing in front of (#2241).
 *
 * Cook mode is the twenty minutes of doing the cooking, and the question that
 * comes up there is always about *this* sentence: how do I know when it's done,
 * can I do this bit ahead, what do I use instead of the thing I haven't got.
 * This module is everything about that exchange which isn't a network call or a
 * view — what the model is told, what the cook is offered to ask, and how long
 * an answer is allowed to be.
 *
 * The value is the context, not the model. A general chat app can answer "how
 * long should I sear it"; it cannot know the recipe is being read at half scale,
 * that the milk line is already oat milk because of a standing swap, or that the
 * step belongs to the mash rather than to the meal. `cookQuestionContext`
 * assembles exactly that and nothing else.
 *
 * Two rules it shares with the rest of cook mode:
 *
 * - **Asking writes nothing.** The answer is screen state, same as the step
 *   position and the ingredient panel's fold. A step only gains a `note` when
 *   someone presses Keep.
 * - **The offer is dumb on purpose.** `suggestedCookQuestions` derives its chips
 *   from the step's own words, so a wrong reading costs a chip nobody presses —
 *   the same call `stepDurationOffers` makes about a duration it thought it saw.
 */

/** How much typed question is sent. Past this is a paragraph, not a question. */
export const COOK_QUESTION_MAX_LENGTH = 200;

/**
 * How long an answer may be, in lines and in characters.
 *
 * The character ceiling is the step-note cap itself rather than a number of its
 * own, so what cook mode shows is exactly what Keep can store: a clamp here and
 * a different clamp in `setStepNote` would silently file a shortened copy of the
 * answer someone read and decided to keep.
 *
 * Four lines is the screen's limit rather than the model's. The step text is
 * what this screen is for, at `font.xxl` and readable across a counter, so an
 * answer that pushes it off the top has answered the wrong question. The prompt
 * asks for two or three sentences; this is the backstop for when it doesn't.
 */
export const COOK_ANSWER_MAX_LINES = 4;
export const COOK_ANSWER_MAX_CHARS = RECIPE_STEP_NOTE_MAX_LENGTH;

/** How much of the ingredient list travels with the question. */
const MAX_CONTEXT_INGREDIENTS = 40;

/** One ingredient line as the question carries it: the amount this cook needs. */
export interface CookContextIngredient {
  name: string;
  /** Scaled then converted, so it reads as the panel on screen does. Empty when the line gives no amount. */
  quantity: string;
  /** The recipe's own word for this line when a standing swap rewrote it. */
  swappedFrom?: string;
}

/** Everything the model is told about where the cook is standing. */
export interface CookQuestionContext {
  /** The meal being cooked — the root recipe, whatever step is on screen. */
  recipeName: string;
  /** The component the step belongs to, or null for the meal's own steps. */
  componentName: string | null;
  stepText: string;
  /** One-based, to match what the screen says. */
  stepNumber: number;
  stepCount: number;
  previousStepText: string | null;
  nextStepText: string | null;
  ingredients: CookContextIngredient[];
  /**
   * The factor the recipe is being read at, and the units it's being read in.
   *
   * The pair that makes this worth asking in the app rather than anywhere else:
   * a question about timing or pan size asked at 0.5x is a different question,
   * and nothing outside this screen knows the difference.
   */
  scale: number;
  unitSystem: UnitSystem;
}

/**
 * What to tell the model about the step on screen.
 *
 * Takes the sheet's own `steps`/`ingredients` rather than a recipe, because the
 * sheet has already done the two walks (`cookSteps`, `flattenRecipeIngredients`)
 * and a second flatten here would be a fourth copy of one walk — the call
 * `cookSteps` itself makes. Returns null when there's no step to ask about.
 *
 * Quantities run scale-then-convert, exact multiplication before rounding
 * conversion, the one order that doesn't compound — same pipeline the panel
 * above the footer draws.
 */
export function cookQuestionContext(
  recipeName: string,
  steps: readonly CookStep[],
  index: number,
  ingredients: readonly FlatIngredient[],
  scale: number,
  unitSystem: UnitSystem,
): CookQuestionContext | null {
  const step = steps[index];
  if (!step) return null;
  return {
    recipeName,
    componentName: step.whole ? null : step.recipe.name,
    stepText: step.text,
    stepNumber: index + 1,
    stepCount: steps.length,
    previousStepText: steps[index - 1]?.text ?? null,
    nextStepText: steps[index + 1]?.text ?? null,
    ingredients: ingredients.slice(0, MAX_CONTEXT_INGREDIENTS).map(flat => {
      const scaled = scaleQuantity(flat.ingredient.quantity, scale);
      const converted = convertQuantity(scaled.text, unitSystem);
      return {
        name: flat.ingredient.name,
        quantity: converted.text,
        ...(flat.swappedFrom ? { swappedFrom: flat.swappedFrom } : {}),
      };
    }),
    scale,
    unitSystem,
  };
}

/**
 * The questions offered as chips under the step, derived from the step itself.
 *
 * Two are asked of almost every step a cook is unsure about, so they're always
 * there. The third only exists when the step names something in the ingredient
 * list, which is what makes it worth a chip at all: "What can I use instead of
 * buttermilk?" is a question the app can see is *available*, where a generic
 * "what can I substitute?" would need the cook to say what they meant anyway.
 *
 * Nothing here reaches the model — generating suggestions would cost a round
 * trip to save typing a round trip.
 */
export function suggestedCookQuestions(
  stepText: string,
  ingredientNames: readonly string[],
): string[] {
  const named = ingredientNamedIn(stepText, ingredientNames);
  return [
    'How do I know when it\'s done?',
    'Can I do this part ahead?',
    ...(named ? [`What can I use instead of ${named}?`] : []),
  ];
}

/**
 * The ingredient this step names, if it names one — longest match first.
 *
 * Longest first so "brown sugar" wins over "sugar" in a recipe holding both: the
 * chip is only useful if it names the thing the cook is looking at. Matching is
 * whole-word on the ingredient's own name, which is deliberately strict — a
 * chip offering a substitute for something the step never mentioned reads as the
 * app having misread the sentence.
 */
function ingredientNamedIn(
  stepText: string,
  ingredientNames: readonly string[],
): string | null {
  const haystack = stepText.toLowerCase();
  const candidates = ingredientNames
    .map(name => name.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const name of candidates) {
    // Word boundaries by hand rather than a RegExp: an ingredient name is user
    // text and can hold any of `.`, `(`, `+` or `*`, so building a pattern out
    // of it would need escaping to do the same job.
    let from = 0;
    while (from <= haystack.length - name.length) {
      const at = haystack.indexOf(name, from);
      if (at < 0) break;
      const before = at === 0 ? ' ' : haystack[at - 1];
      const after = at + name.length >= haystack.length ? ' ' : haystack[at + name.length];
      if (!isWordChar(before) && !isWordChar(after)) return name;
      from = at + 1;
    }
  }
  return null;
}

function isWordChar(ch: string): boolean {
  return /[a-z0-9]/.test(ch);
}

/**
 * An answer, shortened to what the screen can afford.
 *
 * Blank lines go and the remaining lines are kept as lines, because a two-part
 * answer ("Yes. / If it's still loose, give it another minute") reads better
 * broken than run together. Past the line limit the rest is dropped rather than
 * joined on: a fifth line that mattered means the prompt's "two or three
 * sentences" was ignored, and the honest response is to show less, not to grow
 * the panel.
 *
 * The character cut falls back through a sentence end, then a word boundary,
 * then a hard slice, so a clamped answer ends somewhere a reader can see is an
 * ending. An empty result means there was nothing to show.
 */
export function clampCookAnswer(raw: string): string {
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, COOK_ANSWER_MAX_LINES);
  const joined = lines.join('\n');
  if (joined.length <= COOK_ANSWER_MAX_CHARS) return joined;

  const head = joined.slice(0, COOK_ANSWER_MAX_CHARS);
  // Only a boundary past the halfway mark: cutting a 500-character answer back
  // to its first 40 characters because that's where the one period was is worse
  // than cutting it mid-word with an ellipsis.
  const floor = Math.floor(COOK_ANSWER_MAX_CHARS / 2);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
  if (sentence >= floor) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(' ');
  return `${(word >= floor ? head.slice(0, word) : head).trimEnd()}…`;
}
