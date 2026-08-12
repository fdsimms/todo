export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Priority = 0 | 1 | 2 | 3 | 4;
export type Effort = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type SortOption = 'default' | 'priority' | 'effort-asc' | 'effort-desc' | 'due-date' | 'streak';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type ReminderKind = 'notification' | 'alarm';

export interface Category {
  id: string;
  name: string;
  scheduleDays: number[] | null;   // 0=Sun … 6=Sat, null = no restriction
  scheduleStart: string | null;    // "HH:MM"
  scheduleEnd: string | null;      // "HH:MM"
  hideOnVacation: boolean;         // hide tasks in this category while vacation mode is on
  // Keep tasks in this category out of suggested pins (see suggestPinTasks).
  // Only the suggester honours it — the tasks stay visible everywhere and can
  // still be pinned by hand. For routines and errands, which are perfectly
  // real work but bad company for whatever else lands in the pinned list.
  excludeFromPinSuggestions: boolean;
  // The time-of-day a task created in this category starts with — a *seed*,
  // never an override. Nothing reads it after the row exists: the task's own
  // timeSegments stay the single source of truth for every visibility, sorting
  // and grouping path, so one genuinely-morning task in an evening category is
  // still sayable, and clearing this default never silently reschedules
  // anything that already exists. Retroactive changes go through
  // useTaskStore.setCategoryTimeSegments, which writes the tasks themselves.
  // Empty = no default.
  defaultTimeSegments: TimeOfDay[];
  sortOrder: number;
  emoji: string | null;            // shown in place of the folder icon, and prefixed to the name wherever it appears
}

// A category for grouping PROJECTS on the Projects page (e.g. "Travel",
// "Bucket List", "Shopping"). Deliberately a separate pool from Category
// (which groups tasks) — the two never share names or a registry, so
// creating "Travel" here has no effect on task categories and vice versa.
export interface ProjectCategory {
  id: string;
  name: string;
  sortOrder: number;
}

// A category for grouping TEMPLATES on the Templates page (e.g. "Trips",
// "Recurring chores"). Deliberately its own pool, independent of both
// Category (tasks) and ProjectCategory (projects) — creating one here never
// affects the others. Unrelated to TemplateItem.category, which tags the
// tasks an item creates from the existing task-Category pool.
export interface TemplateCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ChainItem {
  id: string;
  title: string;
  // What this step alone is expected to cost. null falls back to the task's
  // own estimate — which covers the whole chain, so without per-step values a
  // five-step routine charges its full estimate at every step and the day's
  // workload never drops as you work through it (see estimatedMinutesFor).
  estimatedMinutes: number | null;
}

// A lightweight, collapsible label for grouping several independent tasks
// together (e.g. "Take supplements" grouping Coq10/Vitamin D/Iron, each on
// its own schedule). Deliberately NOT a Task — it has no dueDate, recurrence,
// streak, or reminder, so it can never itself be "not due yet" and desync
// from children on mismatched cadences (see completeGroup/deferGroup in
// useTaskStore). It has no completion state of its own either, stored or
// derived: a stack is on Today exactly while one of its members is, and goes
// when the last one does. (There was a `completedAt` "user dismissed this
// stack" stamp here; the `completed_at` column it wrote to is still on
// task_groups, unread.)
export interface TaskGroup {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  category: string | null; // which category section it renders under
  // Position within its category section, in the SAME number space as
  // Task.sortOrder — a stack takes a slot in the list order exactly like a
  // loose task does, so one can be dragged above or below the other (see
  // makeCategoryGroups/resolveDrop in utils/taskGrouping.ts). It is not a
  // per-category 1..M ranking of stacks alone; that's what it used to be, and
  // it's why a stack could only ever render above every loose task.
  sortOrder: number;
  collapsed: boolean;      // persisted expand/collapse state
}

// A themed, long-running collection of loosely-dated tasks the user tracks
// and picks off over time (e.g. "Summer Bucket List") — independent of
// TaskGroup (same-day cohorts), Category, and Tags, so a task can belong to
// all four at once. Unlike TaskGroup, a Project has its own optional
// targetStartDate/targetEndDate and can be browsed on its own even when
// nothing inside it is due today. It has no persisted "completed" state —
// completion is always derived from its tasks (see projectProgress in
// useProjectStore) — only an explicit archived flag the user (or, if the
// autoArchiveProjectsOnComplete setting is on, completeTask) sets.
export interface Project {
  id: string;
  title: string;
  notes: string;
  targetStartDate: string | null;
  targetEndDate: string | null;
  // Name of a ProjectCategory, purely for grouping projects on the Projects
  // page. Independent of task Category — never affects the tasks inside the
  // project (their own categories, visibility, etc. are untouched).
  category: string | null;
  sortOrder: number;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  // Days of quiet before this project offers up its next task (see
  // utils/projectPull.ts). 0 = never ask, for a project deliberately parked.
  // Quiet is measured from the last member completed, so a project actually
  // being worked on never nudges — there's nothing to store or clear.
  nudgeCadenceDays: number;
  // Opt-in: when this project runs dry, date its next task automatically
  // instead of offering it in the pull sheet. Deliberately per-project rather
  // than global — silently rescheduling is a bigger promise than suggesting,
  // and it's the right call for a chore list and the wrong one for a wishlist.
  autoSchedule: boolean;
  // Opt-in: the project's hand-sorted order is a sequence, not a preference —
  // each step is held back until the one above it is done (see
  // utils/projectOrder.ts). Off by default, because a list of tasks that all
  // happen to share a project is the normal case and gating it would hide work
  // the user never asked to have hidden.
  sequential: boolean;
  // Off by default: a project has to be explicitly opted in before it can
  // appear in ANY nudge surface — the gone-quiet banner, the auto-schedule
  // drip, and even the manually-opened "Pull from projects" sheet (see
  // classifyProject in utils/projectPull.ts, which gates on this ahead of
  // every other rule, in both modes). A reference list like "Gift ideas" is
  // never going to want a due date; without this, the only way to keep it
  // quiet was nudgeCadenceDays === 0, which only silenced the unprompted
  // surfaces and still showed up the moment someone opened the Pull sheet.
  nudgeOptIn: boolean;
}

// Fallback cadence for a project row written before the nudge columns existed,
// and the default for a newly created project. Never, deliberately: being asked
// about a project you haven't decided you want chasing is the annoying half of
// this feature, and it's the half you get without opting in. It used to default
// to two weeks so the feature wasn't inert on arrival.
export const DEFAULT_NUDGE_CADENCE_DAYS = 0;

export interface Task {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  completedAt: string | null;
  // A recurring occurrence the user explicitly marked missed. Such a row is
  // *also* `completed` with a `completedAt` stamp, and that is deliberate: it
  // is history, and every "is this live" gate in the app (isTaskVisible,
  // groupRoster, retention) keys off `completed`. Storing a miss as an
  // incomplete row would leave it live and overdue for ever. So `completed`
  // means "resolved, off the board" and this field is what separates the two
  // ways a row gets there — read it (via isMissed) anywhere the question is
  // "did the user actually do this", never where it's "is this row history".
  missedAt: string | null;
  /**
   * When dripStalledProjects put a date on this task — the one write in the app
   * the user never asked for, so it's the one that has to say so. Two readers,
   * and they're why this is a timestamp rather than a boolean:
   *
   * - the row, which explains itself while the stamp and a dueDate coexist
   *   ("Fall 2026 Family Trip has been quiet 60 days") instead of appearing as
   *   an item the user doesn't remember adding;
   * - the drip itself, which reads a stamp *without* a dueDate as "the user
   *   cleared what I scheduled" and leaves that project alone for the rest of
   *   that logical day. Clearing a date is the natural way to say "not today"
   *   and was previously invisible to the drip, so the next foreground put the
   *   same task straight back.
   *
   * Deliberately not cleared by the clear: the stamp *is* the record of the
   * refusal, and comparing it to the current logical day is what makes the
   * back-off expire on its own — no flag to reset, no cleanup pass. Setting a
   * real date by hand does clear it: the user has taken the task over, so the
   * row stops narrating where it came from.
   */
  autoScheduledAt: string | null;
  createdAt: string;
  seenAt: string | null; // last time the user interacted with this task; drives the "new" dot

  dueDate: string | null;
  deadline: string | null;   // separate target date to hit; shown as a subtle countdown, doesn't affect scheduling/visibility
  // When set, `deadline` is derived as `dueDate` minus this many days instead of
  // a fixed date, and gets recomputed against the new dueDate every time a
  // recurring task spawns its next occurrence (see completeTask). Null means
  // `deadline` is a one-off fixed date that doesn't carry forward.
  // Signed: positive lands before the due date, negative after it ("due the
  // 1st, has to clear by the 10th"). Never 0 — the editor picks the direction
  // with a pill and steps the magnitude, so there's no zero to step through.
  deadlineOffsetDays: number | null;
  // Alternative to deadlineOffsetDays for monthly recurrence: pins `deadline`
  // to a fixed day-of-month within the due date's own month instead of N days
  // before due, e.g. due the 20th, deadline the last day of the same month —
  // a case a fixed day offset can't express since month lengths vary. -1
  // means the last day of the month. Mutually exclusive with
  // deadlineOffsetDays; recomputed the same way on every new occurrence.
  deadlineMonthDay: number | null;
  deferUntil: string | null;
  timeSegments: TimeOfDay[];
  windowStart: string | null; // "HH:MM" — task only becomes visible/active from this time on its day
  windowEnd: string | null;   // "HH:MM" — task expires (moves to Expired) after this time on its day

  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  recurrenceDays: number[];
  recurrenceMonthDay: number | null; // day of month (1-31) for monthly recurrence on a fixed schedule, -1 = last day of the month; null = same day as dueDate
  // Nth weekday-of-month for monthly recurrence, e.g. "every 2nd Tuesday" (recurrenceWeekOrdinal=2,
  // recurrenceDays=[2]); 1-4 = 1st..4th occurrence, -1 = last occurrence in the month. Mutually
  // exclusive with recurrenceMonthDay; null = not using this mode. Only the first entry of
  // recurrenceDays is used when this is set.
  recurrenceWeekOrdinal: number | null;
  recurrenceEndDate: string | null;
  recurrenceCount: number | null; // occurrences remaining (including this one); null = unlimited
  recurrenceFromCompletion: boolean;

  // Quota — a habit logged N times a day (8 glasses of water) rather than done
  // once. Deliberately not N tasks, N subtasks, or N taps on an ever-present
  // row: a quota task is *hidden from Today while you're on pace* (see
  // isQuotaOnPace in visibilityUtils) and only surfaces when you fall behind,
  // so a day you keep up with produces no feed rows at all. Reaching
  // targetCount calls completeTask like any other task, so recurrence, streaks,
  // Logbook and Stats need no special cases; the per-day reset is free because
  // each new occurrence starts at progressCount 0. Requires daily recurrence to
  // be meaningful — the editor turns it on with the target.
  targetCount: number | null; // null = ordinary task; >= 2 = quota task
  progressCount: number;      // units logged toward targetCount on this occurrence
  // What the count counts, e.g. "8oz glasses" — free text, optional, and shown
  // beside the numbers wherever they are ("5/12 8oz glasses"). It exists so the
  // unit doesn't have to live in the title: "Drink water" with a unit says the
  // same thing as "Drink 8oz glasses of water" and still reads as a task.
  // Formatting rules (including why nothing pluralises it) are in
  // src/utils/quotaUnit.ts; null = show the bare count, as targets always did.
  targetUnit: string | null;
  // Opt-in: when true, logging a unit past targetCount keeps incrementing
  // progressCount instead of completing the task immediately — the task
  // rides out the rest of the day so an overshoot (a 13th glass against a
  // target of 12) can be logged. It's completed automatically at day
  // rollover (see the overshoot sweep alongside sweepExpiredTasks in
  // useTaskStore.ts) with whatever progressCount was reached, over, at, or
  // under target — a normal completion, not a miss. Off by default, so an
  // existing quota task keeps completing the instant it hits target.
  allowOvershoot: boolean;

  tags: string[];
  category: string | null;
  sortOrder: number;

  pinned: boolean;
  /**
   * Rank within the Pinned section, independent of `sortOrder`.
   *
   * A pinned task keeps its row in its category section as well, so the two
   * orders are genuinely separate: dragging a pin to the top of the Pinned
   * section must not also haul it to the top of Work. 0 means "never ranked" —
   * every row predates this column, and `pinnedTasks()` falls back to
   * `sortOrder` for ties, which is exactly the order pins had before. Pinning
   * stamps `max + 1` so a new pin lands at the bottom of the section rather
   * than jumping into the middle of an order the user arranged by hand.
   */
  pinnedOrder: number;
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null; // precise time estimate; effort is the derived coarse bucket

  reminderTime: string | null; // ISO datetime for scheduled notification
  // 'alarm' rings as a native iOS system alarm (AlarmKit, iOS 26+) instead of
  // a plain notification; falls back to 'notification' wherever AlarmKit is
  // unavailable. Ignored when reminderTime is null.
  reminderKind: ReminderKind;

  linkUrl: string | null; // URL/deep-link opened by the link button on the task row

  // Number dialled by the call button on the task row — "call the doctor" with
  // the surgery's number on it, so the task is the thing you act from rather
  // than a reminder to go and look it up.
  //
  // Stored as the user typed it (see src/utils/phone.ts): a number is read far
  // more often than it is dialled, and "+44 20 7946 0018" is legible where its
  // dial string isn't. Sanitising happens at the point of dialling instead, so
  // nothing about spacing, parentheses or an extension is lost on the way in.
  // Deliberately its own field rather than a `tel:` linkUrl — that already
  // works, but only if you know the scheme, and it gets you a URL keyboard and
  // a chain-link glyph for something that is neither.
  phoneNumber: string | null;

  // An email address to compose to — same shape as phoneNumber and for the
  // same reason: stored as typed (no canonicalisation, no validation beyond
  // "worth putting a compose button on the row"), and deliberately its own
  // field rather than a `mailto:` linkUrl for the same reason phoneNumber
  // isn't a `tel:` linkUrl.
  emailAddress: string | null;

  // "Waiting on" — the id of another task that must be done before this one
  // becomes actionable (e.g. "return the router" waiting on "cancel the
  // internet plan"). The fifth reason a task can be hidden, and the only one
  // that isn't a clock: the other four (deferUntil, timeSegments, dueDate,
  // vacationPause) all answer "hidden until *when*".
  //
  // Blocked-ness is DERIVED, never stored — isTaskBlocked() asks whether that
  // row still exists, is incomplete, and is unarchived. Nothing is written when
  // the blocker completes. That's what makes completing, uncompleting,
  // deleting AND archiving the blocker all do the right thing with no cascade;
  // a stored flag would need one in each of those paths, and a missed cascade
  // leaves a task no user action can ever surface again.
  //
  // Deliberately a single id rather than a list: "waiting on" is one thing in
  // practice, and it keeps cycle detection a chain walk instead of a graph
  // traversal. A JSON array is the upgrade path if that ever changes.
  //
  // Note a recurring blocker unblocks its waiter permanently: completing it
  // spawns a new row with a NEW id, so this keeps pointing at the completed
  // original. That's intended — "wait for trash day to happen once".
  blockedById: string | null;

  // The MealPlanEntry this task was projected from — set only on a "Cook X"
  // task the meal plan spawned, null on every task a person typed. See
  // src/utils/mealTasks.ts for the projection rules.
  //
  // **The meal plan is the master and this task is the replica**, which is the
  // one thing to keep straight. The entry owns the title, the day and the
  // time-of-day segment, and reconciling rewrites exactly those three on the
  // task; everything else the user sets on the row (category, notes, priority,
  // subtasks) is theirs and is never touched. Nothing flows the other way
  // except cooked-ness — completing this task stamps the entry's cookedAt, and
  // marking the entry cooked completes this task, each guarded by the other's
  // idempotence check so the two can't ping-pong.
  //
  // Deliberately NOT the inverse of a taskId on the entry: one pointer can't
  // disagree with itself, and the lookup this direction is a scan of an array
  // already in memory (see cookTaskFor in useMealPlanStore). Resolve-or-shrug
  // like every other cross-row pointer here — an entry that has since been
  // purged leaves this dangling, and a dangling cook task is just a task.
  mealEntryId: string | null;

  // The GroceryItem this task was projected from — set only on a "Use up X"
  // task an expiry date spawned, null on every task a person typed. See
  // src/utils/groceryExpiry.ts for the projection rules.
  //
  // Same master/replica split as mealEntryId, one notch quieter: the item owns
  // the title and the day, and reconciling rewrites those two and nothing else
  // — but unlike a meal, nothing flows back. Ticking "Use up spinach" off is
  // not a claim about the catalog row, which still knows when it was bought and
  // when it goes off; the item is not marked eaten, thrown away or out of
  // stock, because none of those is what ticking a task means.
  //
  // Reconciling is also deliberately narrower: it runs on the transitions that
  // change the expiry, not on every grocery mutation, since an expiry date is
  // set at the till and then left alone. Resolve-or-shrug like every other
  // cross-row pointer here — a forgotten item leaves this dangling, and a
  // dangling use-up task is just a task.
  groceryItemId: string | null;

  // Streaks (recurring tasks only)
  streakCount: number;       // positive = N consecutive completions
  streakDate: string | null; // logical-day ISO string of last completion

  // Snapshot of streakCount/streakDate from just before the current
  // completion, so uncompleting (e.g. from the Logbook) can restore the
  // streak to what it was rather than leaving the incremented value.
  previousStreakCount: number;
  previousStreakDate: string | null;

  // Opt-in per task: surface the streak as a chip on the collapsed row rather
  // than only in the expanded panel. Off by default — a flame on every
  // recurring row is noise, but a habit you're deliberately tracking is worth
  // seeing the count for without tapping. Only meaningful when the task
  // recurs, which is the only place the editor offers the toggle.
  showStreak: boolean;

  // Series — one commitment that falls on several hand-picked dates (e.g.
  // walking the neighbour's dog on the 10th and the 15th). Every date is its
  // own real row sharing this id, deliberately rather than one row holding a
  // list of dates: dueDate/completedAt/streakDate are singular everywhere,
  // and Later renders real Task rows (see laterSections), so materialising
  // them is the only way all the dates actually show up there.
  //
  // Not recurrence — a series is a finite set the user picked, and it can
  // hold dates a rule couldn't express. seriesMonthDays is what optionally
  // makes it come back.
  //
  // Deliberately NOT previousOccurrenceId: that's the backward completion
  // chain, and uncompleteTask deletes whichever row points at the one being
  // uncompleted — reusing it would make un-ticking the 10th delete the 15th.
  seriesId: string | null;
  // Days of the month the set repeats on (-1 = last day, same convention as
  // recurrenceMonthDay). Empty = the set happens once and is then done.
  // Stored rather than re-derived from the rows' own dueDates so an anchor on
  // the 29th-31st, clamped into a short month for one set, doesn't stay
  // clamped for every set after it.
  seriesMonthDays: number[];
  // Months from one set to the next. Only read when seriesMonthDays is
  // non-empty; defaults to 1 so nothing has to null-check it.
  seriesRepeatMonths: number;

  parentId: string | null;   // null = root task; set = subtask of that id
  groupId: string | null;    // null = ungrouped; set = grouped under that TaskGroup's id
  projectId: string | null;  // null = not in a project; independent of groupId/category — a task can carry both

  // Chain — steps through a list of items one at a time. Completing a
  // chained task advances to the next item and creates the next task on
  // its own, independent of recurrence; Repeat (if also set) makes the
  // whole chain repeat instead of running through once.
  chainEnabled: boolean;
  chainIndex: number;        // index of the currently active ChainItem
  chainItems: ChainItem[];
  // When the next step arrives. false (default) = right away, the moment the
  // current one is completed — the chain is a sequence you work through in one
  // sitting. true = on the recurrence's next occurrence, so the steps rotate
  // one per scheduled day rather than running back to back.
  //
  // Only meaningful alongside a repeat: with recurrenceType 'none' there is no
  // schedule to wait for, so completeTask ignores it and the editor disables
  // the control. Note the recurrence's own bookkeeping — recurrenceCount and
  // recurrenceEndDate — still advances once per full cycle in either mode
  // (see advancesBySchedule in completeTask), because "repeat 10 times" means
  // ten times through the chain, not ten steps.
  chainStepOnSchedule: boolean;

  // "Extra task" — every Nth completion of this task adds a separate one-off
  // task ("rosin the bow every 4th violin practice").
  //
  // A third spawn mechanism alongside chains and quotas, because neither
  // fits: a chain spawns its next step on *every* completion (1:1), and a
  // quota counts sub-units logged within one occurrence and resets each day.
  // This counts whole completions and never resets on its own.
  //
  // The tally has to be stored. `recurrenceCount` counts occurrences
  // *remaining*, and past occurrences are separate completed rows that
  // `completedRetentionDays` eventually purges — so there is nothing to count
  // after the fact. Like `streakCount`, it rides onto the row spawned by the
  // completion, since every occurrence is a fresh id.
  //
  // The rule is live only with both a count and a title: an extra task with
  // no name is a row nobody could act on, so `extraTaskRule()` is what every
  // reader asks rather than testing the fields apart.
  extraTaskEveryN: number | null; // null = off; >= 2 (every 1st is every time)
  extraTaskTitle: string | null;  // title of the task to add
  extraTaskTally: number;         // completions since the last one was added
  // Snapshot of extraTaskTally from just before the current completion, so
  // uncompleting restores it — the same device previousStreakCount uses, and
  // for the same reason. It can't be derived after the fact: a tally of 0
  // reads identically whether the completion fired the rule and reset it or
  // never advanced it at all (a miss, or a mid-chain step).
  previousExtraTaskTally: number;

  vacationPause: boolean;    // hide and protect streak while vacation mode is on

  // Hides the task from every list (Today, Later, etc.) indefinitely, unlike
  // vacationPause which only hides while vacation mode is on. Completion
  // history stays in SQLite untouched; unarchiving resets streakCount to 0
  // (see unarchiveTask) since the streak is meaningfully broken, but leaves
  // past completions alone so Stats/Logbook/habit tracking pick up where
  // they left off.
  archived: boolean;
  archivedAt: string | null;

  // Time tracking — measure how long a task actually takes
  timerStartedAt: string | null; // ISO timestamp while a live timer runs; null when stopped
  // Measured duration, set by the stopwatch; null = never timed. Always equal
  // to estimatedMinutes once set — timing a task *is* how its estimate gets
  // corrected (see applyMeasuredTime), so this is not a second opinion about
  // how long the task takes. Its only remaining job is the "Timed" label on
  // the expanded task row and in the Logbook, which says the number was
  // measured rather than guessed.
  actualMinutes: number | null;

  // Timed tasks ("play violin for 15 minutes") — a duration the task counts
  // down against. Once the countdown runs out the task reads as ready to
  // complete; it never blocks completion (see isTimerReady in utils/timer.ts).
  // Readiness is derived from these two plus timerStartedAt, never stored, so
  // it stays correct across backgrounding and app restarts.
  //
  // On a *subtask* the same field means that subtask's stretch of its parent's
  // run ("5 min scales, 10 min known pieces") — see utils/timerSegments.ts. It
  // is the same kind of number, so it reuses the same column; what a subtask
  // never gets is a timer of its own, since the run it belongs to is the
  // parent's. Once any subtask carries a stretch the parent's own value is the
  // sum of them, written by whatever changed a stretch rather than typed.
  timedMinutes: number | null;   // the target duration; null = not a timed task
  timerElapsedSeconds: number;   // banked from finished run segments; 0 when never run or reset

  // Set on a task auto-generated by completing a recurring task; points back
  // to the task whose completion created it. Lets uncompleting that task
  // remove this follow-up occurrence again.
  previousOccurrenceId: string | null;

  // Pre-edit values of content fields overridden with "this task only" scope
  // (see updateTask). Applied on top of this task when its completion spawns
  // the next occurrence, so a one-off edit doesn't become the series template.
  seriesDefaults: Partial<Task> | null;

  // Fields an Apple Reminders import parsed out of a reminder but has NOT
  // applied — a proposal shown as a chip on the Inbox row, applied only when
  // the user taps it (see applyPendingImport / dismissPendingImport).
  //
  // It has to live beside the task rather than on it, because every field it
  // carries (dueDate, recurrence, reminderTime, timeSegments) is one that
  // isInboxTask treats as "this task has been filed" — writing any of them at
  // import time would eject the capture from the Inbox onto Today or Later
  // before the user had seen it. isInboxTask deliberately ignores this field
  // for the same reason it ignores notes: a suggestion isn't a schedule.
  //
  // Unlike the derived flags elsewhere in this app, this one is stored rather
  // than computed — and it must be. The EventKit fields it came from are
  // destroyed with the reminder seconds after the import, so there is nothing
  // left to re-derive it from. It's also inert: nothing in the app can
  // invalidate it, so it needs none of the cascades a stored isBlocked would.
  //
  // Partial<Task> rather than Partial<TaskDraft> for two reasons: TaskDraft is
  // Omit<Task, …> below, so naming it here would make Task's own keyof depend
  // on itself; and applying is a straight spread into updateTask, which takes
  // Partial<Task>.
  pendingImport: Partial<Task> | null;

  /**
   * How many times this task has been pushed to a later day (see
   * utils/postpone.ts for what counts). Read by the date picker, which offers
   * a way out once it passes the user's threshold.
   *
   * 0 for every existing row, which is the only honest backfill: nothing before
   * this shipped recorded a push, so no task can start out accused of one. It
   * resets when the task is pulled back to today or earlier, and a recurring
   * task's next occurrence starts from 0 — the pushes belong to the occurrence
   * that was pushed.
   */
  postponeCount: number;

  /**
   * "Stop asking about this one." Some tasks genuinely are waiting on someone
   * else, and being asked about them every week is how the whole feature gets
   * turned off.
   *
   * Unlike postponeCount this deliberately survives into the next occurrence: it
   * is a statement about the task, not about today's row.
   */
  postponeMuted: boolean;
}

// postponeCount/postponeMuted are omitted alongside the streak fields for the
// same reason: they're derived state the app maintains, not something a draft
// gets to assert. That makes newTaskFromDraft's hard-coded 0/false the only
// source, so a series row or a template application can't inherit a count.
// extraTaskTally is the same kind of thing — the rule (extraTaskEveryN,
// extraTaskTitle) is the draft's to set, the progress toward it is not.
export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'seenAt' | 'completed' | 'completedAt' | 'streakCount' | 'streakDate' | 'previousStreakCount' | 'previousStreakDate' | 'archived' | 'archivedAt' | 'postponeCount' | 'postponeMuted' | 'extraTaskTally' | 'previousExtraTaskTally'>;

// Which of the template's two anchor dates an item's offsets are relative
// to — e.g. "pack" anchored to the trip's end date, "request time off"
// anchored to its start date.
export type TemplateAnchor = 'start' | 'end';

// One task definition inside a TaskTemplate. Item ids are stable so future
// wizard rules can reference items; `optional` items start unchecked in the
// apply sheet. Offsets are days relative to whichever anchor date (`anchor`)
// is picked at apply time (negative = before, 0 = day of); null = no date.
export interface TemplateItem {
  id: string;
  title: string;
  notes: string;
  optional: boolean;
  anchor: TemplateAnchor;
  dueOffsetDays: number | null;
  deferOffsetDays: number | null;
  // Resolved like dueOffsetDays against `anchor` at apply time — the offset
  // analog of Task.deadlineOffsetDays, since a template can't bake in a fixed
  // calendar date.
  deadlineOffsetDays: number | null;
  windowStart: string | null; // "HH:MM" — carried through unchanged, no date component
  windowEnd: string | null;   // "HH:MM"
  // Minutes before the item's *resolved* due date. Only meaningful (and only
  // editable) when dueOffsetDays is set — there's no date to count back from
  // otherwise.
  reminderOffsetMinutes: number | null;
  timeSegments: TimeOfDay[];
  tags: string[];
  category: string | null;
  priority: Priority;
  effort: Effort;

  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  recurrenceDays: number[];
  recurrenceMonthDay: number | null;
  recurrenceFromCompletion: boolean;
  recurrenceCount: number | null;

  vacationPause: boolean;
  estimatedMinutes: number | null;

  chainEnabled: boolean;
  chainItems: ChainItem[];
  // Which step a task created from this template starts on. 0 by default —
  // TaskEditor lets a real task's current step move freely (tap a dot), and
  // this is the template-side parity for that: a chain that's meant to be
  // picked up mid-way (e.g. a routine already underway) can say so once,
  // instead of every application of the template starting over at step 0.
  chainIndex: number;

  // Title-only stubs; created as real subtask Task rows once the parent task
  // exists at apply time. No completed/dates — a subtask always starts unchecked.
  subtasks: { id: string; title: string }[];

  // Which of the template's itemGroups this item belongs to; null = ungrouped.
  groupId: string | null;

  // When set, this item is a reference to another template rather than a
  // real task — it expands into that template's own items at apply time.
  // Every other task-shaped field above is ignored when this is set.
  refTemplateId: string | null;
  // Name captured when the reference was made; used only as a fallback
  // label when refTemplateId no longer resolves (the target was deleted).
  refTemplateName: string;
}

// A lightweight named group scoped to one template, mirroring TaskGroup's
// shape but with no notes/priority/category/collapsed — those are irrelevant
// before items become real tasks. Collapse state for display is local
// component state in the detail screen, not persisted.
export interface TemplateItemGroup {
  id: string;
  title: string;
  sortOrder: number;
}

// Where one apply of a template puts the tasks it creates. Item titles are
// written to be read next to the template's name ("Buy tickets" under "Plan an
// activity"), so loose in Today they lose the thing they were about — a
// container carries that context once instead of repeating it in every title.
//   'none'    — loose tasks, the original behavior
//   'stack'   — one TaskGroup named after the run
//   'project' — one Project named after the run, the apply's two anchor dates
//               becoming its targetStartDate/targetEndDate
// Only consulted when the user actually names the run; a blank name always
// means 'none'.
export type TemplateContainer = 'none' | 'stack' | 'project';

export interface TaskTemplate {
  id: string;
  name: string;
  items: TemplateItem[];
  itemGroups: TemplateItemGroup[];
  createdAt: string;
  sortOrder: number;
  // Name of a TemplateCategory, purely for grouping templates on the
  // Templates page. Independent of task Category and ProjectCategory.
  category: string | null;
  applyContainer: TemplateContainer;
}

// One row of the grocery catalog — which is also the shopping list. A row is
// created the first time an item is typed and then lives forever: `onList`
// says "I intend to buy this", `checked` says "it's in the trolley", and
// finishing a trip clears both rather than deleting anything. That's what
// makes the second "Milk" a toggle instead of a duplicate, and what gives
// autocomplete and Buy again something to rank.
//
// Deliberately not a Task: a task is an occurrence you complete once, so
// modelling groceries as tasks floods Inbox/Unscheduled (neither predicate has
// an escape hatch but projectId) and leaves a completion tombstone per trip.
export interface GroceryItem {
  id: string;
  // What the user last typed — the label. "Whole milk" and "milk" reading
  // identically in the list would be worse than a near-duplicate.
  name: string;
  // Normalised identity, from groceryNameKey(). UNIQUE in SQLite, which is
  // where the no-duplicates guarantee actually lives.
  nameKey: string;
  // Never null, unlike Task.category: an unrecognised item is *in* the Other
  // aisle rather than aisle-less, which keeps the null branch out of every
  // grouping and sorting path.
  aisle: string;
  // Free text ("2 lb", "x3", "a bunch"). Nothing does arithmetic on it — the
  // parser exists to get it out of the name so the name stays a clean key.
  quantity: string | null;
  note: string;
  onList: boolean;
  // Invariant: checked implies onList.
  checked: boolean;
  // Whether the row has earned a place in the catalog in its own right, rather
  // than only existing because it's on the list right now. A name typed for the
  // first time is `false` — provisional — and taking it off the list deletes it
  // instead of parking it, whether that's a removal, a finished trip that
  // bought it, or a clear that abandoned it. Invariant: !onList implies
  // inCatalog, which is what lets Buy again and the pruner keep reading the
  // whole off-list set.
  inCatalog: boolean;
  sortOrder: number;
  // Bumped by finishShopping, never by clearList. Together with
  // lastPurchasedAt this *is* the autocomplete ranking signal, which is the
  // real reason a finished trip must not delete rows.
  purchaseCount: number;
  lastAddedAt: string | null;
  lastPurchasedAt: string | null;
  createdAt: string;
  // The pantry override — an explicit "Got it"/"Out of it" assertion from
  // GroceryItemSheet, or set forward automatically when finishShopping
  // records a purchase. A future value reads as "on hand" regardless of what
  // grocerySuggest.probablyHaveReason's purchase-cadence guess would say on
  // its own; a past value reads as "confirmed not on hand" and *suppresses*
  // that guess, rather than letting stale purchase history overrule what the
  // user just said with their own hands. null defers entirely to the guess.
  // Self-expiring: once a future date passes, this reads exactly as null
  // again, so "Got it" never needs a separate action to wear off.
  onHandUntil: string | null;
  // The recipe this item was first added from, if any. Set only when
  // addFromPlan creates a genuinely new catalog row — never on a row that
  // already existed, so re-adding a known item (typed, imported, or from a
  // different recipe) never overwrites where it originally came from. A
  // snapshot pair rather than a live id lookup: sourceRecipeTitle is captured
  // once at creation and never refreshed, resolve-or-shrug like every other
  // cross-row pointer here — a later recipe rename or delete doesn't touch it.
  sourceRecipeId: string | null;
  sourceRecipeTitle: string | null;
  // "apples or pears" — two rows you'll pick between at the shelf, sharing this
  // label. Same idea as RecipeIngredient.choiceGroup and resolved by the same
  // rule (exactly one of a group is bought), with two differences that follow
  // from where it lives:
  //
  // It is an **opaque id, not a name**. A recipe's group label is a heading on
  // the ingredient list, so it has to mean something; a grocery list renders no
  // heading for it — each row just names its siblings — so a label would be a
  // second thing to keep in step with nothing to show for it, and two lines
  // typed alike would silently merge into one group.
  //
  // And it is **resolved destructively**: picking one at the shelf takes the
  // others off the list (see resolveChoice). A recipe's pick is a fact about a
  // cooking that lives on MealPlanEntry and leaves the recipe alone, but a
  // shopping list has nowhere to put "I chose apples" — an unresolved loser
  // just sits there looking outstanding, and finishShopping would leave it on
  // the list for ever.
  choiceGroup: string | null;
  // Always on hand — salt, pepper, water, the things nobody actually shops
  // for. Set by hand on GroceryItemSheet, and unlike onHandUntil it never
  // expires: a staple isn't a guess about recent purchases, it's a standing
  // fact about the kitchen. classifyPlanned (mealPlanGroceries.ts) sorts a
  // staple into its own section when a recipe's ingredients are added to the
  // list, so "salt" doesn't sit in Need to buy next to what the trip is
  // actually for.
  isStaple: boolean;
  /**
   * A `YYYY-MM-DD` local day key — the day this should be used up by, or null
   * for anything that doesn't go off on a schedule worth naming.
   *
   * A date rather than a `perishable` flag, for the reason `Leftover.keepUntil`
   * gives: a flag can only say *whether* to nudge, while a day can say *when*,
   * which is the thing the user is actually trying to get ahead of. Stored as
   * the resolved day rather than as "keeps for 5 days" so a later correction to
   * the purchase history can't silently drag the deadline with it.
   *
   * Written by `finishShopping` from the shelf-life lexicon (see
   * groceryShelfLife.ts) and by hand in `GroceryItemSheet`. Every purchase
   * re-stamps it: buying spinach again is fresh spinach, not the old bag.
   *
   * **Distinct from `onHandUntil`, which is nearby and answers a different
   * question.** That one is "do I still have this" — an availability guess that
   * feeds the pantry and a week plan, and that self-expires into silence. This
   * one is "is it about to be wasted", and it earns a real Task.
   */
  expiresAt: string | null;
  /**
   * Whether this item gets a "Use up X" task when it has an expiry — an
   * explicit per-item answer, or null for "the groceryUseUpTasks setting
   * decides". Exactly `MealPlanEntry.cookTask`'s tri-state, and for the same
   * two reasons.
   *
   * `false` is what deleting the task records, so the next purchase doesn't
   * hand back a task the user has already thrown away — a staple bought every
   * week is precisely the row that would otherwise nag for ever. `true` is the
   * opt-in for one item with the feature off, which is what makes the setting
   * safe to default off.
   */
  useUpTask: boolean | null;
}

// How many days before an item's expiry its "Use up X" task falls due.
//
// One day rather than zero: the task exists to get the thing eaten, and a
// reminder that arrives on the day it's already questionable has given up the
// evening someone could have cooked with it — the same call needsAttention()
// makes for a leftover. Zero is still sayable (use it on the day), and the
// ceiling is generous for the same reason LEFTOVER_KEEP_DAYS_MAX is.
export const GROCERY_USE_UP_LEAD_DAYS_DEFAULT = 1;
export const GROCERY_USE_UP_LEAD_DAYS_MIN = 0;
export const GROCERY_USE_UP_LEAD_DAYS_MAX = 14;

// The furthest out a use-by date can be set by hand, in days. Long enough for a
// freezer bag, short enough that the stepper can still reach the far end.
export const GROCERY_EXPIRY_DAYS_MAX = 365;

// Shorter than TITLE_MAX_LENGTH on purpose — this is a shelf label, not a task
// title, and a long one wrecks the row layout at the bigger grocery font size.
export const GROCERY_NAME_MAX_LENGTH = 80;
export const GROCERY_QUANTITY_MAX_LENGTH = 24;

// A place you shop. "Store" everywhere the user can read; `Shop` in code,
// because `store` is already Zustand's word here (useGroceryStore,
// useTaskStore) and `useGroceryStoreStore` is not a name anyone should type.
// Same split as Stack/TaskGroup.
export interface Shop {
  id: string;
  // As typed — the label. "Trader Joe's", not "trader joe s".
  name: string;
  // Normalised identity, from groceryNameKey(). UNIQUE in SQLite, same as
  // GroceryItem.nameKey, so two spellings of one store can't both exist.
  nameKey: string;
  sortOrder: number;
  createdAt: string;
  // "It has everything, but don't send me there" — Amazon is the canonical
  // case. Keeps the store fully available for manual linking (the item
  // sheet's picker, finishShopping's "which store") while pulling it out of
  // primaryShopFor/exclusiveShopFor and the grocery-run task button's store
  // picker. Same naming convention as Category.excludeFromPinSuggestions.
  excludeFromSuggestions: boolean;
}

// One (item, shop) pair — an aggregate, deliberately NOT a log of trips.
//
// A row per item per trip would grow without bound, which is the disease the
// whole grocery catalog was designed around: GroceryItem is a forever-row
// carrying counters rather than a completion tombstone per shop. This is that
// same decision one level down, so the table is bounded by (items × stores you
// actually shop at) instead of by how long you've had the app.
//
// INVARIANT: item.purchaseCount >= sum of its links' purchaseCount. Trips
// finished before this feature shipped — and any trip finished without picking
// a store — bump the item and write no link. So the item-level count is the
// total and these are partial: never sum links to get a total, and never
// render "6 of 7 trips".
export interface ItemShopLink {
  itemId: string;
  shopId: string;
  // 0 means asserted by hand ("I get this at Costco") and never observed on a
  // trip. That's the whole distinction — it doesn't need a second flag.
  purchaseCount: number;
  lastPurchasedAt: string | null;
  // "They don't have it here" — the negative claim, stamped when it was made.
  //
  // A link row is therefore one of three things, and the count alone can't say
  // which: an observed purchase, a hand-assertion of availability
  // (purchaseCount 0, no stamp), or a store the user has said doesn't stock
  // this. The negative is the *current* answer and the count is history, so
  // both can sit on one row — a shop that stocked it eleven times and stopped
  // is exactly the case, and zeroing the count to express it would destroy the
  // record. Every "where can I get this" read (shopsForItem, primaryShopFor,
  // exclusiveShopFor, itemIdsForShop, planTrip) drops a stamped link; only the
  // item sheet's own store list, which exists to show and undo it, reads it.
  //
  // A date rather than a boolean because stock changes and the claim ages: it
  // says *when* you found the gap, which is what makes "not at Safeway (March)"
  // a fact you can weigh rather than a permanent verdict. Buying the thing
  // there clears it automatically — a purchase refutes the claim outright, and
  // that's the one correction nobody should have to make by hand.
  unavailableAt: string | null;
}

// Shorter than a grocery item's: this is a chip label that has to sit in a row
// of other chips in a sheet, not a list row that owns its width.
export const SHOP_NAME_MAX_LENGTH = 40;

// Shorter again: an aisle is a section header above a list of items, and the
// longest built-in ('Meat & Seafood') is 14.
export const AISLE_NAME_MAX_LENGTH = 32;

// A prep clause ("drained and rinsed", "plus more for topping") is a short
// phrase, not a sentence — same order of magnitude as GROCERY_QUANTITY_MAX_LENGTH
// but roomier, since it's prose rather than a number-and-unit. Named generically
// rather than RECIPE_-prefixed: splitPrep() runs on plain grocery quick-add text
// too, not just recipe ingredient lines.
export const PREP_MAX_LENGTH = 60;

// An ingredient section label ("For the cake", "For the frosting") — a
// component name, same order of magnitude as an aisle's.
export const RECIPE_SECTION_MAX_LENGTH = 40;

// One line of a recipe's shopping implication — deliberately not a GroceryItem.
// A GroceryItem is a forever-row carrying purchase counters that earned a place
// in the catalog; "1 tsp smoked paprika" has not, and minting a catalog row for
// every ingredient at *authoring* time is exactly what the provisional
// `inCatalog` axis exists to prevent. It would also poison the Buy again and
// autocomplete rankings, which are scored on purchase history such a row would
// never have.
//
// The bridge to the catalog is `nameKey`, never an id — see the field.
export interface RecipeIngredient {
  id: string;
  // As typed — the label. Same rule as GroceryItem.name.
  name: string;
  // groceryNameKey(name). THE bridge to the catalog, and resolve-or-shrug like
  // every other cross-row pointer here: a miss just falls through to
  // addByName, which is the right behaviour anyway. Kept in step by
  // useGroceryStore.renameItem → useRecipeStore.remapIngredientKey, exactly as
  // renameRememberedAisle keeps the aisle memory in step.
  nameKey: string;
  // Free text, '' when the recipe didn't say. Nothing does arithmetic on it.
  quantity: string;
  // null means "no opinion", so the lexicon and the user's own filings decide
  // at add time. Deliberately NOT 'Other': asserting Other here would outrank
  // aisleForName and file a known item in the miscellaneous pile forever.
  aisle: string | null;
  // What to do to it, not what it is — "peeled and sliced", "drained and
  // rinsed", "melted". Split out by splitPrep() so it never leaks into `name`:
  // nameKey is the catalog bridge, and "garlic, peeled and sliced" would mint
  // a separate catalog row from plain "garlic" every time the wording of the
  // prep clause changed. null means the line didn't have one, same as aisle.
  prep: string | null;
  // Why it's on the list, not what to do to it — "margaritas" from "Limes for
  // margaritas", "dusting" from "flour for dusting". Split out by
  // splitPurpose() for the same reason prep is: nameKey is the catalog
  // bridge, so a purpose clause staying in `name` would mint a separate
  // catalog row every time the dish it's for changed. null means the line
  // didn't have one, same as prep/aisle.
  purpose: string | null;
  // Which component of the recipe this belongs to — "For the cake", "For the
  // frosting". null means the recipe wasn't authored with sections (the
  // common case), and every existing reader that doesn't know about this
  // field keeps working exactly as it did: it's a label on a flat list, not
  // a nested groups type, so ingredients stay one array everywhere outside
  // the editor and detail view — RecipeIngredientSheet, RecipeDetailScreen's
  // grouping — and adding to the grocery list still flattens straight
  // through (mealPlanGroceries' PlannedIngredient never carries it).
  section: string | null;
  // Which either/or slot this line fills — "Pepper", "Cheese". Lines sharing a
  // non-null group are alternatives ("Serrano *or* jalapeño"), of which exactly
  // one is bought; null (the common case) means the line is always needed.
  // Same label-on-a-flat-list convention `section` above uses, and the same one
  // RecipeComponent.choiceGroup uses a layer up.
  //
  // **This is why an alternative is two rows and not one line reading "serrano
  // or jalapeño".** `nameKey` is the bridge to the grocery catalog, so the
  // one-line spelling mints a catalog item literally called "serrano or
  // jalapeño" — a row that can never match a real purchase, never ranks in Buy
  // again, and has to be hand-corrected on the list every single time. Two rows
  // each carry a clean name, and choosing between them at add time is what puts
  // exactly one of them in the trolley.
  //
  // **Deliberately not shared with RecipeComponent's groups**, even though the
  // labels and the resolution work alike: an ingredient names something you can
  // put in a trolley and a component names a dish (see RecipeComponent), so they
  // stay two lists and one *convention*. Chosen ids from both do travel together
  // in MealPlanEntry.recipeChoices, which is safe because an id says which list
  // it came from by which list holds it.
  choiceGroup: string | null;
}

// One recipe used as a part of another — "mashed potatoes" inside both "Steak
// with mash" and "Salmon with mash".
//
// A *reference*, and the reference is the entire point: the alternative is
// copying the component's ingredients into every parent, which is what the user
// already has to do by hand and which stops being true the moment the component
// is edited. Nothing here is a snapshot of the component's contents; flattening
// happens at read time, in src/utils/recipeComponents.ts.
//
// **Deliberately its own list rather than a RecipeIngredient carrying a
// refRecipeId.** TemplateItem does it the other way (a ref item sits among the
// real ones), and that works there because a template's items are already a
// heterogeneous pile of drafts. An ingredient is not: `nameKey` is THE bridge
// to the grocery catalog, and every reader — mergeIngredients' dedupe,
// remapIngredientKeyIn, classifyPlanned, the aisle lexicon — is written on the
// assumption that a line names something you can put in a trolley. A component
// names a dish. Mixing them makes every one of those readers ask "but is this
// one real", which is the hidden-second-row-type shape this app has rejected
// twice already (Series ghost rows, TaskGroup.completedAt).
export interface RecipeComponent {
  // The link's own id, not the target's — so a component can be removed by
  // identity, exactly like an ingredient row.
  id: string;
  // The referenced recipe. **Deliberately no cascade when it's deleted**, same
  // as MealPlanEntry.recipeId and TemplateItem.refTemplateId: foreign keys are
  // off, and resolve-or-shrug is the house rule for every cross-row pointer
  // here. A component that no longer resolves contributes zero ingredients and
  // renders as a broken row the user can remove.
  recipeId: string;
  // Captured at link time and never refreshed, so a dangling link still has
  // something to name. Only ever rendered when recipeId stops resolving — a
  // live component shows the referenced recipe's current name, so a rename
  // propagates the way the whole feature promises.
  name: string;
  // Which either/or slot this component fills — "Side", "Starch". Components
  // sharing a non-null group are *alternatives*: exactly one of them is cooked,
  // so exactly one contributes ingredients and prep steps to any given meal.
  // null (the common case) means unconditional, and every reader that predates
  // this field behaves exactly as it did.
  //
  // **A label on the flat array, not a nested group type** — the same call
  // RecipeIngredient.section makes, and for the same reason: `components` stays
  // one ordered list everywhere outside the pickers, so resolveComponents,
  // recipesUsing and the cycle check need no reshaping.
  //
  // **The default is the group's first component in list order**, deliberately
  // rather than a defaultComponentId on the recipe: an id is a second thing to
  // keep in step with the list (and to repair when that component is removed),
  // while order is already there. makeComponentDefault moves a link to the
  // front of its group, which is the whole of "make this the usual one".
  choiceGroup: string | null;
}

// Which meal of the day a recipe is *for* — a browsing/filtering tag, not a
// schedule. Deliberately not MealSlot (above, used by MealPlanEntry.slot):
// that type is a calendar slot for one planned day and has no 'dessert',
// where this is an intrinsic property of the dish itself — a recipe is
// breakfast food regardless of which day, if any, it ever gets planned onto.
// A closed set for the same reason MealSlot is one: a user-defined string
// list can't be grouped/sorted without a second ordering table (see #1086,
// which builds that grouping on top of this field).
export type RecipeMealType =
  'breakfast' | 'lunch' | 'dinner' | 'side' | 'condiment' | 'snack' | 'dessert' | 'beverage';

// Display order — also the sort key #1086 groups by.
export const RECIPE_MEAL_TYPES: readonly RecipeMealType[] =
  ['breakfast', 'lunch', 'dinner', 'side', 'condiment', 'snack', 'dessert', 'beverage'];

export const RECIPE_MEAL_TYPE_LABELS: Record<RecipeMealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  side: 'Side',
  condiment: 'Condiment',
  snack: 'Snack',
  dessert: 'Dessert',
  beverage: 'Beverage',
};

// What kind of thing `Recipe.source` names — a website reads differently from
// a cookbook (which is also the only one a page number means anything for).
export type RecipeSourceType = 'website' | 'cookbook' | 'magazine' | 'homeRecipe' | 'other';

export const RECIPE_SOURCE_TYPES: readonly RecipeSourceType[] =
  ['website', 'cookbook', 'magazine', 'homeRecipe', 'other'];

export const RECIPE_SOURCE_TYPE_LABELS: Record<RecipeSourceType, string> = {
  website: 'Website',
  cookbook: 'Cookbook',
  magazine: 'Magazine',
  homeRecipe: 'Home recipe',
  other: 'Other',
};

// A dish you cook, with what it takes to shop for it.
//
// Its own table rather than a TaskTemplate variant: applyTemplate materialises
// Task rows, and a recipe applied has to produce grocery writes. Ingredients
// are a JSON array rather than their own table for the reason templates.items
// is one — nothing outside this row holds an ingredient's id, so an ingredient
// needs no identity that survives a rename, and a blob is one fewer
// hand-written cascade in a database with foreign keys off.
export interface Recipe {
  id: string;
  name: string;
  // UNIQUE in SQLite, from groceryNameKey — so two spellings of one dish can't
  // both exist, the same guarantee GroceryItem and Shop get.
  nameKey: string;
  notes: string;
  sourceUrl: string | null;
  // Legacy single attribution field, superseded by author/source below
  // (#1266). Old recipes may still carry a value here; nothing writes it any
  // more. Kept read-only rather than backfilled: an old value like "Alison
  // Roman, Nothing Fancy" can't be reliably split into a person vs. a
  // publication, so guessing would just move the ambiguity into two fields.
  // describeRecipe() falls back to it only when neither new field is set.
  sourceName: string | null;
  // The person it's from — "Alison Roman". Independent of `source`, same as
  // sourceUrl was independent of sourceName: plenty of recipes name one but
  // not the other, and neither implies the other. null means no attribution
  // was given, not "unknown".
  author: string | null;
  // The publication/cookbook/site it's from — "Nothing Fancy", "NYT Cooking".
  // Independent of `author` for the same reason.
  source: string | null;
  // What kind of thing `source` names. Independent of `source` itself being
  // set — a recipe can carry a source type before it's given a name, though
  // in practice the editor asks for both together. Null means never
  // classified, not "unknown"/"other".
  sourceType: RecipeSourceType | null;
  // A cookbook page number ("142", "112-115"). Only meaningful alongside
  // `sourceType === 'cookbook'` — see useRecipeStore.setSourceType, which
  // clears this the moment the type stops being a cookbook, the same rule
  // `servingsMax` follows for `servings`.
  sourcePage: string | null;
  // The low end of the servings count, or the whole count when the recipe
  // doesn't give a range ("serves 4"). null means no serving count at all.
  servings: number | null;
  // The high end of a servings range ("serves 4-6" -> servings: 4,
  // servingsMax: 6). null means the recipe isn't a range — just `servings`.
  // Never set without `servings` also set.
  servingsMax: number | null;
  // What the recipe makes when a person-count doesn't fit — "3 cups", "2
  // dozen cookies", "1 loaf". Free text, independent of servings/servingsMax
  // (a dough can have both: "serves 8" and "makes 2 loaves"). null means
  // nothing was given.
  recipeYield: string | null;
  // The user-attached photo — a file:// URI under the document directory
  // (src/utils/recipePhoto.ts `pickRecipeImage`), null until one's attached.
  // Deliberately not base64-in-the-row: a recipe photo is a picture the card
  // and detail screen render, not a payload the Messages API reads, so there
  // is no reason to pay SQLite (or every future row read) for the bytes.
  imagePath: string | null;
  // Null means untagged, not "none of these" — most existing recipes predate
  // this field and nothing should guess for them. See RecipeMealType above.
  mealType: RecipeMealType | null;
  // Free-form labels — "vegetarian", "quick", "thai". Deliberately alongside
  // `mealType` rather than replacing it: a meal type is a closed set the box
  // groups by and the meal planner reasons about, while these are whatever the
  // cook wants to slice their own library on. Lowercased and deduped by
  // normalizeRecipeTags (src/utils/recipeTags.ts) — a tag is an identity, so
  // "Thai" and "thai" must not be two chips in the filter row.
  //
  // **No registry, unlike Task.tags.** A task's tag survives with no tasks on
  // it because tag_registry keeps it (there's a Tags screen to create one from,
  // and a tag is how a task gets filed before it exists). A recipe tag is only
  // ever typed onto a recipe, so the vocabulary is derived from the recipes
  // themselves (allRecipeTags) and a tag nobody carries is a typo that cleans
  // itself up rather than a name to maintain.
  tags: string[];
  ingredients: RecipeIngredient[];
  // The recipes this one is partly made of — see RecipeComponent. Empty for
  // every recipe that isn't composed, which is most of them; the ingredient
  // list is still where a plain recipe lives.
  components: RecipeComponent[];
  // "Defrost the chicken", "start the sauce at 5" — real Tasks once "Add prep
  // tasks" on a planned meal walks this list, not a meal-specific reminder
  // path. src/utils/notifications.ts is Task-typed end to end
  // (scheduleTaskReminder(task)), and forking it for one feature is how an
  // app ends up with two reminder systems and one of them quietly broken.
  prepTasks: RecipePrepTask[];
  favorite: boolean;
  sortOrder: number;
  createdAt: string;
  /**
   * How many meal plan entries pointing at this recipe have been marked
   * cooked. Bumped once per "Mark cooked" tap and **never recomputed by
   * scanning entries** — the same discipline that keeps streaks safe from the
   * completed-task purge keeps this safe from the 180-day meal plan entry
   * prune (see MEAL_PLAN_RETENTION_DAYS).
   */
  cookCount: number;
  /** When this recipe was last marked cooked; null if never. */
  lastCookedAt: string | null;

  // Duration + cook timer + actual-time logging (#1091).

  /**
   * How long this recipe is expected to take, in minutes. Shown next to
   * ingredient count/servings (see describeRecipe) and doubles as the cook
   * timer's countdown target below — a recipe's duration and "how long to
   * time it for" are the same number, unlike a Task where estimatedMinutes
   * (workload) and timedMinutes (an explicit countdown target) are allowed to
   * differ.
   */
  estimatedMinutes: number | null;
  // The cook timer itself — the same banked-segment design as
  // Task.timerStartedAt/timerElapsedSeconds (see src/utils/timer.ts and its
  // recipe counterpart src/utils/recipeTimer.ts): only these two raw fields
  // are ever stored, and how much time has elapsed or remains is always
  // derived against the current clock, so a phone that was backgrounded or
  // killed mid-cook comes back with the right answer for free.
  timerStartedAt: string | null; // ISO timestamp while a live cook timer runs; null when stopped
  timerElapsedSeconds: number;   // banked from finished run segments; 0 when never run or reset

  /**
   * Actual cook time, logged when a timer session finishes — an aggregate,
   * deliberately not a row-per-session log. A row per cook would grow
   * without bound, which is the exact disease grocery_item_shops was
   * designed around (see the note on ItemShopLink): the fix there was
   * counters bounded by (items × stores), not a trip log, and cookCount/
   * lastCookedAt above already made the same call for "was this cooked" one
   * level up. So a logged session only ever touches three counters:
   * lastCookMinutes (the most recent one, for "took 32m last time"),
   * cookTimeCount and totalCookMinutes (paired, so an average — "usually
   * about 30m across 4 cooks" — is `totalCookMinutes / cookTimeCount` at
   * read time, never re-derived by scanning anything). This is what lets the
   * recorded time diverge from `estimatedMinutes` and be compared against it
   * over repeated cooks, without a table that grows with every meal made.
   */
  lastCookMinutes: number | null;
  cookTimeCount: number;
  totalCookMinutes: number;

  /**
   * How long prep (chopping, marinating, mise en place) takes before the
   * cook clock starts, in minutes — independent of `estimatedMinutes`, which
   * is cook time only now that this exists. `totalMinutes()` (recipeUtils)
   * is prep + cook whenever either is set; neither field derives from it.
   */
  prepMinutes: number | null;
  // The prep timer — its own banked-segment pair, so prep and cook can be
  // timed independently (mise en place while something else already simmers)
  // rather than sharing timerStartedAt/timerElapsedSeconds above.
  prepTimerStartedAt: string | null;
  prepTimerElapsedSeconds: number;
  // Actual prep time logging, the same aggregate shape as
  // lastCookMinutes/cookTimeCount/totalCookMinutes above.
  lastPrepMinutes: number | null;
  prepTimeCount: number;
  totalPrepMinutes: number;
}

// One prep step on a recipe — TemplateItem's anchor-relative offset model
// reduced to the three fields this needs. Unlike TemplateItem.dueOffsetDays,
// `offsetDays` is never null: a prep step with no date wouldn't have
// anything to remind about, so every step in the list is dated relative to
// the meal by definition.
export interface RecipePrepTask {
  id: string;
  title: string;
  /** Days relative to the meal's date — negative before, 0 the day of. */
  offsetDays: number;
  /** Minutes before the resolved due date a reminder fires; null = no reminder. */
  reminderOffsetMinutes: number | null;
}

// Shorter than TITLE_MAX_LENGTH for the same reason a grocery item's is: this
// is a list-row label at a larger font, not a task title.
export const RECIPE_NAME_MAX_LENGTH = 80;
// A byline, not a title — "NYT Cooking" not a full citation.
export const RECIPE_SOURCE_MAX_LENGTH = 60;
// "142" or "112-115" — never a citation, so far shorter than the source name.
export const RECIPE_PAGE_MAX_LENGTH = 12;

// A tag is a chip in a filter row, so it has to stay readable at chip size —
// "weeknight", "make ahead", not a sentence. Shorter than every other recipe
// string for that reason. See Recipe.tags.
export const RECIPE_TAG_MAX_LENGTH = 24;

// A choice group's label ("Side", "Starch") — the same kind of short component
// name an ingredient section carries, and the same ceiling, for the same
// reason: it renders as a section heading above the options it names.
export const RECIPE_CHOICE_GROUP_MAX_LENGTH = RECIPE_SECTION_MAX_LENGTH;

// Which meal of the day a plan entry sits in. A closed set rather than free
// text: it orders the day, and a day whose sections are user-defined strings
// can't be sorted without inventing a second ordering table.
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

// The order a day is read in. MEAL_SLOTS is the sort key for entries sharing a
// date — see slotRank in src/utils/mealPlan.ts.
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/**
 * One thing planned for one meal of one day.
 *
 * **Its own row, never a Task, and never a Task carrying a marker.** Four
 * concrete failures if it were one: sweepExpiredTasks deletes next week's plan,
 * purgeOldCompletedTasks eats the history, completing a recurring one spawns
 * phantom dinners, and seriesId becomes a second, conflicting way to say "this
 * on several dates". A Task-with-a-flag is the hidden-second-row-type move this
 * app has already rejected twice in writing (Series ghost rows, and
 * TaskGroup.completedAt).
 */
export interface MealPlanEntry {
  id: string;
  /**
   * A `YYYY-MM-DD` **local day key**, deliberately unlike every other date in
   * this app, which stores an ISO instant. A meal slot is a calendar day rather
   * than a moment: an instant would reopen the dayResetTime question (does
   * Tuesday's dinner belong to Tuesday at 02:00?) and make a range read shift
   * under the user the moment they travel. Built with dayKeyOf().
   */
  date: string;
  slot: MealSlot;
  /**
   * Null is a first-class answer — Thursday is allowed to just say "leftovers",
   * and such an entry holds its place, renders on the week and counts toward
   * "6 dinners planned" with no second-class treatment. Every planner that
   * demands a recipe per night is abandoned on a Wednesday.
   *
   * **Deliberately no cascade when the recipe is deleted.** Foreign keys are off
   * in expo-sqlite so ON DELETE CASCADE would silently do nothing anyway, but
   * here no cascade is the choice rather than an accident: deleting a recipe
   * must not blank last Tuesday. Readers are resolve-or-shrug and fall back to
   * `title`, exactly as TemplateItem.refTemplateName does.
   */
  recipeId: string | null;
  /** Captured at plan time, so the row still reads right when recipeId stops resolving. */
  title: string;
  /**
   * Orders entries within one (date, slot). There is deliberately no
   * UNIQUE(date, slot) — two things on one dinner is real (chicken *and* a
   * salad), and a uniqueness constraint would make the second one unsayable.
   */
  sortOrder: number;
  createdAt: string;
  /**
   * When this meal was actually made, set by a "Mark cooked" row action; null
   * until then. This is the one thing this row tracks about the *past* rather
   * than the plan — bumping it also bumps the recipe's cookCount/lastCookedAt,
   * but those live on the recipe and are never derived back from entries (see
   * Recipe.cookCount), so a purged entry never un-counts a cooking.
   */
  cookedAt: string | null;
  /**
   * The tracked leftover this meal is eating, if the user picked one instead of
   * a recipe or free text. Mutually exclusive with `recipeId` in practice —
   * both pickers commit through the same MealPick — but not enforced in the
   * schema, because a row that somehow carried both should still render rather
   * than be rejected.
   *
   * Same resolve-or-shrug, no-cascade contract as `recipeId`: finishing or
   * deleting a leftover must not blank last Tuesday, and `title` is the
   * captured fallback. **Pointing at a leftover is not eating all of it** — see
   * Leftover.finishedAt for why the two states are separate.
   */
  leftoverId: string | null;
  /**
   * Which alternative was picked for each of the recipe's choice groups — a
   * list of ids, each naming either a `RecipeComponent` link ("roast potatoes
   * rather than mash") or a `RecipeIngredient` line ("jalapeño rather than
   * serrano"). Empty means every group falls back to its default, which is what
   * every entry planned before this shipped says.
   *
   * **The pick lives here rather than on the recipe** because it is a fact
   * about a cooking, not about the dish: Tuesday's steak comes with mash and
   * Friday's with roast potatoes, out of one recipe. Same split cookedAt
   * already makes — the recipe is the document, the entry is one instance of
   * having planned it.
   *
   * **One list for both kinds**, rather than two fields, because every reader
   * asks the same question of it ("did this group's option win?") and an id
   * already says which kind it is by which list holds it. A pick that names
   * neither is simply a pick nothing matches.
   *
   * A flat list rather than a `{group: id}` map, because an id is unique across
   * the whole library — and it has to be, since a choice group can sit on a
   * *component* several levels down rather than on the recipe this entry points
   * at, so a group name alone wouldn't say whose group it is.
   *
   * Resolve-or-shrug like every other cross-row pointer here: an id whose row
   * has since been removed names no option, so its group quietly falls back to
   * its default rather than the meal losing its side.
   */
  recipeChoices: string[];
  /**
   * How much of the recipe this meal makes — 1 for as-written, 2 for a doubled
   * Sunday, 0.5 for cooking for one. Applied to every ingredient quantity when
   * the meal is shopped for (see collectPlannedIngredients), components
   * included, and to the servings the meal is described with.
   *
   * **A fact about a cooking, not about the dish**, for exactly the reason
   * `recipeChoices` above is: doubling Sunday's chili must not double the
   * recipe, or every other meal in the week that uses it — including as a
   * component of something else — silently doubles too. The recipe stays the
   * document; the entry is one instance of having planned it.
   *
   * Never null in practice (the column defaults to 1, which is what every entry
   * planned before this shipped says), but read through
   * recipeScale.normalizeScale anyway, so a hand-edited row or a restored
   * backup carrying 0 renders as-written rather than as nothing.
   */
  recipeScale: number;
  /**
   * Whether this meal gets a "Cook X" task on Today — `true`/`false` when the
   * user has said so for this meal, `null` when they haven't and the
   * `mealCookTasks` setting decides (see wantsCookTask in utils/mealTasks.ts).
   *
   * **Three states rather than a boolean, because "no" has to be sayable
   * separately from "not yet asked".** Deleting the spawned task records
   * `false` here, and that's the whole reason the field exists: without a
   * tombstone the next edit to this meal reconciles the task straight back,
   * and a row the user deleted reappearing is the one outcome that would make
   * the feature intolerable. Same shape, and the same reasoning, as
   * grocery `hiddenAisles` — a delete needs somewhere to be remembered when
   * the thing deleted is derived from something else.
   *
   * `null` for every meal planned before this shipped, which reads as "follow
   * the setting" and is what makes the rollout silent: nothing is backfilled,
   * so no cook tasks appear for meals already on the calendar — only ones
   * planned from here on.
   *
   * A fact about a cooking, not about the dish, exactly like recipeChoices and
   * recipeScale above: "I need reminding to make this on Sunday" says nothing
   * about the recipe, which may well be a component of something else.
   */
  cookTask: boolean | null;
}

/**
 * Something cooked that's now sitting in the fridge, with a clock on it.
 *
 * Its own row rather than a GroceryItem or a Recipe, because it is neither: a
 * grocery item is a forever-row with a purchase count, an aisle and a shop, all
 * meaningless here, and its identity is a `nameKey` — but "leftover chilli" made
 * twice in one week is two containers with two different clocks, so the name
 * can't be the identity. A recipe is a reusable document; this is one perishable
 * instance of having cooked one. And it is deliberately not a field on the
 * MealPlanEntry it came from either: a leftover outlives the meal that made it,
 * gets eaten across several later meals, and can be logged with no planned meal
 * behind it at all.
 *
 * **It is also not a Task**, for the reasons MealPlanEntry gives — and one more:
 * a reminder *Task* for "use up the chilli" is #1106's job (expiry-driven tasks
 * for perishable groceries), which doesn't exist yet. This row carries the dates
 * that mechanism would need, and the nudge here stays in-app, so that when #1106
 * ships there is one reminder-task path to join rather than a second to unpick.
 */
export interface Leftover {
  id: string;
  /** What's in the container. Captured, not derived — see recipeId. */
  title: string;
  /**
   * The recipe it was made from, when it was logged off a cooked meal. Null for
   * anything logged by hand, which is a first-class answer: half a takeaway is a
   * leftover and has no recipe. Resolve-or-shrug with no cascade, exactly like
   * MealPlanEntry.recipeId — `title` is what actually renders.
   */
  recipeId: string | null;
  /** The planned meal it was logged from, if any. Same no-cascade contract. */
  sourceEntryId: string | null;
  /** ISO instant it went in the fridge. Age is counted in *calendar* days off this. */
  storedAt: string;
  /**
   * A `YYYY-MM-DD` local day key — the day it should be eaten or thrown out by.
   *
   * Stored as the resolved day rather than as a "keep for 4 days" number, for
   * the reason #1106 gives for preferring a real expiry date to a perishable
   * flag: an absolute day can drive *when* to nudge, and editing the stored-on
   * date later doesn't silently drag the deadline with it. The editor still
   * talks in days and converts (see keepUntilKeyFor / keepDaysBetween).
   */
  keepUntil: string;
  /**
   * ISO instant the container was emptied or binned; null while it's still in
   * the fridge. **This is not set by planning a meal against it** — a pot of
   * soup feeds two dinners, so "used for a meal" and "no longer tracked" are
   * separate states and only an explicit action closes this one out.
   */
  finishedAt: string | null;
  /** Which ending it got. Null exactly while `finishedAt` is null. */
  outcome: LeftoverOutcome | null;
  createdAt: string;
}

/**
 * How a leftover ended. Recorded because "we ate it" and "it went off" are the
 * two things the whole feature is trying to tell apart, and a single
 * finished-flag would throw that away at the moment it's cheapest to capture.
 */
export type LeftoverOutcome = 'eaten' | 'tossed';

/**
 * How close to its keep-until day a leftover is. Four states rather than a
 * boolean because the nudge has to arrive *before* the waste, and "one day
 * left" and "three days past" are not the same message.
 */
export type LeftoverFreshness = 'fresh' | 'soon' | 'due' | 'over';

// A container label, not a title — same reasoning as RECIPE_NAME_MAX_LENGTH,
// and the same number, since a leftover's name usually *is* a recipe's.
export const LEFTOVER_NAME_MAX_LENGTH = RECIPE_NAME_MAX_LENGTH;

/**
 * The keep-for window a freshly logged leftover starts with.
 *
 * Three or four days is the usual food-safety advice for cooked leftovers, and
 * this app rounds toward the cautious end. It's a starting point the stepper
 * moves, never a rule — see LEFTOVER_KEEP_DAYS_MAX.
 */
export const LEFTOVER_KEEP_DAYS_DEFAULT = 3;
/** Same day it was made — for something that genuinely won't last the night. */
export const LEFTOVER_KEEP_DAYS_MIN = 0;
/**
 * The ceiling on the keep-for stepper. Generous on purpose: a frozen portion is
 * a real leftover, and CountStepper exists precisely so a ceiling nobody asked
 * for doesn't make a legitimate answer unsayable.
 */
export const LEFTOVER_KEEP_DAYS_MAX = 90;

/**
 * How long a *closed-out* leftover is kept, in days.
 *
 * Same disease the meal plan prune exists for — one row per container forever —
 * and deliberately a much shorter window, because a finished leftover has no
 * Logbook, no stats and nothing pointing at it once its meal entries have aged
 * out. A leftover that is still *live* is never purged however old it is: an
 * eight-week-old container nobody closed out is exactly what this feature is
 * for, and quietly deleting it would be the app taking the user's side of the
 * conversation.
 */
export const LEFTOVER_RETENTION_DAYS = 60;

/**
 * How long a planned meal is kept, in days.
 *
 * Entries are the first per-event rows this app adds since the grocery model
 * was built to avoid exactly that, so the prune is not optional. It is
 * deliberately *not* wired to `completedRetentionDays`: that setting is a
 * promise about the user's Logbook, and quietly reusing it would mean "keep
 * completions forever" also means "keep four years of dinners".
 */
export const MEAL_PLAN_RETENTION_DAYS = 180;

export const PRIORITY_LABELS = ['None', 'Low', 'Medium', 'High', 'Urgent'] as const;
export const PRIORITY_COLORS = [
  'transparent',
  '#30D158',
  '#FFD60A',
  '#FF9F0A',
  '#FF453A',
] as const;

export const EFFORT_LABELS = ['—', 'XXS', 'XS', 'S', 'M', 'L', 'XL'] as const;
export const EFFORT_HINTS = ['', '~1min', '~15min', '~30min', '~1-2hr', '~4hr', 'day+'] as const;

// Max length for any title-style input (task, subtask, chain step). Long titles
// are truncated with an ellipsis in the list, so cap input to keep them sane.
export const TITLE_MAX_LENGTH = 200;
