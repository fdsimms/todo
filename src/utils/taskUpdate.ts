/**
 * The pure half of `useTaskStore.updateTask`: what a patch turns a task row
 * into, and what a "this and later dates" edit writes onto the rest of a
 * dated series.
 *
 * Lifted out of the store so the MCP server's `update_task` edits a task by
 * exactly the rules the app does, the way `taskDraft.ts` (creating) and
 * `taskCompletion.ts` (completing) were lifted before it. The store keeps
 * everything that is device work around the write: reminders, quota nudges,
 * calendar events, the timer alarm, the grocery flag and the estimate write
 * back, and reopening a completed quota task whose target was raised.
 *
 * Every derivation here has the same escape hatch: a patch that names the
 * derived field itself wins outright, which is what keeps a whole-snapshot
 * undo faithful. Read the comments on each before adding one.
 */
import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { getCurrentDayStart, getTaskDayStart, recurrenceAnchorDayFor } from './dateUtils';
import { quotaRunSpan, quotaTargetForInterval } from './quotaSchedule';
import { isRotationTask, rotationTargetTotal } from './rotation';
import { MIN_TARGET_COUNT, MAX_TARGET_COUNT } from './taskKinds';
import { normalizeTargetUnit } from './quotaUnit';
import {
  canHoldSupply,
  clampSupplyCount,
  clampSupplyLeadDays,
  clampSupplyRefillCount,
  clampSupplyReorderAt,
  DEFAULT_SUPPLY_REORDER_AT,
} from './supply';
import { canHoldFollowUpTask } from './followUpTask';
import { isTaskNew } from './visibilityUtils';
import { postponeOutcome, nextPostponeCount, nextDriftingSince } from './postpone';
import { nextBountyPushes } from './rewards';
import { reanchorReminder } from './taskDraft';
import { blockerFields, blockerIdsOf } from './blocking';

// Fields that silently carry forward to the next occurrence today (spread
// via `...task` in completeTask). These are the only fields "this task only"
// edits (updateTask's { scope: 'occurrence' }) need to protect via
// seriesDefaults — recurrence-rule, chain, and schedule fields are excluded
// because each already has exactly one sensible interpretation (see
// isLiveRecurring / CLAUDE.md recurrence docs for why).
export const CONTENT_FIELDS: (keyof Task)[] = [
  'title', 'notes', 'tags', 'category', 'priority', 'effort', 'difficulty',
  'estimatedMinutes', 'timedMinutes', 'healthMetric', 'healthTarget', 'healthFollowGoal', 'windowStart', 'windowEnd', 'timeSegments', 'reminderTime', 'reminderKind', 'reminderOffsetDays', 'reminderTracksVisibility', 'linkUrl', 'phoneNumber', 'emailAddress', 'location', 'completionTimerMinutes', 'completionTimerNote',
  // The question, not the answer — `deliverableValue` is per-occurrence data
  // like progressCount and is deliberately absent, or a scope:'occurrence'
  // edit would capture one date's answer as the default for every date after.
  'deliverableKind',
  // The rest of the question, which travels with it: a Pick one's options,
  // and whether a date answer sets the trip's Leaving date. Left off, a set's
  // later dates took the kind with no options and asked in free text.
  'deliverableOptions',
  'deliverableSetsAway',
  // Grouped with the other visibility gates (windowStart, timeSegments) rather
  // than the recurrence rule: "this occurrence waits on that one-off errand" is
  // a normal thing to want, and without this a scope:'occurrence' edit would
  // quietly become the template for every occurrence after it.
  'blockedById',
  // The rest of the set, for the same reason: see Task.blockedByIds.
  'blockedByIds',
  // Whether the wait runs to the end of a repeating blocker's series.
  'waitForSeriesEnd',
  // "Only if that question gets this answer" is a gate like the two above.
  'answerGate',
  // Deliberately NOT here: postponeCount / postponeMuted. A scope:'occurrence'
  // edit captures every content field into seriesDefaults, which is applied on
  // top of the row that spawns the next occurrence — so listing them would hand
  // a fresh occurrence a stale count that completeTask had just reset to 0.
];

// The fields whose arrival in an `updates` patch means the user is writing the
// schedule itself, rather than the app moving the row around. Only these
// re-derive recurrenceAnchorDay (see updateTask).
export const SCHEDULE_FIELDS = [
  'dueDate',
  'recurrenceType',
  'recurrenceMonthDay',
  'recurrenceMonth',
  'recurrenceWeekOrdinal',
  'recurrenceFromCompletion',
] as const;

// The fields a run's span is built from. Writing any of them on an interval
// quota re-derives targetCount, because with an interval stored the count is
// arithmetic rather than an answer the user gave (see Task.quotaIntervalMinutes)
// — and arithmetic left stale is worse than arithmetic never done: a window
// shortened from eight hours to four would keep nudging every 20 minutes but go
// on expecting 24 of them, so the task would read as behind from the first
// minute of every day.
export const QUOTA_SPAN_FIELDS = ['windowStart', 'windowEnd', 'quotaIntervalMinutes', 'quotaStartedAt'] as const;

// Editing the set is editing the target, the same way editing the span is —
// so it joins QUOTA_SPAN_FIELDS in triggering a re-derive rather than needing
// its own handling in updateTask.
export const ROTATION_TARGET_FIELDS = ['rotationItems'] as const;

/**
 * `targetCount` for a task whose cadence is stored as an interval, or the
 * count it already had when it isn't.
 *
 * Reads the same span the pace ramp and the notifier read, so the three can't
 * disagree about how many units a day holds. Exported so TaskEditor can keep
 * its own on-screen count in step with the cadence as the user edits it,
 * rather than saving whatever was last typed into the stepper.
 */
export function derivedTargetCount(task: Pick<Task,
  'windowStart' | 'windowEnd' | 'quotaStartedAt' | 'quotaIntervalMinutes' | 'targetCount'
> & Partial<Pick<Task, 'rotationItems'>>): number | null {
  // A rotation's target is how many named things are in it, full stop — there
  // is nothing to type and nothing that could disagree with the set. It is
  // checked ahead of the interval because the two are not a combination the
  // editor offers and the set is the more specific claim.
  if (isRotationTask(task)) return rotationTargetTotal(task.rotationItems!);
  if (task.quotaIntervalMinutes == null) return task.targetCount;
  const { activeHoursStart, activeHoursEnd } = useSettingsStore.getState();
  const span = quotaRunSpan({
    windowStart: task.windowStart,
    windowEnd: task.windowEnd,
    quotaStartedAt: task.quotaStartedAt,
    activeHoursStart,
    activeHoursEnd,
    dayStart: getCurrentDayStart(),
  });
  return quotaTargetForInterval(span, task.quotaIntervalMinutes, {
    min: MIN_TARGET_COUNT,
    max: MAX_TARGET_COUNT,
  });
}

/**
 * The rank a newly pinned task should take: one past the highest currently in
 * use, so a pin lands at the *bottom* of the Pinned section.
 *
 * Appending rather than slotting in by sortOrder is the whole point — the
 * section is hand-orderable now (see Task.pinnedOrder), and dropping a new pin
 * into the middle of an order the user arranged would look like the list moved
 * on its own. Every path that turns `pinned` on goes through this: updateTask
 * covers the editor, the suggested-pins sheet and togglePin, and the two bulk
 * writers stamp a run of consecutive ranks themselves.
 *
 * Counts unpinned rows out but not their stale ranks — an unpin leaves the old
 * number on the row, which is harmless because nothing reads it while
 * `pinned` is false and re-pinning overwrites it here.
 */
export function nextPinnedOrder(tasks: Task[]): number {
  let max = 0;
  for (const t of tasks) {
    if (t.pinned && t.pinnedOrder > max) max = t.pinnedOrder;
  }
  return max + 1;
}

export function captureField<K extends keyof Task>(target: Partial<Task>, source: Task, key: K): void {
  target[key] = source[key];
}

/** Whether `updates` puts the due date on a different logical day from the one it was on. */
function movesToAnotherDay(t: Task, updates: Partial<Task>, dayResetTime: string): boolean {
  if (!('dueDate' in updates) || !updates.dueDate || !t.dueDate) return false;
  return getTaskDayStart(new Date(updates.dueDate), dayResetTime).getTime()
    !== getTaskDayStart(new Date(t.dueDate), dayResetTime).getTime();
}

/**
 * Whether the patch changes the schedule, as opposed to naming it: a schedule
 * field with a new value, or a due date on a different logical day (set or
 * cleared counts; the same day re-stated does not).
 */
function scheduleChanged(t: Task, updates: Partial<Task>, dayResetTime: string): boolean {
  return SCHEDULE_FIELDS.some(f => {
    if (!(f in updates)) return false;
    if (f === 'dueDate') {
      if (!updates.dueDate || !t.dueDate) return (updates.dueDate ?? null) !== (t.dueDate ?? null);
      return movesToAnotherDay(t, updates, dayResetTime);
    }
    return (updates[f] ?? null) !== (t[f] ?? null);
  });
}

/** What the caller knows that the merge can't work out from the two rows. */
export interface TaskUpdateContext {
  /** 'occurrence' keeps the row's old content as the series' defaults; 'series' drops them. */
  scope: 'occurrence' | 'series';
  /** `nextPinnedOrder` over every task, used only on an unpinned-to-pinned edit. */
  freshPinnedOrder: number;
  dayResetTime: string;
  skipPostponeCount?: boolean;
  markSeenOnBecomeVisible?: boolean;
}

/** `t` with `updates` applied, and every field derived from the edit filled in. */
export function mergeTaskUpdate(t: Task, updates: Partial<Task>, ctx: TaskUpdateContext): Task {
  let seriesDefaults = t.seriesDefaults;
  if (ctx.scope === 'occurrence') {
    const captured: Partial<Task> = {};
    for (const key of CONTENT_FIELDS) {
      if (key in updates && !(seriesDefaults && key in seriesDefaults)) {
        captureField(captured, t, key);
      }
    }
    if (Object.keys(captured).length > 0) {
      seriesDefaults = { ...(seriesDefaults ?? {}), ...captured };
    }
  } else if (seriesDefaults) {
    // A deliberate series-wide change makes any pending "revert to"
    // value for that field stale — drop it.
    const next = { ...seriesDefaults };
    let changed = false;
    for (const key of CONTENT_FIELDS) {
      if (key in updates && key in next) {
        delete next[key];
        changed = true;
      }
    }
    seriesDefaults = changed ? (Object.keys(next).length > 0 ? next : null) : seriesDefaults;
  }

  // Taking a drip-scheduled task over: the user picked a date themselves,
  // so the row stops narrating where it came from. Clearing a date is
  // deliberately *not* this — the stamp is what records the refusal, and
  // dripStalledProjects reads it (see Task.autoScheduledAt). The drip's own
  // write passes autoScheduledAt explicitly and so exempts itself.
  const takenOver =
    'dueDate' in updates &&
    updates.dueDate != null &&
    !('autoScheduledAt' in updates) &&
    t.autoScheduledAt !== null;

  // When a wait on somebody starts (or starts over with somebody else),
  // stamped so waitingFollowUpTasks.ts can answer "how long has this been
  // going on" — nothing before Task.waitingOnPersonSince existed could.
  // Derived from the edit rather than asked for, the same shape
  // driftingSince takes beside postponeCount: every way `waitingOnPersonId`
  // gets set — the editor's own row, a bulk edit, a sync merge — stamps it
  // without its call site having to remember to.
  //
  // Only on the transition, never on a re-save of an already-waiting task
  // (`updates.waitingOnPersonId === t.waitingOnPersonId`) — the editor
  // writes the whole "Waiting on someone" field on every save, the same
  // reason `pinnedOrder` above guards on the 0→1 edge rather than on the
  // key being present. Restamping on every unrelated save would make
  // every wait read as having started the moment it was last opened.
  //
  // An update naming the field itself wins outright (no derivation runs),
  // which is what makes a whole-snapshot undo faithful: replaying a
  // pre-write `{ ...task }` restores the stamp that was really there
  // rather than a freshly re-derived one.
  const waitingOnPersonChange =
    'waitingOnPersonId' in updates &&
    !('waitingOnPersonSince' in updates) &&
    updates.waitingOnPersonId !== t.waitingOnPersonId
      ? {
          waitingOnPersonSince: updates.waitingOnPersonId ? new Date().toISOString() : null,
          // A decline about the *previous* wait says nothing about a new
          // one — carrying it forward would silence a fresh "waiting on
          // Sam" nudge on the strength of a swipe made about "waiting on
          // Alex".
          waitingFollowUpDeclinedAt: null,
          // Same for the day to chase it: it was about the old wait.
          ...('followUpOn' in updates ? {} : { followUpOn: null }),
        }
      : undefined;

  // How many times the user has pushed this out (see utils/postpone.ts).
  // Derived from the move rather than asked for, so every hand-picked date —
  // the row's swipe, the editor's Date row — is counted without its call
  // site having to remember to.
  //
  // Two ways out, and both are needed. An update that names postponeCount
  // itself wins outright, which is what makes every snapshot undo correct
  // for free: they replay a whole pre-write `{ ...task }`, so the count goes
  // back to what it was instead of being re-judged by a backward date move.
  // And skipPostponeCount covers the engine paths that undo with a narrow
  // {dueDate, deferUntil} patch (deloadTasks, pullProjectTasks) — there's no
  // field there to hide behind, and that backward move would otherwise read
  // as "resolved" and wipe the history this feature exists to keep.
  //
  // driftingSince rides on the same outcome and the same escape hatches, so
  // the count and the day it started from can never be judged differently:
  // one call to postponeOutcome answers both.
  const derivedPostpone =
    ctx.skipPostponeCount || 'postponeCount' in updates || 'driftingSince' in updates
      ? undefined
      : (() => {
          const outcome = postponeOutcome(t, { ...t, ...updates }, ctx.dayResetTime);
          return {
            postponeCount: nextPostponeCount(t.postponeCount, outcome),
            driftingSince: nextDriftingSince(
              t.driftingSince,
              t.postponeCount,
              outcome,
              t,
              ctx.dayResetTime,
            ),
            // A bounty loses a step on the same pushes the count climbs on.
            // Left out when the update names it (posting or withdrawing in
            // the same save), since this spread lands after `updates`.
            ...('bountyPushes' in updates
              ? {}
              : { bountyPushes: nextBountyPushes(t.bountyPushes, outcome === 'pushed') }),
          };
        })();

  const next = {
    ...t,
    ...updates,
    // A patch naming seriesDefaults itself wins outright, the same rule as the
    // derived fields below: a whole-snapshot undo puts back what was there, and
    // a weekly target's part-week scaling (quotaProrationPatch) writes the full
    // count it reverts to.
    seriesDefaults: 'seriesDefaults' in updates ? (updates.seriesDefaults ?? null) : seriesDefaults,
    ...(derivedPostpone ?? {}),
    ...(waitingOnPersonChange ?? {}),
    ...(takenOver ? { autoScheduledAt: null } : {}),
    // Only on the transition, never on a re-save of an already-pinned
    // task: the editor writes `pinned: true` on every save of a pinned
    // task, and restamping there would shuffle it to the bottom of the
    // section each time it was opened.
    ...(updates.pinned === true && !t.pinned ? { pinnedOrder: ctx.freshPinnedOrder } : {}),
    // Normalized on the way in, like addTask does, so a unit typed as
    // "  glasses " is stored the way every reader formats it.
    ...('targetUnit' in updates ? { targetUnit: normalizeTargetUnit(updates.targetUnit) } : {}),
    // Same normalisation for the supply's unit, and the same clamps the
    // draft path applies, so a value typed in the editor and a value
    // arriving from a restore or another device are stored identically.
    ...('supplyUnit' in updates ? { supplyUnit: normalizeTargetUnit(updates.supplyUnit) } : {}),
    ...('supplyCount' in updates ? { supplyCount: clampSupplyCount(updates.supplyCount) } : {}),
    ...('supplyReorderAt' in updates ? { supplyReorderAt: clampSupplyReorderAt(updates.supplyReorderAt) } : {}),
    ...('supplyLeadDays' in updates ? { supplyLeadDays: clampSupplyLeadDays(updates.supplyLeadDays) } : {}),
    ...('supplyRefillCount' in updates ? { supplyRefillCount: clampSupplyRefillCount(updates.supplyRefillCount) } : {}),
    // **A supply going up clears the decline stamp, and this is the one
    // place that happens.** The stamp means "I turned down the offer to
    // reorder while there were N left", and it silences the offer at N or
    // fewer — so left in place across a restock it would go quiet again the
    // *next* time the count fell back to N, which is the one moment it most
    // needs to speak. Restocking is the only thing that can raise a count
    // (completing a task only ever spends one), and it reaches the store
    // three ways — the reorder task's answer, the editor, a linked grocery
    // purchase — so the clear lives here where all three pass rather than
    // being remembered at each of them.
    //
    // Deliberately keyed on the value *rising*, not on `'supplyCount' in
    // updates`: the editor writes the whole supply card on every save, so
    // testing for the key would clear the stamp on a save that changed the
    // lead time.
    ...(('supplyCount' in updates
      && clampSupplyCount(updates.supplyCount) !== null
      && t.supplyCount !== null
      && clampSupplyCount(updates.supplyCount)! > t.supplyCount)
      ? { supplyDeclinedAtCount: null }
      : {}),
    // Re-derived only when the update actually names part of the schedule.
    // Recomputing on every write would undo the field's whole purpose: the
    // successor completeTask spawns onto February carries the 31st it was
    // anchored to, and the next unrelated patch — a pin, a category move —
    // would read the clamped Feb 28 back off it and put the drift straight
    // back. An update that names the field itself wins outright, which is
    // what keeps a whole-snapshot undo faithful. See Task.recurrenceAnchorDay.
    //
    // A due date moved to a different day, with no grid anchor beside it, is
    // read off that day rather than off the grid the row used to step from:
    // "count from the new date" is exactly that write, and reading the old
    // anchor date brought the grid's 31st straight back, so the task landed
    // somewhere other than where pullForwardChoice's preview said. A re-save
    // on the same day (the editor writes dueDate every time) still reads the
    // grid, which is what keeps a pulled-forward task's day.
    ...(!('recurrenceAnchorDay' in updates) && SCHEDULE_FIELDS.some(f => f in updates)
      ? {
          recurrenceAnchorDay: recurrenceAnchorDayFor({
            ...t,
            ...updates,
            ...(movesToAnotherDay(t, updates, ctx.dayResetTime) && !('recurrenceAnchorDate' in updates)
              ? { recurrenceAnchorDate: null }
              : {}),
          }),
        }
      : {}),
    // A schedule field *changed* without the anchor beside it is "this is the
    // schedule now", so the grid's separate anchor goes with it (#1953) —
    // the same trigger the anchor *day* above uses, so removing a
    // recurrence outright leaves no stale anchor behind either. One rule
    // here rather
    // than a `recurrenceAnchorDate: null` at each of the call sites that
    // re-date a row — the editor's Date row, skipNextRecurrence, the chain
    // step on schedule, the expired sweep — because a call site that
    // forgets it leaves a task stepping from a day it no longer sits on.
    // A patch that names the field itself wins outright, which is both the
    // pull-forward writing the two together and a whole-snapshot undo
    // restoring what was there.
    //
    // Changed, not merely named: the editor writes every schedule field on
    // every save, so judged on presence alone a retitled pulled-forward task
    // lost its grid and stepped on from the day it was pulled to. The
    // same-day re-save the anchor-day rule above already protects stays a
    // re-save here too.
    ...(!('recurrenceAnchorDate' in updates) && scheduleChanged(t, updates, ctx.dayResetTime)
      ? { recurrenceAnchorDate: null }
      : {}),
    // Two rules that ride onto the successor a completion spawns, and so
    // mean nothing on a task that no longer spawns one. Both were enforced
    // at creation (canHoldSupply / canHoldFollowUpTask in newTaskFromDraft)
    // and on the editor's own save, which left the gap in the middle:
    // anything else that writes `recurrenceType: 'none'` onto a live task —
    // a bulk edit, a sync merge, a store action — stranded a supply frozen
    // at its last count and a follow-up rule that could never fire again,
    // both still drawn on the row. Same trigger shape as the anchors above:
    // a patch naming the field itself wins outright, so a whole-snapshot
    // undo restores what it recorded rather than being re-cleared.
    ...(!canHoldSupply({ ...t, ...updates }) && !('supplyCount' in updates)
      ? {
          supplyCount: null,
          supplyUnit: null,
          supplyRefillCount: null,
          supplyReorderAt: DEFAULT_SUPPLY_REORDER_AT,
          supplyLeadDays: null,
          supplyDeclinedAtCount: null,
          supplyGroceryItemId: null,
        }
      : {}),
    ...(!canHoldFollowUpTask({ ...t, ...updates }) && !('followUpTaskEveryN' in updates)
      ? {
          followUpTaskEveryN: null,
          followUpTaskTitle: null,
          followUpTaskDraft: null,
          followUpTaskOneAtATime: false,
          followUpTaskAtEnd: false,
        }
      : {}),
    // Same shape as the two rules above, and the same reasoning: a patch
    // naming targetCount itself wins outright, so a whole-snapshot undo
    // restores the count it recorded rather than recomputing a new one
    // against a span that has since moved.
    ...(!('targetCount' in updates)
      && (QUOTA_SPAN_FIELDS.some(f => f in updates) || ROTATION_TARGET_FIELDS.some(f => f in updates))
      ? { targetCount: derivedTargetCount({ ...t, ...updates }) }
      : {}),
    // Changing polarity restarts the run, because the two polarities count
    // different things: a positive streak is completions and a negative one
    // is days survived, so carrying the number across would relabel history
    // rather than continue it. The dates matter more than the count — a task
    // last completed three months ago carries a `streakDate` three months
    // back, and cleanDayPatch would read that as ninety clean days and hand
    // them over on the first rollover. Same call unarchiveTask makes when it
    // resets a streak it can no longer vouch for.
    //
    // Shaped like the three rules above: a patch naming `streakCount` itself
    // wins outright, so a whole-snapshot undo still restores what it
    // recorded instead of being overruled here.
    ...('polarity' in updates && updates.polarity !== t.polarity && !('streakCount' in updates)
      ? {
          streakCount: 0,
          streakDate: getCurrentDayStart().toISOString(),
          previousStreakCount: 0,
          previousStreakDate: null,
          slipCount: 0,
          slipDate: null,
        }
      : {}),
  };

  // Re-filing a task must not, on its own, make it read as "new".
  // isTaskNew answers "has a day gate let this through since you last
  // looked at it", but two of the things that suppress the answer are the
  // *category's* (excludeFromNewTasksBanner, and a schedule whose window
  // is shut) — and while a task is suppressed nothing ever advances its
  // seenAt, because both the banner's OK and TaskItem's mark-on-tap only
  // fire for a row already showing as new. So its seenAt keeps whatever
  // stale value it had, and the first move into a category that doesn't
  // suppress hands the user a week-old task in the "you have N new todos"
  // banner. Stamping seenAt on that transition is the honest answer: they
  // are holding the task right now, so they have seen it.
  //
  // The same thing happens when the user drags a task's *date* onto today
  // instead — the editor's Date row, the row's own reschedule picker, and
  // Drift's "Do it today" all write dueDate/deferUntil straight through
  // here, and a task pulled forward like that has just as plainly been
  // looked at as one re-filed into a visible category. Unlike the category
  // case there's no single field name to key off (dueDate, deferUntil and
  // timeSegments can each be the one that flips it), and some of the
  // engine-driven writers of those same fields — an unattended project
  // drip, the expired-task sweep — deliberately want the opposite: their
  // whole mechanism is a stale seenAt handing the newly-dated task to the
  // banner once someone actually looks. So this half is opt-in: only a
  // caller passing markSeenOnBecomeVisible is claiming "the user is
  // looking at this task right now", the same claim the category case
  // gets to make unconditionally because nothing re-files a task on the
  // app's own initiative.
  //
  // Only on the transition into new, so a task that was already new keeps
  // its dot through a move (and through the narrow {category} patches the
  // group undos replay), and only when the update doesn't name seenAt
  // itself, which is what lets a full-snapshot undo put the old value back.
  const transitionedIntoNew =
    !('seenAt' in updates) &&
    !isTaskNew(t) &&
    isTaskNew(next) &&
    (('category' in updates && updates.category !== t.category) || !!ctx.markSeenOnBecomeVisible);
  const updated = transitionedIntoNew
    ? { ...next, seenAt: new Date().toISOString() }
    : next;
  return updated;
}

/**
 * The later, still-open dates of `edited`'s series with the content fields
 * `updates` named copied onto them, or [] when there is nothing to write.
 * Only CONTENT_FIELDS: dueDate and the series' own fields are per-row or
 * per-set and would flatten the whole schedule onto one day.
 */
export function seriesFanOutRows(edited: Task, updates: Partial<Task>, tasks: readonly Task[]): Task[] {
  if (!edited.seriesId) return [];
  const fanOut: Partial<Task> = {};
  for (const key of CONTENT_FIELDS) {
    if (key in updates) captureField(fanOut, edited, key);
  }
  if (Object.keys(fanOut).length === 0) return [];
  const from = edited.dueDate ? +new Date(edited.dueDate) : -Infinity;
  const siblings = tasks.filter(
    t => t.seriesId === edited.seriesId &&
      t.id !== edited.id &&
      !t.completed &&
      !t.archived &&
      (t.dueDate ? +new Date(t.dueDate) > from : false)
  );
  return siblings.map(t => {
    const blockers = () => blockerIdsOf({
      blockedById: 'blockedById' in fanOut ? fanOut.blockedById ?? null : t.blockedById,
      blockedByIds: 'blockedByIds' in fanOut ? fanOut.blockedByIds : t.blockedByIds,
    });
    return {
      ...t,
      ...fanOut,
      // reminderTime is absolute; every date keeps its own instant at
      // the edited time of day rather than inheriting this row's —
      // reanchored onto the offset-relative day when reminderOffsetDays
      // is part of what's being fanned out, same as buildSeriesRow.
      ...('reminderTime' in fanOut
        ? reanchorReminder(
            fanOut.reminderTime ?? null,
            new Date(t.dueDate!),
            'reminderOffsetDays' in fanOut ? fanOut.reminderOffsetDays ?? null : t.reminderOffsetDays,
            ('reminderTracksVisibility' in fanOut ? fanOut.reminderTracksVisibility ?? false : t.reminderTracksVisibility)
              ? { ...t, ...fanOut }
              : null
          )
        : {}),
      // A set shares one blocker, but no row can wait on itself. Picking
      // a later date of this same set as the blocker would otherwise
      // hand that row a pointer at its own id, and a task waiting on
      // itself is invisible everywhere and can never be unblocked by
      // anything the user does to another task. wouldCycle() guards the
      // picker against exactly this; the fan-out doesn't go through it,
      // so it re-checks here and leaves that one row's blocker alone.
      ...(('blockedById' in fanOut || 'blockedByIds' in fanOut) && blockers().includes(t.id)
        ? blockerFields(blockers().filter(id => id !== t.id))
        : {}),
      // The same for a gate pointing at one of this set's own dates.
      ...('answerGate' in fanOut && fanOut.answerGate?.taskId === t.id ? { answerGate: null } : {}),
    };
  });
}
