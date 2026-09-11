import React from 'react';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { FoodLogEntrySheet } from './FoodLogEntrySheet';

/**
 * `pendingManualMealLog`'s own mount — the search sheet's counterpart to
 * `LogMealPrompt`, for a meal `offerMealLog` (`useTaskStore.ts`) couldn't
 * measure automatically.
 *
 * Mounted once, beside `LogMealPrompt` and `FinishLeftoverPrompt`, for the
 * same reason those two are: completing the Eat step, or a log-nudge task,
 * can land here from Today, Search, Stuck, the widget or a bulk-complete,
 * not from any one screen.
 *
 * **It waits for the leftover Alert rather than stacking on it**, the same
 * guard `LogMealPrompt` keeps — ticking the meal task for a leftover-backed
 * meal can raise `pendingFinishLeftoverId` in the same commit, and a sheet
 * drawn over a native Alert is a dialog nobody can read.
 *
 * **Closing clears the flag whether or not anything was saved.**
 * `FoodLogEntrySheet` already guards its own swipe-to-dismiss when something
 * is picked or typed (`handleCancel`), so `onClose` here only ever runs once
 * that guard has cleared — there is nothing further for this wrapper to ask.
 */
export function LogMealEntrySheet() {
  const pending = useFoodLogStore(s => s.pendingManualMealLog);
  const setPending = useFoodLogStore(s => s.setPendingManualMealLog);
  const pendingFinishLeftoverId = useLeftoverStore(s => s.pendingFinishLeftoverId);

  return (
    <FoodLogEntrySheet
      visible={!!pending && !pendingFinishLeftoverId}
      slot={pending?.slot ?? null}
      at={new Date()}
      initialQuery={pending?.label ?? ''}
      mealPlanEntryId={pending?.mealPlanEntryId ?? null}
      onClose={() => setPending(null)}
    />
  );
}
