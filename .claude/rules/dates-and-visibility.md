---
paths:
  - "src/utils/dateUtils.ts"
  - "src/utils/visibilityUtils.ts"
  - "src/utils/parseNaturalDate.ts"
  - "src/utils/parseTaskInput.ts"
  - "src/utils/snoozeEngine.ts"
  - "src/utils/taskMoves.ts"
  - "src/utils/lookAhead.ts"
  - "src/utils/deloadPlan.ts"
  - "src/utils/projectPull.ts"
  - "src/utils/slotIn.ts"
  - "src/utils/calendarMonth.ts"
  - "src/utils/*Tasks.ts"
  - "src/store/useTaskStore.ts"
  - "src/screens/TodayScreen.tsx"
  - "mcp/src/timeZone.ts"
---

# Visibility and the logical day, in full

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that load by path" there).
CLAUDE.md keeps the rules themselves, in one line each; this is the model and the bugs behind them.

## Visibility model

The core differentiator: a task has many reasons to be hidden, and `src/utils/visibilityUtils.ts` owns all of them. The time gates are `deferUntil`, `timeSegments` (morning/afternoon/evening), a future `dueDate` and the time window; the others are vacation (`vacationPause`, or a category hidden on vacation), a paused project, being held back (blocked, or waiting on a person), expiry, and having no date at all (Inbox, or an undated project task). `isVisibleApartFromVacation` is the one place they are listed in order; read it rather than a summary.

`isTaskVisible()` drives the Today screen. `isTaskDeferred()` drives Later, and is *not* simply `!isTaskVisible()`: it first drops everything that has no moment to surface (completed, archived, vacation-paused, expired, held back, in a paused project, or undated). `getVisibleAt()` returns the earliest moment a deferred task surfaces (used to sort the Later screen).

**A pass that acts on tasks because a day went by checks `isWithheld`, not `isHiddenForVacation`.** Penalties, negative-habit streaks, quota rollover, expiry, reminders, the widget, pins and the morning check-in all run unattended against the day, and a paused project (`Project.pausedUntil`) holds its tasks back exactly as vacation does. Every one of those passes used to check vacation alone, so a paused project's tasks kept charging penalties, firing reminders and sitting on the widget while hidden everywhere else. `isWithheld` (`visibilityUtils.ts`) covers both, and `getVisibleAt` returns the day a pause ends.

All time comparisons use the configurable `dayResetTime` (default `"00:00"`) to define when the logical day starts — e.g. a 2 AM reset means tasks on a "day" don't surface until 2 AM.

**Expiry needs a window that closes and a day to close it on.** `isTaskExpired()` is the one gate with no way back — `sweepExpiredTasks` (when the user has turned it on) deletes what has stayed expired past its grace (`isTaskSweepable`), rolling a live recurring task forward rather than deleting it — so it checks both. `effectiveWindowEnd()` ignores a `windowEnd` that isn't after its `windowStart` *on the logical day's own timeline* (measured from `dayResetTime`, since `onLogicalDay` rolls a clock time earlier than the reset onto the next date), because both gates anchor to a single logical day and "22:00–02:00" under a midnight reset otherwise compares as past from 02:00 onward: expired before it ever opened. Compared as raw clock minutes instead, "03:00–05:00" under a 4 AM reset kept its end while its start rolled a day forward, and was expired, hidden and swept all day. And `windowEnd` is deliberately not a date signal (see `hasNoDateSignal`), so a task carrying only one has no day to be late for — `hasDayArrived()` can't catch that, since with no `dueDate` it's vacuously true. Expiry now demands the same placement `isTaskVisible` does.

**A new reason a task can't surface goes in `isTaskExpired` as well as `isVisibleApartFromVacation`.** Expiry keeps its own list of hides instead of calling the visibility one, because it needs the window and not the clock, and it is the gate that deletes. A task waiting on another sat in Waiting and Expired at once for lack of the held-back check, and `sweepExpiredTasks` could remove it for a window that closed while it couldn't be done. When a hide is added, add it in both places and add a case to the expiry tests in `visibilityUtils.test.ts`.

**Any `HH:MM` placed on a logical day goes through `onLogicalDay` (`visibilityUtils.ts`), never a bare `setHours` on the day start.** A clock time earlier than `dayResetTime` belongs to the small hours at the *end* of that day, so it has to roll onto the next calendar date. Set on the day start's own date instead, "before 1am" under a 4 AM reset closed three hours before its day began: expired, hidden and swept all day. The category schedule found this first, and the per-task window gates repeated it.

## Scheduling decisions and dayResetTime — the grace window bug

**Any computation that decides where to schedule a task — when it should land, which date to suggest, whether to defer it — must use `dayResetTime`-aware helpers.** Using bare `new Date()` ignores the user's configured day boundary and off-by-ones tasks by one day during the "early-morning grace window" before `dayResetTime`.

**The grace window is the period between midnight (00:00 calendar time) and the user's `dayResetTime` setting.** If a user sets their day to start at 02:00 because they work late, anything happening between midnight and 2 AM — pulling project tasks, accepting snooze suggestions, deciding to lighten the day, creating use-up reminders — still belongs to the *previous* logical day, not today. A decision made at 1:30 AM to reschedule something "tomorrow" means "tomorrow by their clock", which is 26.5 hours away, not 24.

**The bug pattern: `new Date()` returns the calendar date, ignorant of `dayResetTime`.** At 1:30 AM on Aug 16 with a 02:00 reset, `new Date()` is Aug 16 but the logical today is still Aug 15. A scheduling decision that reads `new Date()` dates something Aug 16, not Aug 15, landing it one day later than intended.

**The fix: use the helpers in `src/utils/dateUtils.ts`:**
- `getCurrentDayStart()` — the start instant of the current logical day. Use this for "today's start".
- `getLogicalToday(dayResetTime?)` — the current logical day as a midnight `Date`. Use for "today" as a date.
- `getLogicalTomorrow(dayResetTime?)` — `addDays(getLogicalToday(), 1)`. Use for "tomorrow".
- `getDayStart(date, dayResetTime)` — anchors a date you already have to the start of its logical day.

**`getLogicalNow()` is for day words only.** It is the real instant pulled back a whole day in the grace window, which is right for "tomorrow" and wrong for anything measured on the clock: "in 30 min" typed at 1:30 AM against it lands 23.5 hours in the past. `parseNaturalDate`, `parseDatePart` and `parseTaskInput` take the real instant as a separate `clockNow` for minutes, hours, "tonight" and a bare clock time; a caller passing `getLogicalNow()` also passes `new Date()` there.

**In review**, look at any new date computation that lands a task on a day (`dueDate`, `deferUntil`, snooze suggestions, project pulls, use-up dates, deload destinations) for a bare `new Date()` or `addDays(new Date(), n)` standing in for "today", and for a default parameter of `new Date()` on a task-dating function. A bare `new Date()` is right for a timestamp, for display, and for expiry, which is about wall-clock time rather than logical days.

**A completion recorded after the fact stamps the day it happened on, not today.** The `completedAt` option on a completion (the morning check-in, a widget tap queued overnight, the overshoot sweep) is the moment the streak is measured from: `getStreakOutcome(task, dayResetTime, at)` takes it, and `streakDate` becomes `getDayStart(completedAt, dayResetTime)`, never moved back past a later `streakDate` already stored (`taskCompletion.ts`). Measured from the clock instead, "yes, I did it last night" found a two-day gap and reset a streak it was meant to keep. Any new code that stamps a day because a completion happened takes that moment as a parameter and leaves the clock default for a completion made now.

**Never cut a day key out of `toISOString()`.** It is UTC, and every day key in the app (`dayKeyOf`, `getLogicalDayKey`, the `YYYY-MM-DD` columns) is local. The two agree only while the instant being keyed stays on the same calendar date in both, so the mismatch is invisible in a UTC run (which is what an agent's sandbox does) and across most of the Americas and Europe, and appears only far from Greenwich. CI runs the suite in UTC+14 for this reason. `snoozeEngine` keyed its candidate days this way and, in UTC+13/+14, read each day's projected recurring load off the day before it (#2848). A behavioural test can't catch it, because Jest ignores a `process.env.TZ` written at runtime, so `noUtcDayKey.test.ts` bans the pattern in `src/` instead. Use `dayKeyOf` for a calendar date and `getLogicalDayKey` when `dayResetTime` matters. To see a date bug a UTC run hides before CI does, run `npm run test:tz`, which runs the suite in three zones chosen to expose one. Test fixtures follow from this: build a local time with `new Date(2026, 7, 12, 9)` or `new Date('2026-08-12T09:00')` (no `Z`), never a `...Z` literal the test then reads back as a local date, and don't switch zones mid-test by writing `process.env.TZ`, which Jest ignores.
