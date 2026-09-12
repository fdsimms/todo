/**
 * What a completion *is*, as rows: the completed row, whatever it spawns, and
 * nothing that touches a device.
 *
 * Lifted out of `useTaskStore.completeTask` unchanged, for the reason
 * `taskDraft.ts` was lifted out of `addTask` before it. The MCP server
 * completes tasks in a replica of this database from a Node process (see
 * docs/arch/mcp-server.md), and `useTaskStore` cannot be imported there at
 * all: it reaches `expo-notifications` through `useFocusStore`. Everything
 * here reads `useSettingsStore` and `useCategoryStore` at worst, both plain
 * zustand over the database, and otherwise only pure utils.
 *
 * **Writing a second completion instead was never an option**, and that is
 * worth saying plainly because the temptation is real: a headless caller only
 * seems to need "set completed = 1". It does not. A completion decides a
 * streak against the recurrence's own cadence, spends one unit of a supply but
 * only when a person actually did the thing, advances a chain by exactly one
 * step, burns a cycle of a repeat count that a mid-chain step must not touch,
 * rolls a whole dated series over once its last date lands, and can place the
 * next chain step on a date the answer just supplied. Six flags decide all of
 * that and they are not derivable from each other. A second copy would drift
 * from this one the first time any of them changed, and nothing would fail to
 * say so.
 *
 * What stayed behind in the store is everything that is *not* a row: the
 * reminder cancel and reschedule, the deadline and completion calendar events,
 * the HealthKit write, the pending-prompt ids that drive the meal-log and
 * use-up sheets, the completion hold timers, and the undo. Those are device
 * and UI work. A task completed here and synced to a phone has the
 * notification half done for it by `rebuildNotificationQueue`, which
 * reschedules from every task rather than from the one that changed.
 *
 * The one behavioural difference from the old inline version is ordering:
 * every row is computed before any of them is written, where the store used to
 * interleave `dbUpdateTask(completed)` with the successor's computation.
 * Nothing read the database in between, so the rows are identical.
 */
import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  getNextDueDate,
  getCurrentDayStart,
  getStreakOutcome,
  getNextSeriesDates,
  getDeadlineFromOffset,
  getDeadlineFromMonthDay,
  getReminderOffsetDate,
} from './dateUtils';
import { isRecurrenceNotYetDue, isQuotaTask, quotaRidesOutTheDay, isCompletionOnTime, hasNoDateSignal } from './visibilityUtils';
import { isNegativeTask } from './negativeHabits';
import { nextStreakRecord } from './streakRecord';
import {
  followUpTaskRule,
  advanceFollowUpTaskTally,
  followUpTaskSuppressedBy,
  type FollowUpTaskSuppression,
} from './followUpTask';
import { normalizeTitle } from './taskInstances';
import { chainStepDatedByAnswer, deliverableDate } from './deliverables';
import { parseMealSlotSource, mealSlotStepTimeSegments } from './mealSlotTasks';
import { derivedId, spawnSeed } from './syncIds';
import { newTaskFromDraft, buildSeriesRow } from './taskDraft';

/** The four things a caller can say about a completion. Identical to `completeTask`'s. */
export interface CompletionOptions {
  missed?: boolean;
  deliverableValue?: string | null;
  neutral?: boolean;
  completedAt?: string;
}

/**
 * Everything `buildCompletion` would otherwise have reached a store for.
 *
 * Passed in rather than read, so the function is a pure function of its
 * arguments and a test can state a vacation or a roster without standing a
 * store up. `dayResetTime` and `vacationMode` are the only two settings the
 * old inline version read.
 */
export interface CompletionContext {
  dayResetTime: string;
  vacationMode: boolean;
  /** The moment the work is being recorded at. `completedAt` can predate it. */
  now: Date;
  /** Every task, for the follow-up roster scan, the series siblings and the sort order. */
  allTasks: readonly Task[];
  /** The completing task's own subtasks, carried onto a successor. */
  subtasks: readonly Task[];
}

/**
 * The rows a completion produces, and the two flags a caller still needs.
 *
 * `null` from `buildCompletion` itself means the completion is refused
 * outright (already done, a negative habit, a recurrence not yet due) — the
 * same three guards `completeTask` has always opened with.
 */
export interface CompletionRows {
  /** The row that was completed, ready to write. */
  completed: Task;
  /** The next occurrence or chain step, if this completion spawns one. */
  nextTask: Task | null;
  /** That successor's subtasks, cloned unchecked. */
  nextSubtasks: Task[];
  /** The every-Nth-completion task, if this completion earned one. */
  followUpTask: Task | null;
  followUpSubtasks: Task[];
  /** The next set of a repeating dated series, once its last date lands. */
  rolledOver: Task[];
  /** True when the recurrence's own schedule applied on this completion. */
  advancesBySchedule: boolean;
  /** True when the task carries a recurrence rule at all. */
  recurs: boolean;
}

/**
 * Whether this completion may run at all.
 *
 * Its own function because the MCP server has to answer it *before* asking for
 * a deliverable: a task that cannot be completed should say so rather than
 * being refused for a missing answer it was never going to use.
 *
 * - A **negative habit** has no completion to run. There is no tap that
 *   finishes "don't smoke" (see `Task.polarity`); `logSlip` is the action this
 *   polarity has instead. Refused here rather than at each caller because this
 *   is the funnel every completion path pours into, and any one of them
 *   reaching a negative habit would mark it done, spawn a successor and take
 *   it off the feed, which is precisely the row that is supposed to sit there
 *   all day.
 * - A **recurring task shown early** in Later cannot be completed ahead of
 *   schedule: doing so would generate the next occurrence off today instead of
 *   the task's real day. Non-recurring tasks have no such math, so early
 *   completion is fine for them.
 */
export function completionRefusal(task: Task): string | null {
  if (task.completed) return 'That task is already completed.';
  if (isNegativeTask(task)) {
    return 'That task is a habit you are avoiding rather than one you finish, so it has no completion. Record a slip against it instead.';
  }
  if (isRecurrenceNotYetDue(task)) {
    return 'That recurring task is not due yet, and completing it early would schedule the next occurrence off today rather than off its own day.';
  }
  return null;
}

/**
 * Build every row a completion produces, writing none of them.
 *
 * Returns null when `completionRefusal` would refuse it, so a caller that has
 * not checked still cannot complete something it should not.
 */
export function buildCompletion(
  task: Task,
  options: CompletionOptions | undefined,
  context: CompletionContext,
): CompletionRows | null {
  if (completionRefusal(task) !== null) return null;

  const { dayResetTime, vacationMode, now, allTasks, subtasks } = context;
  const missed = options?.missed ?? false;
  const neutral = options?.neutral ?? false;
  const id = task.id;
  // The morning check-in is the one caller that completes a task after the
  // fact — "yes, I did this last night" — and wants the record to say so
  // rather than reading as done at whatever moment the user got around to
  // answering. Everything else here (the successor's createdAt/seenAt, the
  // streak's getCurrentDayStart() calls) stays keyed to the real moment; only
  // the completed row's own timestamps move.
  const completedAt = options?.completedAt ? new Date(options.completedAt) : now;

  const recurs = task.recurrenceType !== 'none';
  const chainAdvances = task.chainEnabled && task.chainItems.length > 0;
  // A miss never walks forward into the next step — that would read as
  // having done Step 2 the moment Step 1 was marked missed. It ends the
  // whole chain attempt on the spot, same as reaching the real last step,
  // so the run's own bookkeeping (streak, recurrenceCount) treats a
  // mid-chain miss as a missed cycle rather than a free pass through it.
  const atChainEnd = chainAdvances && (missed || task.chainIndex >= task.chainItems.length - 1);
  // A chain is a singly linked list of steps: completing one immediately
  // creates the next, with no schedule needed, and it simply ends after
  // the last step. Repeat changes only what happens at that last step —
  // instead of ending, the whole chain loops back to the first item on
  // the recurrence's schedule. A chain with no Repeat set never spawns
  // past its last item; a plain recurring task with no chain just keeps
  // recurring on schedule as always. So the recurrence's own schedule
  // (streak, recurrenceCount, getNextDueDate) only ever applies once per
  // cycle — at the last step of a repeating chain, or on every completion
  // of a plain recurring task with no chain at all — never on a mid-chain
  // step, which always advances immediately.
  const advancesBySchedule = !chainAdvances || atChainEnd;
  // Per-step scheduling ("Next step: on the next repeat") makes every step
  // wait for the recurrence instead of spawning immediately, so the chain
  // rotates one step per occurrence. It needs a schedule to wait for, hence
  // the `recurs` guard — the flag is inert on a chain with no Repeat set.
  const stepsBySchedule = chainAdvances && recurs && task.chainStepOnSchedule;
  // Deliberately two flags, not one. `advancesBySchedule` is the recurrence's
  // *bookkeeping* — recurrenceCount, recurrenceEndDate — and stays once per
  // full cycle in both modes, because "repeat 10 times" means ten times
  // through the chain rather than ten steps. `datesBySchedule` is the
  // narrower question of whether the row we spawn gets a scheduled date,
  // which per-step mode answers yes to on every step. Collapsing them would
  // let a mid-chain step burn a cycle of the count and let the end date
  // strand a chain half-finished.
  const datesBySchedule = advancesBySchedule || stepsBySchedule;
  // A pinned chain step spawns its successor immediately, with no date and
  // no wait — so clearing the pin on that successor would drop a pinned
  // chain run out of the Pinned block mid-way through, which defeats the
  // point of pinning it. It stays pinned across every immediate step and
  // only clears when the chain actually ends (see pendingUnpinIds in the
  // store) or the user unpins by hand. Per-step scheduling (stepsBySchedule)
  // makes the next step wait for the recurrence instead, which reads the same
  // as any other future occurrence, so that case resets the pin like one.
  const chainStepStaysPinned = chainAdvances && !atChainEnd && !stepsBySchedule && task.pinned;

  // Calculate streak — see getStreakOutcome for the cadence-aware gap check (#691).
  // A miss skips all of it and breaks the streak outright (below). The gap
  // check would eventually catch it anyway — it measures the distance to the
  // next completion against the cadence — but only *lazily*, so the row would
  // keep displaying "12 day streak" until the next time the task was done.
  // An explicit miss is the one case where the break is known at the time.
  let newStreakCount = 1;
  if (!missed && recurs && datesBySchedule && task.streakDate) {
    // #1255: a task opted into streakRequiresWindow that's completed
    // outside its own timeSegments/windowStart-windowEnd window forfeits
    // the calendar-gap outcome below entirely — a late completion still
    // logs (see `completed` below), it just can't continue or preserve the
    // streak the way an on-time one does. isCompletionOnTime is vacuously
    // true for a task with no window, so the setting is inert there.
    const onTime = !task.streakRequiresWindow || isCompletionOnTime(task);
    const outcome = onTime ? getStreakOutcome(task, dayResetTime) : 'reset';
    if (outcome === 'same-day') {
      newStreakCount = task.streakCount;
    } else if (outcome === 'continued') {
      newStreakCount = task.streakCount + 1;
    }
    // else 'reset': missed too many cadence units, or completed outside the
    // task's own window → reset to 1 (already set above)
  }

  // Per step, not per cycle, when the steps are scheduled — and that isn't a
  // preference. getStreakOutcome measures the gap against the recurrence's
  // own cadence, so a 5-step daily rotation advancing its streak once per
  // cycle would show a 5-day gap against an expected 1 and read as 'reset'
  // every single time round: a streak that can never exceed 1.
  const streakAdvances = !missed && !neutral && recurs && datesBySchedule;
  // A missed occurrence breaks the streak where a completed one advances it.
  // Both write through the same previous* snapshot, so uncompleteTask undoes
  // either one without needing to know which happened.
  const streakBreaks = missed && recurs && datesBySchedule;
  // Named once because the record's fold compares against it (see
  // nextStreakRecord) and the completed row and its successor must agree.
  const nextStreak = streakBreaks ? 0 : streakAdvances ? newStreakCount : task.streakCount;

  // "Follow-up task" — every Nth completion adds a separate one-off task (see
  // Task.followUpTaskEveryN). The tally is advanced here, not derived from the
  // completed rows, which completedRetentionDays eventually purges.
  //
  // Gated on advancesBySchedule for the same reason the streak is: mid-chain
  // a completion is one *step* of the task rather than a completion of it,
  // so a three-step chain would otherwise reach "every 4th" in a day and a
  // bit. A miss doesn't count either — the rule counts completions, and
  // markMissed comes through here too.
  const followUpRule = followUpTaskRule(task);
  const followUpAdvance = followUpRule && !missed && !neutral && advancesBySchedule
    ? advanceFollowUpTaskTally(task.followUpTaskTally, followUpRule.everyN)
    : null;
  // Why an earned spawn might not happen — vacation, or one of its own
  // still outstanding. Asked only when the advance actually fires, so the
  // roster scan below costs nothing on the other N-1 completions.
  //
  // "Still outstanding" is matched on the normalized title rather than by
  // walking back to the root of the previousOccurrenceId chain: the row
  // that spawned this one is a different occurrence every time, and a
  // chain root does not survive completedRetentionDays purging a middle
  // occurrence. Same call cohortKeyOf makes in rhythms.ts, for the same
  // reason. Renaming the added row therefore reads as a different piece of
  // work and lets the next one through, which is the right answer anyway.
  let followUpSuppression: FollowUpTaskSuppression | null = null;
  if (followUpRule && followUpAdvance?.spawns) {
    const wanted = normalizeTitle(followUpRule.title);
    followUpSuppression = followUpTaskSuppressedBy(
      followUpRule,
      task.followUpTaskOneAtATime,
      vacationMode,
      allTasks.some(t =>
        !t.parentId && !t.completed && !t.archived && normalizeTitle(t.title) === wanted),
    );
  }
  // A suppressed spawn leaves the tally exactly where it was rather than
  // taking the reset it earned — see followUpTaskSuppressedBy. The advance
  // tests `>=`, so the first completion after the reason passes fires for
  // real instead of starting another full N-completion wait.
  const nextFollowUpTally = followUpAdvance && !followUpSuppression
    ? followUpAdvance.tally
    : task.followUpTaskTally;

  const completed: Task = {
    ...task,
    completed: true,
    completedAt: completedAt.toISOString(),
    // What makes this row a miss rather than a completion. It is set
    // alongside `completed`, never instead of it — see Task.missedAt.
    missedAt: missed ? completedAt.toISOString() : task.missedAt,
    // Pin is cleared once the completion hold expires, not immediately —
    // otherwise a pinned row would vanish from the Pinned section instantly
    // instead of getting the same fade-out grace period every other list
    // gives a completed task. That hold lives in the store.
    streakCount: nextStreak,
    streakDate: streakBreaks ? null : streakAdvances ? getCurrentDayStart().toISOString() : task.streakDate,
    previousStreakCount: task.streakCount,
    previousStreakDate: task.streakDate,
    // Folds the run that just ended into the record, if one did — a miss
    // breaking the streak, or a gap restarting it at 1. See nextStreakRecord
    // for why the rule is stated over the transition rather than the cause.
    priorBestStreak: nextStreakRecord(task, nextStreak),
    // Completing a quota task outright (the last unit, a swipe, a bulk
    // action) means the whole quota is done, so the row reads 8/8 rather
    // than being logged as a partial (see isQuotaPartial). A miss keeps
    // whatever count it actually reached — that's the record of the day, the
    // same way rolloverQuotas leaves a partial alone.
    //
    // The kinds that ride the day out are the exception: their whole point
    // is a tally that can land over, at, or under target, so clamping it
    // here would erase the record the sweeps exist to preserve — the
    // overshoot for allowOvershoot (see sweepOvershootQuotas), and for an
    // interval quota the honest "18 of 24 nudges taken" that the run-ended
    // sweep closes the day with.
    progressCount: isQuotaTask(task) && !missed && !quotaRidesOutTheDay(task) ? task.targetCount! : task.progressCount,
    // What was decided, where the caller had somewhere to ask. Omitted means
    // "nobody asked" — every non-interactive path (bulk, cascade, widget,
    // sweep) and every miss — which completes the row exactly as it did
    // before this feature existed, keeping whatever was already there rather
    // than nulling it. Explicit null is the user declining to answer.
    deliverableValue: options?.deliverableValue !== undefined
      ? options.deliverableValue
      : task.deliverableValue,
    followUpTaskTally: nextFollowUpTally,
    previousFollowUpTaskTally: task.followUpTaskTally,
  };

  let nextTask: Task | null = null;
  let nextSubtasks: Task[] = [];
  const spawnsNext = chainAdvances ? (recurs || !atChainEnd) : recurs;
  if (spawnsNext) {
    // The recurrence's schedule only decides the date at the point it
    // actually applies (see advancesBySchedule above) — everywhere else
    // there's no date to compute.
    // catchUp: this is placing a real row, and a successor dated before
    // today is one the user has to complete again to get rid of. See
    // getNextDueDate.
    const nextDue = recurs && datesBySchedule ? getNextDueDate(task, dayResetTime, { catchUp: true }) : null;
    // Skip the spawn only when we actually consulted the schedule and it
    // says the series has ended — a mid-chain step never consults it, so
    // it always spawns regardless of recurrenceEndDate/recurrenceCount.
    if (!advancesBySchedule || nextDue !== null) {
      // A "this task only" edit (see updateTask) stores what content fields
      // should revert to for the next occurrence in seriesDefaults — apply
      // it before spreading so the clone below reflects the series' real
      // values, not a one-off edit made on this occurrence.
      const effective: Task = { ...task, ...(task.seriesDefaults ?? {}) };
      // A mid-chain step carries no schedule of its own, so it only gets a
      // date when the step it's replacing had one — preserving placement
      // rather than always dating (which would drop a fully undated chain's
      // steps into having dates, and would drop a dated chain's steps out
      // of view entirely once they lost theirs — see isTaskVisible).
      //
      // Accepted trade-off: getNextDueDate's fixed-schedule anchor
      // (dateUtils.ts) reads the last step's own dueDate, which is now
      // "today" (whatever day that step happened to be completed) rather
      // than the cycle's original schedule-anchored date. For the normal
      // case — a chain finished in one sitting, same day it started — this
      // anchors identically to the old fixed schedule. A chain left
      // mid-way across a day boundary drifts the grid forward to the
      // completion day instead, i.e. behaves like recurrenceFromCompletion
      // for that cycle. Chosen deliberately over adding a separate
      // cycle-anchor field, which no other part of the schema needs.
      const midChainDue =
        chainAdvances && !advancesBySchedule && !hasNoDateSignal(task)
          ? (() => { const d = getCurrentDayStart(); d.setHours(12, 0, 0, 0); return d; })()
          : null;
      // Under per-step scheduling nextDue is set on every step, so it wins
      // and midChainDue never applies. The one case it still catches there
      // is a rotation whose recurrenceEndDate has passed: getNextDueDate
      // returns null, and the remaining steps land on today rather than
      // losing their date and dropping out of view. Ending the *repeat* is
      // not a request to abandon the run that's already in progress — the
      // spawn-skip below is likewise gated on advancesBySchedule, so a
      // rotation can only stop at the wrap, never half-finished.
      // A step that asked for a date and was told to pass it on (see
      // ChainItem.deliverableDatesNextStep) places the next step itself:
      // "Book haircut" is answered with the appointment, and "Get haircut"
      // lands on it rather than on today. It wins over both dates below,
      // which is the whole point — an answer given a moment ago is a better
      // placement than either the schedule's guess or "the day the previous
      // step happened to get done".
      //
      // Deliberately not gated on hasNoDateSignal the way midChainDue is:
      // that guard exists so a chain with no placement at all doesn't
      // acquire one by accident, and an answer is not an accident.
      //
      // atChainEnd covers both cases with nowhere to send it — the last step
      // of a plain chain (nothing spawns) and the wrap of a repeating one
      // (the recurrence owns that date). chainStepDatedByAnswer refuses the
      // second on its own too, via nextChainStep; both are checked because
      // this is the half that writes.
      const answeredDue = !atChainEnd && chainStepDatedByAnswer(task)
        ? deliverableDate(options?.deliverableValue)
        : null;
      const effectiveDue = answeredDue ?? nextDue ?? midChainDue;
      let nextReminderTime: string | null = effective.reminderTime;
      let nextReminderUtcOffsetMinutes: number | null = effective.reminderUtcOffsetMinutes;
      if (effectiveDue && effective.reminderTime) {
        const original = new Date(effective.reminderTime);
        const next = new Date(
          effective.reminderOffsetDays !== null
            ? getReminderOffsetDate(effectiveDue, effective.reminderOffsetDays)
            : effectiveDue
        );
        next.setHours(original.getHours(), original.getMinutes(), 0, 0);
        nextReminderTime = next.toISOString();
        nextReminderUtcOffsetMinutes = next.getTimezoneOffset();
      }
      const nextChainIndex = chainAdvances
        ? (atChainEnd ? 0 : task.chainIndex + 1)
        : task.chainIndex;
      // A meal-slot chain step's own time gate (see mealSlotStepTimeSegments)
      // doesn't carry via ...effective like everything else here — it depends
      // on *where in the chain* the spawned row lands, not on what the step
      // being completed happened to be gated by. Only the step that finishes
      // the chain (Eat, Eat X) hides behind the meal's time-of-day segment;
      // every earlier one (Choose, Prepare, Make X) is visible all day.
      // `!atChainEnd` because a real meal-slot task never carries a
      // recurrence rule (see NO_RECURRENCE) — the wrap branch below is only
      // ever reached by a user-made chain that happens to repeat, and this
      // must not reach into that for a `generatedKind` it isn't using the
      // way this generator does.
      const mealSlotSource = chainAdvances && !atChainEnd && effective.generatedKind === 'mealSlot'
        ? parseMealSlotSource(effective.generatedSourceId)
        : null;
      const nextTimeSegments = mealSlotSource
        ? mealSlotStepTimeSegments(mealSlotSource.slot, nextChainIndex, task.chainItems.length)
        : effective.timeSegments;
      // A fixed deadline is a one-off target date and doesn't carry to the next
      // occurrence. A relative deadline (deadlineOffsetDays or deadlineMonthDay
      // set — mutually exclusive) recomputes against the new dueDate instead,
      // so e.g. "the day before it's due" or "the last day of the month"
      // keeps meaning that on every future occurrence too.
      const nextDeadline =
        !effectiveDue ? null
        : effective.deadlineOffsetDays !== null
          ? getDeadlineFromOffset(effectiveDue, effective.deadlineOffsetDays).toISOString()
        : effective.deadlineMonthDay !== null
          ? getDeadlineFromMonthDay(effectiveDue, effective.deadlineMonthDay).toISOString()
          : null;
      nextTask = {
        ...effective,
        // Derived, not random: completing this task on two devices while
        // they are apart must produce one successor, not two. See syncIds.
        id: derivedId(spawnSeed.occurrence(task.id)),
        completed: false,
        completedAt: null,
        missedAt: null, // a miss belongs to the occurrence that was missed, never to its successor
        // The twin of the line above, and load-bearing rather than tidy: the
        // stamp is what stops a charge being made twice, so riding it forward
        // would mean a daily task could be charged once and then never again,
        // however many mornings it went undone after that. The configuration
        // that decides the cost still carries via ...effective.
        penaltyFiredAt: null,
        // Same reasoning one field up: the drip dated the occurrence that was
        // just completed, not this one, whose date came from the schedule.
        autoScheduledAt: null,
        createdAt: now.toISOString(),
        seenAt: now.toISOString(),
        dueDate: effectiveDue ? effectiveDue.toISOString() : null,
        deadline: nextDeadline,
        deferUntil: null,
        // Dropped alongside the defer, and for the same reason: both say
        // where *the occurrence just completed* actually sat, and neither is
        // a fact about the one taking its place. The successor's own dueDate
        // came off the grid, so it is the grid's anchor again (#1953). This
        // one is explicit because the successor is built as a row rather than
        // patched through updateTask, so the rule there doesn't reach it.
        recurrenceAnchorDate: null,
        timeSegments: nextTimeSegments,
        pinned: chainStepStaysPinned, // stays pinned through an immediate chain step; resets otherwise
        progressCount: 0, // a quota starts the new day empty
        // ...and starts it from the window again. A run begun by hand at
        // 10:30 is a statement about this morning, not about the schedule
        // (see Task.quotaStartedAt), so it rides no successor.
        quotaStartedAt: null,
        // The question carries via ...effective, the answer doesn't: this
        // occurrence hasn't been decided yet. Same split actualMinutes makes,
        // and it's what turns a recurring decision task's Logbook into the
        // log of its answers rather than one answer copied forward for ever.
        deliverableValue: null,
        // The pushes belong to the occurrence that was pushed. postponeMuted
        // deliberately isn't reset here — it rides through on ...effective,
        // because "stop asking about this one" is a statement about the task,
        // not about today's row, and a muted chore would otherwise start
        // nagging again next week just as the count climbs back.
        postponeCount: 0,
        // Cleared with it: a fresh occurrence has no run of pushes, so it has
        // no day one started from.
        driftingSince: null,
        // Carries the broken streak forward on a miss, not the pre-miss one:
        // the streak lives on whichever row is currently running it, so
        // resetting only the missed row would hand the next occurrence the
        // old count straight back and the break would never be visible.
        streakCount: nextStreak,
        streakDate: streakBreaks ? null : streakAdvances ? getCurrentDayStart().toISOString() : task.streakDate,
        previousStreakCount: task.streakCount,
        previousStreakDate: task.streakDate,
        // Rides onto the successor for the same reason the streak does: the
        // record belongs to the task, and every occurrence is a fresh row.
        priorBestStreak: nextStreakRecord(task, nextStreak),
        // Rides onto the successor like the streak does, and for the same
        // reason: every occurrence is a fresh id, so a tally left on the
        // completed row would restart the count from zero every time.
        followUpTaskTally: nextFollowUpTally,
        previousFollowUpTaskTally: task.followUpTaskTally,
        reminderTime: nextReminderTime,
        reminderUtcOffsetMinutes: nextReminderUtcOffsetMinutes,
        chainIndex: nextChainIndex,
        recurrenceCount:
          advancesBySchedule && task.recurrenceCount !== null ? task.recurrenceCount - 1 : task.recurrenceCount,
        // One unit spent per occurrence, riding onto the successor exactly
        // as recurrenceCount and the streak do — the completed row keeps the
        // count it was worked at, which is what makes uncompleting free: the
        // successor holding the decrement is the row uncompleteTask deletes,
        // so the unit comes back with it and nothing has to be added on.
        //
        // Two gates, and they are not the same gate:
        //
        // - `advancesBySchedule` mirrors recurrenceCount's. A mid-chain step
        //   is one step of one occurrence, so "Replace filter" spending a
        //   filter at every step of a five-step routine would empty the box
        //   in a single morning.
        // - **`!missed` has no counterpart on recurrenceCount, and that
        //   difference is deliberate.** A missed occurrence still burns a
        //   cycle of the schedule — that's what makes a streak break — but it
        //   emphatically does not burn a filter, because nobody changed one.
        //   The unattended sweep completing a task the user never touched is
        //   the one path that could silently empty a supply, and it's the one
        //   path that must not.
        //
        // Floored at 0 rather than allowed negative: -1 filters is not a
        // state, and `describeSupply` renders 0 as "Out", which is the thing
        // that actually happened.
        supplyCount:
          advancesBySchedule && !missed && task.supplyCount !== null
            ? Math.max(0, task.supplyCount - 1)
            : task.supplyCount,
        timerStartedAt: null, // fresh occurrence isn't running; actualMinutes/estimate carry via ...effective
        timerElapsedSeconds: 0, // countdown restarts from the top; timedMinutes carries via ...effective
        // healthMetric/healthTarget carry via ...effective too, and need no
        // reset: readiness is derived against today's reading rather than
        // stored, so tomorrow's occurrence starts unready on its own.
        // vacationPause carries over so recurring tasks stay paused across occurrences
        // blockedById carries via ...effective too, and harmlessly: for this
        // occurrence to have been completed its blocker was already done, so
        // the new row inherits a pointer at a completed task and isn't blocked.
        previousOccurrenceId: task.id, // lets uncompleting `task` remove this occurrence again
        seriesDefaults: null, // fresh occurrence starts with no pending "this task only" overrides
        // A spawned row is never one of the dates the user picked. Since a
        // series carries no recurrence rule (see NO_RECURRENCE), the only
        // way to get here from a series row is mid-chain — and a chain step
        // spawns onto the *same day* it was completed, so inheriting the
        // seriesId put a second row on a date the set already had. The next
        // date edit reconciles by calendar day, so it deleted one of them
        // and the chain's position went with it.
        seriesId: null,
        seriesMonthDays: [],
        seriesRepeatMonths: 1,
        // Carries via ...effective otherwise, and must not: the source this
        // points at is still the same meal, the same catalog row, the same
        // container, so a spawned occurrence would be a second task claiming
        // it — enough to make the reconcile decline to create the real one
        // later, and enough for a stray tick to un-cook a night that already
        // happened or reopen a leftover already closed out. A generated task
        // is a one-off by construction (nothing gives one a recurrence rule);
        // this is the defensive half of that, for a row the user made
        // recurring by hand.
        //
        // **A mid-chain step is the exception, and it's the case the rule
        // above was never about.** The reasoning is a *recurrence* one — a
        // second occupant claiming a source the first one already answered.
        // Stepping from "Choose lunch" to "Prepare lunch" isn't a second
        // claimant, it's the same run continuing, and exactly one row is live
        // at any point in it. Cleared here, a chained generated task loses
        // its identity at step two: its reconcile stops finding it (so a plan
        // change no longer reaches the row), its delete stops writing an
        // opt-out, and the next firing pass, seeing nothing live, writes a
        // duplicate underneath it. So the clear stops at the wrap: the last
        // step of a repeating chain starts a fresh cycle and does have to let
        // go, which is what `!atChainEnd` says. See utils/mealSlotTasks.ts,
        // the first generator whose task is a chain.
        generatedKind: chainAdvances && !atChainEnd ? effective.generatedKind : null,
        generatedSourceId: chainAdvances && !atChainEnd ? effective.generatedSourceId : null,
        // Never carried forward: the old occurrence's device event still
        // shows the old deadline, and this is a fresh row with a fresh
        // deadline (nextDeadline above) that needs its own event, created
        // by the store's reconcile.
        calendarEventId: null,
        // Nor this: the old occurrence's completion event logged that
        // occurrence's completion, not this fresh one's — which hasn't
        // happened yet.
        completionCalendarEventId: null,
        // Nor this: last Tuesday's block was time spent on last Tuesday's
        // occurrence. The next one starts unblocked, and asking for a slot
        // is a decision the user makes per occurrence — there is no
        // reconcile here to create one, deliberately.
        timeBlockEventId: null,
      };

      // Subtasks belong to the series, not a single occurrence — carry them
      // onto the fresh occurrence the same way duplicateTask does, reset to
      // unchecked (a subtask always starts unchecked — see TemplateItem.subtasks).
      // Chains spawn a new row on every step, so without this a chained
      // task's subtasks would vanish after the first step.
      nextSubtasks = subtasks.map(sub => ({
        ...sub,
        id: derivedId(spawnSeed.subtask(nextTask!.id, sub.id)),
        parentId: nextTask!.id,
        completed: false,
        completedAt: null,
        missedAt: null,
        autoScheduledAt: null,
        createdAt: now.toISOString(),
        seenAt: now.toISOString(),
      }));
    }
  }

  // The follow-up task is due on the *next* occurrence's day rather than piling
  // onto the completion that earned it — you rosin the bow at the bench, and
  // the practice that just finished is over. With no next occurrence (a
  // one-off, or a series that has run out) there's nothing to ride, so it
  // lands today.
  //
  // A top-level row rather than a subtask of the occurrence: every top-level
  // selector filters `!t.parentId`, so a subtask would only ever be visible
  // inside the practice row, couldn't be moved to another day on its own,
  // and would disappear the moment its parent was ticked.
  //
  // What the added task looks like past its title is the rule's own
  // `draft` (Task.followUpTaskDraft) when there is one. With none — every rule
  // written before drafts existed — each field below falls back to exactly
  // what it was: filed where the spawning task lives, and `undefined` for
  // priority and effort so newTaskFromDraft's new-task defaults still
  // apply. What the draft deliberately can't name is the stack: a stack
  // owns its members' category and cascades over them, and this is a
  // different piece of work that happens to have been earned by one of
  // them.
  let followUpTask: Task | null = null;
  let followUpSubtasks: Task[] = [];
  if (followUpRule && followUpAdvance?.spawns && !followUpSuppression) {
    const maxOrder = allTasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const spec = followUpRule.draft;
    followUpTask = newTaskFromDraft({
      title: followUpRule.title,
      dueDate: nextTask?.dueDate ?? getCurrentDayStart().toISOString(),
      notes: spec?.notes ?? '',
      // Null on the draft means "the same as the task that spawned it", so
      // it doesn't sit loose above the categories — see FollowUpTaskDraft.
      category: spec?.category ?? task.category,
      projectId: spec?.projectId ?? task.projectId,
      tags: spec?.tags ?? [],
      // undefined, not 0, when there's no draft: 0 is a real answer here
      // and would override a configured new-task default.
      priority: spec?.priority,
      effort: spec?.effort,
      estimatedMinutes: spec?.estimatedMinutes ?? null,
      timeSegments: spec?.timeSegments ?? [],
      // Written onto the row, not merely consulted at spawn time: a
      // vacation that starts after this landed should hide it too, the
      // same as any other paused row. See FollowUpTaskDraft.vacationPause.
      vacationPause: spec?.vacationPause ?? false,
      // Undo comes free: uncompleteTask deletes every uncompleted row
      // pointing back at the completion being undone, which is exactly the
      // scope wanted here — undoing the 4th practice takes the rosin task
      // with it, and the tally goes back with the restored row.
      previousOccurrenceId: task.id,
      followUpTaskSourceTitle: task.title,
    }, now.toISOString(), maxOrder + 1);
    // Derived for the same reason the occurrence above is: one milestone
    // task per completion, however many devices saw that completion.
    followUpTask = { ...followUpTask, id: derivedId(spawnSeed.extra(task.id)) };

    // Real subtask rows, since that's the only thing a subtask ever is
    // here — the draft holds title-only stubs, like TemplateItem.subtasks.
    // They ride the same undo as their parent: uncompleteTask deletes the
    // subtasks of every follow-up it takes back.
    const parentId = followUpTask.id;
    followUpSubtasks = (spec?.subtasks ?? []).map((sub, i) => newTaskFromDraft(
      // The new-task defaults are for a task someone is creating, and a
      // checklist step under one isn't that — addSubtask spells out a bare
      // row for the same reason, so category, priority and effort are said
      // rather than left to fall through.
      { title: sub.title, parentId, priority: 0, effort: 0 },
      now.toISOString(),
      i + 1,
      false,
      derivedId(spawnSeed.subtask(parentId, sub.id)),
      true,
    ));
  }

  // A repeating dated series rolls over as a whole set, not row by row:
  // the next month's dates appear only once every date in the current set
  // is done, so ticking off the 10th doesn't conjure a third row while the
  // 15th is still outstanding. Order-independent — whichever date you
  // finish last is the one that triggers it. Series rows carry
  // recurrenceType 'none' (enforced by NO_RECURRENCE, since the editor will
  // happily save a repeat rule alongside extra dates), so the recurrence
  // spawn above can never run on the same completion as this.
  const rolledOver: Task[] = [];
  if (task.seriesId && task.seriesMonthDays.length > 0) {
    const siblings = allTasks.filter(
      t => t.seriesId === task.seriesId && !t.parentId && t.id !== id
    );
    const setComplete = siblings.every(t => t.completed || t.archived);
    if (setComplete) {
      const dueDates = [...siblings, completed]
        .filter(t => t.dueDate)
        .map(t => new Date(t.dueDate!));
      const nextDates = getNextSeriesDates(dueDates, task.seriesMonthDays, task.seriesRepeatMonths);
      let order = allTasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
      for (const date of nextDates) {
        order += 1;
        rolledOver.push({
          ...buildSeriesRow(
            { ...task, ...(task.seriesDefaults ?? {}) },
            date,
            task.seriesId,
            { monthDays: task.seriesMonthDays, repeatMonths: task.seriesRepeatMonths },
          ),
          sortOrder: order,
          // Derived per date, so a rollover triggered on two devices lands
          // on one row per date rather than two. See syncIds.
          id: derivedId(spawnSeed.seriesDate(id, date.toISOString())),
          // Linked to the completion that produced it, exactly as a
          // recurrence's next occurrence is, so undoing that completion
          // takes the next set back out with it (see uncompleteTask).
          previousOccurrenceId: id,
        });
      }
    }
  }

  return {
    completed,
    nextTask,
    nextSubtasks,
    followUpTask,
    followUpSubtasks,
    rolledOver,
    advancesBySchedule,
    recurs,
  };
}

/** The settings `buildCompletion` needs, read from the store. */
export function completionSettings(): Pick<CompletionContext, 'dayResetTime' | 'vacationMode'> {
  const { dayResetTime, vacationMode } = useSettingsStore.getState();
  return { dayResetTime, vacationMode };
}
