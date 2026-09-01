/**
 * The passes that exist because time passed, in the order they have to run in.
 *
 * These were the middle of `App.tsx`'s launch sequence and nothing else. They
 * moved here when the background refresh task arrived (`backgroundRefresh.ts`),
 * because the one rule that keeps a background run correct is that it must call
 * **these exact store actions in this exact order** rather than a second
 * implementation of the same idea. Every `dayResetTime` guarantee, every
 * idempotency key, every "don't hand it back" mark and every demo refusal lives
 * inside the actions themselves; a background entry point that re-derived any
 * of it is precisely where the grace-window bug would appear, since a run at
 * 1:30am is the most likely moment in the app's life to be asked what day it is.
 *
 * So the list is the shared thing, and both callers spread it. A generator added
 * to it runs at launch and in the background without either caller being edited.
 *
 * ## Why they're in three groups
 *
 * `runBackgroundRefresh` spreads `catchUpPasses()` and deliberately not the
 * other two. The split is about what a pass is *for* when nobody is watching:
 *
 * - **`catchUpPasses`** write or reconcile rows, and their whole value is being
 *   already done when the app is next opened. A birthday task that appeared
 *   overnight is the feature working.
 * - **`expiryPasses`** and **`retentionPasses`** only ever *delete*. Nobody
 *   benefits from a row being deleted earlier — the deletion happens on the next
 *   launch either way, and it is the one class of work here that can't be undone
 *   (`purgeOldCompletedTasks` deliberately bypasses the undo stack, since a
 *   purge the user didn't just perform must not sit under their first shake of
 *   the session). Running them unattended buys nothing and risks the one thing
 *   worth not risking, so they stay a launch-time job with a person present.
 *
 * ## What is deliberately not here
 *
 * `TodayScreen`'s own foreground pass keeps its separate, slightly different
 * list, and that is not an oversight to unify: it runs on focus and on
 * foreground rather than at launch, and it carries two passes this list doesn't
 * (`sweepFinishedQuotaRuns`, `checkSupplyReorderTasks`) whose triggers arrive
 * while the user is looking at the row. Its per-line comments say why each one
 * sits there. Both lists reach the same store actions, so they can't disagree
 * about behavior; what they differ on is when to ask.
 */

import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useEventReminderStore } from '../store/useEventReminderStore';
import { rescheduleAllReminders } from './notifications';

/** A named step, the shape `runStartupSequence` isolates one at a time. */
export type MaintenanceStep = [string, () => void];

/**
 * Delete tasks whose window closed on a day that has already been and gone.
 *
 * First in the launch sequence, and launch-only: it needs settings
 * (vacationMode, dayResetTime, autoRemoveExpiredTasks) loaded for real, and it
 * has to run before vacation expiry can turn vacationMode back off — see #689.
 */
export function expiryPasses(): MaintenanceStep[] {
  return [['sweep expired tasks', () => useTaskStore.getState().sweepExpiredTasks()]];
}

/** Everything whose trigger is a clock rather than an edit. */
export function catchUpPasses(): MaintenanceStep[] {
  const tasks = () => useTaskStore.getState();
  return [
    // Turn vacation mode back off if its end date already passed while the
    // app was closed
    ['check vacation expiry', () => tasks().checkVacationExpiry()],
    // Close out quota tasks whose day ended unfinished while the app was
    // closed, so a day you fell short on is logged as a partial instead of
    // sitting overdue — also needs real settings (dayResetTime) loaded first.
    ['roll over quotas', () => tasks().rolloverQuotas()],
    // Opt-in counterpart to the pass above: an allowOvershoot task rides
    // out its whole day instead of auto-completing at target, so it needs
    // its own end-of-day close — see sweepOvershootQuotas in useTaskStore.ts.
    ['sweep overshoot quotas', () => tasks().sweepOvershootQuotas()],
    // Let projects the user opted into auto-scheduling date their own next
    // task if they've run dry. After rolloverQuotas, which can complete and
    // spawn members and so change what a project counts as scheduled; and
    // after initSettings, since "quiet" is measured in logical days.
    ['drip stalled projects', () => tasks().dripStalledProjects()],
    // Opt-in weekly nudge to plan the coming week's meals (#1121) — off by
    // default. After initSettings, since it reads mealPlanNudge* and
    // weekStartsOn, and after initTasks, whose fan-out creates the meal
    // plan tables it queries directly.
    ['check meal plan nudge', () => tasks().checkMealPlanNudge()],
    // Give quiet projects their "Review X" task, and clear the ones whose
    // project has since been scheduled. Straight after dripStalledProjects,
    // which can date a member and so settle whether a project is quiet at
    // all — running the cheaper pass first means this one never writes a
    // task the drip is about to make wrong.
    ['check project review tasks', () => tasks().checkProjectReviewTasks()],
    // Today's meal tasks — one per meal the user says they eat, whose steps
    // are what's left to decide about it. After initSettings, since the day
    // it writes for is the *logical* one; after initTasks, whose fan-out
    // creates the meal plan tables it reads to see what's already planned.
    ['check meal slot tasks', () => tasks().checkMealSlotTasks()],
    // Ask about anything the pantry has quietly stopped vouching for (off by
    // default). Grouped with the two passes above because it shares their
    // trigger — time passing rather than a source mutation — and it reads the
    // grocery catalog initTasks' fan-out has already loaded.
    // Before the drip, deliberately: the review offer is what suppresses the
    // per-item questions (see checkPantryCheckTasks), so running it second
    // would let both fire in the same sweep the first time a cupboard goes
    // doubtful enough for the bulk offer.
    ['check pantry reviews', () => tasks().checkPantryReviewTasks()],
    ['check pantry checks', () => tasks().checkPantryCheckTasks()],
    // And anything planned for the next couple of days that the kitchen
    // can't currently make (off by default). Straight after the pass above
    // for the same reason that one sits after checkMealSlotTasks: it reads
    // both the meal plan and the grocery catalog initTasks' fan-out has
    // already loaded, and it fires on a meal coming into range, which is time
    // passing rather than a source mutation.
    ['check meal shortfall tasks', () => tasks().checkMealShortfallTasks()],
    // Once a day, a task to review tomorrow's calendar — grouped with the two
    // passes above for the same reason: time passing rather than a source
    // mutation. In practice this rarely finds anything to do at cold-launch
    // time, since the calendar window itself is only ever populated by
    // useCalendarSync's own effect — but a launch that's already warm (the
    // window still holds yesterday's read) can act on it immediately rather
    // than waiting for the first foreground. Same in a background run, where
    // the window is always unread: it refuses on `!calendar.loaded` rather
    // than reading an empty window as "tomorrow is free".
    ['check calendar review tasks', () => tasks().checkCalendarReviewTasks()],
    // Beside it, same trigger again — this rarely does anything at
    // cold-launch time either, since the snapshot it reads is only ever
    // populated by useWeatherSync's own effect. A background run never has
    // one: reading the forecast needs a location read, and the app's
    // when-in-use permission string promises it never happens in the
    // background. It refuses on the snapshot's own day key instead.
    ['check weather tasks', () => tasks().checkWeatherTasks()],
    // Beside it, same trigger and the same near-no-op at cold launch: the
    // crossings it reads are only ever drained by useScreenTimeSync's own
    // effect, which has not run yet on the very first pass.
    ['check screen time tasks', () => tasks().checkScreenTimeTasks()],
    // Birthdays, which share the same trigger — a date arriving rather than a
    // source changing — and read the people initTasks' fan-out has loaded.
    // After initSettings for the same reason the meal pass is: the day a task
    // lands on is the logical one, and the lead time is a setting.
    ['check birthday tasks', () => tasks().checkBirthdayTasks()],
    // Beside the birthday pass, sharing its trigger and reading the same
    // people — off by default, so in practice this rarely does anything
    // until somebody has switched it on.
    ['check birthday gift tasks', () => tasks().checkBirthdayGiftTasks()],
    // Beside the birthday pass and for the same reason: the trigger is time
    // passing rather than a source changing. Does no work at all until
    // somebody has been opted in.
    ['check reach-out tasks', () => tasks().checkReachOutTasks()],
    // A leftover can age from "fresh" into "soon" purely by time passing too
    // — same trigger as the two passes above, and it reads the leftovers
    // initTasks' fan-out has already loaded. This used to run only on
    // foreground (TodayScreen's AppState listener), which never fires for a
    // true cold launch — so a leftover that crossed the threshold while the
    // app was closed sat with no use-up task until the app was backgrounded
    // and reopened at least once.
    ['reconcile leftover use-up tasks', () => useLeftoverStore.getState().reconcileAllLeftoverTasks()],
    // Apply any template whose schedule came due while the app was closed
    // (#1781). After initSettings, since "due" is measured in logical days
    // and gated on vacationMode; after dripStalledProjects for the same
    // reason that one sits after rolloverQuotas — a run can create tasks a
    // project counts, so the cheaper pass goes first and sees a settled list.
    ['check scheduled templates', () => useTemplateStore.getState().checkScheduledTemplates()],
  ];
}

/** The three passes that only ever delete. Launch-time, with a person present. */
export function retentionPasses(): MaintenanceStep[] {
  return [
    // Enforce the completed-task retention window, if the user set one. Last
    // of the maintenance passes on purpose: it only ever deletes rows old
    // enough to be out of every other pass's reach, and running it after
    // rolloverQuotas means a completion that pass just wrote is judged on the
    // same footing as any other.
    ['purge old completed tasks', () => useTaskStore.getState().purgeOldCompletedTasks()],
    // The meal plan's own horizon, alongside it rather than inside it: these
    // are per-event rows on a fixed 180-day window, deliberately not wired to
    // completedRetentionDays — that setting is a promise about the Logbook,
    // and "keep completions forever" must not also mean four years of dinners.
    ['purge old meal plan entries', () => useMealPlanStore.getState().purgeOldEntries()],
    // And the fridge's, which only ever takes rows the user already closed
    // out — a container nobody said they finished survives this however old
    // it is, because that is exactly the one the nudge exists to surface.
    ['purge old leftovers', () => useLeftoverStore.getState().purgeOldLeftovers()],
  ];
}

/**
 * Rebuild the whole notification queue from the tasks as they now stand.
 *
 * The same three lines `useTaskStore.initialize()` ends with, exported because
 * a warm background run has an initialized store and so never reaches them —
 * and topping the queue back up is half of what the background run is for (a
 * pace run holds only `MAX_QUOTA_NUDGES_AHEAD` pending nudges at a time, so a
 * phone left alone stops being nudged after the sixth; see #2203).
 */
export function rebuildNotificationQueue(): void {
  const { tasks } = useTaskStore.getState();
  const { tripShopId, tripStartedAt, shops } = useGroceryStore.getState();
  const eventReminders = Object.values(useEventReminderStore.getState().remindersByKey);
  rescheduleAllReminders(tasks, { shopId: tripShopId, startedAt: tripStartedAt, shops }, eventReminders);
}
