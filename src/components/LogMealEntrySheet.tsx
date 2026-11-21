import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useSavedMealsStore } from '../store/useSavedMealsStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { dayKeyOf, getCurrentDayStart, getLogicalToday } from '../utils/dateUtils';
import { logInstantFor } from '../utils/foodLog';
import { featureHidden } from '../utils/simpleMode';
import { FoodLogEntrySheet } from './FoodLogEntrySheet';
import { SavedMealReviewSheet } from './SavedMealReviewSheet';
import { SavedMealsSheet } from './SavedMealsSheet';
import { ScanToLogFlow } from './ScanToLogFlow';
import type { LabelSubject } from './LabelSubjectSheet';
import type { MealSlot, SavedMeal } from '../types';

/**
 * When the meal is logged as having been eaten: now for today's, noon for
 * another day's. See `logInstantFor`.
 */
function mealInstant(dayKey: string): Date {
  return logInstantFor(dayKey, dayKeyOf(getCurrentDayStart()));
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
 * **So is estimating it, behind the same gate `FoodLogScreen` uses**
 * (`estimateRoute !== 'unavailable'`): a meal-plan prompt is as likely to be
 * a takeout order nobody's going to find in a search as anything logged from
 * the food log screen. The estimate runs inside `FoodLogEntrySheet` itself and
 * carries its `mealPlanEntryId`, so it links back to the meal exactly as a
 * searched entry would.
 *
 * **`pending` stays put while Scan is open, and the scanner is handed to
 * `FoodLogEntrySheet` as `overlays` so it renders inside its Modal.**
 * Opening it used to clear `pending`, closing this sheet outright, so backing
 * out of a scan landed on the food log with nothing rather than back where you
 * started. Keeping `pending` is what fixes that: only a completed Log clears
 * it (`onLogged`), so cancelling reveals this sheet again exactly as it was
 * left, typed query included.
 *
 * **Rendering them out here as siblings is what broke this, and "it stays
 * open behind the database search" is not the precedent it looked like.**
 * iOS presents a Modal from `[self reactViewController]` — the nearest view
 * controller up the responder chain — and a view controller can present only
 * one thing at a time. `EstimateAmountSheet` works *because it is rendered
 * inside* `FoodLogEntrySheet`'s own Modal, so it presents from that sheet's
 * view controller, which is presenting nothing. As siblings, the scanner and
 * the old describe sheet
 * presented from the *root* view controller, which was already presenting
 * this sheet: UIKit refused, nothing appeared, and RN had already flipped its
 * internal `_isPresented`, so the flow wedged with no error to point at it.
 * Both buttons did nothing and froze the food log.
 *
 * Hiding this sheet for the duration is the other fix and is what
 * `ScanToLogFlow` does internally for its own scanner. It is the wrong one
 * here: a hidden Modal unmounts its children once it finishes dismissing, so
 * a cancelled scan would hand back an empty search field.
 *
 * **Saved meals are offered here as on the food log screen**: a SAVED MEALS
 * block under a typed name, and the "Log a saved meal" tile, both of which
 * `FoodLogEntrySheet` shows only when its caller passes the saved-meal props.
 * Logging one writes its entries on the planned meal's own day and slot, linked
 * to that plan entry (`logMeal`'s `mealPlanEntryId`), and clears `pending` like
 * any other completed log. `FoodLogScreen` keeps its own copy of this glue
 * because it has a third host (the header's list), so a change to how a saved
 * meal is reviewed or logged belongs in both.
 */
export function LogMealEntrySheet() {
  const pending = useFoodLogStore(s => s.pendingManualMealLog);
  const setPending = useFoodLogStore(s => s.setPendingManualMealLog);
  const pendingFinishLeftoverId = useLeftoverStore(s => s.pendingFinishLeftoverId);
  const setLogMeal = useMealPlanStore(s => s.setLogMeal);
  const estimateRoute = useAiRoute('nutritionEstimate');
  // No Scan button in simplified mode, same gate as the food log's own.
  const simpleMode = useSettingsStore(s => s.simpleMode);

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
    { slot: MealSlot | null; dayKey: string; mealPlanEntryId: string | null; code: string | null } | null
  >(null);
  // The food whose nutrition label is being photographed, with what `scan`
  // captures because `pending` is gone once the panel is saved.
  const [label, setLabel] = useState<
    { subject: LabelSubject; slot: MealSlot | null; dayKey: string; mealPlanEntryId: string | null } | null
  >(null);

  // ==== saved meals ====
  const savedMeals = useSavedMealsStore(useShallow(s => s.meals));
  const logSavedMeal = useSavedMealsStore(s => s.logMeal);
  const removeSavedMeal = useSavedMealsStore(s => s.removeMeal);
  const replaceSavedMealItems = useSavedMealsStore(s => s.replaceItems);
  const [savedMealsOpen, setSavedMealsOpen] = useState(false);
  // An id, so the review reads the store's current copy after "Save changes to
  // this meal" rewrites it. `reviewHost` says which sheet it is raised from:
  // each renders its own review inside its own Modal, and only that one shows.
  const [reviewMealId, setReviewMealId] = useState<string | null>(null);
  const [reviewHost, setReviewHost] = useState<'list' | 'search'>('list');
  const reviewMeal = savedMeals.find(m => m.id === reviewMealId) ?? null;
  const shownReviewMeal = useSheetSubject(reviewMeal);
  const openReview = (meal: SavedMeal, host: 'list' | 'search') => {
    setReviewHost(host);
    setReviewMealId(meal.id);
  };

  /**
   * Writes a saved meal on the planned meal's day, linked to it, and finishes
   * the prompt. Everything nested is closed in the same commit, which
   * `SheetModal` sequences innermost first.
   */
  const logSaved = (meal: SavedMeal, slot: MealSlot | null) => {
    if (!pending) return;
    logSavedMeal(meal, slot ?? pending.slot, mealInstant(pending.dayKey), { mealPlanEntryId });
    setSavedMealsOpen(false);
    setReviewMealId(null);
    setPending(null);
  };

  const savedMealReview = (host: 'list' | 'search') => shownReviewMeal && (
    <SavedMealReviewSheet
      visible={reviewMeal !== null && reviewHost === host}
      meal={shownReviewMeal}
      slot={pending?.slot ?? null}
      at={pending ? mealInstant(pending.dayKey) : new Date()}
      onLog={(items, chosenSlot) => logSaved({ ...shownReviewMeal, items }, chosenSlot)}
      onSaveChanges={items => replaceSavedMealItems(shownReviewMeal.id, items)}
      onClose={() => setReviewMealId(null)}
    />
  );

  return (
    <FoodLogEntrySheet
        visible={!!pending && !pendingFinishLeftoverId}
        slot={pending?.slot ?? null}
        at={pending ? mealInstant(pending.dayKey) : new Date()}
        initialQuery={pending?.label ?? ''}
        mealPlanEntryId={mealPlanEntryId}
        onClose={() => setPending(null)}
        onScan={featureHidden('barcodeScanning', simpleMode) ? undefined : code => {
          setScan({ slot: pending?.slot ?? null, dayKey: pending?.dayKey ?? dayKeyOf(getLogicalToday()), mealPlanEntryId, code: code ?? null });
        }}
        onPhotographLabel={featureHidden('barcodeScanning', simpleMode) ? undefined : subject => {
          setLabel({ subject, slot: pending?.slot ?? null, dayKey: pending?.dayKey ?? dayKeyOf(getLogicalToday()), mealPlanEntryId });
        }}
        canEstimate={estimateRoute !== 'unavailable'}
        onSavedMeal={() => setSavedMealsOpen(true)}
        savedMeals={savedMeals}
        onPickSavedMeal={meal => openReview(meal, 'search')}
        onLogSavedMeal={(meal, slot) => logSaved(meal, slot)}
        onDeclineMeal={mealPlanEntryId ? () => {
          setLogMeal(mealPlanEntryId, false);
          setPending(null);
        } : undefined}
        overlays={
          <>
            <ScanToLogFlow
              visible={!!scan}
              slot={(scan ?? label)?.slot ?? null}
              at={(scan ?? label) ? mealInstant((scan ?? label)!.dayKey) : new Date()}
              mealPlanEntryId={(scan ?? label)?.mealPlanEntryId ?? null}
              onClose={() => setScan(null)}
              onLogged={() => setPending(null)}
              initialCode={scan?.code ?? null}
              label={label?.subject ?? null}
              onLabelClose={() => setLabel(null)}
            />
            <SavedMealsSheet
              visible={savedMealsOpen}
              meals={savedMeals}
              onLog={meal => logSaved(meal, pending?.slot ?? null)}
              onDelete={meal => removeSavedMeal(meal.id)}
              onReview={meal => openReview(meal, 'list')}
              onClose={() => { setSavedMealsOpen(false); setReviewMealId(null); }}
              // Inside the list's own Modal, for the same reason the list is
              // inside this sheet's (the sibling Modal rule).
              overlays={savedMealReview('list')}
            />
            {savedMealReview('search')}
          </>
        }
    />
  );
}
