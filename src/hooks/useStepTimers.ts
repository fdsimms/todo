import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { RecipeStepTimer } from '../types';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { haptics } from '../utils/haptics';
import {
  isStepTimerReady,
  isStepTimerRunning,
  sortStepTimers,
  stepTimerRemaining,
} from '../utils/stepTimers';

/** Past the moment a timer is due, so the wake finds it rung rather than a hair short. */
const RING_SLACK_MS = 50;

/** Everything a surface showing step timers draws and calls. */
export interface StepTimersBinding {
  /** The stack, ordered by `sortStepTimers`. */
  timers: RecipeStepTimer[];
  start: (input: {
    recipeId: string;
    recipeName: string;
    stepId: string;
    stepLabel: string;
    stepExcerpt?: string;
    durationSeconds: number;
    /** Starts a repeating timer expecting this many rounds; see the store's `start`. */
    repeatTarget?: number;
  }) => void;
  toggle: (timer: RecipeStepTimer) => void;
  addTime: (id: string) => void;
  setRepeatTarget: (id: string, target: number) => void;
  restart: (id: string) => void;
  startNextRound: (id: string) => void;
  remove: (id: string) => void;
}

/**
 * The cooking step timers on screen, wired up — the store's stack, its order,
 * the buzz when one rings, and the actions with their haptics.
 *
 * Cook mode and the recipe screen both show these, and both read one stack
 * through this, so a timer paused on one is paused on the other.
 *
 * Nothing here ticks. What the stack as a whole takes from the clock is which
 * timers have rung (the order, and the buzz), and that changes only at the
 * moment one does, so this wakes then and at no other time. The countdown in
 * each row is the row's own (`StepTimerRow`, `useSecondTick`): kept here, a
 * once-a-second clock rendered the whole screen that called this for as long
 * as anything was counting down. A modal mounted invisible must hold no timer
 * open — pass `undefined` for `recipeId` to bind nothing at all, which is what
 * a sheet does while hidden.
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

  // Bumped when a running timer comes due, which is the one thing the clock
  // changes for the stack. Each wake looks again for the next one due.
  const [rungTick, setRungTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    let soonest = Infinity;
    for (const timer of mine) {
      if (!isStepTimerRunning(timer)) continue;
      const left = stepTimerRemaining(timer, now);
      if (left > 0 && left < soonest) soonest = left;
    }
    if (soonest === Infinity) return;
    const wake = setTimeout(() => setRungTick(n => n + 1), soonest * 1000 + RING_SLACK_MS);
    return () => clearTimeout(wake);
  }, [mine, rungTick]);

  // A timer that rings while its screen is open gets a buzz as well as the
  // alarm: iOS shows a notification banner for a foregrounded app at best and
  // AlarmKit's alert not at all, so without this the row would go quietly
  // accent while somebody was looking straight at it.
  const rung = useRef<Set<string>>(new Set());
  useEffect(() => {
    const live = new Set(mine.map(t => t.id));
    for (const id of rung.current) if (!live.has(id)) rung.current.delete(id);
    const now = Date.now();
    for (const timer of mine) {
      if (!isStepTimerReady(timer, now)) {
        rung.current.delete(timer.id);
        continue;
      }
      if (rung.current.has(timer.id)) continue;
      rung.current.add(timer.id);
      haptics.timerDone();
    }
  }, [mine, rungTick]);

  // Against the time as it is, not a held one: `rungTick` is what says it moved.
  const timers = useMemo(() => sortStepTimers(mine, Date.now()), [mine, rungTick]);

  return {
    timers,
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
    setRepeatTarget: (id, target) => {
      haptics.tap();
      store.setRepeatTarget(id, target);
    },
    restart: id => {
      haptics.impactMedium();
      store.restart(id);
    },
    startNextRound: id => {
      haptics.impactMedium();
      store.startNextRound(id);
    },
    remove: id => {
      haptics.tap();
      store.remove(id);
    },
  };
}
