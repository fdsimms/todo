import type { Recipe } from '../types';
import { formatStopwatch } from './effort';

/**
 * Stopwatch math for a recipe's cook and prep timers — the same banked-segment
 * design as src/utils/timer.ts for timed tasks. See that file's header for why
 * nothing but each pair's two raw fields (`*TimerStartedAt`,
 * `*TimerElapsedSeconds`) is ever stored: how much time has elapsed is always
 * *derived* against the current clock, so a phone backgrounded or killed
 * mid-cook comes back with the right answer for free.
 *
 * **These count up and never down.** A recipe's timer exists to record how long
 * the cook or the prep actually took (the figure `applyMeasuredCookTime`
 * averages), not to ring: it used to count down from `estimatedMinutes`/
 * `prepMinutes`, which put a "Cook for 20m" countdown on every recipe that had
 * a stated time, before anything had started. Anything that needs an alarm is
 * a step, and steps have their own timers (`stepTimers.ts`). The estimate is
 * still shown beside the timer (`describeCookTime`) and compared against the
 * logged time afterwards, but nothing here reads it.
 *
 * Cook and prep are two independent timers (mise en place while something
 * else already simmers), each with its own raw field pair, but identical
 * math — `bankedElapsedSeconds` is that shared math, and every other
 * function below is a thin, explicitly-typed wrapper over it so a call site
 * reads "cookTimerElapsed(recipe)" rather than a generic "timerElapsed(recipe,
 * 'cook')" that leaves which fields it touches to be looked up.
 */
export type CookTimerState = Pick<Recipe, 'timerElapsedSeconds' | 'timerStartedAt'>;
export type PrepTimerState = Pick<Recipe, 'prepTimerElapsedSeconds' | 'prepTimerStartedAt'>;

function bankedElapsedSeconds(startedAt: string | null, bankedSeconds: number, now: number): number {
  const banked = Math.max(0, bankedSeconds ?? 0);
  if (startedAt === null) return banked;
  const started = new Date(startedAt).getTime();
  // A clock that moved backwards (timezone change, manual set) would otherwise
  // hand back a negative segment and rewind the clock.
  return banked + Math.max(0, (now - started) / 1000);
}

/** Is a cook run segment in flight right now? */
export function isCookTimerRunning(recipe: CookTimerState): boolean {
  return recipe.timerStartedAt !== null;
}

/** Total seconds spent cooking, banked segments plus the one currently running. */
export function cookTimerElapsed(recipe: CookTimerState, now: number = Date.now()): number {
  return bankedElapsedSeconds(recipe.timerStartedAt, recipe.timerElapsedSeconds, now);
}

/** Is a prep run segment in flight right now? */
export function isPrepTimerRunning(recipe: PrepTimerState): boolean {
  return recipe.prepTimerStartedAt !== null;
}

/** Total seconds spent on prep, banked segments plus the one currently running. */
export function prepTimerElapsed(recipe: PrepTimerState, now: number = Date.now()): number {
  return bankedElapsedSeconds(recipe.prepTimerStartedAt, recipe.prepTimerElapsedSeconds, now);
}

export type KitchenTimerKind = 'cook' | 'prep';

/**
 * The one running timer `CookingBar` names, or null when none is. A cook
 * timer wins over a prep timer, on any recipe: the dish on the stove is the
 * one you're likelier to need to get back to. A cook/prep timer is a
 * stopwatch and never rings, so that bar is the only thing standing between
 * starting one and forgetting it's still going once you've left the recipe.
 */
export function activeKitchenTimer<R extends CookTimerState & PrepTimerState>(
  recipes: readonly R[],
): { recipe: R; kind: KitchenTimerKind } | null {
  const cooking = recipes.find(isCookTimerRunning);
  if (cooking) return { recipe: cooking, kind: 'cook' };
  const prepping = recipes.find(isPrepTimerRunning);
  if (prepping) return { recipe: prepping, kind: 'prep' };
  return null;
}

// ==== cook mode ====

/**
 * Does cook mode draw the prep row? It does on the mise en place screen, where
 * prep happens, and on a step only while a prep timer is running or paused, so a
 * started one can't be lost. A cook who never times prep pays no footer space on
 * the steps.
 */
export function showsPrepRow(atMise: boolean, prepInProgress: boolean): boolean {
  return atMise || prepInProgress;
}

/**
 * What leaving mise en place does to the two timers. A running prep timer is
 * paused, so prep and cook never count the same minutes; the cook timer starts
 * unless a cook is already in progress (Back then Start cooking again must not
 * reset it).
 */
export function startCookingPlan(t: { prepRunning: boolean; cookInProgress: boolean }): {
  pausePrep: boolean;
  startCook: boolean;
} {
  return { pausePrep: t.prepRunning, startCook: !t.cookInProgress };
}

// ==== what the row says ====

/** The live half of a recipe timer that `RecipeTimerRow` draws: `useRecipeTimer`'s binding, narrowed. */
export interface RecipeTimerReading {
  running: boolean;
  paused: boolean;
  elapsedSeconds: number;
}

/**
 * The stopwatch as the row draws it: the number big, the state small after it
 * ("3:12 elapsed", "3:12 paused"), the split `StepTimerRow` made in #2920 and
 * this row shares. Null for a timer that hasn't started, which the row labels
 * in words instead ("Time this cook").
 */
export function recipeTimerClock(t: RecipeTimerReading): { clock: string; state: string } | null {
  if (!t.running && !t.paused) return null;
  return { clock: formatStopwatch(t.elapsedSeconds), state: t.running ? 'elapsed' : 'paused' };
}

/**
 * The confirm before Reset throws a timed cook or prep away, or null when
 * there is nothing on it to lose. Reset sits on the same row as Pause, reached
 * for mid-cook, and unlike a step timer's cancel it loses a measurement: the
 * time was about to be logged against the recipe (see `stepTimerCancelPrompt`,
 * the sibling this copies). It asks past the target too, since an overrun is
 * still a time worth logging.
 */
export function recipeTimerResetPrompt(
  verb: 'Cook' | 'Prep',
  t: Pick<RecipeTimerReading, 'running' | 'elapsedSeconds'>,
): { title: string; message: string } | null {
  if (!(t.elapsedSeconds >= 1)) return null;
  const clock = formatStopwatch(t.elapsedSeconds);
  return {
    title: `Reset the ${verb.toLowerCase()} timer?`,
    message: t.running
      ? `${clock} timed so far, not logged yet.`
      : `Paused at ${clock}, not logged yet.`,
  };
}
