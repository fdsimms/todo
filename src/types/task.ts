import type { AlarmMission } from './alarms';
import type { LogMealSlot } from './mealPlan';
import type { NutrientKey } from './nutrition';
import type { HealthTargetMetric, WeatherCondition } from './rules';

// 'hours' is the one type with no calendar grid of its own — see
// getNextDueDate and the "hours" note on Task.recurrenceInterval. It always
// behaves as recurrenceFromCompletion regardless of that flag's stored value.
// What a recurring task does on a holiday. See Task.recurrenceHolidays.
export type HolidayRule = 'skip' | 'move';

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'hours';
export type Priority = 0 | 1 | 2 | 3 | 4;
export type Effort = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type SortOption = 'default' | 'priority' | 'effort-asc' | 'effort-desc' | 'due-date' | 'streak';
/**
 * The Projects screen's order. 'manual' is the hand-dragged order and the only
 * one a drag can change; the others sort within each category section. See
 * sortProjects in utils/projectList.
 */
export type ProjectSortOption = 'manual' | 'deadline' | 'progress' | 'name';
export type RecipeSortOption = 'default' | 'name' | 'cooked-recent' | 'cooked-oldest' | 'quickest' | 'ingredients-asc' | 'ingredients-desc';
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
//
// 'yesno' and 'choice' answer with one of a fixed set: Yes/No for the first,
// the task's own `deliverableOptions` for the second. The stored answer is the
// option's text, so a project can count them ("12 yes, 3 no").
// 'dateRange' answers with two days, stored as "start/end" (ISO instants, see
// `deliverableDateRange`): the dates of a trip rather than one day.
// 'people' answers with people from the people list, stored as a JSON list of
// `{ id, name }` (see `deliverablePeople`): the name rides along so every
// reader can show the answer without the people store.
export type DeliverableKind = 'text' | 'date' | 'dateRange' | 'people' | 'number' | 'yesno' | 'choice';

/**
 * How hard a task is to make yourself do, apart from how long it takes — see
 * `Task.difficulty`.
 */
export type Difficulty = 'trivial' | 'easy' | 'normal' | 'hard';

/**
 * Answers to the three questions the backfill screen asks about every task,
 * given once for a whole group of tasks instead of once per task: a project's
 * list (`Project.taskDefaults`) or a kind of generated task (Settings'
 * `generatedTaskDefaults`). Every field is null for "no default, ask me", and
 * a default only ever fills a field nobody answered (see `newTaskFromDraft`).
 *
 * `priority: 0` is an answer, not an absence: it means "these have no
 * priority, don't ask", and a task created under it is stamped as dismissed for
 * the priority backfill, since a priority of 0 otherwise reads as missing.
 * `effort: 0` is the same answer for the time estimate.
 *
 * The last three are the backfill screen's yes/no questions. `true` turns the
 * setting on, `false` leaves it off and stamps the question as dismissed so
 * Backfill never asks, and `null` is "no default, ask me". Streak chip and
 * vacation pause only mean something on a repeating task, so a default for
 * either is applied to repeating tasks only.
 */
export interface TaskFieldDefaults {
  priority: Priority | null;
  difficulty: Difficulty | null;
  /** An estimate bucket, 1 to 6, or 0 for "no estimate, don't ask". The minutes come from `EFFORT_MINUTES`. */
  effort: Effort | null;
  /** `Task.showStreak`, for repeating tasks. */
  showStreak: boolean | null;
  /** `Task.vacationPause`, for repeating tasks. */
  vacationPause: boolean | null;
  /** `Task.excludeFromSuggestions`. */
  excludeFromSuggestions: boolean | null;
  /**
   * `Task.slotIn`. Unlike the three above, `false` is written onto the task as
   * an answer ("keep the date") rather than stamped as dismissed, because the
   * task field can hold one and it has to outrank a category that says wait.
   * Optional so a stored object from before this field reads as no answer.
   */
  slotIn?: boolean | null;
}

/**
 * The rest of a kind of generated task's "Task settings", beside its
 * `TaskFieldDefaults` and its own category setting: fields the generator never
 * writes, applied to each new task beneath whatever the generator's draft
 * names (see `generatedExtrasFill` in `src/utils/generatedTaskSettings.ts`).
 * Empty arrays and a null kind mean "nothing set".
 */
export interface GeneratedTaskExtras {
  /** Added to the draft's own tags, never replacing them. */
  tags: string[];
  /** Used only when the draft names no time of day. */
  timeSegments: TimeOfDay[];
  /** `Task.deliverableKind`, used only when the draft asks nothing. */
  deliverableKind: DeliverableKind | null;
  /** `Task.deliverableOptions`, for a `'choice'` kind only. */
  deliverableOptions: string[];
}

/**
 * Which direction a task's success runs in — see `Task.polarity`.
 *
 * 'positive' is every task that has ever existed here: something to do, and
 * doing it is the win. 'negative' is the opposite commitment ("don't smoke"),
 * where the win is the day passing untouched, so it is never completed and its
 * streak counts clean days rather than completions.
 */
export type Polarity = 'positive' | 'negative';

/**
 * The stretch a daily target counts across — see `Task.quotaPeriod`. 'day' is
 * every quota that predates the field; 'week' is "three times a week".
 */
export type QuotaPeriod = 'day' | 'week';

export interface Category {
  id: string;
  name: string;
  scheduleDays: number[] | null;   // 0=Sun … 6=Sat, null = no restriction
  scheduleStart: string | null;    // "HH:MM"
  scheduleEnd: string | null;      // "HH:MM"
  hideOnVacation: boolean;         // hide tasks in this category while vacation mode is on
  // Keep tasks in this category out of suggested pins (see suggestPinTasks)
  // and suggested focus queues (see suggestFocusTasks). Only the suggesters
  // honour it — the tasks stay visible everywhere and can still be pinned or
  // queued by hand. For routines and errands, which are perfectly real work
  // but bad company for whatever else lands in a shortlist.
  excludeFromSuggestions: boolean;
  // Keep tasks in this category from counting as "new" — no entry in the
  // "you have X new tasks" banner, and no dot on their own row (see
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
  // Tasks here wait for a day that isn't full (see src/utils/slotIn.ts). Read
  // whenever the pass runs, unlike defaultTimeSegments, so turning it on covers
  // the tasks already in the category; a task's own `slotIn` outranks it.
  slotIn: boolean;
  sortOrder: number;
  emoji: string | null;            // shown in place of the folder icon, and prefixed to the name wherever it appears
  /**
   * Which Backfill fields (see `src/utils/categoryBackfill.ts`) this category
   * has been told to stop asking about — same mechanism and same reasoning as
   * `Task.backfillDismissedFields`, holding `CategoryBackfillFieldId` values
   * as plain strings since a `Category` field can't depend on a type from
   * `src/utils`.
   */
  backfillDismissedFields: string[];
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
  // What completing *this step* asks for, or null/absent for the ordinary
  // "ticking it is the whole answer" step. Per-step for the same reason
  // estimatedMinutes is: `Task.deliverableKind` is one question for the whole
  // task and rides `...effective` onto every successor, so a two-step chain
  // that asks a question at step one asked it again at step two. Resolved by
  // `deliverableKindFor`, which prefers the active step and falls back to the
  // task, exactly as `estimatedMinutesFor` and `displayTitleFor` do.
  //
  // The *answer* stays on the row (`Task.deliverableValue`) and needs no
  // per-step counterpart — a chain only ever has one step live at a time, and
  // each step is its own row, so the answers already log one per step.
  deliverableKind?: DeliverableKind | null;
  // For a 'date' step: the answer becomes the next step's due date, instead of
  // the next step landing on the day this one was completed. "Book haircut"
  // answers with the appointment date and "Get haircut" lands on it.
  //
  // Deliberately its own flag rather than something a date step always does.
  // Recording a date mid-chain and *moving the next step* are two different
  // wants, and the second one reschedules a row — a thing that should be
  // visible in the editor rather than an unannounced second meaning of the
  // date kind. Inert without `deliverableKind: 'date'`, and inert on the last
  // step, which has no next step to date.
  deliverableDatesNextStep?: boolean;
  // What completing *this step* records in the medication log, or null/absent
  // for a step that records nothing. Per-step for the same reason
  // `estimatedMinutes` and `deliverableKind` are: the task-level fields ride
  // `...effective` onto every successor, so a "morning pills / evening pills"
  // chain logged the morning dose again in the evening. Resolved by
  // `medicationFor`, which prefers the active step and falls back to the task.
  //
  // **Resolved as a set, never field by field.** A step naming a medication
  // supplies the whole triple, including a null amount. Falling back per field
  // would let a step that names only "Sertraline" inherit the task's "25 mcg"
  // and record a dose of one medicine at another's strength, which is the one
  // way this feature could state something actively false.
  medicationName?: string | null;
  medicationAmount?: number | null;
  medicationUnit?: string | null;
  // What the link button opens for *this step*, or null/absent to fall back
  // to the task's own `linkUrl`. Same reason as the fields above: `linkUrl`
  // rides `...effective` onto every successor, so a chain whose steps point
  // at different places ("Check email" / "Check calendar") opened the first
  // step's link at every step. Resolved by `linkFor`, which prefers the
  // active step and falls back to the task.
  linkUrl?: string | null;
  // A note for *this step* alone, shown on the row while the step is the
  // active one, under the task's own notes. Per-step for the same reason as the
  // fields above: `Task.notes` rides `...effective` onto every successor, so a
  // note about "bring cash" would otherwise sit on every step of the chain.
  // Null/absent for a step with no note.
  notes?: string | null;
}

/**
 * One named unit of a rotation — a language to listen to, a bathroom to clean,
 * an instrument to practise. The rotation itself lives on the task that holds
 * the set (see `Task.rotationItems`).
 *
 * Deliberately a plain record rather than a `Task`. A member is an *option*,
 * not a thing with a schedule: it has no due date, no completion state of its
 * own and never appears on Today, because the entire point of the feature is
 * that one parent row stands in for the whole set and asks which one you did.
 * Subtask rows would put all five on the day and let you tick one directly,
 * which is the shape this exists to avoid.
 *
 * One JSON column rather than a table, for the reason `chainItems` is one:
 * these are only ever read and written together, with the task that owns them.
 */
export interface RotationItem {
  id: string;
  title: string;
  // What the link button opens for this member — the podcast feed, the lesson
  // page. Optional, and falls back to nothing rather than to the task's own
  // `linkUrl`: a rotation's members are siblings, so a member with no link of
  // its own has no link, where a chain *step* sensibly inherits the task's.
  linkUrl?: string | null;
  // How many times this member is done in a period. Absent means once, which is
  // what every set written before this existed says. A target of three runs and
  // one bike ride is `perWeek: 3` on one member and nothing on the other; the
  // set's target is the sum (`rotationTargetTotal`), and a pick only covers
  // something while its member is under its own count.
  perWeek?: number;
  // The workout this member stands for: a routine, or a program whose next
  // routine it starts (`Task.workoutRoutineId`/`workoutProgramId`, per member).
  // One or the other, never both. The pill starts it, and finishing that
  // session logs this member (`rotationMemberForWorkout`). Resolve-or-shrug: a
  // routine or program deleted since leaves a plain member.
  workoutRoutineId?: string | null;
  workoutProgramId?: string | null;
}

/**
 * One logged pick — which member, and when. The period's ledger is an array of
 * these (`Task.rotationLog`), in the order they were logged.
 *
 * It carries a timestamp because the ledger *is* the record for the period:
 * the closed occurrence keeps it the same way a partial quota keeps its
 * `progressCount` (see `rolloverQuotas`), so "which did I listen to on
 * Tuesday" is answerable from the week's own row rather than from five
 * tombstones that retention is entitled to delete.
 */
export interface RotationLogEntry {
  itemId: string;
  at: string;
}

// Everything the "Follow-up task" rule says about the task it adds, beyond its
// title — see the field notes on Task.followUpTaskEveryN, and followUpTask.ts for
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
export interface FollowUpTaskDraft {
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
  // Same field and meaning as `Task.difficulty`. Optional so a draft stored
  // before it existed reads as unrated.
  difficulty?: Difficulty | null;
  estimatedMinutes: number | null;
  timeSegments: TimeOfDay[];
  // Same field and meaning as `Task.vacationPause`, and the one field of the
  // Task slice this spec was missing. It does two jobs rather than one, which
  // is why it belongs here rather than being a rule-level condition: it marks
  // the added task as one vacation hides *and*, because of that, stops the
  // rule adding one at all while vacation mode is on (see the suppression
  // note in followUpTask.ts). Both follow from the same answer — "this is work
  // that waits until I'm back" — so asking twice would be asking the same
  // question in two places.
  //
  // A vacation starting *after* one has already landed is why the flag is
  // still written onto the spawned row rather than only consulted at spawn
  // time: an outstanding wash-cloth task should hide when you leave, the same
  // as any other paused row.
  vacationPause: boolean;
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
  // The filing half of FollowUpTaskDraft, and null/0 mean the same thing here:
  // this rule says nothing about that field, so whatever would have happened
  // without it still happens.
  category: string | null;
  projectId: string | null;
  tags: string[];
  priority: Priority;
  effort: Effort;
  // Same field and meaning as `Task.linkUrl` — a known app's scheme (see
  // `KNOWN_LINK_APPS`) or a custom URL, opened by the row's link button. "Add
  // a link to the YNAB app when I mention YNAB" is this field: the rule is a
  // filing decision like category or a tag, not a schedule one, so it fits
  // the same null-means-nothing contract as the rest of the row.
  linkUrl: string | null;
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
  // Whether this stack was on the Today screen the last time it was looked at
  // — one bit, rewritten by Today itself as stacks come and go, and read by
  // nothing else.
  //
  // It exists so an expansion doesn't outlive the stack's stay on Today: a
  // stack expanded on Monday and finished off leaves the list, and coming
  // back on Tuesday it would otherwise arrive expanded, dropping its whole
  // roster into the middle of the day. Going from absent to present collapses
  // it (see syncTodayPresence), which is the same state a stack is created in.
  // A stack that never leaves keeps whatever the user set, restarts included.
  //
  // This is deliberately *not* the dismissed-for-today stamp that used to live
  // on this row: it gates nothing, so a wrong value costs one tap on the
  // chevron rather than a stack that won't come back. Today still renders a
  // stack exactly while it has a visible child.
  onToday: boolean;
  // The project this stack was built inside, if it was built inside one.
  //
  // Everywhere else a stack is scoped by its children — which project it
  // belongs to is read off the members, and it renders wherever they do. That
  // answers nothing for a stack with no members yet, which is why this exists:
  // a stack made from a project's own screen is an outline the user is about
  // to fill in, and without a stored home it would vanish the moment the
  // editor closed and reappear only once a task happened to point at it.
  //
  // Set when the stack is made on a project's screen, and changeable from the
  // stack editor's Project row — but never *inferred* from members: a stack's
  // tasks can sit in different projects (or none), so deriving it would have
  // to pick a winner, and the one thing this field is for is being right
  // before there are any members to ask. A stack made anywhere else keeps null
  // and is scoped by its children exactly as before.
  //
  // It says which project's page the stack appears on, not who its tasks
  // belong to, so changing it moves no tasks — unlike `category`, which the
  // stack does own and cascades onto its members.
  projectId: string | null;
  // A list section: its rows are items checked off rather than tasks
  // scheduled (a packing list inside a trip). Shown to people as "List"; the
  // field keeps its older name for the reason `cycle_items` does. Only
  // meaningful on a project's section; ignored anywhere else. Read through
  // `sectionIsList` (src/utils/listMode.ts), since a list project makes every
  // section a list without setting this. Optional for rows built before it
  // existed.
  checklist?: boolean;
  // The opposite override: a section that stays a task section inside a list
  // project (Project.list). Ignored when the project isn't a list. Optional
  // for rows built before it existed.
  keepsTasks?: boolean;
  // Leaves the "Next: ..." part off this stack's collapsed header.
  // Presentation only. Optional for rows built before it existed.
  hideNextStep?: boolean;
}

/**
 * Which of the app's unattended generators wrote a task — see
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
  | 'pantryCheck'
  // The offer to go through the whole cupboard at once, rather than one item
  // at a time the way pantryCheck asks — see src/utils/pantryReviewTasks.ts.
  // Its source id is the day key the offer was raised on, the same "square on
  // the calendar, not a row" position calendarReview and mealPlanNudge are in,
  // and for the same reason writeGeneratedOptOut has nothing to write for it.
  | 'pantryReview'
  // Once a day, a task to look at tomorrow's calendar — see
  // src/utils/calendarReviewTasks.ts. Its source id is tomorrow's day key, the
  // same "square on the calendar, not a row" position mealPlanNudge is in, and
  // for the same reason writeGeneratedOptOut has nothing to write for it.
  | 'calendarReview'
  // A calendar event whose title matches a rule the user wrote — see
  // src/utils/eventTasks.ts. Its source id is `${eventId}|${eventStart}#${ruleId}`:
  // one *occurrence* of an event (EventKit shares one id across a whole
  // recurring series, the same trap EventReminder and HiddenEvent are keyed
  // around) and the rule that named it. Not `sourced` — a calendar event is
  // not a row in this app, so there is nowhere to stamp an opt-out and the
  // mark lives in settings (`eventTaskHandled`), the position calendarReview
  // and the other three rule generators are already in.
  | 'eventTask'
  // A calendar event with a location becomes "Leave for X", its reminder set
  // to the event's start less a lead the user typed — see
  // src/utils/travelTasks.ts. Its source id is the occurrence key alone
  // (`${eventId}|${eventStart}`), eventTask's without a rule id after it,
  // since there is one rule. Not `sourced`, for eventTask's reason: the
  // handled record in settings (`travelTaskHandled`) is the mark.
  | 'travel'
  // Tomorrow's first timed event needs an earlier wake-up than usual, so a task
  // says when to be up and points at the device's own alarms (Task.alarmLink)
  // — see src/utils/wakeUpTasks.ts. Its source id is the occurrence key alone,
  // travel's, and the handled record in settings (`wakeUpTaskHandled`) is the
  // mark, for the same reason.
  | 'wakeUp'
  // A recurring task whose supply of a consumable is nearly spent becomes
  // "Order more X". The first generator whose source is a *task* rather than a
  // row in another store — see src/utils/supply.ts.
  | 'supplyReorder'
  // A meal coming up that the kitchen can't currently make becomes "Shop for
  // Tue ragu". The only generator whose source row is one the user edits freely
  // and often, which is why its whole staleness rule is the creation predicate
  // re-run — see src/utils/mealShortfallTasks.ts.
  | 'mealShortfall'
  // A meal planned for today or tomorrow whose ingredients (or leftover
  // container) are only on hand frozen becomes "Take chicken out of the
  // freezer". mealShortfall's sibling on the same source row, asking about the
  // rows the kitchen has frozen rather than the ones it lacks, and its opt-out
  // is its own tri-state beside shopTask (`MealPlanEntry.thawTask`). See
  // src/utils/mealThawTasks.ts.
  | 'mealThaw'
  // A planned meal a few days in the past with nothing logged against it
  // becomes "Log X" — the missed half of the offer `mealLog.ts` makes at
  // completion time. Its source row is the same `MealPlanEntry` mealShortfall's
  // is, and its opt-out is the same field the completion prompt's "Don't ask
  // for this meal" already writes (`MealPlanEntry.logMeal`) — declining either
  // one means the same thing about the same meal. See
  // src/utils/mealLogNudgeTasks.ts.
  | 'mealLogNudge'
  // Somebody's birthday, a few days ahead of the day itself — see
  // src/utils/birthdayTasks.ts. The only generator whose trigger is known years
  // in advance rather than derived from something that just changed.
  | 'birthday'
  // Getting them a gift, on its own separately configurable lead time — see
  // src/utils/birthdayTasks.ts. Rides the same person and year in
  // generatedSourceId that 'birthday' does; the kind is what keeps the two
  // from being read as one another's task (see generatedSourceOf).
  | 'birthdayGift'
  // A date on a person besides their birthday (Person.dates). Its own kind
  // rather than a second meaning of 'birthday', because the birthday kind's
  // source id is personId#year and a person can have several dates in a year.
  // It shares the birthday's switch, lead time and category (see its spec).
  | 'personDate'
  // A person you asked to be reminded about, whose cadence has run out — see
  // src/utils/reachOutTasks.ts. Silent on everybody until they are explicitly
  // opted in, which is what keeps "who am I neglecting" a question the app
  // never asks.
  | 'reachOut'
  // A task waiting on a person (Task.waitingOnPersonId), waited on long
  // enough, becomes "Follow up with X about Y" — see
  // src/utils/waitingFollowUpTasks.ts. Sourced on the waiting task itself
  // rather than the person, the same position 'supplyReorder' is in: a task
  // is the thing that stops being wanted (completed, archived, released),
  // not the person, and two different waits on the same person must each be
  // able to ask.
  | 'waitingFollowUp'
  // A user-configured rule ("sunny -> Put on sunscreen") matched against
  // today's weather — see src/utils/weatherTasks.ts. Its source id is a day
  // key and a rule id (`${dayKey}#${ruleId}`), the same "square on the
  // calendar, not a row" position calendarReview is in, and for the same
  // reason writeGeneratedOptOut has nothing to write for it: the rule it
  // points at lives in settings, not in a row a stamp could be spent against.
  | 'weather'
  // A Screen Time usage threshold the user wrote down ("after 30 minutes on
  // these apps") that the OS reported crossed — see
  // src/utils/screenTimeRules.ts. Its source id is a day key and a rule id,
  // the same `${dayKey}#${ruleId}` shape weather uses and for the same reason:
  // the source is a rule in settings, not a row a decline could be stamped on,
  // so writeGeneratedOptOut has nothing to write for it either.
  | 'screenTime'
  // An offer of coins for blocking apps a set time, written by a rule the user
  // wrote — see src/utils/blockOfferTasks.ts. Same `${dayKey}#${ruleId}` source
  // id as weather and screenTime, and writeGeneratedOptOut has nothing to write
  // for it for their reason: the source is a rule in settings.
  | 'blockOffer'
  // A shortfall against an Apple Health reading the user wrote a rule about
  // ("under six hours of sleep") — see src/utils/healthRules.ts. Same
  // `${dayKey}#${ruleId}` source id as weather and screenTime, and
  // writeGeneratedOptOut has nothing to write for it for their reason: the
  // source is a rule in settings, not a row a decline could be stamped on.
  | 'health'
  // Once a day, a task to write down how you are doing — see
  // src/utils/moodTasks.ts. Its source id is the day key it is asking about,
  // the same "square on the calendar, not a row" position calendarReview is
  // in, and for the same reason writeGeneratedOptOut has nothing to write for
  // it: the day it names is not a row a decline could be stamped on.
  | 'moodLog'
  // A run of low-mood days becomes a task to do something you enjoy — see
  // src/utils/moodTasks.ts. Beside 'moodLog' the way birthdayGift sits beside
  // birthday: one pair, two lead-ins, and the second is the only generator in
  // the app whose trigger is a *trend* in the user's own data rather than a
  // date, a row or a threshold crossed once.
  | 'moodNudge'
  // A task to write in the journal, one per configured part of the day, and
  // one a day to write down a dream — see src/utils/journalTasks.ts. Same
  // day-keyed, no-source-row position as moodLog (journalLog's source id
  // carries the segment the same way), so neither has a row to stamp a decline
  // on and a settings mark keeps a swiped-away one away.
  | 'journalLog'
  | 'dreamLog'
  // A weekend with nothing on it becomes a task to make plans for it — see
  // src/utils/weekendTasks.ts. Its source id is the weekend's *Saturday* day
  // key, which is the same "square on the calendar, not a row" position
  // calendarReview is in, one unit wider: three days named by one of them. So
  // writeGeneratedOptOut has nothing to write for it either, and what stops a
  // swiped-away row coming straight back is weekendNudgeLastWeekendKey.
  | 'weekendNudge'
  // One row per Backfill pool once that pool has a lot waiting — see
  // src/utils/backfillTasks.ts. Its source id is the pool's name, and the
  // "don't hand it straight back" mark is settings-level
  // (`backfillLastDayKeys`), the position pantryReview is in.
  | 'backfill'
  // A stretch with no weigh-in recorded becomes a task to record one — see
  // src/utils/weightTasks.ts. Its source id is the day key the request was
  // raised on, the same "square on the calendar, not a row" position moodLog
  // is in, and what stops a swiped-away one coming straight back is
  // weighInLastDayKey, then weighInDeclinedDayKey for the rest of the window.
  //
  // Deliberately not part of 'health' despite reading the same store: that
  // kind fires *because* a reading crossed a rule the user wrote, and this one
  // fires because there is no reading at all. Asking for data and reacting to
  // it are two different permissions, so they are two different switches.
  | 'weighIn'
  // weighIn's sibling for blood pressure — see src/utils/bloodPressureTasks.ts.
  // Same position: day-keyed with no source row, bloodPressureLastDayKey for the
  // rest of the day and bloodPressureDeclinedDayKey for the rest of the window.
  | 'bloodPressureLog'
  // A water task that follows the food log's target (Task.followWaterTarget),
  // finished for the day before the target rose, becomes a one-off task for
  // what is still owed — see src/utils/waterShortfallTasks.ts. Its source id is
  // the day key it was raised on, the same "square on the calendar, not a row"
  // position weighIn is in. What stops a deleted one coming straight back is
  // waterShortfallDeclinedDayKey, and a completed one blocks a second through
  // `blocksOnFinished`.
  | 'waterShortfall'
  // A snack suggestion once the afternoon has started and the food log is well
  // short of the calorie target — see src/utils/snackNudgeTasks.ts. Day-keyed
  // with no source row, waterShortfall's position: what stops a deleted one
  // coming straight back is snackNudgeDeclinedDayKey, and a completed one blocks
  // a second through `blocksOnFinished`.
  | 'snackNudge'
  // A produce suggestion once the evening has started and the food log is short
  // of a servings goal, with a recipe idea from what the kitchen has — see
  // src/utils/produceNudgeTasks.ts. snackNudge's position: day-keyed with no
  // source row, produceNudgeDeclinedDayKey stops a deleted one coming straight
  // back, and a completed one blocks a second through `blocksOnFinished`.
  | 'produceNudge'
  // A weekly "Restock vegetables and fruit" task when the pantry lists fewer
  // than a set number — see src/utils/produceFloorTasks.ts. Keyed by the week's
  // first day, no source row: produceFloorDeclinedWeekKey stops a deleted one
  // coming straight back, and a completed one blocks a second that week.
  | 'produceFloor'
  // A "don't do" task per Stay under limit, slipped automatically when the food
  // log goes past it — see src/utils/limitWarningTasks.ts. Keyed by the
  // nutrient; deleting one adds it to limitWarningDeclined.
  | 'limitWarning'
  // "Aim for 120g protein" for a nutrient goal, checked off by the app when the
  // day reaches it — see src/utils/goalTargetTasks.ts. Keyed by the nutrient
  // and the day; deleting one adds the nutrient to goalTargetDeclined.
  | 'goalTarget'
  // "Book Optometrist" once a saved event's own interval has nearly passed
  // since the last one — see src/utils/savedEventTasks.ts. Sourced by the saved
  // event and the cycle (`key|day`), and declined on the saved event itself.
  | 'bookEvent'
  // "WaniKani: 42 reviews" when the person's WaniKani review queue reaches a
  // number, and "WaniKani: 5 lessons" once a day — see src/utils/wanikaniTasks.ts.
  // Fed by a fetch of their own WaniKani account (src/services/wanikani.ts).
  // Sourced by the wave (`reviews:<hour>`) or the day (`lessons:<day>`), with
  // no source row; deleting one closes that wave and writes nothing.
  | 'wanikani'
  // "Approve 4 transactions in YNAB" while the person's YNAB plan has
  // transactions waiting, and "Cover $12.40 overspending in Dining Out" per
  // overspent category — see src/utils/ynabTasks.ts. Fed by a fetch of their
  // own plan (src/services/ynab.ts). Sourced by the day (`queue:<day>`) or the
  // category and month (`overspent:<month>:<category>`), with no source row.
  | 'ynab';

/** "Only if <question> is answered one of <answers>" — see `Task.answerGate`. */
export interface AnswerGate {
  /** The task whose question decides it. */
  taskId: string;
  /** The answers that open it, as the question's own option text. */
  answers: string[];
}

/** One photo or file on a task (see `Task.attachments`). */
export interface TaskAttachment {
  /** The file's name in the `task-files` folder, always starting `task-`. */
  name: string;
  kind: 'photo' | 'file';
  /** What to call it: the file's own name for a document, "Photo" for a picture. */
  title: string;
}

/** A medicine a task records beside its main one: a name, and the dose where one was stated. */
export interface TaskMedicationExtra {
  name: string;
  amount: number | null;
  unit: string | null;
}

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
   * A repeating occurrence (or one-off) the user said somebody else did. Like a
   * miss it is *also* `completed`, so every "is this row history" gate keeps
   * working, and this field is what `isRealCompletion` reads: the user did not
   * do it, so it earns no coins, advances and breaks no streak, and isn't an
   * achievement in Stats. Unlike a miss it still counts as done for a project
   * (`isResolvedAsDone`), because the work happened.
   */
  doneByOtherAt?: string | null;
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
  // A separate target date to hit; shown as a subtle countdown, doesn't affect
  // scheduling/visibility. An instant, never a bare day key: readers parse it
  // with `new Date`, and the write paths convert one (`deadlineInstant`).
  deadline: string | null;
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
  // Optional "HH:MM" the deadline closes at on its day. Null is a deadline for
  // the day as a whole (every deadline before this field existed). It is its
  // own column rather than a time carried inside `deadline`, because `deadline`
  // is a day stored as local noon and a relative rule (deadlineOffsetDays,
  // deadlineMonthDay) recomputes that day each occurrence; the time rides
  // unchanged through every recompute. Read it through `deadlineMoment`.
  deadlineTime?: string | null;
  // Whether this deadline is mirrored as an all-day event on the calendar
  // picked in Settings › Calendar (useSettingsStore's deadlineCalendarId) —
  // opt-in per task, never a blanket export of every deadline in the app.
  // See calendarEventId below and reconcileDeadlineEvent in useTaskStore.ts.
  deadlineOnCalendar: boolean;
  // Whether completing this task writes a silent, point-in-time event to the
  // calendar picked in Settings › Calendar (useSettingsStore's
  // completionCalendarId) — opt-in per task, never a blanket export of every
  // completion in the app. See completionCalendarEventId below and
  // logCompletionEvent in useTaskStore.ts.
  logCompletionToCalendar: boolean;
  // Which nutrient (see NutrientKey) is written to Apple Health as a sample
  // each time this task completes, or null when nothing is logged.
  // logHealthAmount is the amount, in that nutrient's own unit — a task
  // logging water this way stores 'waterMl' here and the millilitres there.
  // Two fields rather than a boolean-plus-amount pair, same reasoning this
  // field's predecessor (logWaterMl) had: "off" and "log 0" would otherwise
  // be two different ways to say nothing happened. Opt-in per task and gated
  // on Settings' healthWriteEnabled the same way logCompletionToCalendar is
  // gated on completionCalendarId. One-shot like the completion calendar
  // event: no delete-on-uncomplete, because a logged sample is a historical
  // record. See logTaskHealthValue in src/utils/healthCompletionSync.ts and
  // docs/arch/health-data.md.
  logHealthMetric: NutrientKey | null;
  logHealthAmount: number | null;
  // What completing this task records in the medication log (see
  // MedicationLog), or null when it records nothing. medicationAmount /
  // medicationUnit are the dose, and are the same two-field pair
  // logHealthMetric / logHealthAmount above are, for the same reason: "off"
  // and "log 0" must not be two ways of saying nothing happened.
  //
  // This is the whole of the task→log hook, and it deliberately asks nothing
  // at the tick. A scheduled dose is the case taskMoodContrasts already
  // answers off the task alone, so making the user confirm an amount they
  // already told the app once would be the "same fact twice" this feature
  // exists not to be. A dose that varies is logged by hand instead.
  //
  // These ride ...effective onto the next occurrence, so a daily task keeps
  // logging its dose without being re-set every day.
  //
  // Unlike logHealthMetric this is NOT one-shot: uncompleting the task
  // deletes the dose it wrote (matched on MedicationLog.taskId). A health
  // sample is a historical record in somebody else's database; this is the
  // app's own record of what went into a person, and a task ticked by mistake
  // means the dose was not taken. A phantom dose left behind corrupts exactly
  // the thing the log exists to be.
  medicationName: string | null;
  medicationAmount: number | null;
  medicationUnit: string | null;
  // Which meal slot completing this task logs to the food log, or null when
  // it logs nothing — "Log breakfast", "Pack lunch", any task whose own tick
  // is the moment a meal happened. Deliberately not a silent write like
  // logHealthMetric/medicationName above: an arbitrary task names no food and
  // no amount, so there's nothing to log yet, only an offer worth making.
  // completeTask raises the same manual-entry prompt (`pendingManualMealLog`)
  // a meal-plan task's own completion does (see offerMealLog), prefilled with
  // this slot and the task's title, rather than writing a FoodLogEntry
  // outright — see FoodLogEntrySheet.tsx.
  logMealSlot: LogMealSlot | null;
  // A saved meal (`SavedMeal`) completing this task logs straight to the food
  // log, in `logMealSlot`'s slot: "Metamucil" logs that you took Metamucil with
  // no sheet to answer. Null or absent means the offer above is all that
  // happens. Optional so a row or fixture from before it reads as off.
  //
  // Resolve-or-shrug, the same call `MealPlanEntry.recipeId` makes: a saved
  // meal that has since been deleted falls back to the manual offer rather than
  // logging nothing, so the tick is never silently a no-op. Each entry written
  // carries `FoodLogEntry.taskId`, and uncompleting the task takes them back.
  // Rides ...effective onto the next occurrence like logMealSlot does.
  logSavedMealId?: string | null;
  // When true, completing the task files its meal under the slot the clock
  // says (`slotForHour`) at the moment of completion, instead of the fixed
  // `logMealSlot`, which stays the fallback shown in the editor. For one task
  // done at different meals on different days (a supplement, a shake). Optional
  // so a row or fixture from before it reads as off. Rides ...effective onto the
  // next occurrence like logMealSlot does.
  logMealSlotByTime?: boolean;
  /**
   * The workout routine (`WorkoutRoutine.id`) this task is for: the row offers
   * "Start workout", which opens workout mode laid out from the routine, and
   * finishing that session completes this occurrence through `completeTask`
   * (docs/arch/workouts.md). The task owns *when* (its repeat, streak, coins);
   * the session owns *what happened*. Ticking the task off without a session
   * never invents one.
   *
   * Resolve-or-shrug like `logSavedMealId`: a routine deleted since reads as no
   * link, and the row offers nothing. Rides `...effective` onto the next
   * occurrence. Optional so a row or fixture from before it reads as unlinked.
   */
  workoutRoutineId?: string | null;
  /**
   * The workout program (`WorkoutProgram.id`) this task is for: the row's
   * "Workout" starts the program's next routine, worked out from its finished
   * sessions (`programProgress`), and finishing that session completes this
   * occurrence the way `workoutRoutineId`'s does. A task names a routine or a
   * program, never both; the editor and the MCP server clear the other.
   *
   * Resolve-or-shrug: a program deleted since, or one with nothing in its
   * rotation, offers nothing. Rides `...effective` onto the next occurrence.
   */
  workoutProgramId?: string | null;
  deferUntil: string | null;
  timeSegments: TimeOfDay[];
  windowStart: string | null; // "HH:MM" — task only becomes visible/active from this time on its day
  windowEnd: string | null;   // "HH:MM" — task expires (moves to Expired) after this time on its day
  /**
   * A window bound that follows the sun instead of the clock: "sunset",
   * "sunset-30", "sunrise+15" (see src/utils/sunTimes.ts). Null for a plain
   * clock time, which is every row written before this existed.
   *
   * **It overrides `windowStart`/`windowEnd` for that bound, and doesn't
   * replace them.** A reader resolves it for the day it's asking about through
   * `windowBoundsFor`, and the clock field keeps the time it resolved to when
   * it was set: that is what a reader with no day of its own, an older build on
   * another device, and a day the sun times can't be worked out (no location
   * saved, a polar day) all read instead. So anything writing the clock field
   * for a bound without naming its anchor clears the anchor (`updateTask`), or
   * the anchor would silently outrank the time just typed.
   */
  windowStartSun?: string | null;
  windowEndSun?: string | null;

  recurrenceType: RecurrenceType;
  // The count of days/weeks/months/years for every type but 'hours', which
  // reuses this same field to mean hours instead — "take medication every 8
  // hours after the last dose" is 8 here, not a separate column, since the
  // two meanings never coexist on one row (the type says which one applies).
  recurrenceInterval: number;
  recurrenceDays: number[];
  recurrenceMonthDay: number | null; // day of month (1-31) for monthly recurrence on a fixed schedule, -1 = last day of the month; null = same day as dueDate
  // Month (1-12) a yearly rule falls in, on a fixed schedule; null = whatever
  // month dueDate currently falls in (the picker's "same month as due date").
  // Monthly/weekly/daily/hours ignore this — there's no month for it to mean
  // anything against. Unlike recurrenceMonthDay it needs no anchor-day-style
  // clamp/restore pair: a month never gets clamped short the way Feb clamps a
  // day, so the stored value is read as-is by getNextYearDayOccurrence.
  recurrenceMonth: number | null;
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
  /**
   * The day the recurrence grid is measured from, when that is no longer
   * `dueDate` — null on every task that hasn't been pulled forward, which is
   * almost all of them.
   *
   * **`dueDate` does double duty**: it is both the date this occurrence sits on
   * and the anchor the whole future grid steps from (see the Recurrence section
   * in CLAUDE.md). Pushing an occurrence out doesn't have to disturb that —
   * `deferUntil` is a floor laid over the stored date, so the anchor survives.
   * Pulling one *forward* has no such option: the only way to make a task
   * surface on Wednesday is for its date to *be* Wednesday, since there is no
   * "un-hide" to pair with `deferUntil`'s hide. So the two directions genuinely
   * need different mechanisms, and this is the second one: move `dueDate`
   * honestly, and hand the grid its own anchor to keep stepping from.
   *
   * That split is why every reader of "what day is this on" is untouched by
   * this field. Only the recurrence engine consults it — `getNextDueDate`'s
   * base, the projection walk, and `recurrenceAnchorDayFor` — and everything
   * else keeps reading the real `dueDate`.
   *
   * **Cleared by any deliberate schedule edit.** Writing `dueDate` without
   * setting this in the same patch means "this is the schedule now", which is
   * what the editor's Date row does and what every successor does, so the rule
   * lives in `updateTask` rather than at each call site.
   */
  recurrenceAnchorDate: string | null;
  recurrenceEndDate: string | null;
  recurrenceCount: number | null; // occurrences remaining (including this one); null = unlimited
  recurrenceFromCompletion: boolean;
  /**
   * What the next occurrence does when the rule lands it on a holiday
   * (`src/utils/holidays.ts`: the set chosen in Settings plus the user's own
   * days off). `'skip'` drops it for the rule's following date; `'move'` puts
   * it on the next day that isn't one, the way a trash pickup slides a day
   * after a holiday. Null, as on every row written before this existed, is
   * "happens anyway".
   *
   * Applied where the engine produces a date (`getNextOccurrence`), so the
   * successor, a skip and the month grid all agree. A move keeps the rule's
   * own date in `recurrenceAnchorDate`, the pull-forward mechanism, so one
   * moved occurrence doesn't drag the rest of the schedule with it. The
   * occurrence the user dated themselves is never moved: this governs the
   * dates the rule picks.
   */
  recurrenceHolidays?: HolidayRule | null;

  // Quota — a habit logged N times a day (8 glasses of water) rather than done
  // once. Deliberately not N tasks, N subtasks, or N taps on an ever-present
  // row: a quota task is *hidden from Today while you're on pace* (see
  // isQuotaOnPace in visibilityUtils) and only surfaces when you fall behind,
  // so a day you keep up with produces no feed rows at all — unless
  // quotaAlwaysVisible opts it out of that hide. Reaching
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

  // How often one unit falls due, in minutes. The interval and the count are
  // the same triangle read from different corners — a span divided by one
  // gives the other — and which one is *stored* decides what stays fixed when
  // the span moves. Storing the count keeps "24 a day" and squeezes the
  // spacing; storing the interval keeps "every 20 minutes" and takes fewer of
  // them. For anything the user actually thinks of as a cadence (an eye break
  // every 20 minutes, standing up every half hour) the second is what they
  // mean, and it's the only one that survives quotaStartedAt moving the start
  // (see quotaRunSpan in src/utils/quotaSchedule.ts).
  //
  // So when this is set, `targetCount` is *derived* from it and the run's
  // span, recomputed wherever either changes (see QUOTA_SPAN_FIELDS in
  // useTaskStore) rather than typed. Every existing reader keeps reading
  // targetCount and needs to know nothing about this column — the same call
  // recurrenceAnchorDate makes about staying inside the recurrence engine.
  //
  // null = the count is the primitive, which is every quota task that predates
  // this and every one whose target is a real goal ("8 glasses") rather than
  // arithmetic.
  quotaIntervalMinutes: number | null;
  // Send a notification each time a unit falls due, instead of only surfacing
  // the row on Today.
  //
  // A quota has always paced silently, which is right for water (you'll see
  // the row when you next look at your phone) and useless for anything whose
  // whole point is to interrupt you — the row can't nudge you off a screen if
  // looking at the row means looking at a screen. Materialised as N one-shot
  // notifications for the reason src/utils/alarmChain.ts spells out at length:
  // the layer underneath only understands one fire at one time.
  //
  // Independent of quotaIntervalMinutes on purpose. A cadence you don't want
  // to be nudged about is a real thing to ask for, and so is being nudged
  // about a plain count.
  quotaReminders: boolean;
  // Saved places (`SavedPlace.id`) the reminders above are limited to; empty or
  // absent = anywhere. See src/utils/placeGate.ts: the app never reads location
  // in the background, so "at" means the last foreground fix, and a reminder is
  // only scheduled while that fix is recent and inside one of these places.
  quotaPlaceIds?: string[];
  // When today's run was started by hand, if it was — the "start now" that
  // makes a fixed window optional.
  //
  // Deliberately its own per-occurrence timestamp rather than a write to
  // windowStart: the window is the schedule and holds for every day, while
  // this is one morning that began at 10:30. It rides no successor
  // (completeTask clears it beside progressCount), so a run started late
  // today says nothing about tomorrow.
  //
  // Only honoured on its own logical day, so an app left closed over a
  // weekend doesn't resume Friday's run on Monday. null = the window decides.
  quotaStartedAt: string | null;
  // Opt-in: keeps the row on Today all day instead of hiding it while
  // isQuotaOnPace says you're keeping up. Right for a target with no
  // time-of-day expectation at all ("do this N times today, whenever") —
  // the pace ramp still runs and still gates isOnPaceQuota (see there), so
  // logging behaves exactly as before; only the disappear-while-ahead
  // behavior is switched off. Off by default, so an existing quota task
  // keeps hiding on pace exactly as it always has.
  quotaAlwaysVisible: boolean;
  // Opt-in, and only meaningful on a daily target that logs water
  // (`logHealthMetric: 'waterMl'`): `targetCount` is then derived each day from
  // the food log's own water target (plus the exercise boost, when today
  // qualifies) divided by `logHealthAmount`, instead of being a fixed number.
  // The task still stores a real `targetCount`, so every reader of a quota
  // (pace, progress, completion, Stats) needs no second path; what this adds
  // is a writer, `syncWaterQuotaTasks`. See `followedWaterTargetCount` in
  // src/utils/waterTargetUnits.ts. Off by default.
  followWaterTarget: boolean;
  /**
   * Opt-in, and only for a plain weekly target: once a log puts it on pace, the
   * row leaves Today for the rest of that logical day and is back at the next
   * day start, however far ahead of pace it still is. It replaces the pace
   * hide for this task (`quotaHidesWhenOnPace` says no), because that one waits
   * for the next unit to fall due, which for a target running ahead is days
   * away. A day with no log, or a log that leaves it behind pace, leaves the row
   * up. `quotaAlwaysVisible` still wins. See `quotaRestsForToday`.
   */
  quotaRestAfterLog?: boolean;
  /**
   * The logical day (`YYYY-MM-DD`) of the last unit logged on this occurrence,
   * which is what `quotaRestAfterLog` reads. Stamped by `logQuotaUnit`, cleared
   * by `unlogQuotaUnit`, and never carried onto a successor.
   */
  quotaLoggedDayKey?: string | null;
  /**
   * The instant of each unit logged on this occurrence, oldest first, so a count
   * of 1/5 can be traced to the tap that made it. Appended by `logQuotaUnit`
   * (capped at `QUOTA_TAP_HISTORY`), popped by `unlogQuotaUnit`, and reset on
   * every successor like `progressCount`. Display only: nothing reads it to
   * decide anything, and the count stays `progressCount`.
   */
  quotaTapTimes?: string[];

  /**
   * Further medicines this task records alongside `medicationName`, for things
   * taken together ("Iron + Vitamin C"): completing the task writes one dose per
   * entry, and unchecking it takes them all back. Meaningless without a primary
   * `medicationName`, which is still the switch, and read through
   * `medicationsFor` rather than directly. Not for a chain step, and not for a
   * daily or weekly target, whose unit logs record one dose each. See
   * `docs/arch/mood-log.md`.
   */
  medicationExtras?: TaskMedicationExtra[];

  /**
   * Photos and files kept with the task: a scan of a form, a photo of a part
   * to buy, a PDF. Each names a file in the `task-files` folder
   * (`src/utils/taskFiles.ts`), and the files travel between devices the way
   * recipe photos do. Carried onto the next occurrence like the notes, and
   * never deleted with the row (a delete can be undone): the launch sweep takes
   * a file once no task names it.
   */
  attachments?: TaskAttachment[];

  /**
   * The stretch of time the target is counted over: one logical day (every
   * quota that predates this field, and the default) or one logical week.
   *
   * `'week'` is what "three times a week, any days" is. It is deliberately not
   * a recurrence type, though that is where you would first look for it: a
   * recurrence answers "what date is next", and this has no next date to give —
   * any three days will do. What it has is a count and a period, which is a
   * quota, so it is one flag on the mechanism that already counts rather than a
   * sixth `RecurrenceType` the whole engine would have to learn.
   *
   * Everything that made a daily target work still works, because all of it
   * reads the *span* rather than the day: the pace ramp, the meter, the
   * completion that spawns the next occurrence. Only the span differs (see
   * `quotaWeekSpan`), which is the reason this is affordable at all. The one
   * exception is hide-while-ahead: a weekly target ahead of pace leaves Today
   * only for a later day, never for a later time today, so it stays up while
   * its next unit falls due today (`quotaHidesWhenOnPace`). The pace across a week is linear rather than following active hours
   * each day — by Wednesday lunchtime you are owed about half of it — because a
   * week-long ramp is answering "am I going to run out of week", and the hour
   * of the day doesn't change that answer.
   *
   * An interval quota is day-shaped and stays daily (the editor won't offer the
   * combination). `allowOvershoot` works on either period: a weekly one keeps
   * counting past the target and `sweepOvershootQuotas` closes it at the end
   * of the week.
   *
   * Pairs with weekly recurrence, which is what spawns next week's occupant.
   */
  quotaPeriod: QuotaPeriod;

  /**
   * Ramp up — a plain daily or weekly target that raises its own `targetCount`
   * ("add 1 after every 7 days you hit it, up to 20"). The rule is
   * `src/utils/quotaRamp.ts`; `completeTask` applies it when it spawns the next
   * occurrence. All four are optional and absent reads as off.
   *
   * `quotaRampStep` is the amount added (null/0 = no ramp). `quotaRampEvery` is
   * how many occurrences that met the target it takes, counted in the task's own
   * period (days, or weeks for a weekly target). `quotaRampGoal` is the ceiling
   * (null = climb to the app's maximum). `quotaRampHits` is the running count
   * toward the next step, and rides each successor.
   *
   * A missed or short occurrence neither steps nor resets it: the ramp waits.
   */
  quotaRampStep?: number | null;
  quotaRampEvery?: number | null;
  quotaRampGoal?: number | null;
  quotaRampHits?: number;

  /**
   * Rotation — the set of named things a quota is counting, when the units are
   * distinguishable from each other. Five languages to listen to once each per
   * week; four bathrooms; three instruments. Empty (the default) = an ordinary
   * quota, counting anonymously exactly as it always has.
   *
   * **A rotation is a quota whose units have names**, and that framing is the
   * whole implementation. When the row appears is the weekly quota's: it
   * leaves Today while you are on pace (`quotaHidesWhenOnPace`), and
   * `quotaAlwaysVisible` opts out as for any target. What is new is only that
   * logging asks *which*, and that the row can say which are left.
   *
   * So `targetCount` is **derived** from `rotationItems.length` (see
   * `derivedTargetCount` in useTaskStore, alongside the interval's own
   * derivation) rather than typed. Every existing reader — the meter, the pace
   * mark, the progress chip, `isQuotaPartial`, `rolloverQuotas` — keeps reading
   * `targetCount` and needs to know nothing about this column, which is the
   * same call `recurrenceAnchorDate` makes about staying inside the recurrence
   * engine, and the reason the feature is affordable at all.
   *
   * Order is the user's own and is never re-ranked: it is the order the picker
   * lists the remaining members in, and a set someone arranged by how much they
   * like each option should stay arranged that way.
   */
  /**
   * Whether this task is a rotation at all, held separately from the set.
   *
   * Exactly `chainEnabled`'s job and there for exactly its reason: the editor
   * derives the task's kind from its fields (`taskKindOf`), and a set is
   * empty for as long as it takes to type the first two names into it. Without
   * a flag to hold the kind, picking Rotation would compute a `targetCount` of
   * zero, read back as an ordinary task, and throw you out of the mode before
   * you could add anything to it.
   *
   * So the "a rotation needs two members" rule lives at *save* (and in
   * `isRotationTask`, for everything downstream), never in the kind — the same
   * split `chainEnabled` documents.
   */
  rotationEnabled: boolean;
  rotationItems: RotationItem[];
  /**
   * What has been logged in the *current* period, oldest first. Paired with
   * `rotationPeriodStart`, which says which period that is.
   *
   * `progressCount` stays the count and this stays the ledger. The invariant
   * held at the two write sites (`recordRotationPick` / `unlogRotationUnit`)
   * is that `progressCount` equals the number of *distinct* members in here,
   * not the number of entries: a member may be logged twice in a period and
   * the second one is a real listen but not a sixth language, so the ledger
   * can be longer than the count. See `rotationDoneCount`.
   *
   * The redundancy is deliberate and is what buys the paragraph above: every
   * reader that only needs "how many" keeps working untouched, and only the
   * handful that need "which" reach for this.
   */
  rotationLog: RotationLogEntry[];
  /**
   * The opening instant of the period `rotationLog` belongs to, or null when
   * nothing has been logged yet.
   *
   * A ledger from a period that has since closed is **ignored rather than
   * swept** — `activeRotationLog` compares this against the current period and
   * returns nothing when they differ. That is the same shape as
   * `quotaStartedAt` being "only honoured on its own logical day", and it is
   * what keeps this feature free of a maintenance pass: an app left closed for
   * a fortnight comes back to a clean week without anything having had to run
   * while it was shut.
   */
  rotationPeriodStart: string | null;
  /**
   * When each member was last logged, by member id, across every period this
   * task has ever had. Never reset.
   *
   * It exists because the ledger above resets weekly and so cannot answer "when
   * did I last do Portuguese", and because summing that back out of completed
   * occurrences would be wrong rather than merely slow: `completedRetentionDays`
   * is entitled to delete those rows, so a history derived from them quietly
   * loses weeks. Same reasoning that keeps `streakCount` on the live row rather
   * than counting the chain.
   *
   * **It says when, and nothing else.** The picker shows "Last done 3 weeks
   * ago" beside a member and stops there. Naming the pattern — calling someone
   * avoidant, ranking their languages by neglect — is the line `people.md` and
   * `mood-log.md` both hold, and a feature that watches which of five things
   * you keep skipping is close enough to it to say so here.
   */
  rotationLastDone: Record<string, string>;
  /**
   * The member chosen for a day ahead of doing it: `{ itemId, dayKey }`, or
   * null when nothing is planned. A plan is **a note about one logical day and
   * nothing else**. It never hides, holds or completes anything on its own;
   * the row reads it (`plannedRotationItem`) to offer a one-tap log of that
   * member, and logging any pick on that day spends it. A plan whose `dayKey`
   * is not today is ignored rather than swept, the same rule the ledger follows
   * (`activeRotationLog`), so no maintenance pass has to clear it.
   */
  rotationPlan: { itemId: string; dayKey: string } | null;

  // Supply — how many units of a consumable are left, for a recurring task
  // that spends one every time it's done. Replacing a CPAP filter monthly out
  // of a box of six is the shape: the schedule says when, and this says how
  // many times that can still happen before something has to be bought.
  //
  // **The app is the meter, and that's the whole reason this isn't the
  // kitchen's job.** `probablyHaveReason` guesses what's in the cupboard from
  // how long ago it was bought, because nothing tells it when a bag of flour
  // gets used. Here the app *is* what records each use — a completion is a
  // unit gone — so the count is exact rather than a decaying guess, and it
  // works for the things the grocery side can't model at all (filters, lens
  // solution, printer toner, the dog's flea treatment).
  //
  // Requires a recurrence to mean anything, the same way `targetCount`
  // requires a daily one: the count rides onto the successor `completeTask`
  // spawns (like `recurrenceCount` and the streak), so a task that spawns no
  // successor has nowhere to put the decrement. The editor only offers the
  // card on a repeating task.
  //
  // null = not a supply task, which is every task that has never been given
  // one. 0 is a real value and means you have run out.
  supplyCount: number | null;
  // What the units are, e.g. "filters" — free text, optional, shown beside the
  // number ("3 filters left"). Exactly `targetUnit`'s job for exactly
  // `targetUnit`'s reason: the unit doesn't have to live in the title, and
  // nothing pluralises it (see src/utils/quotaUnit.ts, whose formatter this
  // reuses). null = show the bare count.
  supplyUnit: string | null;
  // How many arrive when you restock — "a box of six". Optional, and it earns
  // its column three times over: it defaults the number the reorder task asks
  // for (so topping back up is one tap rather than a keypad), it's what a
  // linked grocery purchase restores the count to, and it is the one number
  // that makes "3 left" legible as a fraction of anything. null = the app has
  // no idea what a pack holds, and asks with an empty field.
  supplyRefillCount: number | null;
  // Ask for more once the count drops to this. 1 by default — "tell me when
  // I'm on my last one" — never 0, because a reorder task that arrives the day
  // you run out is a reorder task that arrived too late.
  //
  // Deliberately a *count* rather than only the lead time below, because a
  // task whose next date can't be projected (`recurrenceFromCompletion`, a
  // live chain — see `canProject`) has no run-out day to work back from, and
  // the count is the only trigger such a task can have.
  supplyReorderAt: number;
  // How many days it takes to get more, or null when the user hasn't said.
  //
  // **This is the trigger that's actually right, where it can be computed.**
  // A count threshold assumes every task burns its supply at the same speed:
  // "two left" is two months of runway on a monthly filter change and two days
  // on a daily pill, and only one of those leaves time for a delivery. With a
  // lead time and a projectable schedule the app works backwards from the day
  // the supply runs out instead — see `supplyRunOutDate` — and asks on the day
  // that still leaves time. Both triggers are live at once and whichever fires
  // first wins, so setting this never makes the app *quieter* than the count
  // alone would have been.
  supplyLeadDays: number | null;
  // The count this task's reorder offer was last turned down at, or null if it
  // hasn't been.
  //
  // The self-spending decline stamp, modelled on
  // `GroceryItem.pantryCheckDeclinedAt` and spent against the same kind of
  // thing: not the day (an order you've already placed shouldn't be asked
  // about again tomorrow), but the state that made the question worth asking.
  // The gate is `supplyCount > supplyDeclinedAtCount`, so while the count only
  // ever falls — which is all completing a task can do to it — the question
  // stays answered.
  //
  // **Cleared whenever the count rises**, in `updateTask` and nowhere else.
  // Without that, a stamp written at 1 would silence the offer at 1 again
  // after the next restock, and every restock after that: the suppression
  // would outlive the thing it was about. See the note there for why it keys
  // on the value rising rather than on the field being written.
  supplyDeclinedAtCount: number | null;
  // The grocery catalog row this supply is stocked from, or null for a supply
  // bought anywhere else.
  //
  // The one bridge between the two halves of the app, and deliberately a
  // pointer rather than a copy: a linked supply has no separate inventory
  // number of its own to drift out of step with the catalog, it just knows
  // which row to put on the shopping list when it gets low. See
  // src/utils/supply.ts for what linking actually changes (the item goes on
  // the list, the reorder task links to the list instead of a URL, and buying
  // it tops the count back up to `supplyRefillCount`).
  supplyGroceryItemId: string | null;

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

  /**
   * Which Backfill fields (see `src/utils/fieldBackfill.ts`) this task has
   * been told to stop asking about — "this one genuinely doesn't need a time
   * estimate", not "not right now". Holds `BackfillFieldId` values as plain
   * strings, since a `Task` field can't depend on a type from `src/utils`.
   * An id the user never actually skipped just means it hasn't been asked.
   */
  backfillDismissedFields: string[];

  reminderTime: string | null; // ISO datetime for scheduled notification
  // 'alarm' rings as a native iOS system alarm (AlarmKit, iOS 26+) instead of
  // a plain notification; falls back to 'notification' wherever AlarmKit is
  // unavailable. Ignored when reminderTime is null.
  reminderKind: ReminderKind;
  // Alternative to a fixed reminderTime, the same way deadlineOffsetDays is to
  // a fixed deadline: when set, reminderTime is recomputed as this many days
  // before dueDate (at reminderTime's own time-of-day) on every future
  // occurrence — buildSeriesRow, completeTask's successor, skipNextRecurrence.
  // Only meaningful (and only editable) when dueDate is set. Null keeps
  // today's behaviour: a reminder that just tracks the due date's own day.
  reminderOffsetDays: number | null;

  // The other alternative to a fixed reminderTime, mutually exclusive with
  // reminderOffsetDays: when true, reminderTime is recomputed as the exact
  // moment getVisibleAt() (src/utils/visibilityUtils.ts) says this task next
  // surfaces — the same function that orders the Later screen — rather than
  // as an offset from dueDate. "Remind me the moment this comes off snooze"
  // or "remind me right when the evening segment opens". Only meaningful
  // (and only editable) when the task has something to become visible
  // *from*: deferUntil is set or timeSegments is non-empty, mirroring how
  // reminderOffsetDays is gated on dueDate. Recomputed at completion,
  // skip-recurrence and series-reanchor time exactly where reminderOffsetDays
  // is, plus periodically by reanchorWallClockReminders (useTaskStore.ts)
  // since — unlike an offset, which only changes when dueDate moves —
  // getVisibleAt's own answer can change on its own as a defer date arrives
  // or a time-of-day threshold passes. No numeric parameter, since there's
  // nothing to count: false keeps today's behaviour.
  reminderTracksVisibility: boolean;

  // Whether reminderTime means "this wall-clock reading, wherever the device
  // currently is" ('wallClock', the default) or "this exact fixed instant,
  // never touched" ('fixed'). A task/habit app's "9am" overwhelmingly means
  // 9am local time wherever you happen to be, not a UTC instant that drifts
  // to noon after a flight — so wallClock reminders are recomputed on every
  // foreground/launch (see reanchorWallClockReminders in useTaskStore.ts) to
  // track the device's current timezone. Fixed reminders are left alone.
  // See #1205.
  reminderTimeAnchor: 'wallClock' | 'fixed';
  /**
   * A reminder at a place rather than a time: the saved place's id
   * (`SavedPlace.id`, Settings › Calendar › Places) and whether it rings on
   * arriving there or on leaving. The system watches the place, so the app
   * never reads a location in the background (`src/utils/placeReminders.ts`).
   * Independent of `reminderTime`: a task can have either or both. Optional so
   * a row from before this reads as having none.
   */
  reminderPlaceId?: string | null;
  reminderPlaceOn?: 'arrive' | 'leave' | null;

  // UTC offset in minutes (Date.getTimezoneOffset()) captured from
  // reminderTime's own moment the last time reminderTime was set — not from
  // `new Date()`, because a reminder that crosses a DST boundary before it
  // fires should still remember the offset that was in effect for its own
  // target date/time. Used to detect a timezone change and undo it. Null
  // whenever reminderTime is null, and meaningless (never read) when
  // reminderTimeAnchor is 'fixed'. See #1205.
  reminderUtcOffsetMinutes: number | null;

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

  // A physical place the task is about — an appointment's address, a venue.
  // Free text, not geocoded: nothing in the app plots it or opens it in Maps
  // (that's a real future reader, not a reason to hold this field back), so
  // it's stored exactly as read rather than validated into a shape a mapping
  // API would want. Distinct from linkUrl and phoneNumber for the reason
  // those two are distinct from each other — a different kind of task action
  // gets its own field rather than overloading one that already has a
  // meaning.
  location: string | null;

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
  // Started as a single id on the grounds that "waiting on" is one thing in
  // practice. It isn't always ("send invitations" waits on both the guest list
  // and the venue), so `blockedByIds` holds the rest and the task waits for
  // all of them. This stays the first, so everything written before the list
  // existed reads exactly as it did. Read the set through `blockerIdsOf`.
  //
  // Note a recurring blocker unblocks its waiter permanently: completing it
  // spawns a new row with a NEW id, so this keeps pointing at the completed
  // original. That's intended — "wait for trash day to happen once".
  blockedById: string | null;
  /**
   * The tasks this one waits on beyond `blockedById`, and it waits for every
   * one of them. Empty on almost every task. Never holds `blockedById` itself,
   * and never has entries while `blockedById` is null (see `blockerFields`,
   * the one writer that keeps both halves in step).
   *
   * Optional so a row built before the field existed still type-checks; every
   * reader goes through `blockerIdsOf`, which treats a missing list as empty.
   */
  blockedByIds?: string[];
  /**
   * Hold this task until a repeating blocker has finished its *last*
   * occurrence, not just the one it points at. Completing a repeating task
   * spawns a successor with a new id, so without this the wait ends at the
   * first completion. With it, a blocker that is done but has a live successor
   * (`previousOccurrenceId`) still holds, and the hold ends when the series
   * does (a count or end date runs out, or the successor is archived or
   * deleted). Derived at read time by `isBlocked`, never stored per occurrence.
   * A blocker that repeats with no end never releases the task.
   */
  waitForSeriesEnd?: boolean;

  /**
   * Shown only if another task's question gets one of these answers: "Book
   * City Hall" only if "Ceremony format?" is answered "City Hall". Null on
   * almost every task.
   *
   * Until the question is answered the task waits on it exactly as it would
   * on a blocker. Once it is, the task is either free (a listed answer) or
   * *not needed* (any other), and a not-needed task is off every list and out
   * of its project's count. Both are derived from the question's row, never
   * stored, so correcting an answer swaps the branches back by itself; the
   * rules, including how "not needed" spreads to tasks that only wait on it,
   * are `isNotNeeded` in `src/utils/blocking.ts`.
   *
   * Only a 'choice' or 'yesno' question can gate, since those are the ones
   * whose answers are a fixed set to pick from.
   *
   * Optional so a row built before the field existed still type-checks.
   */
  answerGate?: AnswerGate | null;

  /**
   * Somebody you are waiting on — "Waiting on Gideon to send the photos"
   * (#2087). Null on every ordinary task.
   *
   * The same shape as `blockedById` with a person on the other end, and it
   * hides the task from the daily lists the same way, so it inherits the
   * Waiting screen. Resolve-or-shrug like every pointer in the people layer: a
   * deleted or archived person frees their waiters rather than stranding them,
   * exactly as `canBlock` frees the waiters of a completed or archived blocker
   * task. That is what makes a cascade unnecessary on either delete.
   *
   * **The one real difference is that nothing ends it on its own.** A task
   * blocked on a task frees itself when the blocker completes; nobody
   * completes a person, so this is cleared by hand and by nothing else. That is
   * why the clearing action sits on the row itself and on the Waiting screen
   * rather than only in the editor — a hidden task with no obvious way back is
   * how this becomes a way to lose one.
   *
   * Independent of `personIds`, which says a task is *with* somebody. Waiting
   * on Gideon for the photos is not time spent with Gideon, and it must never
   * land in his history.
   */
  waitingOnPersonId: string | null;

  /**
   * When `waitingOnPersonId` was last set — ISO, or null while the task isn't
   * waiting on anybody. Stamped by `updateTask` on the transition (null/a
   * different person → this one), the same "derived on the edit, not asked
   * for" shape `driftingSince` uses beside `postponeCount`. What it's for:
   * `waitingFollowUp` (see `src/utils/waitingFollowUpTasks.ts`) reads it to
   * offer "Follow up with X about Y" once a wait has gone on long enough,
   * which nothing before this could answer — there was no record of when a
   * wait started, only that one was happening.
   */
  waitingOnPersonSince: string | null;

  /**
   * "Not now" on the `waitingFollowUp` nudge this task's own wait produced —
   * ISO, or null. A self-expiring stamp like `Project.reviewDeclinedAt`,
   * spent against `WAITING_FOLLOW_UP_DECLINE_DAYS` rather than the day: a
   * nudge about somebody you're waiting on returning tomorrow morning reads
   * as the app disagreeing with you about the wait, the same reasoning
   * `Person.reachOutDeclinedAt` gives for its own week-long hold. Cleared
   * whenever `waitingOnPersonId` changes, since a decline about one wait
   * says nothing about the next.
   */
  waitingFollowUpDeclinedAt: string | null;

  /**
   * When to follow up on this wait — a day key ("YYYY-MM-DD"), or null to
   * leave it to `WAITING_FOLLOW_UP_THRESHOLD_DAYS`. Set beside
   * `waitingOnPersonId` in the editor ("chase the contractor Friday"), and
   * deliberately its own field rather than the task's `dueDate`: the task's
   * date is when the task is due, and reading it as the follow-up day made an
   * overdue task ask straight away the moment it started waiting. A date set
   * here always gets its follow-up, whether or not the generator's setting is
   * on and past its cap of two, because it was asked for. Cleared when the
   * wait ends or moves to somebody else, like the stamps above.
   */
  followUpOn?: string | null;

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
  /**
   * Why that answer was given ("under 20 guests, no venue deposit"), and what
   * would reopen it ("guest list goes over 25"). Optional text recorded with
   * the answer, in the prompt that asks for it, and edited wherever the
   * answer is. Null on almost every row.
   *
   * On the answer rather than in `notes`, for the reason `deliverableValue`
   * gives and one more: notes are what you need to know to *do* the task,
   * and this is what was decided by doing it. Per-occurrence for the same
   * reason too, so a recurring decision's Logbook keeps each answer's own
   * reasoning. Nothing evaluates "revisit if": it is free text for a reader,
   * a person scanning Decisions or Claude reading `get_project`.
   *
   * Optional so a row built before the fields existed still type-checks.
   */
  deliverableWhy?: string | null;
  deliverableRevisitIf?: string | null;
  /**
   * The options a 'choice' question offers, in the order they're shown.
   * Ignored for every other kind ('yesno' has its own two). Rides to the next
   * occurrence with the kind, since both are the question. Read through
   * `deliverableOptionsFor`.
   */
  deliverableOptions?: string[];
  /**
   * A 'date' answer that also becomes the project's departure (`awayStart`):
   * "Pick dates for Lisbon" answered with the 14th makes the trip leave on the
   * 14th. Opt-in per task, written in `completeTask` and nowhere else, and it
   * never overwrites a departure the project already has. See
   * `src/utils/deliverables.ts` for the terms a second destination has to meet.
   */
  deliverableSetsAway?: boolean;

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
  // generatedSourceId is null only for a generator with nothing at all to
  // point at. mealPlanNudge and calendarReview instead carry a day key — a
  // square on the calendar, not a row (see generatedTasks.ts).
  generatedKind: GeneratedKind | null;
  generatedSourceId: string | null;
  /**
   * When the thing this generated task asks for was seen to be done: the food
   * was logged, the item restocked, the goal reached. The row stays and reads
   * ready (`circleReady`) so the person ticks it and the coins are theirs; a
   * sweep that used to delete or complete it for them sets this instead. Only
   * a generator that finds the reason wanted again clears it. Display only: it
   * gates nothing, and null on every other task.
   */
  generatedReadyAt?: string | null;

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
  //
  // **This device's, and it doesn't sync, like the two below** (#2950): an
  // EventKit id names a record on one phone (`SYNC_DEVICE_LOCAL_COLUMNS` in
  // db/syncTracking.ts says how each of the three went wrong on the wire).
  // Each device holds the id of the event *it* wrote, and a peer's edit to the
  // task leaves it alone. The event itself still follows that edit: the reload
  // after a sync rewrites it, or deletes it when the peer completed or deleted
  // the task (`reconcileSyncedEvents` in useTaskStore, with the rules in
  // `taskEventsAfterSync`). A task with no event here gets none from a sync.
  calendarEventId: string | null;

  // The calendar server's id for the deadline event above
  // (`calendarItemExternalIdentifier`), read back after every write, or null
  // until one is (#2950). Only read when calendarEventId no longer resolves: a
  // backup restored on a new phone carries the old phone's local ids, which
  // name nothing there, so the event is looked up by this before a fresh one is
  // written beside it (`writeAllDayEvent` in utils/calendarEventLink.ts).
  // Device-local in sync and kept in backups, exactly like calendarEventId.
  // Optional so a row or fixture from before it reads as null.
  calendarEventExternalId?: string | null;

  // The id of the one-shot event logging this task's completion, or null when
  // logCompletionToCalendar is off, no calendar is picked, or the write
  // hasn't happened (yet, or ever). Resolve-or-shrug like calendarEventId
  // above, but with one key difference: this is written **once**, at
  // completion time, and never reconciled or rewritten afterward — it's a
  // historical record of what happened, not a live mirror of current task
  // state, so nothing here goes stale the way a moved deadline would leave
  // calendarEventId's event pointing at the wrong day.
  //
  // On uncomplete, if this is set, the device event is deleted and this is
  // cleared — un-completing the task means the thing the event recorded
  // didn't actually happen, so there's nothing left for it to log. That
  // includes an uncomplete on another device (#2950): this id stays on the
  // device that wrote the event, so the reload after the sync does the same
  // delete here (`taskEventsAfterSync`'s `uncompleted`).
  completionCalendarEventId: string | null;

  // The calendar server's id for the completion event above, read back after
  // it is written, or null until one is (#2950). Read only when uncompleting
  // deletes the event and the id above names nothing here, which is every
  // completion event on a phone a backup was restored to: without it, the
  // reopened task's "completed" event stayed on the calendar
  // (`deleteLinkedEvent` in utils/calendarEventLink.ts). Cleared with the id
  // above, device-local and kept in backups like it. Optional so a row or
  // fixture from before it reads as null.
  completionCalendarEventExternalId?: string | null;

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
  // start — see timeBlockUpdateFor in timeBlock.ts for exactly what a
  // reconcile touches.
  //
  // Never written except through the system event sheet, which is also the
  // only thing that deletes one: this app has no call site for
  // deleteEventAsync on a block, because the block is a commitment the user
  // made in their own calendar and may have shared with other people. A task
  // completed, deleted or spawned into its next occurrence leaves the event
  // alone. Resolve-or-shrug like every other cross-row pointer here.
  //
  // Device-local like calendarEventId (#2950), and a peer's rename or new
  // estimate reaches the block the same way, through the reload after a sync:
  // the title and the length, never the start, and a task deleted on another
  // device still leaves its block where it is.
  timeBlockEventId: string | null;

  // The calendar server's id for the block above (`calendarItemExternalIdentifier`),
  // read after the sheet saves it and again by any reconcile that finds it
  // missing, or null until one is (#2950). Read only when timeBlockEventId no
  // longer resolves, which a backup restored on a new phone leaves every
  // block with: the task finds its block by this instead of forgetting it
  // (`adoptTimeBlock` in useTaskStore). Device-local and kept in backups, like
  // the id beside it. Optional so a row or fixture from before it reads as null.
  timeBlockExternalId?: string | null;

  /**
   * Which direction success runs in. 'positive' — do the thing — is every task
   * that predates this field and the default for every new one.
   *
   * A 'negative' task is a commitment *not* to do something, and it inverts
   * three rules rather than adding a fourth kind of row:
   *
   * - **It is never completed.** There is no tap that finishes "don't smoke",
   *   so `completeTask` refuses one (see the polarity guard there) and the row
   *   has no checkbox — it has a shield. Keeping it out of the completion path
   *   is what keeps `completedAt`, the Logbook, Stats and the recurrence engine
   *   free of special cases, the same trade quota tasks make by going *through*
   *   completion rather than around it.
   * - **It stays visible all day** (see isVisibleApartFromVacation), because
   *   the row is the reminder. A repeating one is there every day; one with no
   *   repeat covers a single day and is finished once it passes
   *   (`oneDayEndPatch`). A positive task earns its place by being undone;
   *   an avoid-task that vanished once you were doing well would be missing at
   *   exactly the moment it is useful.
   * - **Its streak counts clean days, not completions.** Nothing advances it on
   *   a tap; the day-rollover pass does (see `rolloverNegativeStreaks`), which
   *   is the one structural difference the feature actually costs. Tapping is
   *   the *failure* report, and it breaks the run.
   */
  polarity: Polarity;

  /**
   * How hard this is to make yourself do, which the time estimate can't say:
   * a two-minute phone call you dread and an hour of something you enjoy.
   * Only the coin rules read it (`difficultyMultiplier` in `rewards.ts`); it
   * scales the effort bucket's value and nothing else.
   *
   * - **Null is "never rated" and earns as 'normal' does**, so every task that
   *   existed before the field earns exactly what it did. It is kept apart
   *   from an explicit 'normal' because the backfill queue asks about the
   *   unrated ones, and a rating someone gave is an answer. Absent is null.
   * - **It is the person's own rating and nothing writes it on their behalf.**
   *   Inferring it from `postponeCount` would pay more for a task that waited,
   *   which is the one thing the bounty rules exist to refuse.
   * - **It carries to the next occurrence** (a `CONTENT_FIELD`), unlike a
   *   bounty: a call you dread this week is one you'll dread next week.
   */
  difficulty?: Difficulty | null;

  /**
   * Slips logged against a negative task on the day named by `slipDate`, and 0
   * on any other day.
   *
   * Deliberately not `progressCount`, though it counts taps the same way: that
   * field is read through `isQuotaTask` in a dozen places as progress *toward*
   * a target, and a slip is the opposite of progress. A negative task with a
   * target would then read as on-pace for smoking eight cigarettes.
   *
   * One field covers both shapes the issue asked for. A binary avoid-task
   * ("don't smoke") is one that goes 0 → 1 and stops mattering, since the
   * streak is already broken; a frequency-logged one ("count the cigarettes")
   * keeps incrementing, and the extra taps are the record. Nothing has to
   * choose between them up front, so there is no completion_type to set.
   *
   * Always read through `slipsToday()` rather than directly — the pair is a
   * count plus the day it belongs to, and the count alone is stale the moment
   * the day turns. That is the same discipline `streakDate` imposes on
   * `streakCount`, and it means a day that rolls over while the app is closed
   * reads correctly without the rollover pass having run.
   */
  slipCount: number;
  slipDate: string | null; // logical-day ISO string the slips above belong to

  /**
   * How many slips a day a negative task absorbs before one counts as a failure.
   * Slips inside it are still recorded in `slipCount`, but they leave the streak
   * alone and cost nothing (no app block, no coins); the slip after them does
   * what a first slip always did. Null or 0 is the original rule, where the
   * first slip fails the day, so every existing row reads exactly as before.
   *
   * It is configuration, so it is the person's to set and a draft may carry it
   * (unlike `slipCount`, which is what happened). Read through
   * `slipAllowanceOf()`, which clamps it to a whole number. Per day only: a
   * budget that spans days would need a second ledger beside the daily streak.
   */
  slipAllowance?: number | null;

  /**
   * How long the apps picked in Settings are blocked when this task is failed,
   * or null for the tasks — nearly all of them — that cost nothing.
   *
   * One field carries both the switch and the size, the way
   * `deadlineOffsetDays` does, because "blocking for no minutes" is not a state
   * worth being able to store. What counts as failing depends on the polarity
   * and is the whole of the difference between the two:
   *
   * - A **positive** task fails by still being incomplete when
   *   `penaltyCutoffTime` passes. It needs a `dueDate` to be late against, for
   *   the reason `isTaskExpired` needs one: a task with no day on it has no day
   *   to have missed.
   * - A **negative** task fails on every slip logged, with no cutoff involved —
   *   `logSlip` is already the failure report (see `polarity` above), so there
   *   is nothing to wait for and nothing to be idempotent about.
   *
   * Deliberately not a `blockMinutes`: `blockedById`, `isHeldBack` and
   * `blocking.ts` already mean one task waiting on another throughout this
   * codebase, and a second sense of the word in the same type is how a reader
   * ends up trusting the wrong one.
   */
  penaltyMinutes: number | null;

  /**
   * The time of day a positive task has to be done by, as "HH:mm", or null to
   * be judged at the end of its logical day.
   *
   * Scoped to this feature rather than being a time added to `deadline`, which
   * is documented above as informational and deliberately outside scheduling —
   * giving it an hour would put `deadlineCalendarSync`, the countdown and both
   * relative-deadline forms in scope of a question none of them asked. Read
   * through `penaltyCutoffAt()`, never directly: a time before `dayResetTime`
   * belongs to the *next* calendar day of the same logical one, so "01:00"
   * under a 02:00 reset is tomorrow morning's 01:00 and not a cutoff that
   * passed 23 hours ago.
   */
  penaltyCutoffTime: string | null;

  /**
   * When this occurrence's penalty was charged, or null while it still hasn't
   * been.
   *
   * Per-occurrence state like `progressCount` and `deliverableValue`, so it is
   * deliberately absent from CONTENT_FIELDS: a recurring task's successor is a
   * fresh row that has to be able to fail on its own day, and a scope:'series'
   * edit must not spread one morning's charge across every morning after it.
   *
   * It exists to make the sweep idempotent, which is the whole reason the
   * charge is recorded on the row rather than as a day key in settings — a day
   * key cannot tell two tasks missed on the same day apart, which is the
   * unbounded mistake `generatedTasks.ts` argues against at length. It is also
   * why completing a task late never clears it: the stamp records that the
   * cutoff passed with the task undone, and that stays true afterwards. What
   * finishing late *can* do is take the remaining block off — see
   * `penaltyCreditedAt` below, which is a separate stamp for exactly that
   * reason. The record and the consequence are two different things, and only
   * the second is refundable.
   */
  penaltyFiredAt: string | null;

  /**
   * When this row's charge was given back, or null while it still stands.
   *
   * Finishing a task you were charged for takes its own `penaltyMinutes` off
   * the block being served (`penaltyCreditFor` / `creditShieldUntil`). This is
   * the once-only stamp: without it, completing, undoing and completing again
   * would print minutes.
   *
   * Deliberately *not* cleared by uncompleting, which is the same call
   * `undoSlip` makes from the other side. A block already lifted is a
   * consequence that has been served, and taking it back would mean a record
   * correction re-imposing a block — punishing somebody for editing history
   * rather than for missing anything.
   *
   * Per-occurrence like `penaltyFiredAt`, and never copied onto a successor for
   * its reason: a fresh row has taken nothing from anybody and so has nothing
   * to give back.
   */
  penaltyCreditedAt: string | null;

  /**
   * Keep the apps picked in Settings blocked for as long as this task is
   * outstanding. The other direction from `penaltyMinutes` above: that one is
   * what failing costs afterwards, this one is what has to happen first.
   *
   * The block runs for no fixed time, because its length is the person's own
   * behaviour — "no YouTube before the morning walk" ends when the walk does.
   * That sounds like a way to be locked out of a phone indefinitely and isn't,
   * because two one-tap exits are always there: complete it, or move it to
   * another day. The friction is the whole feature; being trapped is not.
   *
   * **When it applies is `isTaskVisible`, not a clock of its own.** That is
   * what keeps "before my morning walk" from meaning 11pm the night before,
   * and it inherits every existing reason a task isn't yours to do yet — a
   * deferral, a time-of-day segment, vacation mode, waiting on another task or
   * a person. A gate that could be raised by a task the app itself was
   * withholding is the one outcome this must not have, and reusing the
   * visibility rule is what rules it out by construction rather than by a
   * list of exceptions somebody has to maintain (compare `penaltyChargeFor`,
   * which had to be handed that answer).
   *
   * Meaningless on a negative task, which is never completed and so would
   * block for ever — `isGateTask` refuses one rather than trusting the editor
   * to hide the row.
   */
  gatesApps: boolean;
  /**
   * The group of apps this gate holds (`appGroups.ts`), or null for the gate
   * setting's own group. Only read while `gatesApps` is on. An id that no
   * longer names a group reads as Default, as for every reason. Device-local:
   * group ids mean nothing on another phone (`SYNC_DEVICE_LOCAL_COLUMNS`).
   */
  gateGroupId?: string | null;

  // Streaks
  //
  // For a positive task these are consecutive completions, which is what they
  // have always been. For a negative one they are consecutive clean days, and
  // every field below means the run either way — which is why polarity is a
  // flag on the task rather than a second set of columns.
  streakCount: number;       // positive = N consecutive completions; negative = N clean days
  streakDate: string | null; // logical-day ISO string of last completion (positive) or last day counted (negative)

  // Snapshot of streakCount/streakDate from just before the current
  // completion, so uncompleting (e.g. from the Logbook) can restore the
  // streak to what it was rather than leaving the incremented value.
  previousStreakCount: number;
  previousStreakDate: string | null;

  /**
   * The longest run this task reached **before the current one** — the record
   * a live streak is measured against. Zero until a run has ended.
   *
   * Deliberately not the all-time best, which is what you would reach for
   * first and what makes the feature announce itself every day. A running
   * maximum is raised by the streak that is setting it, so "am I past my
   * record" is true again on every completion once you have passed it: pass 34
   * and day 35 beats 34, day 36 beats 35, for ever. Excluding the current run
   * is what makes overtaking happen exactly once, on the day it happens.
   *
   * The all-time figure is still what gets *shown*, and it is derived rather
   * than stored — `bestStreakOf` is max(this, streakCount), because a run in
   * progress that is past this is itself the record. `src/utils/streakRecord.ts`
   * owns all three reads and the fold.
   *
   * Folded only when a run ends, by the one rule in `nextStreakRecord`: the
   * streak going *down* is a run ending, whether that is a break to 0, a
   * gap restarting it at 1, or a manual reset. Rides onto the successor row
   * alongside streakCount, since the streak lives on whichever row is
   * currently running it.
   */
  priorBestStreak: number;

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

  // Opt-in per task, for a weekly target (quotaPeriod 'week'): the streak chip
  // counts every unit logged, as a running total, instead of the weeks in a row
  // the whole target was hit. A missed or short week costs nothing, since
  // there is no run to break. Inert on any other task, which is the only place
  // the editor offers it. See countsUnits in src/utils/streakUnits.ts.
  streakCountsUnits: boolean;

  // Opt-in per task, for a target (`targetCount`): coins are paid on every tap
  // instead of once when the target is reached. The occurrence's base coins
  // are split across the taps (`coinsForTap` in src/utils/rewards.ts), so the
  // total is the same either way and only the timing differs. The streak
  // bonus and a bounty ride the last tap, which is the completion. Inert
  // while rewards are off and on any task without a target.
  coinsPerTap: boolean;

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

  /**
   * Who this task involves — see `docs/arch/people.md`.
   *
   * An array on the row rather than a join table, unlike `grocery_item_shops`,
   * and the deciding argument is that rows get *copied* constantly here:
   * `completeTask` spreads `...effective` onto a recurrence successor,
   * `buildSeriesRow` materialises a date set, chains spawn steps, templates
   * instantiate. A JSON column rides every one of those for free. A join table
   * needs explicit copy logic at each, and the failure mode is silent — a
   * recurring "Sunday call with Mom" that quietly stops being about Mom at the
   * second occurrence. Same shape and same reasoning as `tags`.
   *
   * This is also the entire interaction history: a completed task carrying an
   * id *is* the record that something happened with that person, which is why
   * there is no interactions table. Reverse lookups go through
   * `peopleRegistry.ts`, never a scan.
   */
  personIds: string[];

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

  // "Follow-up task" — every Nth completion of this task adds a separate one-off
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
  // The rule is live only with both a count and a title: a follow-up task with
  // no name is a row nobody could act on, so `followUpTaskRule()` is what every
  // reader asks rather than testing the fields apart.
  followUpTaskEveryN: number | null; // null = off; >= 2 (every 1st is every time)
  followUpTaskTitle: string | null;  // title of the task to add
  // The rest of what the added task looks like, or null for "just the title"
  // — see FollowUpTaskDraft. Off the rule's own liveness check on purpose:
  // followUpTaskRule() needs a count and a name, and everything here is optional
  // detail on top of those.
  followUpTaskDraft: FollowUpTaskDraft | null;
  // Don't add another while one added by this rule is still outstanding.
  //
  // A property of the *rule* rather than of the task it adds, which is why it
  // sits here and not in FollowUpTaskDraft: it decides whether to spawn at all,
  // and says nothing about what the spawned row looks like.
  //
  // Off by default, so every rule written before this behaves exactly as it
  // did. Both readings are legitimate — a chore you either do or don't
  // (swapping wash cloths: a second row says nothing the first didn't), and a
  // count you're meant to keep up with (one row per set of five runs) — so
  // this is asked rather than assumed.
  followUpTaskOneAtATime: boolean;
  // The other trigger for the same rule: add the task once, when the repeat
  // runs out (the last of a counted repeat, or the first past its end date),
  // rather than every Nth completion. Exclusive with `followUpTaskEveryN`:
  // the editor clears one when the other is chosen, and `followUpTaskEndRule()`
  // is what the store asks, since it also needs an end to exist. Shares the
  // title and draft, because it is the same added task on a different trigger.
  followUpTaskAtEnd: boolean;
  followUpTaskTally: number;         // completions since the last one was added
  // Snapshot of followUpTaskTally from just before the current completion, so
  // uncompleting restores it — the same device previousStreakCount uses, and
  // for the same reason. It can't be derived after the fact: a tally of 0
  // reads identically whether the completion fired the rule and reset it or
  // never advanced it at all (a miss, or a mid-chain step).
  previousFollowUpTaskTally: number;
  // The spawning task's title, snapshotted at spawn time — what TaskItem's
  // "Extra · from X" chip reads. Null on every task that isn't one of
  // these. A snapshot rather than a pointer to the completed occurrence
  // that earned it: that row is exactly what completedRetentionDays
  // eventually purges, and previousOccurrenceId already exists for the
  // undo path that needs the live row. Same call the pending-suppression
  // match above makes, and for the same reason.
  followUpTaskSourceTitle: string | null;
  // A pointer, unlike the title above — but at the *rule's* current
  // occurrence rather than at the one that earned this task, which is the
  // row followUpTaskSourceTitle explicitly declined to point at. Stamped
  // with the successor's id the same completion spawns (nextTask.id in
  // buildCompletion), so it names whichever row is carrying
  // followUpTaskEveryN/followUpTaskTitle forward right now — what
  // TaskEditor's "Follow-up frequency" row resolves against, so the count
  // can be raised or lowered from here without leaving for the parent's own
  // editor.
  //
  // It goes stale the next time the parent completes again: every occurrence
  // is a fresh id, so a follow-up task left unopened across another cycle of
  // its parent points at a row that no longer carries the live rule. That
  // isn't corrected here — the id simply stops resolving to a task, and the
  // editor's shortcut quietly stops offering itself, the same "nothing to
  // show" a dangling blocker pointer already reads as elsewhere.
  followUpTaskSourceId: string | null;

  vacationPause: boolean;    // hide and protect streak while vacation mode is on

  // Keep this task out of suggested pins (see suggestPinTasks) and suggested
  // focus queues (see suggestFocusTasks). Only the suggesters honour it — the
  // task stays visible everywhere and can still be pinned or queued by hand.
  // Same naming convention and same mechanism as Category.excludeFromSuggestions,
  // one level down: a task in an otherwise ordinary category that's still bad
  // shortlist company (an open-ended "read more later", a standing chore that
  // outranks nothing). The two aren't mutually exclusive — a task's own category
  // being flagged already excludes it, and this flag reaches the tasks a whole
  // category isn't the right unit for.
  excludeFromSuggestions: boolean;

  // A one-off task that waits for a kind of day ("leave books on the curb on
  // the next sunny day"). While set, the weather pass owns `deferUntil` and
  // moves it to the first forecast day that matches; it clears this once that
  // day arrives. Null = not waiting. Only a plain one-off may wait (see
  // `canWaitForWeather`); a repeating task, chain step or series member never
  // carries it. See src/utils/weatherWait.ts.
  weatherWait?: WeatherCondition | null;

  // "If the day is full": true waits for a day that isn't (see
  // src/utils/slotIn.ts), false keeps the date, null has no answer and follows
  // the category's `slotIn`. The pass owns `deferUntil` while it holds one,
  // the same way the weather pass does.
  slotIn?: boolean | null;
  // The logical day the slot-in pass last decided this task, whether it held
  // it or let it through. Synced, so a second device doesn't decide the same
  // task again the same day. A hold is a `deferUntil` on the day after this
  // one; any other future defer is the user's own and is left alone.
  slotDecidedOn?: string | null;
  // The day this task was first meant for, stamped on its first hold. Orders
  // the waiting tasks (longest wait goes first) and is what the row's "Waiting
  // since" reads. Belongs to the occurrence: a successor starts without one.
  slotWaitingSince?: string | null;

  // On a recurring task: every occurrence it spawns starts pinned. Completing
  // a pinned task clears its pin and a successor is a new row that starts
  // unpinned, so without this the pin has to be redone by hand each time.
  // Does nothing on a task that doesn't repeat. Optional like the other
  // later additions, so a task built without it reads as off.
  pinEachOccurrence?: boolean;

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
  // Measured duration; null = never timed. Set by the stopwatch, or offered
  // from a focus session's own Done tap (FocusSessionSheet, gated by
  // focusMeasuredMinutes/measuredTimeAppliesTo so it only fires on a clock
  // reading that actually means something). Always equal to estimatedMinutes
  // once set — timing a task *is* how its estimate gets corrected (see
  // applyMeasuredTime), so this is not a second opinion about how long the
  // task takes. Its only remaining job is the "Timed" label on the expanded
  // task row and in the Logbook, which says the number was measured rather
  // than guessed.
  actualMinutes: number | null;

  // The estimate that stood when this task was timed, kept because
  // applyMeasuredTime is about to overwrite it (#2681). Null means never
  // timed, timed with no estimate to compare against, or timed again — a
  // second measurement is being compared to the first one rather than to a
  // guess, and that is not evidence about how somebody estimates.
  //
  // Read only in aggregate, by estimateCalibration.ts, and never shown against
  // the single task it came from: one task running long says nothing, and
  // saying it would turn a workload read into a judgement about the person.
  estimateBeforeTiming: number | null;

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

  // Health-target tasks ("walk 8,000 steps") — a number from Apple Health the
  // task reads as ready at. The exact shape `timedMinutes` above takes, for the
  // reason that field gives: readiness is *derived* against a live reading and
  // never stored, so a row that mounts after the app was killed shows the truth
  // rather than a stale flag. See utils/healthTarget.ts.
  //
  // **Reaching the target never completes the task.** It is the most tempting
  // place in the app to break that rule — the number is right there, and the
  // task plainly is done — and the worst, because a reading is a claim rather
  // than a statement: a watch left on the side, a walk with the phone in a bag.
  // Striking something off somebody's list on the strength of a guess about
  // their body, before they could disagree with it, is the outcome this must
  // not have. The checkbox stays a checkbox; the row only says "Ready".
  //
  // Deliberately not the quota fields, which look like the same idea and are
  // not: `progressCount` is stored state written by a tap, `logQuotaUnit`
  // auto-completes on reaching the target, and the pace ramp would nudge per
  // step. See docs/arch/health-data.md.
  healthMetric: HealthTargetMetric | null;  // null = not a health-target task
  healthTarget: number | null;              // in the metric's own unit: steps, hours, minutes or calories
  // For the three Activity-ring metrics only: read the target from the goal the
  // person set in Fitness instead of from `healthTarget`, which stays as what
  // is used until that goal has been read. False on every other task. See
  // `effectiveHealthTarget` in utils/healthTarget.ts.
  healthFollowGoal: boolean;

  // Optional reminder scheduled a fixed number of minutes after this task is
  // completed — "take the iron pill" -> "eat, 2 hours later". Null means the
  // task doesn't offer one. Purely a duration from the moment of completion,
  // unrelated to reminderTime (which fires before/at a task's own schedule).
  completionTimerMinutes: number | null;
  // Something that has to be done before this task can be checked off (20
  // pushups): ticking it opens the mission instead, and `completeTask` refuses
  // a completion the mission didn't make (a missed mark and "someone else did
  // it" claim nothing about the mission, so they still go through). Null or
  // absent = none. With an alarm reminder, the alarm rings back every 15
  // seconds after Stop until it's done. See src/utils/missions.ts.
  mission?: AlarmMission | null;
  // What an alarm reminder (reminderKind 'alarm' or 'persistent') rings
  // with: null for the system sound, a built-in tone, or `custom:<id>` for a
  // sound imported on one phone, which rings as the default on any other
  // device. See src/utils/alarmSounds.ts.
  alarmSound?: string | null;
  // Two or more sounds an alarm reminder picks between, one for each time it
  // is scheduled (a repeating task's next occurrence is a new row, so each gets
  // its own pick). Empty or absent = no pool, and `alarmSound` rings. See
  // `pickFromPool` in src/utils/alarmSounds.ts.
  alarmSoundPool?: string[];
  // The alarm a task like "Set alarm for morning" is about: 'next' for
  // whichever of the device's own alarms rings first tomorrow, or an alarm's
  // id. The row shows that alarm and opens a card to keep or change it. Alarms
  // are device-only, so an id from another phone reads as 'next'. Null = none.
  // See src/utils/morningAlarm.ts.
  alarmLink?: string | null;
  // Keeping or changing the linked alarm from the row's card checks the task
  // off, unless this is set.
  alarmLinkLeavesOpen?: boolean;
  // A template to run from this task: the row shows "Run <template>" and opens
  // the template's apply sheet, so its questions are answered when they can be
  // (a packing list before the trip is decided, say) rather than when the task
  // is made. Running it checks the task off. The id is a template's, which
  // syncs; a deleted template leaves the id in place and the row says so
  // instead of hiding the button. Null = none. See src/utils/templateLink.ts.
  templateId?: string | null;

  // Optional freeform text explaining what the completion timer reminder is
  // for — "Don't eat for 2 hours" — shown as the notification body instead of
  // the generic default. Null/empty falls back to that default.
  completionTimerNote: string | null;

  // Set the moment a completion timer starts (see completionTimerMinutes),
  // cleared once it's dismissed or the completion it followed is undone. Runtime
  // state, like timerStartedAt, not a seedable setting — read by
  // src/utils/liveActivity.ts to drive the countdown's Lock Screen/Dynamic
  // Island Live Activity, which runs alongside the notification rather than
  // replacing it.
  completionTimerStartedAt: string | null;

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
  // left to re-derive it from. The one thing that makes it stale is the task
  // being placed some other way (the editor's Date row, a swipe reschedule),
  // and mergeTaskUpdate clears it then, so every route is covered by one rule.
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

  /**
   * A bounty posted on this occurrence: how many times it has been pushed since
   * (see "Bounties" in utils/rewards.ts). Null for no bounty, which is every
   * existing row. Counts up from 0 on each push and stops at
   * BOUNTY_PUSHES_TO_EXPIRE, where it pays nothing; a withdrawn bounty is set
   * straight there, so it can't be reposted to restart the count.
   *
   * Its own count rather than a read of postponeCount, so a task already
   * pushed a dozen times can still be posted on at full value, and it never
   * resets on a pull back to today. Belongs to the occurrence like
   * postponeCount: a recurring task's next occurrence starts at null.
   */
  bountyPushes?: number | null;
}

// postponeCount/postponeMuted/driftingSince are omitted alongside the streak
// fields for the
// same reason: they're derived state the app maintains, not something a draft
// gets to assert. That makes newTaskFromDraft's hard-coded 0/false the only
// source, so a series row or a template application can't inherit a count.
// followUpTaskTally is the same kind of thing — the rule (followUpTaskEveryN,
// followUpTaskTitle) is the draft's to set, the progress toward it is not.
// One key per line, deliberately, and not to be re-joined. See the note on
// the settings load in useSettingsStore.ts: every runtime-only field added
// to Task is added here too, so one line is a guaranteed conflict between
// any two branches adding a field at once.
export type TaskDraft = Omit<
  Task,
  | 'id'
  | 'createdAt'
  | 'seenAt'
  | 'completed'
  | 'completedAt'
  | 'streakCount'
  | 'streakDate'
  | 'previousStreakCount'
  | 'previousStreakDate'
  | 'priorBestStreak'
  | 'slipCount'
  | 'slipDate'
  | 'penaltyFiredAt'
  | 'penaltyCreditedAt'
  | 'archived'
  | 'archivedAt'
  | 'postponeCount'
  | 'postponeMuted'
  | 'driftingSince'
  | 'bountyPushes'
  | 'waitingOnPersonSince'
  | 'waitingFollowUpDeclinedAt'
  | 'followUpTaskTally'
  | 'previousFollowUpTaskTally'
  | 'calendarEventId'
  | 'calendarEventExternalId'
  | 'completionCalendarEventId'
  | 'completionCalendarEventExternalId'
  | 'timeBlockEventId'
  | 'timeBlockExternalId'
  | 'backfillDismissedFields'
  // The set is configuration and a draft may carry it; the ledger, the period
  // stamp and the last-done memory are what a running rotation has recorded,
  // which is the same line the streak fields above are cut on.
  | 'rotationLog'
  | 'rotationPeriodStart'
  | 'rotationLastDone'
  | 'rotationPlan'
>;

export const PRIORITY_LABELS = ['None', 'Low', 'Medium', 'High', 'Urgent'] as const;
export const PRIORITY_COLORS = [
  'transparent',
  '#30D158',
  '#FFD60A',
  '#FF9F0A',
  '#FF453A',
] as const;


// Max length for any title-style input (task, subtask, chain step). Long titles
// are truncated with an ellipsis in the list, so cap input to keep them sane.
export const TITLE_MAX_LENGTH = 200;
