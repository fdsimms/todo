import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { RecipeStepTimer } from '../types';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { haptics } from '../utils/haptics';
import { isStepTimerReady, isStepTimerRunning, sortStepTimers } from '../utils/stepTimers';

/** Everything a surface showing step timers draws and calls. */
export interface StepTimersBinding {
  /** The stack, ordered by `sortStepTimers`. */
  timers: RecipeStepTimer[];
  /** The clock everything derived is measured against, moving once a second. */
  now: number;
  start: (input: {
    recipeId: string;
    recipeName: string;
    stepId: string;
    stepLabel: string;
    stepExcerpt?: string;
    durationSeconds: number;
  }) => void;
  toggle: (timer: RecipeStepTimer) => void;
  addTime: (id: string) => void;
  restart: (id: string) => void;
  remove: (id: string) => void;
}

/**
 * The cooking step timers on screen, wired up — the store's stack, the
 * once-a-second clock everything is derived against, and the actions with their
 * haptics.
 *
 * The same "one hook owns the clock" shape `useRecipeTimer` has, and for the
 * same reason: cook mode and the recipe screen both show these, and two
 * surfaces each keeping their own interval over one stack is how a paused timer
 * ends up still ticking on the other screen.
 *
 * The tick runs only while something is actually counting down. A stack of rung
 * timers waiting to be dismissed has nothing left to recompute, and a modal
 * mounted invisible must not hold an interval open — pass `undefined` for
 * `recipeId` to bind nothing at all, which is what a sheet does while hidden.
 */
export function useStepTimers(recipeId: string | undefined): StepTimersBinding {
  const all = useStepTimerStore(useShallow(s => s.timers));
  const store = useStepTimerStore.getState();

  const mine = useMemo(
    () => (recipeId === undefined
      ? []
      : all.filter((t): t is RecipeStepTimer => t.kind === 'recipe' && t.recipeId === recipeId)),
    [all, recipeId],
  );
  const anyRunning = mine.some(isStepTimerRunning);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [anyRunning]);

  // A timer that rings while its screen is open gets a buzz as well as the
  // alarm: iOS shows a notification banner for a foregrounded app at best and
  // AlarmKit's alert not at all, so without this the row would go quietly
  // accent while somebody was looking straight at it.
  const rung = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set(mine.map(t => t.id));
    for (const id of rung.current) if (!live.has(id)) rung.current.delete(id);
    for (const timer of mine) {
      if (!isStepTimerReady(timer, now)) {
        rung.current.delete(timer.id);
        continue;
      }
      if (rung.current.has(timer.id)) continue;
      rung.current.add(timer.id);
      haptics.timerDone();
    }
  }, [mine, now]);

  const timers = useMemo(() => sortStepTimers(mine, now), [mine, now]);

  return {
    timers,
    now,
    // None of these await the haptic: the store moves on the same frame as
    // the buzz rather than a bridge round trip after it. Removing a timer is
    // a tap rather than success, since nothing has been finished.
    start: input => {
      haptics.impactMedium();
      store.start(input);
    },
    toggle: timer => {
      haptics.tap();
      if (isStepTimerRunning(timer)) store.pause(timer.id);
      else store.resume(timer.id);
    },
    addTime: id => {
      haptics.impactLight();
      store.addTime(id);
    },
    restart: id => {
      haptics.impactMedium();
      store.restart(id);
    },
    remove: id => {
      haptics.tap();
      store.remove(id);
    },
  };
}
