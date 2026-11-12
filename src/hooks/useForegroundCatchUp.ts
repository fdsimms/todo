import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { syncWakeUpAlarm } from '../utils/wakeUpAlarm';

/**
 * The passes a day going by can owe, run each time the app comes back to the
 * front: vacation and trip expiry, the quota day-closes, and every generator
 * whose trigger is the clock rather than an edit.
 *
 * App-level rather than on Today, where this list used to live. A tab blurred
 * by another tab is frozen and runs no effects (`.claude/rules/ui-sheets-and-lists.md`,
 * "Frozen tabs"), and Today's listener was a focus effect besides, so a phone
 * reopened on Groceries the morning after skipped every one of these until the
 * next time it was foregrounded with Today in front. The launch sequence and
 * the background refresh run the same work through `catchUpPasses`; this is
 * the warm-foreground third of it. Every pass is idempotent, which is what
 * lets all three overlap.
 *
 * Today keeps what is its own: the morning check-in (a sheet on that screen)
 * and the heartbeat that redraws its rows. Those run after these, the order a
 * cold launch already has.
 */
export function useForegroundCatchUp(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (!useTaskStore.getState().initialized) return;
      useTaskStore.getState().checkVacationExpiry();
      // A project's pause that ran out overnight, the same way.
      useTaskStore.getState().forgivePausedProjectStreaks();
      // Straight after the expiry, the order maintenancePasses uses and for
      // its reason: opening the app on the morning you fly is the moment
      // this is for, and a trip ending as another starts must resolve in
      // that order.
      useTaskStore.getState().checkAwayVacation();
      // And the day set in Settings for vacation to begin, after the trip's.
      useTaskStore.getState().checkScheduledVacation();
      // The device's time zone can change while the app sits backgrounded
      // (a flight lands mid-trip), and a phone left closed never sees a cold
      // start, so this is the chance to move wall-clock reminders before the
      // next one fires at the old zone's hour (#1205).
      useTaskStore.getState().reanchorWallClockReminders();
      useTaskStore.getState().rolloverQuotas();
      // After checkVacationExpiry: a run that was protected while vacation
      // was on should start counting again in the same pass vacation ends,
      // not one day later.
      useTaskStore.getState().rolloverNegativeStreaks();
      // Opt-in counterpart to rolloverQuotas, for allowOvershoot tasks —
      // see its doc comment in useTaskStore.ts.
      useTaskStore.getState().sweepOvershootQuotas();
      // The third quota day-close, for interval quotas — see its doc
      // comment. Here as well as on Today's 30-second tick, since a phone closed
      // before its window shut comes back with the run already over.
      useTaskStore.getState().sweepFinishedQuotaRuns();
      // After rolloverQuotas/sweepOvershootQuotas: either can complete and
      // spawn members, which changes what a project counts as scheduled.
      useTaskStore.getState().dripStalledProjects();
      // The weekly "Plan meals for the week" nudge fires purely by time
      // passing (a weekday/time trigger), and a phone that's merely
      // foregrounded — not force-quit — never sees another cold start to
      // catch it on. Without this it depended entirely on a true cold
      // launch or the OS's own background refresh actually running, which
      // for most people is close to never.
      useTaskStore.getState().checkMealPlanNudge();
      // A project goes quiet purely by time passing, and stops being quiet
      // the moment anything in it is dated — including from the review
      // task's own row, which nothing else would then clear. Same reason
      // the passes around it run here rather than waiting for a cold start.
      useTaskStore.getState().checkProjectReviewTasks();
      // A birthday arrives purely by time passing, the same trigger as the
      // passes around it, and a phone left open across midnight never sees
      // another cold start — so without this somebody's birthday task would
      // wait for a force-quit. Idempotent: the source id carries the year,
      // so a second run finds the row already there and does nothing.
      useTaskStore.getState().checkBirthdayTasks();
      // A person's other dates, same trigger and the same idempotency.
      useTaskStore.getState().checkPersonDateTasks();
      // Beside it, same trigger, same idempotency (the source id carries
      // the year) — off by default, so ordinarily a no-op check.
      useTaskStore.getState().checkBirthdayGiftTasks();
      // Same trigger again: a cadence runs out by time passing, and stops
      // needing a row the moment anything lands in that person's history —
      // including from this very row, which nothing else would then clear.
      useTaskStore.getState().checkReachOutTasks();
      // A day rolls over purely by time passing, and a phone left open
      // across midnight never sees another cold start — so without this
      // the window would stop advancing until the app was force-quit. It
      // only ever writes past its own mark
      // (mealSlotTasksWrittenThroughDayKey), so running it here as well as
      // in the launch sequence costs one day's work at most and can never
      // double-fire.
      useTaskStore.getState().checkMealSlotTasks();
      // The Stay under and Aim for tasks read the food log, and a new day
      // empties it: without this a phone reopened the next morning showed
      // yesterday's "24.9g so far" until the first meal was logged, since
      // the food log's writes were the only trigger outside a cold start.
      useTaskStore.getState().syncSnackNudgeTasks();
      useTaskStore.getState().syncLimitWarningTasks();
      useTaskStore.getState().syncGoalTargetTasks();
      // Same shape one shelf over: a pantry guess runs out purely by time
      // passing, and stops needing an answer the moment the user gives one
      // from the sheet this task links to.
      useTaskStore.getState().checkPantryReviewTasks();
      useTaskStore.getState().checkBackfillTasks();
      useTaskStore.getState().checkPantryCheckTasks();
      // A meal comes into shopping range purely by time passing, and stops
      // wanting a shop the moment the plan changes under it — re-planned,
      // moved, cooked, or the ingredients added to the list. None of those
      // mutations knows a row is sitting on Today naming the old dish, and
      // wiring the ~15 that can change a week is the "four call sites and
      // still missed one" the stacks note warns about. This pass re-runs the
      // predicate instead. After checkMealSlotTasks, which can plan a meal.
      useTaskStore.getState().checkMealShortfallTasks();
      // The freezer sibling, on the same trigger: tomorrow's dinner comes
      // into range purely by the day turning over.
      useTaskStore.getState().checkMealThawTasks();
      // The reverse-window sibling of the pass above, same trigger and the
      // same missing-cold-start problem: a planned meal a few days behind
      // that never got logged should ask about it without waiting for a
      // force-quit.
      useTaskStore.getState().checkMealLogNudgeTasks();
      // And the same for a supply whose lead time has come round while the
      // app sat in the background — a phone left open for a fortnight
      // never sees another cold start, and the whole point of a lead time
      // is that it fires on a day nobody opened the editor.
      useTaskStore.getState().checkSupplyReorderTasks();
      // And a third generator on the same shelf: which day is "tomorrow"
      // rolls over purely by time passing too, and the calendar window this
      // reads is kept current by useCalendarSync's own AppState listener
      // rather than anything here.
      useTaskStore.getState().checkCalendarReviewTasks();
      // Beside it, same trigger — the reading this checks against is kept
      // current by useWeatherSync's own AppState listener.
      useTaskStore.getState().checkWeatherTasks();
      // Beside it, same trigger: an event that has started leaves the
      // window by time passing alone. The window and the MTA snapshot it
      // reads both land asynchronously, so useTravelTaskSync re-runs it
      // when either arrives rather than this firing being the only one.
      useTaskStore.getState().checkTravelTasks();
      // Beside it: the wake-up task, and this phone's alarm for it.
      useTaskStore.getState().checkWakeUpTasks();
      syncWakeUpAlarm();
      // And the event rules, which read the same window. They ran only at
      // launch and in background refresh, so a rule whose lead day arrived
      // while the app sat open waited for the next cold start.
      useTaskStore.getState().checkEventTasks();
      // Beside it, same trigger — the crossings this checks against are
      // kept current by useScreenTimeSync's own AppState listener.
      useTaskStore.getState().checkScreenTimeTasks();
      // Beside it, same trigger: a block that ended while the app was
      // closed marks its offer ready here.
      useTaskStore.getState().checkBlockOfferTasks();
      // Beside it, same trigger, and the one that matters most for this
      // generator: a steps rule cannot be judged until evening, so the
      // launch pass is usually too early and this is where it actually
      // fires.
      useTaskStore.getState().checkHealthTasks();
      // Beside them, same trigger: which day is "today" rolls over purely
      // by time passing, and so does the length of a low run.
      useTaskStore.getState().checkMoodTasks();
      useTaskStore.getState().checkJournalTasks();
      // Lets a held WaniKani task's hour pass; useWaniKaniSync reads the
      // account on the same foreground and runs the rest when it lands.
      useTaskStore.getState().checkWaniKaniTasks();
      // And a held Franki task's, the same way (useFrankiSync reads the server).
      useTaskStore.getState().checkFrankiTasks();
      // And the weigh-in, which shares the mood check-in's shape: a day
      // rolling over is its whole trigger, so a phone that stays open for
      // days would otherwise never be asked. Async (it takes its own
      // Health read), fired and not awaited, as the launch sweep does.
      void useTaskStore.getState().checkWeighInTasks();
      // Beside it, same trigger, and this is the firing that does the real
      // work: the calendar events it weighs Saturday and Sunday against are
      // whatever useCalendarSync has read by now, which at cold launch is
      // nothing.
      useTaskStore.getState().checkWeekendNudgeTasks();
      // And any template whose schedule came due while the app sat in the
      // background (#1781) — a weekly run would otherwise wait for the next
      // cold start, which for a phone left open all week never comes. Same
      // reason dripStalledProjects is here as well as in the launch
      // sequence; checkScheduledTemplates is idempotent within a period, so
      // running it in both places can't double-fire.
      useTemplateStore.getState().checkScheduledTemplates();
      // A leftover can age from "fresh" into "soon" purely by time
      // passing, with no store mutation to trigger a reconcile — same
      // reason the other checks above run here rather than waiting for
      // the next cold start. Grocery use-up tasks share the sweep, so an
      // item the use-up cap turned away gets its task once a slot frees
      // up, soonest use-by day first across both kinds (#2924).
      useGroceryStore.getState().reconcileAllUseUpTasks();
      // A completion timer's countdown ends purely by time passing too,
      // and this is the case that matters most for it: the whole point of
      // one is a short reminder a few minutes to a few hours after
      // finishing a task, so most of them run their course while the
      // phone is sitting closed for a normal length of time rather than
      // across a cold launch. Without this the Live Activity it started
      // sat on the Lock Screen at 0:00 until the next background refresh
      // or force-quit got around to it.
      useTaskStore.getState().sweepExpiredCompletionTimers();
    });
    return () => subscription.remove();
  }, []);
}
