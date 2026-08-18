import { useEffect, useState } from 'react';
import type { Recipe } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { haptics } from '../utils/haptics';
import { describeCookTime, describePrepTime } from '../utils/recipeUtils';
import {
  cookTimerElapsed,
  cookTimerProgress,
  cookTimerRemaining,
  hasCookTimer,
  isCookTimerReady,
  isCookTimerRunning,
  hasPrepTimer,
  isPrepTimerReady,
  isPrepTimerRunning,
  prepTimerElapsed,
  prepTimerProgress,
  prepTimerRemaining,
} from '../utils/recipeTimer';

/** Everything RecipeTimerRow draws and calls, for one of a recipe's two timers. */
export interface RecipeTimerBinding {
  targetMinutes: number | null;
  running: boolean;
  paused: boolean;
  inProgress: boolean;
  ready: boolean;
  elapsedSeconds: number;
  remainingSeconds: number;
  progress: number;
  summary: string;
  onToggle: () => void;
  onLog: () => void;
  onReset: () => void;
  onLogManual: (minutes: number) => void;
}

/**
 * One recipe timer, wired up: the once-a-second clock, everything derived
 * against it, and the four store calls with their haptics.
 *
 * **There is one cook timer and one prep timer per recipe, and this is how any
 * surface reaches them.** Cook mode (#1695) keeps the cook timer on screen
 * throughout, which is only worth anything if it's the *same* timer the recipe
 * screen starts and logs — a second stopwatch that happens to look alike would
 * have the cook running two of them and logging one. Spreading this into
 * `RecipeTimerRow` is what makes that structural rather than a promise: both
 * screens read `Recipe.timerStartedAt`/`timerElapsedSeconds` through the same
 * derivation and write through the same actions.
 *
 * Nothing is counted down in state — the elapsed/remaining/progress numbers are
 * recomputed from the two stored fields against `nowTick` on every tick, which
 * is what makes a phone backgrounded or killed mid-cook come back with the
 * right answer (see src/utils/recipeTimer.ts). The tick itself only runs while
 * this timer is actually running.
 *
 * `recipe` is allowed to be undefined so a screen can call this above its own
 * "the row is gone" guard; the binding then reads as a stopped timer with no
 * target and its handlers do nothing.
 */
export function useRecipeTimer(recipe: Recipe | undefined, verb: 'Cook' | 'Prep'): RecipeTimerBinding {
  const isCook = verb === 'Cook';
  const startCookTimer = useRecipeStore(s => s.startCookTimer);
  const pauseCookTimer = useRecipeStore(s => s.pauseCookTimer);
  const resetCookTimer = useRecipeStore(s => s.resetCookTimer);
  const stopCookTimer = useRecipeStore(s => s.stopCookTimer);
  const logManualCookTime = useRecipeStore(s => s.logManualCookTime);
  const startPrepTimer = useRecipeStore(s => s.startPrepTimer);
  const pausePrepTimer = useRecipeStore(s => s.pausePrepTimer);
  const resetPrepTimer = useRecipeStore(s => s.resetPrepTimer);
  const stopPrepTimer = useRecipeStore(s => s.stopPrepTimer);
  const logManualPrepTime = useRecipeStore(s => s.logManualPrepTime);

  const running = recipe ? (isCook ? isCookTimerRunning(recipe) : isPrepTimerRunning(recipe)) : false;
  const startedAt = isCook ? recipe?.timerStartedAt : recipe?.prepTimerStartedAt;

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNowTick(Date.now());
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [running, startedAt]);

  if (!recipe) {
    return {
      targetMinutes: null,
      running: false,
      paused: false,
      inProgress: false,
      ready: false,
      elapsedSeconds: 0,
      remainingSeconds: 0,
      progress: 0,
      summary: '',
      onToggle: () => {},
      onLog: () => {},
      onReset: () => {},
      onLogManual: () => {},
    };
  }

  const banked = isCook ? recipe.timerElapsedSeconds : recipe.prepTimerElapsedSeconds;
  // Remaining, progress and ready are all against a target, so a timer with
  // none is a plain stopwatch and reports the flat values the row draws for one.
  const hasTarget = isCook ? hasCookTimer(recipe) : hasPrepTimer(recipe);

  return {
    targetMinutes: isCook ? recipe.estimatedMinutes : recipe.prepMinutes,
    running,
    paused: !running && banked > 0,
    inProgress: running || banked > 0,
    ready: hasTarget && (isCook ? isCookTimerReady(recipe, nowTick) : isPrepTimerReady(recipe, nowTick)),
    elapsedSeconds: isCook ? cookTimerElapsed(recipe, nowTick) : prepTimerElapsed(recipe, nowTick),
    remainingSeconds: hasTarget
      ? (isCook ? cookTimerRemaining(recipe, nowTick) : prepTimerRemaining(recipe, nowTick))
      : 0,
    progress: hasTarget
      ? (isCook ? cookTimerProgress(recipe, nowTick) : prepTimerProgress(recipe, nowTick))
      : 0,
    summary: isCook ? describeCookTime(recipe) : describePrepTime(recipe),
    onToggle: async () => {
      if (running) {
        await haptics.success();
        (isCook ? pauseCookTimer : pausePrepTimer)(recipe.id);
      } else {
        await haptics.impactMedium();
        (isCook ? startCookTimer : startPrepTimer)(recipe.id);
      }
    },
    onLog: async () => {
      await haptics.success();
      (isCook ? stopCookTimer : stopPrepTimer)(recipe.id);
    },
    onReset: async () => {
      await haptics.warning();
      (isCook ? resetCookTimer : resetPrepTimer)(recipe.id);
    },
    onLogManual: async (minutes: number) => {
      await haptics.success();
      (isCook ? logManualCookTime : logManualPrepTime)(recipe.id, minutes);
    },
  };
}
