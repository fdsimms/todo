import React, { useState } from 'react';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import { dayKeyOf, dayKeyToDate, getLogicalToday } from '../utils/dateUtils';
import { EstimateMealSheet } from './EstimateMealSheet';
import { FoodLogEntrySheet } from './FoodLogEntrySheet';
import { ScanToLogFlow } from './ScanToLogFlow';
import type { MealSlot } from '../types';

/** Noon on the meal's own day — see the note at the call site. */
function dayKeyAtNoon(dayKey: string): Date {
  const at = dayKeyToDate(dayKey);
  at.setHours(12, 0, 0, 0);
  return at;
}

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
 *
 * **Scanning is offered here too, which is what `ScanToLogFlow` is for.**
 * A planned meal is as likely to be a packaged thing as anything logged from
 * the food log screen, and this sheet is reachable from further away, so the
 * scan being on another screen's header meant it wasn't reachable at all. The
 * scan carries the meal it is logging (`mealPlanEntryId`), so what it writes
 * is linked exactly as a searched entry would be.
 *
 * **So is describing it, same gate and same handoff `FoodLogScreen`'s own
 * sparkles action uses** (`estimateRoute !== 'unavailable'`) — a meal-plan
 * prompt is as likely to be a takeout order nobody's going to find in a
 * search as anything logged from the food log screen. `EstimateMealSheet`
 * gets the same `mealPlanEntryId` the search path already carries, so an
 * estimate logged from here links back to the meal exactly as a searched
 * entry would.
 *
 * **`pending` stays put while Scan or Describe is open, but this sheet is
 * hidden for the duration.** Opening either used to clear `pending`, closing
 * this sheet outright — so backing out of a scan or an estimate landed on the
 * food log with nothing, rather than back where you started. Keeping
 * `pending` is what fixes that: only a completed Log clears it (`onLogged` on
 * both), so cancelling either brings this sheet back. The *hiding* is a
 * separate, non-negotiable thing, and conflating the two is what broke this.
 *
 * **Two of these may never be presented at once, and "it stays open behind
 * the database search" is not the precedent it looks like.** iOS presents a
 * Modal from `[self reactViewController]` — the nearest view controller up
 * the responder chain — and a view controller can present only one thing at
 * a time. `NutritionSearchSheet` works *because it is rendered inside*
 * `FoodLogEntrySheet`'s own Modal, so it presents from that sheet's view
 * controller, which is presenting nothing. `ScanToLogFlow` and
 * `EstimateMealSheet` are rendered out here as *siblings*, so they present
 * from the root view controller, which is already presenting this sheet.
 * UIKit refuses, nothing appears, and RN has already flipped its internal
 * `_isPresented` — so the flow is wedged with no error to point at it. That
 * shipped for real: both buttons did nothing and froze the food log.
 *
 * So a sheet raised from this one hides it, and a sheet raised from *that*
 * one hides it in turn (`ScanToLogFlow` does the same for its scanner).
 * Nesting the Modal inside the one below it is the only other way, and it is
 * what `NutritionSearchSheet` does; a sibling has to hide.
 */
export function LogMealEntrySheet() {
  const pending = useFoodLogStore(s => s.pendingManualMealLog);
  const setPending = useFoodLogStore(s => s.setPendingManualMealLog);
  const pendingFinishLeftoverId = useLeftoverStore(s => s.pendingFinishLeftoverId);
  const setLogMeal = useMealPlanStore(s => s.setLogMeal);
  const estimateRoute = useAiRoute('nutritionEstimate');

  const mealPlanEntryId = pending?.mealPlanEntryId ?? null;

  /**
   * The scan session, holding what the sheet it replaced knew.
   *
   * Opening it clears `pending`, rather than hiding the sheet behind the
   * scanner and bringing it back: cancelling a scan leaves nothing half-done
   * either way, and that is the same thing tapping Scan on the food log screen
   * does to its own picker. The slot, the day and the meal are captured here
   * because they are gone from `pending` a moment later — carrying `dayKey`
   * rather than a stamped `at` keeps it the meal's own day even when that day
   * isn't today, which a stamped `new Date()` never could.
   */
  const [scan, setScan] = useState<
    { slot: MealSlot | null; dayKey: string; mealPlanEntryId: string | null } | null
  >(null);

  /** Same shape as `scan` above, for the describe-instead handoff. */
  const [estimate, setEstimate] = useState<
    { slot: MealSlot | null; dayKey: string; mealPlanEntryId: string | null } | null
  >(null);

  /**
   * A dish the estimate sheet matched to something already in the recipe
   * box, handed back to `FoodLogEntrySheet` already picked — same
   * `seedRecipeId` handoff `FoodLogScreen` uses for its own estimate sheet.
   */
  const [seedRecipeId, setSeedRecipeId] = useState<string | null>(null);

  return (
    <>
      <FoodLogEntrySheet
        // Hidden while Scan or Describe is up, and that is not optional: iOS
        // presents each of these from `[self reactViewController]`, which for
        // a Modal rendered out here is the *root* view controller. A UIKit
        // view controller can present only one thing at a time, so asking the
        // root to present a second sheet while this one is still up is
        // refused outright — nothing appears, and RN has already set its own
        // `_isPresented` flag, so the flow wedges. `pending` deliberately
        // stays set, which is what brings this sheet back on cancel.
        visible={!!pending && !pendingFinishLeftoverId && !scan && !estimate}
        slot={pending?.slot ?? null}
        at={pending ? dayKeyAtNoon(pending.dayKey) : new Date()}
        seedRecipeId={seedRecipeId}
        initialQuery={pending?.label ?? ''}
        mealPlanEntryId={mealPlanEntryId}
        onClose={() => { setPending(null); setSeedRecipeId(null); }}
        onScan={() => {
          setScan({ slot: pending?.slot ?? null, dayKey: pending?.dayKey ?? dayKeyOf(getLogicalToday()), mealPlanEntryId });
        }}
        onEstimate={estimateRoute !== 'unavailable' ? () => {
          setEstimate({ slot: pending?.slot ?? null, dayKey: pending?.dayKey ?? dayKeyOf(getLogicalToday()), mealPlanEntryId });
        } : undefined}
        onDeclineMeal={mealPlanEntryId ? () => {
          setLogMeal(mealPlanEntryId, false);
          setPending(null);
        } : undefined}
      />
      <ScanToLogFlow
        visible={!!scan}
        slot={scan?.slot ?? null}
        at={scan ? dayKeyAtNoon(scan.dayKey) : new Date()}
        mealPlanEntryId={scan?.mealPlanEntryId ?? null}
        onClose={() => setScan(null)}
        onLogged={() => setPending(null)}
      />
      <EstimateMealSheet
        visible={!!estimate}
        slot={estimate?.slot ?? null}
        at={estimate ? dayKeyAtNoon(estimate.dayKey) : new Date()}
        mealPlanEntryId={estimate?.mealPlanEntryId ?? null}
        onClose={() => setEstimate(null)}
        onLogged={() => setPending(null)}
        onPickRecipe={recipeId => {
          setSeedRecipeId(recipeId);
          setEstimate(null);
        }}
      />
    </>
  );
}
