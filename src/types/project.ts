import type { TaskFieldDefaults } from './task';

// A themed, long-running collection of loosely-dated tasks the user tracks
// and picks off over time (e.g. "Summer Bucket List") — independent of
// TaskGroup (same-day cohorts), Category, and Tags, so a task can belong to
// all four at once. Unlike TaskGroup, a Project has its own optional
// deadline and can be browsed on its own even when nothing inside it is due
// today.
//
// It carries *two* end states, and they are independent: `completed` (finished,
// listed under Completed) and `archived` (filed away, out of the active list).
// Both are explicit flags the user sets, or that completeTask sets on their
// behalf when the autoCompleteProjectsOnDone setting is on. Neither is derived
// from the tasks — `projectProgress` answers "how far along", which is a
// different question, and deliberately never reaches 100% for a project holding
// a recurring member.
/** A link kept on a project page. `label` is optional; the page falls back to the host. */
export interface ProjectLink {
  id: string;
  label: string;
  url: string;
}

export interface Project {
  id: string;
  title: string;
  notes: string;
  /**
   * A target date to finish by. Informational, exactly like `Task.deadline`:
   * it is shown on the project's card, flagged once it passes (see
   * isProjectPastWindow) and affects nothing about scheduling or when any task
   * appears. It shares that field's name because it is the same idea one
   * container out, and shares its formatter (`formatDeadlineDate`).
   *
   * It replaced a `targetStartDate`/`targetEndDate` pair. The start half had
   * exactly one reader in its whole life — the "From Jun 1" side of the label
   * on the project card — so it gated nothing, sorted nothing, and reached
   * neither search, stats nor the widget. Two fields where one was decoration
   * read as a schedule the project did not have, which is what #1740 had to
   * add a paragraph of footer copy to deny.
   *
   * Still persisted in the `target_end_date` column, which is not renamed for
   * the same reason `cycle_items` and `exclude_from_pin_suggestions` aren't:
   * renaming one costs a data migration for every install and buys nothing a
   * comment can't say. `target_start_date` stays on the table too, unread and
   * never written, the way `task_groups.completed_at` does.
   */
  deadline: string | null;
  /**
   * The day the project is built around: the wedding, the move, the party.
   * Stored at noon, like `awayStart`. Null on almost every project.
   *
   * Deliberately separate from `deadline`, which means "finish by" and is
   * flagged once it passes. Work is planned on both sides of an event
   * (thank-you notes, changing your name), so an event used as a deadline
   * reads as overdue the day after it happens.
   *
   * What it does, so it isn't the decoration `targetStartDate` was (see
   * above): it is shown on the project, moving it offers to move the
   * project's dated tasks by the same number of days (`AwayShiftSheet`, the
   * offer a moved departure or deadline already makes), a template saved from
   * the project counts its days from it, and the MCP server can date a task
   * "60 days before the event". The offsets are not stored on the task, for
   * the reason docs/arch/away-dates.md gives for trip offsets.
   *
   * Optional so a row built before the field existed still type-checks.
   */
  eventDate?: string | null;
  // Name of a ProjectCategory, purely for grouping projects on the Projects
  // page. Independent of task Category — never affects the tasks inside the
  // project (their own categories, visibility, etc. are untouched).
  category: string | null;
  // Name of a (task) Category, deliberately a different pool from the field
  // just above. Every task created inside this project falls back to it —
  // ahead of Settings' own newTaskDefaults.category — when nothing more
  // specific names one: not the editor's own category field (a person typing
  // a category wins outright), not a template item's (same rule), and not a
  // quick-add `#tag` (parseCategoryAndTagsInput still resolves those first).
  // See newTaskFromDraft, the one place this is read.
  //
  // Null by default, the "nominated, never inferred" rule every opt-in field
  // on this type follows: a project gets no default until somebody names one,
  // the same as weekendSource starting off and destination starting blank.
  defaultTaskCategory: string | null;
  /**
   * Priority, difficulty and time estimate every new task in this project
   * starts with, so a list like a wish list doesn't put each item through the
   * backfill screen. Optional so a row built before the field existed still
   * type-checks; absent and null both mean no defaults. See `TaskFieldDefaults`
   * and `src/utils/taskFieldDefaults.ts`.
   */
  taskDefaults?: TaskFieldDefaults | null;
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
  // Never offer the "Mark Complete" banner, however many of its tasks are
  // done — a running list (groceries you keep restocking, a recurring
  // errand list) has no finish line to reach. Independent of `completed`:
  // manual completion through ProjectEditor still works exactly as it does
  // for any other project, this only silences the automatic offer.
  ongoing: boolean;
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
  // False keeps a project out of ANY nudge surface — the gone-quiet banner,
  // the auto-schedule drip, and even the manually-opened "Pull from projects"
  // sheet (see classifyProject in utils/projectPull.ts, which gates on this
  // ahead of every other rule, in both modes). A new project starts opted in
  // with no cadence ("When I ask", see createProject), so it answers the sheet
  // but never volunteers itself. A reference list like "Gift ideas" is
  // never going to want a due date; without this, the only way to keep it
  // quiet was nudgeCadenceDays === 0, which only silenced the unprompted
  // surfaces and still showed up the moment someone opened the Pull sheet.
  nudgeOptIn: boolean;
  // Opt-in: somewhere to look when the weekend nudge finds a bare weekend (see
  // utils/weekendTasks.ts). Off by default, and deliberately its own field
  // rather than a reading of the title: nothing may guess which of
  // somebody's projects are the fun ones. Separate from
  // nudgeOptIn above because they answer different questions — that one is
  // "chase me about this project", this one is "look here when I have a free
  // weekend", and a wishlist is a good answer to the second and a bad one to
  // the first.
  weekendSource: boolean;
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
  // When the user last told the pull sheet "nothing to pull" for this project
  // (ProjectPullSheet's "Nothing to pull, mark reviewed", reachable only from
  // the project's own review task — see reviewTaskId there). Unlike
  // reviewDeclinedAt above, this is a deliberate "I looked, there's genuinely
  // nothing" rather than a swiped-away "not today", so it means more than one
  // day of quiet: lastTouchedAt (utils/projectPull.ts) treats it as a touch,
  // the same way a member's completedAt is, so the quiet clock restarts from
  // here rather than from whatever was last completed. Without that, marking
  // a project reviewed only silenced it for the rest of the logical day
  // (projectsReviewedToday), and the very next sweep wrote an identical review
  // task back — a stalled project with nothing left to pull stays stalled by
  // definition, so "nothing to pull" only ever bought one day of quiet
  // instead of the project's own nudgeCadenceDays.
  reviewedAt: string | null;
  /**
   * Which Backfill fields (see `src/utils/projectBackfill.ts`) this project
   * has been told to stop asking about — same mechanism and same reasoning
   * as `Task.backfillDismissedFields`, holding `ProjectBackfillFieldId`
   * values as plain strings since a `Project` field can't depend on a type
   * from `src/utils`.
   */
  backfillDismissedFields: string[];
  /**
   * The day you leave, for a project that is a trip — and `awayEnd` below is
   * the day you are back. See `docs/arch/away-dates.md`, which is the design
   * these are the first slice of and is not optional reading before adding a
   * reader of them.
   *
   * They exist because four parts of the app already serve being away from
   * home and none of them can tell the others when the trip is:
   * `lookAhead`'s `{ start, cutoff, awayEnd }`, a template's two anchors,
   * `isAwayList` in groceries, and vacation mode. Two of those carry an
   * apology comment for the missing field — `LookAheadSheet` has to *ask*
   * when you get back, because `vacationStart` is stamped at switch-on and so
   * records when you went rather than when you are going, and
   * `applyTemplate` says of a run's start anchor that it "has nowhere to go
   * now that a project carries one date rather than a range".
   *
   * These change behaviour, so they are their own fields rather than a flag
   * on how the project is drawn — the same call `weekendSource` made, and for
   * the reason it gives.
   *
   * **This is not `targetStartDate` coming back.** That pair was deleted
   * because the start half had, across its whole life, one reader: half a
   * label. Departure is load-bearing in a way it never was — it is
   * `lookAhead`'s cutoff, and the day you leave is not a day you have. The
   * bar that deletion set is *readers*, and it is why nothing should ever add
   * a span here without them.
   *
   * **Both are stored at noon** (`awayNoonIso`), so a span entered at home
   * and read after a flight cannot move by a calendar day.
   *
   * **The span never blocks anything.** People do things on holiday, and a
   * reader that refuses a day inside it is worse than no span at all, because
   * then the trip stops being entered and every other reader loses its input.
   * It ranks, it never gates. Vacation mode is already opt-in per row
   * (`Task.vacationPause`, `Category.hideOnVacation`), and that stays the
   * only thing that hides anything.
   */
  awayStart: string | null;
  /**
   * The day you are back, or null for a departure with no return date yet.
   *
   * Deliberately not symmetric with `awayStart`: it is ignored unless there is
   * a start and it falls after it (see `awaySpanOf`), and a start without an
   * end is a legal, meaningful state rather than a half-filled form — exactly
   * `LookAheadWindow`'s own `awayEnd: null`, "a boundary but not a trip".
   *
   * The day itself is *not* away: containment is `start <= day < end`, so a
   * trip out on the 3rd and back on the 10th is seven nights, which is what
   * `templateQuestions.answerFromDates` already means by 'nights'.
   */
  awayEnd: string | null;
  /**
   * Opt-in: let this trip switch vacation mode on when you leave and off when
   * you are back.
   *
   * Nominated, never inferred, the call `weekendSource` makes and for its
   * reason — nothing may decide on its own that a project's dates are the ones
   * that should hide half your tasks. Separate from the dates themselves
   * because they answer different questions: `awayStart`/`awayEnd` are "when am
   * I gone", this is "and pause my tasks while I am", and entering a trip is
   * not a request for the second.
   *
   * **It does not hide anything by itself.** All it does is flip the existing
   * global switch, and what that switch hides is still only what the user has
   * already nominated per row (`Task.vacationPause`, `Category.hideOnVacation`).
   * So a trip with this on and nothing marked pauses nothing, which is correct:
   * the app's answer to "I still need to do things while away" is that you say
   * which things pause, and this changes only *when* that takes effect.
   *
   * Deliberately not set by a template run either. `TemplateSchedule` can fire
   * a run unattended, so a template that could set this could turn vacation
   * mode on with nobody having asked. See docs/arch/away-dates.md.
   */
  awayPauses: boolean;
  /**
   * The `awayStart` this project's vacation pause was last switched off for,
   * or null.
   *
   * The opt-out that had to be scoped to the *span* rather than to a day.
   * `reviewDeclinedAt` is a date because dismissing a review task means "not
   * today"; switching vacation mode off on day three of a seven-day trip means
   * "give me my tasks back for this trip", so a day-scoped stamp would re-arm
   * every morning and fight the user for the rest of the week.
   *
   * Holding the departure rather than a boolean is what makes it self-clearing:
   * moving the dates is a new trip in every sense that matters, and the stamp
   * stops matching.
   */
  awayPauseDeclinedFor: string | null;
  /**
   * The shopping list this trip buys from, or null.
   *
   * Groceries already has a list you are away from home for — `isAwayList()`,
   * whose whole meaning is that — but nothing connected it to *when*. So the
   * list was a manual switch at both ends of a trip, and the end that costs is
   * the one at the end: an away list records nothing (see `finishShopping`, no
   * purchase history, no price, no store link, no use-by), so a shop at home on
   * a list you forgot to switch off drops all of it silently.
   *
   * Nominated, never inferred — the `weekendSource` rule, one field over. A
   * project does not acquire a list because its name matches one, and a list
   * does not become a trip's because it was made during the trip.
   *
   * `checkAwayGroceryList` is what reads it. Storing the id rather than a flag
   * on `GroceryList` keeps the direction right: a trip has a list, a list does
   * not have a trip, and two projects can point at one list without the list
   * having to hold a set.
   */
  awayListId: string | null;
  /**
   * The `awayStart` this project's list switch was last undone for, or null.
   *
   * Exactly `awayPauseDeclinedFor`, for exactly its reason: switching back to
   * the home list on day three of a seven-day trip means "leave my lists
   * alone for this trip", not "not today", and a day-scoped stamp would put
   * you back on the trip's list on the next foreground. Holding the departure
   * is what makes it self-clearing when the dates move.
   */
  awayListDeclinedFor: string | null;
  /**
   * Paused until this day (a `YYYY-MM-DD` logical day key), or null. While
   * set and not yet reached, the project's tasks are held off Today and Later
   * and it's left out of every nudge, then it comes back on its own that day.
   * For "park the garden for winter": archiving leaves the repeating tasks on
   * Today (an archive files the project, not its tasks), and vacation mode is
   * app-wide. Its own field rather than a reading of `archived`, since a
   * paused project is still one you mean to come back to.
   */
  pausedUntil: string | null;
  /**
   * The people this project is with or for: the planner, the contractor, the
   * guests of honor. Shown on the project page, each opening the person.
   * Deliberately not copied onto new tasks: a project with a contractor on it
   * isn't a list of tasks involving the contractor, and `Task.personIds` is
   * where a task says who it's about.
   */
  personIds: string[];
  /** Links kept with the project (the booking, the shared doc), in order. */
  links: ProjectLink[];
  /**
   * Work the tasks in page order: Pull and auto-schedule offer only the first
   * open one, so "paint" never comes up before "patch the wall". Off by
   * default, where they offer whatever is best.
   */
  inOrder: boolean;
  /**
   * Leaves the "Next: ..." line off this project's card on the Projects
   * screen. Presentation only. Optional for rows built before it existed.
   */
  hideNextStep?: boolean;
  /**
   * Gathers what this project has on Today under its own name, at the top of
   * the Today view below the pinned block, rather than leaving its tasks and
   * stacks in their category sections (`buildTodayProjectBands`). A trip's
   * packing day is the case it exists for: its sections arrive as stacks,
   * and without it nothing on Today said they were one trip's. Presentation
   * only: what is on the day is decided exactly as before, and Later,
   * Unscheduled and Inbox ignore it. Optional for rows built before it existed.
   */
  groupOnToday?: boolean;
  /**
   * The project page draws its open tasks as a board: a column for the tasks in
   * no section and one per section, with cards dragged between them
   * (`src/utils/projectBoard.ts`). Presentation only: a card moved on the
   * board is written through the same store actions as a drag in the list, so
   * the two drawings never disagree. Optional for rows built before it existed.
   */
  boardView?: boolean;
  /**
   * The project is a list (a wish list, gift ideas, a bucket list): its
   * sections and loose rows are items to check off rather than tasks to
   * schedule, unless a section says otherwise (`TaskGroup.keepsTasks`). What
   * that changes is read through `src/utils/listMode.ts`, never off this field
   * directly, because a section's own setting can override it.
   *
   * Presentation and read-time rules only. Turning it on or off rewrites
   * nothing: not `ongoing`, not the nudge fields, not a single task. The List
   * project type this replaces (#3574) did rewrite them on every conversion,
   * which is half of why converting felt like a commitment. Items stay ordinary
   * tasks, so a dated one is on Today like any other. Optional for rows built
   * before it existed.
   */
  list?: boolean;
  /**
   * Where the trip goes, as free text.
   *
   * `Task.location` carries a note saying nothing in the app plots it and that
   * a real reader is a future thing. This is that reader: paired with the away
   * span it is enough to ask what the weather will be while you are there, which
   * is the one thing packing actually turns on. It also gives a trip template's
   * `{destination}` blank somewhere to live between runs.
   *
   * Free text, geocoded when a reader asks (see `src/services/geocode.ts`).
   * "Mum's" is a destination and is not a place any gazetteer knows, and a
   * field that only accepted what a geocoder recognised would refuse half the
   * trips people take.
   */
  destination: string | null;
  /**
   * Where `destination` geocoded to, kept so sunrise and sunset can follow the
   * trip (`tripSunLocationOn`): those are worked out synchronously in every
   * list pass, which can't wait on a request. Rounded like `sunLocation`.
   *
   * **A cache of the text, never a second answer to it.** Written only by the
   * trip page's own geocode, against the destination it asked about, and
   * cleared whenever the destination changes (`destinationPinFields`), so it
   * can't outlive the words it came from. Null for a place no geocoder knows
   * ("Mum's"), and until the page has looked it up; sun times then use home.
   */
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
}

// Fallback cadence for a project row written before the nudge columns existed,
// and the default for a newly created project. Never, deliberately: being asked
// about a project you haven't decided you want chasing is the annoying half of
// this feature, and it's the half you get without opting in. It used to default
// to two weeks so the feature wasn't inert on arrival.
export const DEFAULT_NUDGE_CADENCE_DAYS = 0;
