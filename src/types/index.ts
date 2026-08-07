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
  createdAt: string;
  seenAt: string | null; // last time the user interacted with this task; drives the "new" dot

  dueDate: string | null;
  deadline: string | null;   // separate target date to hit; shown as a subtle countdown, doesn't affect scheduling/visibility
  // When set, `deadline` is derived as `dueDate` minus this many days instead of
  // a fixed date, and gets recomputed against the new dueDate every time a
  // recurring task spawns its next occurrence (see completeTask). Null means
  // `deadline` is a one-off fixed date that doesn't carry forward.
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

  tags: string[];
  category: string | null;
  sortOrder: number;

  pinned: boolean;
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null; // precise time estimate; effort is the derived coarse bucket

  reminderTime: string | null; // ISO datetime for scheduled notification
  // 'alarm' rings as a native iOS system alarm (AlarmKit, iOS 26+) instead of
  // a plain notification; falls back to 'notification' wherever AlarmKit is
  // unavailable. Ignored when reminderTime is null.
  reminderKind: ReminderKind;

  linkUrl: string | null; // URL/deep-link opened by the link button on the task row

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
  actualMinutes: number | null;  // measured duration once timed/logged; null = never timed

  // Timed tasks ("play violin for 15 minutes") — a duration the task counts
  // down against. Once the countdown runs out the task reads as ready to
  // complete; it never blocks completion (see isTimerReady in utils/timer.ts).
  // Readiness is derived from these two plus timerStartedAt, never stored, so
  // it stays correct across backgrounding and app restarts.
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
}

export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'seenAt' | 'completed' | 'completedAt' | 'streakCount' | 'streakDate' | 'previousStreakCount' | 'previousStreakDate' | 'archived' | 'archivedAt'>;

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
