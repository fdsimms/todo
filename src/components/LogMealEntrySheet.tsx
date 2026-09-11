import React from 'react';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
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
 *
 * **`onDeclineMeal` writes the same flag `LogMealPrompt`'s own "Don't ask
 * for this meal" does** (`MealPlanEntry.logMeal`) — the meal this sheet is
 * about might have been logged some other way already (the plain "add a
 * food" flow, an earlier manual entry with no link back), or the person
 * simply doesn't feel like logging it, and either way the answer is the
 * same "stop asking about this one". Only supplied when there's a meal to
 * decline; a leftover with no meal-plan entry has nothing this flag means.
 */
export function LogMealEntrySheet() {
  const pending = useFoodLogStore(s => s.pendingManualMealLog);
  const setPending = useFoodLogStore(s => s.setPendingManualMealLog);
  const pendingFinishLeftoverId = useLeftoverStore(s => s.pendingFinishLeftoverId);
  const setLogMeal = useMealPlanStore(s => s.setLogMeal);

  const mealPlanEntryId = pending?.mealPlanEntryId ?? null;

  return (
    <FoodLogEntrySheet
      visible={!!pending && !pendingFinishLeftoverId}
      slot={pending?.slot ?? null}
      at={new Date()}
      initialQuery={pending?.label ?? ''}
      mealPlanEntryId={mealPlanEntryId}
      onClose={() => setPending(null)}
      onDeclineMeal={mealPlanEntryId ? () => {
        setLogMeal(mealPlanEntryId, false);
        setPending(null);
      } : undefined}
    />
  );
}
