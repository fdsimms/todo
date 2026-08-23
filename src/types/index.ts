export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Priority = 0 | 1 | 2 | 3 | 4;
export type Effort = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type SortOption = 'default' | 'priority' | 'effort-asc' | 'effort-desc' | 'due-date' | 'streak';
export type RecipeSortOption = 'default' | 'name' | 'cooked-recent' | 'cooked-oldest' | 'ingredients-asc' | 'ingredients-desc' | 'voted';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
// 'persistent' is 'alarm' that re-rings on an interval until the task is
// completed, rather than once — see src/utils/alarmChain.ts.
export type ReminderKind = 'notification' | 'alarm' | 'persistent';
/**
 * What a decision task asks for when you complete it — see
 * `Task.deliverableKind` and `src/utils/deliverables.ts`.
 *
 * 'place' is deliberately absent until there's a place entity to point at
 * (#1123): a string that pretends to be a place is a row nothing can ever
 * resolve, the same mistake `splitAlternativeNames` exists to avoid on the
 * grocery side.
 */
export type DeliverableKind = 'text' | 'date' | 'number';

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
  // Keep tasks in this category from counting as "new" — no entry in the
  // "you have X new todos" banner, and no dot on their own row (see
  // isTaskNew). Both read the same signal, so this turns it off at the
  // source rather than hiding it from only one of the two places it shows.
  // For categories that surface tasks constantly (routines, recurring
  // errands) where "new" would fire every day and stop meaning anything.
  excludeFromNewTasksBanner: boolean;
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

// Everything the "Extra task" rule says about the task it adds, beyond its
// title — see the field notes on Task.extraTaskEveryN, and extraTask.ts for
// the rule itself.
//
// **Null on the task means "just the title", which is what every rule written
// before this existed says**, and the spawn behaves exactly as it did: filed
// where the task that spawned it lives, and taking the app's new-task
// defaults for priority and effort. A draft, once authored, is the whole
// answer for the fields it carries.
//
// One JSON column rather than nine, for the reason chainItems is one: these
// are only ever read and written together, by the one place that spawns the
// task, and a column apiece would be nine migrations for a field set that is
// this feature's alone.
//
// What is deliberately *not* here is when it lands. The rule already answers
// that ("due with the next occurrence, or today if there isn't one"), so a
// due date, a defer, a reminder or a repeat of its own would be a second
// schedule contradicting the first — the same call applyTaskDates makes about
// a series never carrying a recurrence rule.
export interface ExtraTaskDraft {
  notes: string;
  // Null = the same category as the task that spawns it, which is the
  // original behaviour and stays the default. Deliberately not a tri-state
  // with an explicit "no category": filing it where its parent lives is what
  // stops it sitting loose above the category sections, and that argument
  // doesn't get weaker for being made in a picker.
  category: string | null;
  projectId: string | null; // null = the same project, same reasoning
  tags: string[];
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null;
  timeSegments: TimeOfDay[];
  // Title-only stubs, created as real subtask rows alongside the task itself
  // — the same shape TemplateItem.subtasks uses, and for the same reason: a
  // subtask always starts unchecked, so it has no state worth authoring.
  subtasks: { id: string; title: string }[];
}

// How a quick-added title gets filed on its own — "anything starting with
// 'expense' belongs to Work". A rule is *conditional new-task defaults*: it
// sits between what the person typing actually picked and Settings'
// newTaskDefaults, and like those defaults it only ever fills a field nobody
// answered (see newTaskFromDraft).
//
// **It says where a task is filed and how it's ranked, never when it
// happens.** No date, defer, reminder, time-of-day or repeat — the title's own
// schedule phrase already owns "when" (parseTaskInput), and a rule quietly
// dating a task is the one that can hide it outright (see the visibility
// model). Nor notes and subtasks: a rule that writes a task's contents is a
// template, and the app has templates.
//
// Stored as one JSON settings row rather than a table, the call aisleOrder
// makes and stores don't: nothing points *at* a rule, so it needs no id that
// survives a rename. What it does point at — a category name, a project id —
// dangles resolve-or-shrug like every other cross-row pointer here, so
// deleting the project a rule files into leaves a rule that fills one less
// field, not a broken one.
export interface TitleRule {
  id: string;
  // Every word or phrase that triggers it, matched case-insensitively and on
  // whole words only, so "expense" never fires on "expensive". A list rather
  // than one word because near-synonyms ("expense", "expenses", "reimburse")
  // are one rule in the user's head; plurals are deliberately not guessed at,
  // which is exactly why adding the second form has to be this cheap.
  keywords: string[];
  match: TitleRuleMatch;
  // The filing half of ExtraTaskDraft, and null/0 mean the same thing here:
  // this rule says nothing about that field, so whatever would have happened
  // without it still happens.
  category: string | null;
  projectId: string | null;
  tags: string[];
  priority: Priority;
  effort: Effort;
  // Take the matched word back out of the title ("expense lunch" → "lunch").
  // Off by default: the word is usually part of what the task is called, and
  // a rule that silently rewrites what someone typed is a worse first
  // impression than one that leaves it alone.
  stripKeyword: boolean;
  // Off keeps the rule written down but stops it applying — the same call
  // ItemSubLink.standing makes, so reviewing a rule that misfiled something
  // doesn't mean deleting the only record of it.
  enabled: boolean;
}

// "Starts with" is the anchored one and the reason this feature exists: a
// marker word people already type at the front of a title. "Contains" is the
// looser second, for a word that shows up anywhere ("invoice", a client's
// name). There is deliberately no regex mode — see titleRules.ts.
export type TitleRuleMatch = 'startsWith' | 'contains';

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

/**
 * One stretch of a focus session — either work on a task, or a break.
 *
 * A session is a *plan*: an ordered list of these, built once when the session
 * starts (see `src/utils/focusPlan.ts`) from the tasks' own estimates and the
 * user's rest rules. The plan is stored rather than re-derived, because it's a
 * commitment the user agreed to on the setup sheet — re-deriving it would let
 * an estimate edit reshuffle a session already in progress.
 */
export type FocusStepKind = 'work' | 'rest';

export interface FocusStep {
  kind: FocusStepKind;
  /** Work steps: the task being worked on. Rest steps carry null. */
  taskId: string | null;
  /** How long the stretch runs for. Always positive. */
  minutes: number;
  /**
   * Which slice of its task this is, 1-based, and how many slices that task
   * was cut into. `1 of 1` for a task that fits inside one work step. A task
   * estimated longer than `focusWorkCapMinutes` is split into equal parts so a
   * two-hour estimate becomes several stretches with breaks between them,
   * rather than one two-hour "pomodoro" that is no such thing.
   */
  part: number;
  partCount: number;
  /** Rest steps: the longer break every `focusLongRestEvery` breaks. */
  long: boolean;
}

/**
 * The one focus session in flight, if there is one.
 *
 * At most one row exists at a time (`focus_sessions` holds a single row —
 * starting a session replaces whatever was there, ending one deletes it).
 *
 * **Only the current step carries a clock.** How far through a step we are is
 * derived from `stepStartedAt`/`stepElapsedSeconds` against the wall clock and
 * never stored, exactly as `src/utils/timer.ts` derives a task countdown and
 * for the same reason: a stored "seconds remaining" would need clearing on
 * pause and would go stale the moment the app is backgrounded. What is *not*
 * derived is which step you're on — `stepIndex` moves only when the user
 * advances, so a phone left in a pocket for an hour comes back on the step it
 * was on, over-run, rather than having silently burned through three of them.
 */
export interface FocusSession {
  id: string;
  /** When the session began. Only ever displayed, never used for step math. */
  startedAt: string;
  steps: FocusStep[];
  /** Which step is live. `steps.length` means the plan is finished. */
  stepIndex: number;
  /** ISO while the current step's run segment is in flight; null when paused. */
  stepStartedAt: string | null;
  /** Banked seconds within the *current* step only — reset on every advance. */
  stepElapsedSeconds: number;
  /** Tasks ticked off from inside the session, for its closing summary. */
  completedTaskIds: string[];
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
  // Independent of archived: finishing a project and filing it away are two
  // different calls, and reusing archived for both meant the only way to mark
  // a project done was to also hide it from the Projects screen entirely (see
  // ProjectEditor's Mark complete row). A completed project keeps its own
  // Completed list; archiving one afterward moves it to Archived instead, same
  // as archiving any other project.
  completed: boolean;
  completedAt: string | null;
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
  // When the user last deleted this project's review task (see
  // utils/projectReviewTasks.ts) — the per-source opt-out every generated task
  // writes on its source row, and the one that had to be a *date* rather than
  // the usual `false`.
  //
  // The other four generators' opt-outs are permanent by design: a staple
  // bought every week can be told once that it doesn't need a use-up task, and
  // stays told. A project has no such answer to give. The only fields it could
  // write to are nudgeOptIn and nudgeCadenceDays, and both mean "never chase me
  // about this again" — an enormous thing to have said by swiping one row away.
  // What the swipe actually means is "not today", which is precisely what
  // Task.autoScheduledAt already records for the drip, so this is the same
  // idiom: a stamp read against the current logical day and ignored once that
  // day is past. Deliberately not scoped to the project's own cadence, for the
  // reason declinedToday gives — a fortnightly project would bury the offer for
  // two weeks over one tap.
  reviewDeclinedAt: string | null;
}

// Fallback cadence for a project row written before the nudge columns existed,
// and the default for a newly created project. Never, deliberately: being asked
// about a project you haven't decided you want chasing is the annoying half of
// this feature, and it's the half you get without opting in. It used to default
// to two weeks so the feature wasn't inert on arrival.
export const DEFAULT_NUDGE_CADENCE_DAYS = 0;

/**
 * Which of the app's six unattended generators wrote a task — see
 * `Task.generatedKind` below, and `src/utils/generatedTasks.ts` for the
 * mechanism they share.
 *
 * The strings are persisted in `tasks.generated_kind`, so these are storage
 * values: rename one and every existing row goes unrecognised, which reads as
 * that generator having forgotten every task it ever wrote.
 */
export type GeneratedKind =
  // Retired in favour of 'mealSlot' below, and kept only because these are
  // storage values: rows written before the fold still say 'mealCook', and a
  // kind the code no longer recognises reads as the app having forgotten every
  // cook task it ever wrote. Nothing writes it any more — see
  // src/utils/mealSlotTasks.ts for what replaced it and why.
  | 'mealCook'
  // A meal of the day as one task, whose steps are what's left to decide:
  // Choose -> Prepare -> Eat for a slot with nothing in it, and the same chain
  // with its first step already gone once something is planned.
  | 'mealSlot'
  | 'groceryUseUp'
  | 'leftoverUseUp'
  | 'mealPlanNudge'
  | 'projectReview'
  | 'pantryCheck';

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
  // Whether this deadline is mirrored as an all-day event on the calendar
  // picked in Settings › Calendar (useSettingsStore's deadlineCalendarId) —
  // opt-in per task, never a blanket export of every deadline in the app.
  // See calendarEventId below and reconcileDeadlineEvent in useTaskStore.ts.
  deadlineOnCalendar: boolean;
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
  // The day-of-month the monthly/yearly grid is measured from when the rule
  // has no explicit recurrenceMonthDay or recurrenceWeekOrdinal — i.e. the
  // picker's "same day as the due date" anchor. Captured from dueDate whenever
  // the user writes the schedule, and deliberately *not* rewritten by the
  // successor completeTask spawns, which is the whole point: addMonths clamps
  // (Jan 31 -> Feb 28), and a stored date that then becomes the next anchor
  // loses the 31st for good — Feb 28, Mar 28, Apr 28, for ever. The anchor is
  // what a short month is clamped *from* each time, so the 31st comes back in
  // March, exactly as getNextSeriesDates already does for a dated series.
  // Never shown: the picker still reads "same day as the due date", and this
  // follows dueDate on every deliberate edit, so that stays true.
  recurrenceAnchorDay: number | null;
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

  /**
   * "Ask on completion" — a task whose completion means recording a decision
   * ("Pick a date for the trip"), not just ticking a box. Null on every
   * ordinary task, which is almost all of them.
   *
   * Deliberately NOT a fifth `TaskKind`. The four kinds are exclusive by
   * construction (`bakedFields` clears the other three's fields), and there is
   * no reason a chain step or a timed task can't also end in a decision — so
   * this is an additive optional field, like `deadline` or `blockedById`.
   */
  deliverableKind: DeliverableKind | null;
  /**
   * The answer, once given: an ISO date for 'date', the digits for 'number',
   * free text for 'text'. Null while unanswered — which a *completed* task is
   * allowed to be, because nothing may block a completion (see
   * DeliverablePromptSheet, and the non-interactive paths into completeTask
   * that can't ask at all).
   *
   * **Not carried to the next occurrence**, exactly like `actualMinutes`: it
   * records what happened on this row. The *kind* carries (it's the question,
   * which is a property of the task), the answer doesn't — so a recurring
   * decision task's Logbook becomes the log of its answers over time.
   *
   * The reason this isn't appended to `notes`, which was the obvious first
   * idea: `notes` is a CONTENT_FIELD and rides `...effective` into the next
   * occurrence, so a recurring task would inherit every past answer and grow
   * without bound, and a scope:'series' edit would fan the text across the set.
   */
  deliverableValue: string | null;

  // Which generator wrote this task, and the row it was projected from — both
  // null on every task a person typed. See src/utils/generatedTasks.ts for the
  // mechanism and src/utils/{mealSlotTasks,groceryExpiry,leftoverTasks,
  // mealPlanNudge}.ts for each generator's own rules.
  //
  // These replaced a column per generator (mealEntryId, groceryItemId,
  // leftoverId) once there were four of them and a fifth would have meant a
  // fifth column, a fifth "don't pile up" rule and a fifth copy of the same
  // opt-out (#1524). The old columns are still on the table, backfilled from
  // and then left unwritten, like task_groups.completed_at.
  //
  // **The source is the master and this task is the replica**, which is the one
  // thing to keep straight. The source owns a named handful of fields — a
  // meal's title, day and time-of-day segment; a grocery item's title, due date
  // and deadline — and reconciling rewrites exactly those; everything else the
  // user sets on the row (category, notes, priority, subtasks) is theirs and is
  // never touched. Only meals flow anything back: completing a cook task stamps
  // the entry's cookedAt and marking the entry cooked completes the task, each
  // guarded by the other's idempotence check so the two can't ping-pong.
  // Ticking "Use up spinach" off is deliberately *not* a claim about the
  // catalog row or the container in the fridge — neither is marked eaten,
  // thrown away or out of stock, because none of those is what ticking a task
  // means.
  //
  // Deliberately NOT the inverse of a taskId on the source: one pointer can't
  // disagree with itself, and the lookup this direction is a scan of an array
  // already in memory. Resolve-or-shrug like every other cross-row pointer here
  // — a source that has since been purged leaves this dangling, and a dangling
  // generated task is just a task.
  //
  // generatedSourceId is null for a generator projected from no row at all: the
  // meal-plan nudge comes off the calendar, so its tasks carry the kind alone.
  generatedKind: GeneratedKind | null;
  generatedSourceId: string | null;

  // The id of the all-day calendar event mirroring this task's deadline, or
  // null when deadlineOnCalendar is off or the write hasn't happened (yet, or
  // ever — the device write is best-effort).
  //
  // Inverted from mealEntryId/groceryItemId just above: there this task is
  // the replica of another row. Here **the task is the master** — it owns
  // the title and the date, the event is the replica, and reconciling
  // rewrites exactly those two on the device event. Nothing flows back: a
  // deadline dragged around in Apple Calendar doesn't move it here, because
  // the whole point of a deadline is that it doesn't move just because a day
  // got busy — see reconcileDeadlineEvent in useTaskStore.ts.
  //
  // Resolve-or-shrug like every other cross-row pointer here — the event
  // gone missing (deleted by hand, or the calendar itself removed) leaves
  // this dangling, and the next reconcile just writes a fresh one.
  calendarEventId: string | null;

  // The id of the timed event blocking out room to actually *do* this task,
  // or null until the user asks for one. Deliberately its own field rather
  // than sharing calendarEventId above: a deadline event and a time block are
  // two events, on two days, saying two different things ("this is due" vs
  // "I'm doing this from 2 to 3"), and a task can very reasonably have both.
  //
  // Master/replica the same way calendarEventId is, with one field moved
  // across the line: **the task owns the title and the duration, the event
  // owns the time.** Dragging the block to a better hour in Apple Calendar is
  // the entire point of putting it there, so nothing here ever rewrites its
  // start — see syncTimeBlockEvent in timeBlock.ts for exactly what a
  // reconcile touches.
  //
  // Never written except through the system event sheet, which is also the
  // only thing that deletes one: this app has no call site for
  // deleteEventAsync on a block, because the block is a commitment the user
  // made in their own calendar and may have shared with other people. A task
  // completed, deleted or spawned into its next occurrence leaves the event
  // alone. Resolve-or-shrug like every other cross-row pointer here.
  timeBlockEventId: string | null;

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

  // Opt-in per task (#1255): a completion outside the task's own
  // timeSegments/windowStart-windowEnd window still logs as done — it isn't
  // lying about whether the work happened — but it doesn't continue the
  // streak the way an on-time completion does; see
  // visibilityUtils.isCompletionOnTime for what "on time" means for each kind
  // of window. Only meaningful for a recurring task that actually carries a
  // window, which is the only place the editor offers the toggle — a task
  // with neither timeSegments nor a windowStart/windowEnd has nothing to be
  // late against, and this is inert on it.
  streakRequiresWindow: boolean;

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
  // The rest of what the added task looks like, or null for "just the title"
  // — see ExtraTaskDraft. Off the rule's own liveness check on purpose:
  // extraTaskRule() needs a count and a name, and everything here is optional
  // detail on top of those.
  extraTaskDraft: ExtraTaskDraft | null;
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

  /**
   * The day this task was sitting on when it was first pushed off it — "you've
   * been moving this since March 3rd". ISO, or null for a task that isn't
   * currently drifting.
   *
   * Stamped and cleared in lockstep with postponeCount, by the same derivation:
   * set when the count goes 0 → 1, left alone while it climbs, nulled whenever
   * it resets. That pairing is the whole point — a count says how often and this
   * says how long, and the Drift screen needs both to tell three pushes last
   * week apart from three pushes since the spring.
   *
   * Deliberately *not* "first scheduled at", which #947 sketched. A stamp that
   * never resets outlives the count beside it, so a task pushed twice last week
   * would read "pushed 2 times · since March" — which is true about the task and
   * a lie about the drift. This is the day the current run of pushes started
   * from, so the two fields always describe the same run.
   */
  driftingSince: string | null;
}

// postponeCount/postponeMuted/driftingSince are omitted alongside the streak
// fields for the
// same reason: they're derived state the app maintains, not something a draft
// gets to assert. That makes newTaskFromDraft's hard-coded 0/false the only
// source, so a series row or a template application can't inherit a count.
// extraTaskTally is the same kind of thing — the rule (extraTaskEveryN,
// extraTaskTitle) is the draft's to set, the progress toward it is not.
export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'seenAt' | 'completed' | 'completedAt' | 'streakCount' | 'streakDate' | 'previousStreakCount' | 'previousStreakDate' | 'archived' | 'archivedAt' | 'postponeCount' | 'postponeMuted' | 'driftingSince' | 'extraTaskTally' | 'previousExtraTaskTally' | 'calendarEventId' | 'timeBlockEventId'>;

// Which of the template's two anchor dates an item's offsets are relative
// to — e.g. "pack" anchored to the trip's end date, "request time off"
// anchored to its start date.
export type TemplateAnchor = 'start' | 'end';

// What kind of answer a template question takes.
//   'text'   — a typed value, the declared form of the `{name}` blanks that
//              are otherwise inferred from item text
//   'number' — a typed count, which item titles can do arithmetic on
//              ("Pack {nights} shirts", "Pack {nights / 2} pairs of jeans")
//   'choice' — one of a fixed list, which items can be conditioned on
export type TemplateQuestionKind = 'text' | 'number' | 'choice';

// Where a number question's answer comes from before anyone types one.
// 'days' and 'nights' both count the run's own two anchor dates — a trip
// entered as the 3rd to the 10th is 7 nights and 8 days — so the length of a
// trip is answered by picking its dates rather than typed a second time.
// 'none' (the default) means the question is only ever answered by hand.
export type TemplateQuestionSource = 'none' | 'days' | 'nights';

// One thing the apply sheet asks about a run before it creates any tasks —
// "How many nights?", "What kind of trip?".
//
// **A declared blank, not a second mechanism beside them.** An item's `{name}`
// tokens are otherwise inferred from its text (see templateUtils' placeholder
// engine), which leaves nowhere to say that one of them is a number, or that
// its answer comes in a fixed set, or what to call it when it's asked for.
// A question is that declaration: it fills the blank of the same `name`
// exactly as an inferred one does, and everything below is what the
// declaration buys.
//
// **Its own list on the template rather than fields on the items that use
// it**, because two things need one shared answer — the title that inlines it
// and every item conditioned on it — and an answer asked once per item is not
// the same answer.
export interface TemplateQuestion {
  id: string;
  // The blank it fills — "nights", "trip type". Lowercased and validated by
  // normalizePlaceholderName, so a question and a hand-typed `{nights}` are
  // the same blank rather than two that merely look alike. May be blank on a
  // question that exists only to condition items ("What kind of trip?" need
  // not appear in any title), in which case nothing substitutes it.
  name: string;
  // What the apply sheet asks — "How many nights?". Falls back to the name
  // when empty, which is what a question written for a title alone gets.
  prompt: string;
  kind: TemplateQuestionKind;
  // 'choice' only: the answers offered, in the order they're shown.
  // **The first is the default**, deliberately rather than a defaultOptionId —
  // the same call RecipeComponent.choiceGroup makes, and for the same reason:
  // an id is a second thing to keep in step with the list and to repair when
  // that option is renamed, while order is already there.
  options: string[];
  // 'text'/'number': what the field starts at, or '' for an empty one. Ignored
  // for 'choice', whose default is its first option.
  defaultValue: string;
  // 'number' only: fill the answer from the run's anchor dates. A typed answer
  // always wins — this is where the field starts, not what it's pinned to.
  fromDates: TemplateQuestionSource;
}

// "Only include this item when the answer is one of these."
//
// Values are matched against the answer as strings, OR within one condition
// and AND across an item's several — so an item can be for work trips *and*
// long ones without the model needing an expression language.
//
// A condition naming a question that no longer exists is ignored rather than
// failing the item, the resolve-or-shrug rule every cross-row pointer in this
// app follows: deleting a question must not silently empty a packing list.
export interface TemplateItemCondition {
  questionId: string;
  // Which answers include the item. An empty list is inert (it would
  // otherwise mean "no answer includes this", which nothing can act on).
  values: string[];
}

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

  // What the task created from this item asks for when it's completed, or null
  // for the ordinary "ticking it is the whole answer" item. Another field
  // alongside the ones above rather than a template-item "kind", exactly as
  // Task.deliverableKind is — a decision item is where a template earns its
  // keep ("Pick dates", "Decide on the budget"), and without this it had to be
  // set by hand on every application. There is no template-side counterpart to
  // deliverableValue: the question carries, the answer doesn't.
  deliverableKind: DeliverableKind | null;

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

  // Which of the run's answers include this item — empty (the common case)
  // means it's included whatever the run is about.
  //
  // **A condition decides the item's *default* tick in the apply sheet, not
  // whether it's offered at all.** Everything the template holds stays on
  // screen and stays overridable: a laptop conditioned on a work trip is
  // pre-ticked for one and merely unticked for a weekend away, which is what
  // the request asked for ("includes my laptop *by default*") and what keeps
  // a wrong answer from hiding items the user then can't get back without
  // editing the template.
  //
  // **When an item has conditions they replace `optional`, rather than
  // stacking with it.** Both fields answer "is this ticked to begin with", and
  // an item that's off for a beach trip and on for a work one is exactly the
  // thing `optional` was being used to approximate — so an authored condition
  // is the more specific answer and wins. `optional` still decides every item
  // that carries no conditions, and an optional *nested-template block* still
  // suppresses what's under it (its items answer to their own template's
  // questions, not to this one's).
  conditions: TemplateItemCondition[];

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
//   'task'    — one real Task named after the run, every item becoming a
//               subtask of it instead of a top-level task of its own. Takes
//               no dates of its own, same as a stack — there's no Task field
//               to put a start/end range in, only single dueDate/deferUntil.
// Only consulted when the user actually names the run; a blank name always
// means 'none'.
export type TemplateContainer = 'none' | 'stack' | 'project' | 'task';

// How often a scheduled template fires itself. Deliberately three coarse
// buckets rather than an interval-plus-epoch: every one of these has a period
// the calendar already names ("this week", "this month", "this year"), which
// is what `scheduleLastFiredKey` stores and compares. An every-N-weeks option
// needs an epoch to count from and a key that isn't a calendar period, so it
// is its own change rather than a fourth member here.
export type TemplateScheduleFrequency = 'weekly' | 'monthly' | 'yearly';

// When a template applies itself, with no one present.
//
// Held on the template rather than in its own table: one schedule per template
// is the whole of the feature, so a row would be a join to maintain for a
// one-to-one. Null — the default, and what every existing template reads as —
// means the template only ever runs when someone taps Apply.
//
// **`time` is a threshold, not an alarm.** There is no backend and nothing runs
// while the app is closed (see checkScheduledTemplates), so a schedule fires on
// the first launch at or after its trigger instant. The settings copy says this
// in as many words; a schedule that implied 09:00 sharp would be lying.
export interface TemplateSchedule {
  frequency: TemplateScheduleFrequency;
  // 'weekly': which day fires, date-fns `getDay()` convention (0 = Sunday).
  // Ignored by the other two frequencies.
  weekday: number;
  // 'monthly'/'yearly': which day of the month fires, clamped to the length of
  // the month it lands in, so 31 fires on the 30th in November and the 28th in
  // February rather than skipping those months entirely.
  monthDay: number;
  // 'yearly' only: which month fires, 1-12.
  month: number;
  // "HH:mm" — the time of day at or after which the firing day's run is due.
  time: string;
  // How many days the run's anchor range spans, or null for a start anchor
  // alone. This is what a template's own date offsets hang off, and what a
  // number question with `fromDates` reads — so a trip template scheduled
  // yearly can still answer "how many nights" without anyone typing it.
  anchorSpanDays: number | null;
}

export interface TaskTemplate {
  id: string;
  name: string;
  items: TemplateItem[];
  itemGroups: TemplateItemGroup[];
  // What the apply sheet asks before it creates anything. Empty (the common
  // case) means it asks nothing beyond the anchor dates and the run name, as
  // every template did before this existed.
  questions: TemplateQuestion[];
  createdAt: string;
  sortOrder: number;
  // Name of a TemplateCategory, purely for grouping templates on the
  // Templates page. Independent of task Category and ProjectCategory.
  category: string | null;
  applyContainer: TemplateContainer;
  // When this template applies itself unattended, or null for tap-to-apply
  // only (the default, and what every template written before this reads as).
  schedule: TemplateSchedule | null;
  // The calendar period this template last fired for — a week-start day key, a
  // "YYYY-MM", or a "YYYY". Compared against the period a firing would be for,
  // which is the whole of the once-per-period guarantee, and is why it is a
  // period name rather than a timestamp: a stamp has to be reasoned about
  // against the schedule to answer "was that this week's", and gets that
  // reasoning wrong across a schedule the user edits mid-period.
  //
  // Written on **every** outcome of a due check, not just the ones that create
  // tasks — a period that was skipped for vacation is the one exception, and
  // it deliberately leaves this alone so the run happens when vacation ends.
  scheduleLastFiredKey: string | null;
}

// One row of the grocery catalog — which is also the shopping list. A row is
// created the first time an item is typed and then lives forever: `onList`
// says "I intend to buy this", `checked` says "it's in the trolley", and
// finishing a trip clears both rather than deleting anything. That's what
// makes the second "Milk" a toggle instead of a duplicate, and what gives
// autocomplete and the catalog something to rank.
//
// Deliberately not a Task: a task is an occurrence you complete once, so
// modelling groceries as tasks floods Inbox/Unscheduled (neither predicate has
// an escape hatch but projectId) and leaves a completion tombstone per trip.
/**
 * One remembered price, as recorded by a finished trip.
 *
 * The whole point of keeping several is that a *single* last price is a poor
 * baseline: last week's happened to be a sale, and everything measured against
 * it reads as a jump. A short run of them answers "what does this usually
 * cost", which is the question a price is actually asked.
 *
 * **The quantity travels with the amount** and is not optional bookkeeping —
 * "$4.99" means nothing without "for 12 oz", which is the same ambiguity
 * `lastPriceQuantity` exists to close. A run of observations at mixed sizes is
 * normalized before anything is computed over it, or refused outright; see
 * `priceHistory.ts`.
 */
export interface PriceObservation {
  /** Minor units, same as every other price here. */
  minor: number;
  /** What that price was for, as written. Null when the row named no amount. */
  quantity: string | null;
  /** ISO. */
  at: string;
  /**
   * Which box this price was for — the item's preferred product at the moment
   * the trip was finished, or null when it had none.
   *
   * **This is what makes a run answer "what does the one I buy cost" rather
   * than "what does bread cost".** Without it a run mixes Arnold's whole wheat
   * with the store brand seeded sourdough, and the median describes neither —
   * the same disease `lastPriceQuantity` exists to cure one level down, where
   * "$4.99" means nothing without "for 12 oz".
   *
   * **Stamped on the observation rather than kept in a per-product table**,
   * which is the cheaper half of the same answer: the runs are already capped
   * blobs on the rows that own them, so scoping is a filter at read time
   * (`priceRunForProduct`) instead of a third price level with its own table,
   * its own cascade and its own write path in `dbFinishGroceryShopping`.
   *
   * **Null is the honest fallback, not a gap.** An observation recorded before
   * this shipped, or on a trip for an item with no preference, genuinely
   * doesn't know which box came home — the same thing `ItemShopLink.productId`
   * refuses to guess. Such observations stay in the run and are what a filtered
   * run falls back to when it has too little of its own to be a baseline.
   *
   * Resolve-or-shrug at every reader: an id naming a product that has since
   * been deleted or merged away simply never matches a filter, which reads as
   * "not this box" rather than as an error.
   */
  productId?: string | null;
}

export interface GroceryItem {
  id: string;
  // What the user last typed — the label. "Whole milk" and "milk" reading
  // identically in the list would be worse than a near-duplicate.
  name: string;
  // Normalised identity, from groceryNameKey(). UNIQUE in SQLite, which is
  // where the no-duplicates guarantee actually lives.
  nameKey: string;
  // Which of this item's products the user wants — the one to reach for. Null
  // (the common case) means no opinion: any bread is bread.
  //
  // This pointer replaced a `brand`/`variant` pair of strings on this row. The
  // pair could only ever hold the box you want *right now*, so switching from
  // Arnold's wheat to Dave's Killer overwrote it — which left nowhere to
  // record that you'd tried the first one and hated it, and no object for a
  // rating to hang on. It also never really paired the two words: "Arnold's"
  // and "wheat" named one box only because they sat on the row together.
  //
  // The item stays the Platonic ideal — one nameKey bridging recipes, Buy
  // again, the pantry and the aisle lexicon, one purchase history, one expiry,
  // one set of substitutes. The products hanging off it are the boxes on the
  // shelf. See ItemProduct, and `docs/arch/groceries.md`.
  //
  // Resolve-or-shrug at every reader (`preferredProductOf`), like every other
  // cross-row pointer here: a dangling id reads as "no opinion" rather than
  // throwing. Nothing should dangle — deleting a product clears this — but the
  // readers don't lean on that.
  preferredProductId: string | null;
  // "Only this one" — whether a store has to be on record with the preferred
  // product to count as having the item at all (shopsForItem and everything
  // built on it, including trip coverage and the shelf captions).
  //
  // **Default false, and that's what makes this safe to ship.** A preference
  // set before this existed, or set as a note to self, is a preference and not
  // a rule; turning every one of them into a filter would silently rewrite
  // which stores the app suggests. Nothing infers it — the user says so.
  //
  // **The product chooses the granularity, which is why there is one flag and
  // not two.** A product carrying a brand and no variant ("any Arnold's") is
  // the brand-level rule; one carrying both ("Arnold's wheat") is the
  // product-level rule its predecessor `brandStrict` couldn't express. That
  // was a real gap — the old per-store evidence was a bare brand string, so
  // there was no variant-level claim to filter on. `ItemShopLink.unavailableProductIds`
  // is that claim now, and it's made against a product.
  //
  // It is deliberately a fact about the *item*, not about the occasion. The
  // honest version of "it doesn't matter when it's for a recipe" needs to know
  // why a row is on the list this week, and the only signal available
  // (sourceRecipeId) is stamped solely on rows addFromPlan genuinely creates —
  // so a catalog staple re-added for a recipe carries none, which is exactly
  // the case it would have to get right. Guessing there would drop stores on
  // evidence the app doesn't have; this is a switch instead.
  //
  // Inert with no preferred product: there is nothing to be strict about.
  productStrict: boolean;
  // Never null, unlike Task.category: an unrecognised item is *in* the Other
  // aisle rather than aisle-less, which keeps the null branch out of every
  // grouping and sorting path.
  aisle: string;
  // Free text ("2 lb", "x3", "a bunch"). Nothing does arithmetic on it — the
  // parser exists to get it out of the name so the name stays a clean key.
  quantity: string | null;
  // Whether `quantity` is the app's own writing (a recipe's cooking amount,
  // true for one shop) rather than the user's standing preference. The field
  // has two owners with different lifetimes and can't tell them apart on its
  // own: `addFromPlan` only writes into an empty or recipe-owned slot, and
  // finishing the shop or taking the row off the list clears a recipe-owned
  // quantity outright, since the shop it was for has happened. `setQuantity`
  // — the user typing an amount by hand — always takes ownership.
  quantityFromRecipe: boolean;
  note: string;
  onList: boolean;
  // Invariant: checked implies onList.
  checked: boolean;
  // Whether the row has earned a place in the catalog in its own right, rather
  // than only existing because it's on the list right now. A name typed for the
  // first time is `false` — provisional — and taking it off the list deletes it
  // instead of parking it, whether that's a removal, a finished trip that
  // bought it, or a clear that abandoned it. Invariant: !onList implies
  // inCatalog, which is what lets the catalog view and the pruner keep reading the
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
  // The pantry override — an explicit "Got it"/"Out of it" assertion, and
  // *only* that. A future value reads as "on hand" regardless of what
  // grocerySuggest.probablyHaveReason's purchase reading would say on its
  // own; OUT_OF_IT_UNTIL reads as "confirmed not on hand" and *suppresses*
  // that reading, rather than letting stale purchase history overrule what
  // the user just said with their own hands. null defers entirely to the
  // purchase reading. Self-expiring: once a future date passes this reads
  // exactly as null again, so "Got it" never needs a separate action to wear
  // off — which is why the negative is a sentinel and not merely "in the
  // past", or a lapsed "Got it" would be indistinguishable from one.
  //
  // finishShopping used to set this forward on every purchase, which made the
  // assertion branch the only reachable one and told people they had marked
  // things on hand that a till had (#1770). A trip now only ever *clears* it:
  // coming home with something refutes an "Out of it" left on it, the same
  // correction a purchase already makes to ItemShopLink.unavailableAt.
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
   * ISO instant the user said they were nearly out, or null.
   *
   * **The state between "Got it" and "Out of it", and the one the pair was
   * missing.** Those two are the ends of a scale whose interesting point is in
   * the middle: noticing the jar is nearly empty is the moment you'd want it on
   * the list, and it's a moment the app had no way to hear about. `onHandUntil`
   * couldn't carry it — that column is a timestamp with two sentinel readings
   * already, and a third would be a third thing for `onHandAssertion` to get
   * wrong.
   *
   * **Running low still means you have it.** `probablyHaveReason` answers for a
   * low row, so it stays in the pantry and a week plan still counts it: there
   * is some left, which is exactly what distinguishes this from "Out of it".
   * What changes is that the row goes on the list.
   *
   * **Unlike `onHandUntil` this never self-expires.** A "Got it" is a guess
   * with a shelf life, so it lapses back into silence; being nearly out is a
   * fact that stays true until something refutes it, and the thing that refutes
   * it is buying more. So a purchase clears it, and so does saying either of
   * the other two things.
   */
  runningLowAt: string | null;
  /**
   * ISO instant this was opened, or null for a jar still sealed and for the
   * bulk of a catalog where opening means nothing.
   *
   * **The third event that re-anchors a use-by day**, alongside a purchase and
   * a thaw. `expiresAt` is a fact about one purchase, and for a sealed thing
   * the purchase is the wrong anchor: a jar of salsa bought five weeks ago and
   * opened on Tuesday keeps a week from Tuesday, where the purchase-based guess
   * wrote it off a month back. `OPEN_SHELF_LIFE_LEXICON` is the second, much
   * shorter table that says which names that's true of.
   *
   * **Recorded even when it changes nothing.** A name the open lexicon has
   * never heard of still stamps this and still says so on the row: opening a
   * bag of spinach doesn't restart anything, but "opened 12 Aug" is a true and
   * useful thing for the pantry row to say either way. Only the date is
   * conditional.
   *
   * Cleared by a purchase, exactly like `frozenAt` and for the same reason: the
   * jar you opened is not the jar you have just carried home.
   */
  openedAt: string | null;
  /**
   * ISO instant this went in the freezer, or null for anything that didn't.
   *
   * **The clock stops while this is set, and restarts when it's cleared.**
   * `finishShopping` stamps `expiresAt` from the shelf-life lexicon on
   * everything it buys, and that lexicon is at its most aggressive exactly
   * where a freezer is most used — chicken 2 days, ground beef 2, salmon 2.
   * Without this, a month of meat bought on Saturday spawns a fistful of "Use
   * up" tasks due Monday about food under an inch of ice, which is the
   * "spawns a task about food that's fine" failure `groceryShelfLife.ts` names
   * as the one that gets a feature turned off.
   *
   * **An instant, not a flag**, matching `lastPricedAt` and
   * `ItemShopLink.unavailableAt` rather than `isStaple`: what a frozen row has
   * to say is *when it went in*, since a freezer is the one place food outlives
   * every window the rest of the pantry reasons in. It also means the pantry
   * can keep showing it — see `probablyHaveReason`, which reads a live
   * `frozenAt` as on hand the way it reads a staple, because a purchase window
   * of two weeks would otherwise drop a frozen thing out of the kitchen while
   * it's still very much in the kitchen.
   *
   * **`expiresAt` is left alone while this is set, never cleared.** The stored
   * day goes quiet rather than away (`freshness.liveUseBy` is the single
   * reader), because what ends a freeze is a thaw and a thaw restarts the
   * count from a fresh shelf life. Stamping the new day at freeze time would
   * assert a thaw date the user hasn't picked; clearing it would leave nothing
   * to put back.
   */
  frozenAt: string | null;
  /**
   * A remembered shelf life, in days — "spinach keeps 5 days" — kept apart
   * from `expiresAt` on purpose: this is a fact about the *item*, and
   * `expiresAt` is a fact about one purchase of it.
   *
   * Set by hand in `GroceryItemSheet` when the item isn't currently on hand
   * (see `onHandUntil`), because there's nothing to count down from yet — the
   * clock starts when it's actually bought. **Only a real purchase activates
   * it**: `finishShopping` reads this as the shelf life for the row it just
   * bought, ahead of the `groceryShelfLife.ts` lexicon guess, and stamps
   * `expiresAt` from it. Marking "Got it" by hand deliberately does *not*
   * consult this — "Got it" doesn't say *when*, so it could be days-old
   * already, and guessing the countdown starts today would as often be wrong
   * as right.
   *
   * Editing "Use by" while the item *is* on hand writes `expiresAt` directly,
   * same as before this field existed, and updates this alongside it — a
   * correction made once is remembered for next time, the same way the app
   * already learns a purchase cadence.
   */
  shelfLifeDays: number | null;
  /**
   * What you last paid for this, in whole minor units of the one currency the
   * app knows about (cents/pence) — `429`, never `4.29`. An integer because
   * this is the number a trip estimate sums, and floats accumulate a tail.
   *
   * **Wherever you bought it.** `ItemShopLink` carries the same three fields
   * per store, and the split is exactly the one `purchaseCount` already makes:
   * a trip finished without naming a store writes this and no link, so this is
   * the price and the link ones are partial. Never reconcile them, and never
   * sum links to get an item's price.
   *
   * A price is a remembered observation, never a ledger the user maintains —
   * the same principle the pantry is built on. Nothing expires it, but nothing
   * renders it bare either: see `lastPricedAt`.
   */
  lastPriceMinor: number | null;
  /**
   * When that price was seen. A date rather than nothing, for the reason
   * `ItemShopLink.unavailableAt` is one: a price ages, and "$3.19 (March)" is a
   * fact you can weigh where a bare "$3.19" from eighteen months ago is the UI
   * lying. Every read renders the age alongside the number.
   */
  lastPricedAt: string | null;
  /**
   * `quantity` as it stood when the price was recorded — a verbatim snapshot,
   * never parsed and never divided into a per-unit price.
   *
   * Load-bearing: "milk $4.29" means nothing if last time was a gallon and this
   * week it's a pint. Deriving "$0.21/oz" from it would need a normalised unit,
   * which inherits every refusal `parseQuantityAmount` makes ("a bunch" has no
   * per-unit price) — so the string is shown next to the price and the reader
   * does the comparing.
   */
  lastPriceQuantity: string | null;
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
  /**
   * When the user last swiped away a "Check if you still have X" task for this
   * row — the pantry check's opt-out (see `src/utils/pantryCheckTasks.ts`).
   *
   * **A stamp rather than `useUpTask`'s tri-state boolean**, for the reason
   * `Project.reviewDeclinedAt` is one: a permanent `false` says "never ask me
   * about this item again", which is far more than a swipe means. A pantry
   * check is about one purchase running out of credibility, and the same row
   * earns a new question every time it's bought and lapses again.
   *
   * **It expires against `lastPurchasedAt` rather than against the day.** A
   * project stays quiet indefinitely, so its decline lapses at the day
   * boundary and the offer comes back tomorrow; a pantry question that came
   * back tomorrow would be nagging about a cupboard. The purchase is the unit
   * here — declined after the last purchase means "don't ask again until I buy
   * it" — which is also why nothing clears this on a purchase the way
   * `frozenAt`/`openedAt`/`runningLowAt` are cleared: a stamp that predates the
   * new purchase is already spent, so there is no second place to keep in step.
   */
  pantryCheckDeclinedAt: string | null;
  /**
   * How many times the user has said they finished this, and how many times
   * they've said it went bad — the two ways a thing leaves the pantry, counted.
   *
   * **The fridge already kept this and the pantry threw it away.** Closing a
   * container out is "Finished it" / "Threw it out" (`LeftoverOutcome`), read
   * back by `describeFridgeHistory`; marking a catalog row out of it was one
   * bit, so the same fact about a bag of spinach was discarded. Completing
   * "Use up spinach" and completing "Use up leftover chili" both land in
   * `UseUpResolveSheet`, and until this only one of them remembered what
   * happened.
   *
   * **Counts, never a rate, and deliberately not a shelf-life estimate.** The
   * obvious use — learn how long things really keep — is the one thing these
   * can't do. Both answers are recorded when the user *notices*, not when the
   * food turned, and that lag is routinely longer than the shelf lives in
   * `SHELF_LIFE_LEXICON` (2 days for chicken, 4 for berries). So both readings
   * are biased late and would drag a learned estimate *longer*, which is the
   * direction that makes a use-up task arrive after the food is already slime.
   * `shelfLifeDays` stays the correction, made by a person looking at the
   * thing; what these do is tell that person when it's worth making.
   *
   * **Nothing decays them.** A count is a count, which is why `lastSpoiledAt`
   * sits alongside — `lastPricedAt`'s argument exactly: a bare "went bad 3
   * times" from two years ago is the UI lying, so every read renders the age
   * with it.
   */
  usedUpCount: number;
  spoiledCount: number;
  /**
   * When the user last said this went bad. Null for a row that never has,
   * including every row that predates these columns.
   *
   * Only the spoiled side gets a date. "Used it up" is the ordinary outcome
   * and its age says nothing anyone would read; going bad is the one worth
   * dating, because that's the count a caption qualifies and the prompt fires
   * on.
   */
  lastSpoiledAt: string | null;
  /**
   * The last few prices this item was bought at, newest first, capped at
   * `PRICE_HISTORY_LIMIT`.
   *
   * **Bounded by construction, which is what keeps it an aggregate rather than
   * a log** — the objection `grocery_item_shops` was shaped around. A rolling
   * window also answers non-stationarity for free: prices drift, packaging
   * changes, and a median over everything ever paid would quietly mislead
   * after a year. There is no window to choose because the window is the cap.
   *
   * **Written by a finished trip and nothing else.** A hand-typed price still
   * sets `lastPriceMinor` and is deliberately not recorded here: a trip is the
   * app watching a purchase happen, which is the same standard
   * `probablyHaveReason` holds itself to (#1770), and it means clearing a price
   * by hand has nothing here to un-say.
   */
  priceHistory: PriceObservation[];
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

// How many "Use up X" tasks — grocery and leftover use-up tasks together — are
// allowed to be live at once (#1675). null (the default) is unlimited: this
// is a governor for a well-stocked kitchen with both generators on, not a
// behavior change for anyone who hasn't hit it. A source that's declined a
// slot isn't suppressed, just deferred until one opens up.
export const USE_UP_TASK_CAP_MIN = 1;
export const USE_UP_TASK_CAP_MAX = 20;

// The furthest out a use-by date can be set by hand, in days. Long enough for a
// freezer bag, short enough that the stepper can still reach the far end.
export const GROCERY_EXPIRY_DAYS_MAX = 365;

/**
 * Why a frozen thing is in the kitchen — `probablyHaveReason`'s word for it,
 * and the leading half of a frozen row's caption in `kitchenInventory`.
 *
 * Here rather than in `freshness.ts` beside `describeFrozenSince`, which is
 * where it reads like it belongs, for a module-weight reason: `grocerySuggest`
 * is one of the two producers and is deliberately free of `dateUtils` (which
 * reaches `useSettingsStore` and so `expo-sqlite`), so importing `freshness`
 * for one string would drag SQLite into every pure grocery test. `types` is
 * already where the kitchen's other shared constants live and costs nothing.
 */
export const FROZEN_REASON = 'in the freezer';

/**
 * Why a nearly-empty thing is still in the kitchen — `probablyHaveReason`'s
 * word for it, beside `FROZEN_REASON` and here for the same module-weight
 * reason.
 */
export const RUNNING_LOW_REASON = 'running low';

// Shorter than TITLE_MAX_LENGTH on purpose — this is a shelf label, not a task
// title, and a long one wrecks the row layout at the bigger grocery font size.
export const GROCERY_NAME_MAX_LENGTH = 80;
export const GROCERY_QUANTITY_MAX_LENGTH = 24;
// Shorter than a name on purpose: this is a brand, not a second name for the
// thing. Matches SHOP_NAME_MAX_LENGTH, which is the same kind of proper noun.
export const GROCERY_BRAND_MAX_LENGTH = 40;
// A product's note — "the blue bag", "too sweet". Room for a sentence and no
// more: this is a reminder to yourself at the shelf, not the item's own note.
export const GROCERY_PRODUCT_NOTE_MAX_LENGTH = 120;
// Its own constant rather than a second use of the brand's, because the two
// cap different things — a maker's name against a product line — and one of
// them changing shouldn't silently move the other. Same length for now.
export const GROCERY_VARIANT_MAX_LENGTH = 40;

// What the user thought of one product, when they've bothered to say. Null —
// the overwhelmingly common state — is no opinion, not "fine": a product
// nobody has rated is one nobody has judged.
//
// Three states rather than a 1..5 scale on purpose. The question this answers
// at the shelf is "have I had this and hated it", and a scale asks for a
// precision nobody applies consistently to a loaf of bread — four stars versus
// three is not a distinction anyone reproduces a month later, while "never
// again" is. Two poles and silence is the whole vocabulary.
export type ProductRating = 'loved' | 'avoid';

// One box on the shelf — Arnold's wheat, Dave's Killer 21 grain, the store
// brand. A product *of* a GroceryItem, never a GroceryItem itself.
//
// **The item is the Platonic ideal and this is a thing you can actually pick
// up.** Bread is what recipes call for, what the pantry tracks, what has an
// aisle and an expiry and a purchase history; the products under it are which
// bread. That split is the whole reason this type exists: brand and variant
// used to be two loose strings on the item, which meant the item could
// remember the box you want *now* and nothing else — no record of the ones
// you've tried, and nowhere for `rating` to live.
//
// It is deliberately **not** a second GroceryItem. Folding "Arnold's wheat"
// into the catalog as its own row would mint a name that can never match
// "bread" the ingredient, and split one item's purchase history, pantry state
// and expiry in two — the exact reason brand was kept out of `nameKey` in the
// first place.
//
// **And it is not a substitute.** A hamburger bun standing in for bread is a
// different thing you buy, with its own aisle, its own pantry state and its own
// recipes calling for it, so it's an ItemSubLink between two items. The line:
// *same box → product, different thing → substitute*. Within an item you pick
// among products; across items you fall back to a substitute.
//
// Its own table (`grocery_item_products`), shaped like `grocery_item_shops`
// and `grocery_item_subs`, rather than a JSON blob on the item the way
// `Recipe.ingredients` is one. That call turns on the same question every
// time: does anything outside the row hold this id? Here it does —
// `GroceryItem.preferredProductId` and `ItemShopLink.productId` both point at
// a product, and a rating is a thing you'd want to look up across items.
export interface ItemProduct {
  id: string;
  // The item this is a product of. Cascade-deleted with it by hand, since FKs
  // are off — same as every other link table here.
  itemId: string;
  // Who makes it — "Arnold's", "Good Culture". Null is a variant with no maker
  // worth naming ("the low fat one"), which is an ordinary state.
  //
  // **Nothing parses this out of typed text, and that's the decision, not a
  // gap.** `RecipeIngredient.prep` and `purpose` are split off marked-up
  // clauses — a comma, a trailing "for X" — while a brand has no marker at all,
  // so telling "Good Culture cottage cheese" from "sliced almonds" means
  // knowing what the words mean. That's the guess splitPrep already refuses to
  // make.
  brand: string | null;
  // Which one of that brand — "wheat", "low fat", "4%", "crunchy".
  //
  // Separate from `brand` rather than more room inside it because the two are
  // different kinds of fact, and because the pair is what makes a product: the
  // maker is stable and is what a store gets recorded against, while the
  // product line is what actually varies within it.
  //
  // **A product with a brand and no variant is the brand-level statement**
  // ("any Arnold's"), and that's what lets `GroceryItem.productStrict` be one
  // flag instead of two — see its note.
  variant: string | null;
  // Normalised identity from `productKeyFor()`, UNIQUE per item in SQLite,
  // which is where "one row per box" actually lives. Same discipline as
  // GroceryItem.nameKey, scoped to the item rather than the catalog: two items
  // may both have a "store brand" product and those are different boxes.
  //
  // Invariant: never empty. A product with neither a brand nor a variant is
  // the item itself, and `addProduct` refuses it.
  productKey: string;
  // See ProductRating. Null is no opinion.
  rating: ProductRating | null;
  // Free text — "the blue bag", "too sweet", "only at the big Safeway".
  // A string whose empty value is "nothing written", like GroceryItem.note,
  // rather than nullable: nothing tests it for null.
  note: string;
  // How many finished trips brought this one home, and when the last did.
  //
  // Partial in exactly the way ItemShopLink's counters are, and for the same
  // reason: a trip finished before this feature existed, or one that bought an
  // item with no preferred product, bumps `GroceryItem.purchaseCount` and
  // writes nothing here. So the item's count is the total and these are a
  // subset of it. Nothing sums them to produce a total.
  purchaseCount: number;
  lastPurchasedAt: string | null;
  // The barcode on this box, once a scan has been confirmed against it. Null
  // for every product named by hand, which is most of them.
  //
  // **This is the one identity here that is globally unique**, unlike
  // `productKey` right above it, and the two are unique for opposite reasons:
  // a product key is scoped to its item because two items may each have a
  // "store brand", while a GTIN denotes one box in the world. Hence its own
  // partial UNIQUE index rather than a second `(item_id, …)` one, and hence
  // `dbSetProductGtin`'s release-then-claim write: moving a barcode to another
  // box has to take it off the first.
  //
  // **It lives here, and not on `gtin_lookups`, because it is a personal
  // fact.** That table is excluded from both sync and backup on the grounds
  // that it records nothing about the user (see `GtinLookup`), so a pointer at
  // one of their catalog rows kept there would not survive a restore and would
  // never reach a second device. What a barcode *denotes* is shared; which of
  // your boxes it is, is yours.
  gtin: string | null;
  /**
   * This box's own "Got it"/"Out of it", read exactly like
   * `GroceryItem.onHandUntil` — a future instant is on hand, OUT_OF_IT_UNTIL is
   * a confirmed absence, null defers to the item.
   *
   * **The four pantry columns here exist because a box is the thing you
   * actually have**, and one item can hold two of them at once: two brands of
   * vegan ground beef are interchangeable at the stove and are still two
   * separate packets in the freezer, one of which may be open, frozen or gone
   * while the other isn't. Before these, the pantry had one slot per item, so
   * saying anything about one packet said it about both.
   *
   * **A box only enters the pantry when the user says so** — see
   * `grocerySuggest.productHaveReason`, which reads these four and nothing
   * else. There is deliberately no per-box purchase reading to match
   * `probablyHaveReason`'s: `purchaseCount` here only ever bumps for whichever
   * box was *preferred* at the till (see `dbFinishGroceryShopping`), so
   * guessing from it would vouch for one brand and stay silent about the other
   * — and it would put a row in the pantry for every box anyone had ever named.
   * The item's own purchase reading stays the answer to "do I have any of
   * this"; these say which packet.
   *
   * `runningLowAt` deliberately has no counterpart here. It's the one pantry
   * assertion that writes `onList` (see its note on the item), and being nearly
   * out of one brand while a full packet of the other sits beside it is not a
   * reason to buy more.
   */
  onHandUntil: string | null;
  /**
   * This box's use-by day, `YYYY-MM-DD`, or null to fall back to the item's.
   * Same meaning as `GroceryItem.expiresAt` — "is this about to be wasted" —
   * scoped to the packet the date is actually about, which is the whole reason
   * two packets of one item can't share one.
   */
  expiresAt: string | null;
  /**
   * ISO instant this box went in the freezer. Suspends its countdown exactly as
   * `GroceryItem.frozenAt` suspends the item's, through the same
   * `freshness.liveUseBy`, and reads as on hand for the same reason: a freezer
   * outlives every window the rest of the pantry reasons in.
   */
  frozenAt: string | null;
  /**
   * ISO instant this box was opened, re-anchoring its use-by day off
   * `OPEN_SHELF_LIFE_LEXICON` the way `GroceryItem.openedAt` does. The one of
   * these four with the clearest claim to being per-box: an open jar and a
   * sealed one of the same thing are the case the item-level column could never
   * tell apart.
   */
  openedAt: string | null;
  createdAt: string;
}

/**
 * "At this store, a line reading GV MLK 2% GAL means milk."
 *
 * The memory that makes matching improve instead of staying at 85%. A receipt
 * line and a looked-up product name are both somebody else's words for
 * something in your catalog, and until this the app re-guessed them from
 * scratch every trip, getting the same ones wrong every time.
 *
 * **Written from a confirmation, not from a guess.** An alias is only recorded
 * when a person applied a review sheet with the row resolved — see
 * `rememberAliases`. The app's own reading is never fed back into itself, which
 * would let one bad match harden into a permanent rule.
 *
 * **Keyed by `id`, not by the pair it is unique on**, for the reason
 * `grocery_item_products` gives, plus one specific to this table: sync's
 * `row_key` joins composite keys with `|`, safe only because every other key in
 * the app is base36 from `generateId()`. This one would be a receipt's printed
 * text, which can contain anything.
 */
export interface StoreAlias {
  id: string;
  /**
   * The store whose printer produced this text, or `''` for a text that isn't
   * store-specific (a product name off a barcode lookup).
   *
   * Empty string rather than null because the UNIQUE index over
   * `(shop_id, raw_key)` is what stops two rows claiming one phrase, and SQLite
   * treats NULLs as distinct in a unique index — so a nullable column here
   * would enforce nothing at all for exactly the rows that need it.
   */
  shopId: string;
  /** The printed text, normalized by `aliasKeyFor()`. */
  rawKey: string;
  /** The catalog row this text means. Resolve-or-shrug, like every pointer here. */
  itemId: string;
  /**
   * How many times this has been confirmed. Not currently read by matching — a
   * remembered alias already outranks every similarity tier, so there is
   * nothing for a count to break a tie between. It's here because the write
   * path has it for free and because "confirmed nine times" is what a future
   * review screen would sort on.
   */
  hitCount: number;
  createdAt: string;
  lastUsedAt: string;
}

/**
 * What a barcode turned out to be, remembered so it is only ever looked up once.
 *
 * A cache of a *shared* fact, and the only thing in this app that is. Every
 * other grocery row records something about you — what you buy, where, what it
 * cost, whether you liked it. This records what a GTIN denotes, which is the
 * same answer for everyone and never changes, so it is keyed by the barcode
 * rather than by an item and is safe to keep for ever.
 *
 * It deliberately does **not** point at a `GroceryItem`. The resolution from a
 * scanned product to a row in your catalog is a judgement made in front of the
 * user at review time (see `scanResolve.ts`), and freezing the first answer
 * onto the cache row would mean a correction made once could never be revisited
 * — and would put a personal decision inside a table whose whole point is that
 * it holds none. Remembering the correction is `store_aliases`' job, which is
 * its own change.
 */
export interface GtinLookup {
  /** Canonical GTIN-14, from `normalizeGtin()`. */
  gtin: string;
  /**
   * Whether any source knew this barcode.
   *
   * **A miss is cached too**, which is the point rather than an optimisation: a
   * barcode nobody has heard of is the case that would otherwise hit the
   * network on every single unpack for ever. Misses expire, hits don't — see
   * `GTIN_MISS_TTL_DAYS`.
   */
  found: boolean;
  /** The product as the source names it, full and unabbreviated. Empty on a miss. */
  name: string;
  /** Who makes it, when the source says. Null is ordinary, not a gap. */
  brand: string | null;
  /** The pack size as the source prints it ("1 gal", "500 g"). Null when unstated. */
  quantity: string | null;
  /**
   * How the source files it — OFF's most specific `categories_tags` entry,
   * FDC's `brandedFoodCategory`, Go-UPC's `category`. Read by
   * `aisleForProductCategory` as a last resort for a row's aisle.
   *
   * **Null on every barcode cached before this column existed**, and nothing
   * refetches to fill it in. A hit never expires (see `found`), so a backfill
   * would mean re-asking the network for every code the user has ever scanned,
   * on the first launch after an upgrade, to improve a guess that already has a
   * working fallback. Those rows just keep landing on `aisleForName`, which is
   * exactly what they did before.
   */
  category: string | null;
  /** Which source answered, for telling a thin record from a good one later. Empty on a miss. */
  source: string;
  /** ISO. When this was asked, which is what expires a miss. */
  fetchedAt: string;
}

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
  /**
   * What this store's receipts are good for. See ReceiptStyle.
   *
   * **Data, not a hardcoded special case.** The store this was built for is one
   * local shop whose register prints every line as "GROCERIES" with a price and
   * no name, but nothing about that is special enough to earn a branch in the
   * code — plenty of small stores do it, and the user is the only one who knows
   * which of theirs does.
   */
  receiptStyle: ReceiptStyle;
}

/**
 * Whether a store's receipt can be read, and what to offer when it can't.
 *
 * Three values rather than a flag, because two different things go wrong and
 * they want different answers:
 *
 * - `itemized` — an ordinary receipt with names on it. Scan it.
 * - `opaque` — it prints prices but not names ("GROCERIES ... 4.18"). There is
 *   nothing for the extractor to match on, so reading it is a waste of a
 *   request. But the *prices* are real, and they are the one thing a barcode
 *   can't know, so this offers pairing instead: what you scanned in one column,
 *   what you were charged in the other.
 * - `none` — no useful paper at all. Offers nothing, because a store that hands
 *   you nothing has no prices to pair either.
 *
 * `opaque` and `none` both skip extraction, which is why the pair looks
 * collapsible. They must not be: the difference is whether there is a column of
 * prices to work with, and collapsing them would either offer an empty pairing
 * screen at a store with no receipt or hide pairing at the store it was built
 * for.
 */
export type ReceiptStyle = 'itemized' | 'opaque' | 'none';

export const RECEIPT_STYLES: ReceiptStyle[] = ['itemized', 'opaque', 'none'];

export function isReceiptStyle(value: unknown): value is ReceiptStyle {
  return RECEIPT_STYLES.includes(value as ReceiptStyle);
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
  /**
   * What you last paid for this item *here*, same three fields and same rules
   * as `GroceryItem`'s (minor units, stamped, with the quantity it was for).
   *
   * This is the half that answers "where is it cheaper" — see `cheapestShopFor`
   * — and it's why prices live on the existing aggregate rather than in a log
   * table: the comparison only ever needs the last number per store, which is
   * bounded by (items × stores) exactly as the counters above already are.
   *
   * The negative claim outranks it, like everywhere else: a store the user has
   * said doesn't stock the item is not a place to buy it cheaply, whatever
   * price it last had.
   */
  lastPriceMinor: number | null;
  lastPricedAt: string | null;
  lastPriceQuantity: string | null;
  /**
   * This store's own last few prices, newest first — same rules and same cap as
   * `GroceryItem.priceHistory`.
   *
   * Kept per store as well as per item because the question is per store: what
   * Costco usually charges and what Safeway usually charges are different
   * numbers, and a median mixing them describes neither shop. The item's own
   * run stays the fallback for a trip that named no store, which is a real and
   * supported answer — so the same purchase lands in both, exactly as
   * `lastPriceMinor` already does at both levels.
   */
  priceHistory: PriceObservation[];
  /**
   * The product you last got here — Arnold's wheat at Safeway, the store brand
   * at Costco. An **observation**, paired with lastPurchasedAt above, and
   * deliberately not a claim about what the store stocks.
   *
   * **It must never filter anything, because a store carries several products
   * of a thing.** Having got the store brand at Safeway once is not evidence
   * that Safeway hasn't got Arnold's wheat — it says nothing at all about the
   * rest of the shelf. Reading a mismatch here as "they haven't got yours" is
   * an absence inferred from something that isn't evidence of absence, which is
   * the error shoppingTrip.ts removed `likelyItemIds` to be rid of. The only
   * thing that drops a store is `unavailableProductIds` below, which the user
   * asserts.
   *
   * A *match* is the safe direction and is all this is read for: if the last
   * thing you got here was the one you want, this store demonstrably had it.
   *
   * Written by finishShopping, and only for a strict item — on a row with no
   * rule there is nothing to record, since the app has no idea which box came
   * home.
   *
   * Resolve-or-shrug, like every other cross-row pointer here.
   */
  productId: string | null;
  /**
   * "They haven't got *this one* here" — one entry per product the user has
   * said this store is missing, mapping the product's id to when they said so.
   *
   * The product-level twin of unavailableAt, and a genuinely different claim:
   * the store stocks the item, it just hasn't got the box you want. Every
   * "where can I get this" read drops such a link when the item is strict and
   * the claim names the *preferred* product, and **this is the only thing that
   * does** — see productId above for why an observed mismatch can't.
   *
   * **A map rather than one stamp, and keyed by product rather than implied.**
   * Its predecessor was a bare `brandUnavailableAt` date, which said nothing
   * about *which* brand it was about: switching the item's brand left the claim
   * standing, so the shelf caption would go on reading "no Dave's Killer at
   * Safeway" off a look you took for Arnold's. A claim stamped against the
   * product it was made about can't do that — switch the preferred product and
   * the old entry simply stops matching, and switching back finds it intact,
   * with no rule anywhere that has to remember to clear it. It also lets one
   * store be missing two of an item's products at once, which the single stamp
   * could not say.
   *
   * Dates rather than flags, for exactly unavailableAt's reasons: stock
   * changes, so a claim ages and says *when* you looked. An absent key is
   * unknown, and unknown always counts — the app not having watched you check
   * is ignorance. A purchase here clears the whole map, since coming home with
   * something refutes every claim about this store's shelf at once.
   *
   * JSON in SQLite, like `priceHistory` on this same row: nothing outside this
   * link holds a claim's identity, and the map is bounded by how many products
   * of one item you've actually looked for at one store.
   */
  unavailableProductIds: Record<string, string>;
}

// One (item, substitute) pair — "if there's no butter, use margarine".
//
// Shaped like ItemShopLink above because it's the same problem: a fact about a
// pair of rows, one row per pair, bounded by how many swaps you actually name.
//
// **A substitute is not an alternative**, and the distinction is the whole
// reason this is its own thing rather than another `choiceGroup`. The one-line
// test is whether the answer depends on the dish:
//
// - An *alternative* (`RecipeIngredient.choiceGroup`) lives on the recipe. Both
//   options are intended, they're equals, and which one you make is decided per
//   cooking (`MealPlanEntry.recipeChoices`).
// - A *substitute* lives on the item. One is intended and one is tolerated,
//   they're ranked rather than equal, it's consulted when the first isn't
//   available, and it applies to every recipe naming the item.
//
// Item-level is what makes this a system rather than a field: "I use margarine
// for butter" is one fact that reaches all twelve recipes calling for butter,
// and `RecipeIngredient.nameKey` already bridges every ingredient line to the
// catalog, so it gets there with no new plumbing through the recipes JSON.
//
// **Directional, and symmetry is two rows.** "Milk instead of buttermilk" is
// not "buttermilk instead of milk". A `symmetric` flag would make every reader
// stop and work out which way the row it's holding is facing — the same reason
// two ingredient rows beat one line reading "serrano or jalapeño".
//
// **Nothing infers one.** Same discipline as `GroceryItem.productStrict` and as
// the deleted `likelyItemIds` bucket in shoppingTrip.ts: the user says so, or
// it isn't recorded. There is no built-in substitution lexicon and there is not
// going to be one.
//
// One-to-many is permanently out: "buttermilk → milk + lemon juice" is two
// items both required, which is a recipe rather than a swap.
export interface ItemSubLink {
  // What the recipe asks for.
  itemId: string;
  // What you'd accept instead.
  subItemId: string;
  // The caveat, free text — "fine for frying, not for baking". Margarine for
  // butter is right in a pan and wrong in laminated pastry, and this is where
  // that goes: per-recipe scoping would rebuild `choiceGroup` badly, and since
  // nothing auto-applies a substitute, a wrong one is a caption you ignore
  // rather than a purchase you regret.
  note: string | null;
  createdAt: string;
  /**
   * "1 clove" → "1/4 tsp" — a user-typed conversion for the common case where
   * the substitute genuinely needs a different amount, not just a different
   * name. **Both null or both set; one alone is not a ratio.**
   *
   * The two things this is emphatically not: the app computing a ratio it was
   * never told (a built-in buttermilk→milk table — still out, and staying
   * out, same verdict as the deleted `likelyItemIds` bucket), and a claim that
   * generalizes past the amount it was stated for (¼ tsp per clove is a linear
   * model of something that isn't reliably linear — right at 3 cloves, wrong
   * at 20 in a garlic-forward dish; `note` carries that caveat, this doesn't
   * try to).
   *
   * Stored as the two strings the user typed, not a computed float: that's
   * what was written, it carries both units, and it round-trips into the
   * editor unchanged — the same instinct behind `quantity` being free text
   * everywhere else in this app. See `itemSubs.substituteQuantity` for the
   * one place arithmetic is done on these, and its refusals.
   *
   * A ratio-less link — the common case — shows no ratio anywhere. Rendering
   * "1 : 1" as a stand-in would invent a fact the user didn't state.
   */
  ratioFrom: string | null;
  ratioTo: string | null;
  /**
   * **A standing swap** — "I never buy dairy milk, so every recipe calling for
   * milk reads and shops as oat milk." One bit on the link rather than its own
   * system, because structurally that is all it is (#1571).
   *
   * It is the one deliberate exception to the rule every other read of a
   * substitute obeys: a substitute informs, it never buys. What earns the
   * exception is the mandate — the user named both items and ticked "always",
   * which is a stronger statement than anything `probablyHaveReason` acts on.
   * Four things keep it safe, and none of them is optional:
   *
   * - **Read time only.** `standingSwaps.applyStandingSwap` rewrites a line on
   *   the way out of `flattenRecipeIngredients`, the way `ChoiceResolution`
   *   resolves an either/or. Nothing writes the swapped name onto the recipe,
   *   so unticking this restores every recipe at once.
   * - **Always marked.** A swapped line says what the recipe said, wherever it
   *   is shown — the same call `unitConvert` makes with `≈`.
   * - **Directional and never chained.** `bothWays` writes the reverse row
   *   without this bit, and one item has at most one standing swap; a swap's
   *   target is never itself swapped.
   * - **A ratio that can't be applied refuses the whole swap.** Renaming the
   *   line while leaving an amount the ratio couldn't convert is worse than
   *   not swapping at all.
   *
   * The escape hatch for a swap that's wrong in one dish (butter to margarine
   * in laminated pastry) is `RecipeIngredient.noSwap`, per line.
   */
  standing: boolean;
}

/**
 * The most a price can be, in minor units — £10,000. Not a validation rule
 * anyone should hit, just the ceiling that stops a mistyped card number
 * becoming a trip estimate.
 */
export const GROCERY_PRICE_MINOR_MAX = 1_000_000;

/**
 * One-tap presets for the currency symbol, not a closed list any more (#1476)
 * — a dozen doesn't cover everyone shopping in something else, so the setting
 * itself takes any short string. Kept here anyway: this string is concatenated
 * into every rendered price, so a validated length is what stands between a
 * real symbol and a total nobody can read, not membership in this array. There
 * is one currency at a time and nothing converts between them.
 */
export const CURRENCY_SYMBOLS: readonly string[] = [
  '$', '£', '€', '¥', '₹', '₩', 'R$', 'zł', 'kr', '₽', '₺', '₴',
];
export const DEFAULT_CURRENCY_SYMBOL = '$';
// 1–3 characters, matching the longest preset above ("R$"/"zł"/"kr") — long
// enough for everyone's symbol, short enough that it can't make a price
// unreadable.
export const CURRENCY_SYMBOL_MAX_LENGTH = 3;

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
// `inCatalog` axis exists to prevent. It would also poison the catalog and
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
  // "This one has to be real butter" — the per-line opt-out from a standing
  // swap (ItemSubLink.standing). Margarine for butter is fine in a pan and
  // wrong in laminated pastry, and a rule that rewrites a line without being
  // asked has to have somewhere for that exception to live.
  //
  // **On the recipe, deliberately, and deliberately not a choiceGroup.** Which
  // pepper you use is a fact about one cooking (MealPlanEntry.recipeChoices);
  // "this pastry needs butter" is a fact about the dish, true every time it is
  // made. And it isn't a choice at all — there are no options to pick between,
  // just one line the standing rule doesn't reach — so filing it with the
  // either/or machinery would mean a group of one, the dead-end state
  // RecipeIngredientSheet's Alternatives field exists to make unreachable.
  //
  // Optional rather than `boolean`, unlike every field above: ingredients live
  // in a JSON blob, so an absent key is already the value nearly every line
  // wants, and requiring it would mean a backfill through every construction
  // site (the parser, the extractor, the editor, the seed) for a bit that is
  // off almost everywhere.
  noSwap?: boolean;
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

// Whether you'd cook it again. Two poles and null (no opinion, the common
// state — nothing infers one, cooking a recipe isn't liking it), the same
// shape ProductRating uses for a grocery product and for the same reason: the
// question is "would I make this again", not a score to keep consistent.
export type RecipeVote = 'up' | 'down';

export const RECIPE_VOTE_LABELS: Record<RecipeVote, string> = {
  up: 'Loved it',
  down: 'Not for me',
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
  /**
   * How many days this dish's leftovers keep, or null to fall back to
   * LEFTOVER_KEEP_DAYS_DEFAULT. A fish pie is not a chilli, and the keep-for
   * window is a fact about the dish rather than about one night's cooking —
   * which is exactly why it lives here and `MealPlanEntry.recipeScale` doesn't.
   *
   * **A default the log sheet opens on, never a rule it enforces.** Logging is
   * still the one place a `Leftover.keepUntil` is written, and the stepper there
   * shows this number so what's about to be stored is what's on screen — the
   * same reason the store keeps taking an explicit count rather than resolving
   * the recipe itself. See leftoverKeepDaysFor.
   */
  leftoverKeepDays: number | null;
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
  // Headings declared with nothing filed under them yet — see recipeSections.ts.
  // A section otherwise only exists as the `section` string on an ingredient
  // row, so an empty one has nowhere to live without this; entries here are
  // pruned the moment a row actually carries the same label, so this never
  // duplicates what `sectionsOf(ingredients)` already reports. Empty for
  // every recipe that's never had a heading declared ahead of its ingredients,
  // which is most of them.
  emptySections: string[];
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
  // The method, as discrete instructions rather than one blob — see `notes`
  // above. Empty for every recipe that predates this: `notes` is what every
  // existing recipe's method lives in, and stays exactly as legible as it
  // always was. Ordered by array position, the same convention `ingredients`
  // and `components` use — there is deliberately no separate order field.
  //
  // **Why this exists at all when `notes` already holds text**: scaling and
  // unit conversion can only ever reach a structured amount, never a sentence
  // — so "add 2 cups of the flour" inside a notes blob doesn't move when the
  // recipe is halved, and a cook mode has no unit to read a step's progress
  // against. A step is deliberately still just `text`, though: no ingredient
  // references and no per-step duration. Both were considered and both are a
  // second list to keep in step with this one, worth adding only once
  // something actually reads them (#1695).
  steps: RecipeStep[];
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
  /**
   * Set from the edit page, or offered the first time the recipe is marked
   * cooked (see useRecipeStore.setVote, MealPlanScreen.setCooked). Null is
   * "no opinion yet", not "fine" — see RecipeVote.
   */
  vote: RecipeVote | null;

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

// One instruction, as written — "Preheat the oven to 400°F", not a template
// with amounts filled in. Free text and no length cap, same as `Recipe.notes`
// it's the structured replacement for: a step is a sentence or two, not a
// list-row label. See `Recipe.steps` for why this exists as its own list
// rather than staying inside `notes`.
export interface RecipeStep {
  id: string;
  text: string;
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
 * A glyph per meal, borrowed from the time-of-day pills in quick add — the same
 * three parts of the day MEAL_SLOT_SEGMENTS hides each meal's task behind, so a
 * row and the behaviour agree. Snack gets the cup, since it's the one with no
 * part of the day to name.
 *
 * Beside the labels rather than in either of the two screens that draw it (the
 * Settings rows that switch a meal on, the meal chip on a task row), because
 * one meal wearing two different glyphs on two screens is the drift the shared
 * primitives exist to stop.
 */
export const MEAL_SLOT_ICONS: Record<MealSlot, string> = {
  breakfast: 'sunny-outline',
  lunch: 'partly-sunny-outline',
  dinner: 'moon-outline',
  snack: 'cafe-outline',
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
   * Whether this meal's slot gets a task on Today — `true`/`false` when the
   * user has said so for this meal, `null` when they haven't and
   * `mealSlotsEnabled` decides (see utils/mealSlotTasks.ts).
   *
   * It outlived the cook tasks it was built for: a meal task is keyed by a day
   * and a slot rather than by a meal, but "not this one" is still a thing a
   * *meal* says, so this stays the per-meal answer both the daily pass and the
   * reconcile read. An explicit `true` is also the one way a task appears
   * outside that pass — a lunch you cook once a month can have a task without
   * lunch being a meal you want asked about every day.
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
  /**
   * The device calendar event mirroring this meal, or null when there isn't
   * one (#1494) — the household's shared answer to "what's for dinner
   * Thursday", which a local task can't give.
   *
   * Same direction of authority as `Task.calendarEventId`, and the opposite
   * of `cookTask` right above: **the entry is the master** — it owns the
   * title, the day and the slot, reconciling rewrites exactly those on the
   * device event, and nothing flows back. A cook task is a projection the
   * user can talk back to (deleting it says "not this meal"); a calendar
   * event isn't, because expo-calendar exposes no `EKEventStoreChanged`
   * bridge, so an event moved or deleted on the device is invisible from
   * here. Hence no tri-state opt-out to match `cookTask`'s: there is no
   * gesture that would write one.
   *
   * Not in `MealPlanDraft` — nothing may create an entry pre-pointed at an
   * event. Written only by `reconcileMealEvent` in useMealPlanStore, from
   * whatever the device write returned.
   */
  calendarEventId: string | null;
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
 * **It is also not a Task**, for the reasons MealPlanEntry gives. What it can
 * have is a *replica* Task — "Use up the chilli" — projected the same way
 * #1106 projects one from a perishable grocery item: a separate ordinary row
 * pointing back here via Task.leftoverId, spawned/updated/dropped by
 * src/utils/leftoverTasks.ts, never a second lifecycle grafted onto this row.
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
  /**
   * ISO instant this container went in the freezer, or null while it's in the
   * fridge. Exactly `GroceryItem.frozenAt`, and read through the same
   * `freshness.liveUseBy`.
   *
   * Both halves of the kitchen get this or neither usefully does: a bag of
   * spinach and a container of chilli going off Thursday are the same fact to
   * the cook (#1670), and so are the two of them going in the freezer on
   * Saturday. `isPlannedPastKeepUntil` already conceded as much in prose —
   * planning a container past its day is fair because "it may be going in the
   * freezer" — and this is that sentence with somewhere to be recorded.
   *
   * **It does not close the container out.** `finishedAt` is still the only
   * thing that ends a leftover's life, and a frozen one is as live as any
   * other: it stays plannable onto a night of the week, which is most of what
   * anyone freezes a portion *for*. What stops is the countdown and the nudge
   * (`needsAttention`).
   */
  frozenAt: string | null;
  createdAt: string;
  /**
   * The per-leftover answer to "does this get a use-up task" — true, false, or
   * null to hand the question back to the leftoverUseUpTasks setting. Same
   * semantics as GroceryItem.useUpTask: `false` is what deleting the task
   * records, so a leftover you've already been reminded about once doesn't
   * spawn another the moment it crosses back into "soon".
   */
  useUpTask: boolean | null;
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

/**
 * A row on the Today list that isn't a task and never becomes one (#1571).
 *
 * A calendar event, a planned meal and what's about to go off in the kitchen all
 * belong on the day, and none of them can be dragged, selected or edited here —
 * an event is EventKit's row and the app only reads it, a meal is
 * `MealPlanEntry`'s, and a kitchen row is a reading over the catalog and the
 * fridge (#1689). The first two used to sit in two fixed strips above the list;
 * folding them in needs a row treatment that doesn't bring a second interaction
 * model with it, which is what this is: no drag handle and no `SelectionDot`.
 * That last absence is the signal for bulk edits — every *eligible* row grows a
 * ring while one is on, so a row without one is already how this list says "not
 * this one".
 *
 * **The third kind is why the mechanism was worth having.** The kitchen's front
 * door is the list the user already reads every day, not a screen they have to
 * go to: everything the groceries/meals area knows sits behind More →
 * Groceries & meals → a pill, and a bag of spinach nobody navigates to is a bag
 * of spinach that rots. A context row is the opposite — the knowledge arrives
 * where the attention already is.
 *
 * **A meal can be ticked off from here; an event can't.** That asymmetry is the
 * whole of what a context row can *do*, and it follows from who owns the row: a
 * meal's `cookedAt` is this app's to write, and a leftover or a takeaway planned
 * for tonight is a real thing to finish that has no "Cook X" task to finish it
 * with. See `DayContextRow`, which draws the tickable one's glyph as a button.
 *
 * **A kitchen row is a reading, so it can't be ticked either** (#1689) — and
 * that's the line between it and the "Use up X" *task* the same food can
 * produce. A task is a thing to do: it carries an opt-out, it can be deferred,
 * and it lands in the Logbook when it's done. A kitchen row states what the
 * kitchen is right now; it goes away when the food does, and the only two
 * answers it could offer ("eaten" / "thrown out", "got it" / "out of it") are
 * exactly the two-way questions `KitchenScreen` already refuses to guess at with
 * a single glyph. So it opens the kitchen instead of finishing anything.
 *
 * **A view model, computed per render, never stored.** Nothing here is written
 * to SQLite: `src/utils/dayContextRows.ts` builds these from the calendar store
 * and the meal plan on every read, the same way `TripSummary` is derived rather
 * than kept. It carries only what a row draws, so no reader is tempted to
 * treat it as the source — the event and the entry it came from stay canonical.
 */
export interface ContextRow {
  /**
   * Stable across renders (an event id, a meal entry id — prefixed by kind, so
   * two sources can't collide), because it's the list key. Deliberately not the
   * bare source id: a task and a context row can share a list, and a duplicate
   * key is how a row ends up rendering someone else's content.
   */
  id: string;
  /**
   * The row this was built from — a `MealPlanEntry.id` for a meal, a
   * `BusyEvent.id` for an event, a `GroceryItem.id` or `Leftover.id` for a
   * kitchen row. Its own field rather than `id` with the prefix peeled off at
   * the call site: `id` is a list key and owes nothing to whatever made it, and
   * a screen re-deriving a store key by string surgery is how the two quietly
   * stop matching.
   *
   * Empty on the one row that summarizes several — see `kitchenContextRows`,
   * where "3 things to use up" is built from no single source and has none to
   * name. Nothing dereferences it: every kitchen row opens the same sheet.
   */
  sourceId: string;
  kind: 'event' | 'meal' | 'kitchen';
  title: string;
  /**
   * The caption under the title — "4:15 PM", "All day", "Now", "Dinner", "Use
   * by today". A single string rather than a time plus a formatter, because the
   * cases don't share a format and the row would otherwise need to know which
   * it had. They all say *when*, which is what lets the row caption them with
   * one glyph — a kitchen row's use-by day included, since that is the whole of
   * what makes it worth a row.
   *
   * A kitchen row is the one that can carry a second clause ("Use by today ·
   * For Chili"), and only for the pairing this feature exists for: the thing
   * that's dying, next to the meal already planned to eat it.
   */
  caption: string;
  /** Which category section this files under; null = the header-less loose group. */
  category: string | null;
  /**
   * True only while an event is actually running. The one emphasis in the
   * treatment (medium-weight title, accent caption) and deliberately the only
   * one — the row is otherwise drawn exactly as a task is, so anything further
   * would make a running event louder than the work it sits among.
   */
  now: boolean;
}

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
