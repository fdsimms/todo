export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Priority = 0 | 1 | 2 | 3 | 4;
export type Effort = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type SortOption = 'default' | 'priority' | 'effort-asc' | 'effort-desc' | 'due-date' | 'streak';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export interface Category {
  id: string;
  name: string;
  scheduleDays: number[] | null;   // 0=Sun … 6=Sat, null = no restriction
  scheduleStart: string | null;    // "HH:MM"
  scheduleEnd: string | null;      // "HH:MM"
  hideOnVacation: boolean;         // hide tasks in this category while vacation mode is on
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

export interface ChainItem {
  id: string;
  title: string;
  notes: string;
}

// A lightweight, collapsible label for grouping several independent tasks
// together (e.g. "Take supplements" grouping Coq10/Vitamin D/Iron, each on
// its own schedule). Deliberately NOT a Task — it has no dueDate, recurrence,
// streak, or reminder, so it can never itself be "not due yet" and desync
// from children on mismatched cadences (see completeGroup/deferGroup in
// useTaskStore). Its completion state is derived live from children, not
// stored here.
export interface TaskGroup {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  priority: Priority;
  category: string | null; // which category section it renders under
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
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  completedAt: string | null;
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

  tags: string[];
  category: string | null;
  sortOrder: number;

  pinned: boolean;
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null; // precise time estimate; effort is the derived coarse bucket

  reminderTime: string | null; // ISO datetime for scheduled notification

  linkUrl: string | null; // URL/deep-link opened by the link button on the task row

  // Streaks (recurring tasks only)
  streakCount: number;       // positive = N consecutive completions
  streakDate: string | null; // logical-day ISO string of last completion

  // Snapshot of streakCount/streakDate from just before the current
  // completion, so uncompleting (e.g. from the Logbook) can restore the
  // streak to what it was rather than leaving the incremented value.
  previousStreakCount: number;
  previousStreakDate: string | null;

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

  // Set on a task auto-generated by completing a recurring task; points back
  // to the task whose completion created it. Lets uncompleting that task
  // remove this follow-up occurrence again.
  previousOccurrenceId: string | null;

  // Pre-edit values of content fields overridden with "this task only" scope
  // (see updateTask). Applied on top of this task when its completion spawns
  // the next occurrence, so a one-off edit doesn't become the series template.
  seriesDefaults: Partial<Task> | null;
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
  focused: boolean;

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

export interface TaskTemplate {
  id: string;
  name: string;
  items: TemplateItem[];
  itemGroups: TemplateItemGroup[];
  createdAt: string;
  sortOrder: number;
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
