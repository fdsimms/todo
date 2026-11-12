import type { LogMealSlot } from './mealPlan';
import type { WeatherCondition } from './rules';
import type { ChainItem, DeliverableKind, Difficulty, Effort, HolidayRule, Polarity, Priority, QuotaPeriod, RecurrenceType, RotationItem, TimeOfDay } from './task';

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
//   'people' — any number of the people already added (#2090), written onto
//              personIds for every task the run creates. Its own kind rather
//              than a variant of 'choice': the answer set isn't a fixed,
//              author-typed list, it's whoever exists at apply time, and the
//              answer is a set rather than one of them — see
//              personIdsForAnswers in templateQuestions.ts.
export type TemplateQuestionKind = 'text' | 'number' | 'choice' | 'people';

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
  // 'choice' only: more than one answer may be picked. The run's answer is then
  // a JSON array of the picked options (the way a 'people' answer is a set of
  // ids), and a condition or variant naming any one of them matches. Still
  // starts on the first option, and at least one stays picked. See
  // `answerValues` in templateQuestions.ts.
  multiple?: boolean;
  // Show the destination's forecast for the run's dates under this question
  // ("What's the weather like?"). A sentence only: it never answers the
  // question, ticks anything or conditions an item. See docs/arch/away-dates.md.
  showForecast?: boolean;
}

/** A template item's answer gate: the item that asks, and the answers that show this one. See `TemplateItem.answerGate`. */
export interface TemplateAnswerGate {
  itemId: string;
  answers: string[];
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
  // Empty on a condition over a number question, which uses min/max instead.
  values: string[];
  // A number question has no fixed set of answers to tick, so a condition on
  // one is a range: the item matches when the answer is at least `min` and at
  // most `max` (both inclusive, either may be left off). "Longer than 4 days"
  // is `min: 5`. Neither set is inert, like an empty `values`. Ignored on a
  // condition over a choice question.
  min?: number;
  max?: number;
}

/**
 * A different title and/or notes for an item when one choice question has one
 * answer: "Pack {days / 2} shirts" for a laundry-access trip against
 * "Pack {days + 1} shirts" for one without, without keeping two items.
 *
 * Replaces, never merges: a field the variant leaves out (or blank) keeps the
 * item's own. Deliberately text only; everything else about the item (dates,
 * category, subtasks) is shared, since a variant that changed those would be a
 * second item under one name. The first variant matching the run's answers
 * wins, and one naming a deleted question or an answer that isn't given is
 * inert (resolve-or-shrug, like `TemplateItemCondition`).
 */
export interface TemplateItemVariant {
  questionId: string;
  /** The answer that selects this variant, compared exactly as a condition's values are. */
  answer: string;
  title?: string;
  notes?: string;
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
  // "HH:MM" the deadline closes at on its day, carried through like windowStart.
  // Meaningless without a deadlineOffsetDays, and dropped by the editor then.
  deadlineTime?: string | null;
  windowStart: string | null; // "HH:MM" — carried through unchanged, no date component
  windowEnd: string | null;   // "HH:MM"
  // Task.windowStartSun / windowEndSun, carried through unchanged beside the
  // clock fallback above. Optional so a template stored before them reads as
  // a plain clock window.
  windowStartSun?: string | null;
  windowEndSun?: string | null;
  // Task.linkUrl, seeded onto the task: a booking page, the form to fill in.
  // Optional so a template stored before it reads as having none.
  linkUrl?: string | null;
  // Task.location, seeded onto the task: the clinic, the venue. Optional for
  // the same reason as linkUrl.
  location?: string | null;
  // Minutes before the item's *resolved* due date. Only meaningful (and only
  // editable) when dueOffsetDays is set — there's no date to count back from
  // otherwise.
  reminderOffsetMinutes: number | null;
  timeSegments: TimeOfDay[];
  tags: string[];
  category: string | null;
  priority: Priority;
  effort: Effort;
  // Seeded onto the task this item creates, like every other behaviour toggle
  // here. A "quit smoking" template that could only produce positive tasks
  // would be a template that can't express the one thing it's for.
  polarity: Polarity;
  // Seeds Task.difficulty. Null (the default through normalizeTemplateItem,
  // which is also what stored JSON from before the field reads as) seeds an
  // unrated task.
  difficulty?: Difficulty | null;

  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  recurrenceDays: number[];
  recurrenceMonthDay: number | null;
  recurrenceMonth: number | null;
  recurrenceFromCompletion: boolean;
  // Task.recurrenceHolidays, carried through. Optional so a template stored
  // before it reads as happening anyway.
  recurrenceHolidays?: HolidayRule | null;
  recurrenceCount: number | null;
  // Seeds Task.recurrenceWeekOrdinal: "the 2nd Tuesday" on a monthly repeat
  // (1-4, or -1 for the last), read with recurrenceDays[0]. Optional, like the
  // other fields added after templates shipped: absent reads as null.
  recurrenceWeekOrdinal?: number | null;

  // Seed the counted-target fields of the same names: "8 glasses a day",
  // "3 runs a week". A routine is exactly where a target belongs, and without
  // these it had to be set on every task the template made. The interval form
  // (quotaIntervalMinutes) and the water link are not seeded; see
  // templateItemParity.test.ts for why.
  targetCount?: number | null;
  targetUnit?: string | null;
  quotaPeriod?: QuotaPeriod;
  // Task.quotaRampStep/Every/Goal, seeded: "push-ups, adding 2 every 3 days".
  // The running hit count is per task and never seeded.
  quotaRampStep?: number | null;
  quotaRampEvery?: number | null;
  quotaRampGoal?: number | null;
  allowOvershoot?: boolean;
  // Seeds Task.coinsPerTap.
  coinsPerTap?: boolean;
  quotaReminders?: boolean;

  // Seeds Task.chainStepOnSchedule: on a repeating chain, each step waits for
  // the next repeat rather than following the one before it straight away.
  chainStepOnSchedule?: boolean;

  // Seed Task.phoneNumber / emailAddress, siblings of linkUrl and location:
  // the clinic to call, the office to email.
  phoneNumber?: string | null;
  emailAddress?: string | null;

  /**
   * "Waits on" before there is a task: other items of this template that must
   * be done first. Named by item id, like `answerGate`, and turned into the
   * task's blockers (`blockerFields`) once those items are tasks. An item that
   * wasn't ticked, or isn't in this template, is dropped at apply time rather
   * than left as a blocker that names nothing.
   */
  blockedByItemIds?: string[];

  vacationPause: boolean;
  // Seeds Task.excludeFromSuggestions on the task this item creates. Same
  // parity as vacationPause above — a template item for a routine chore can
  // start its instances out of the suggesters without a follow-up trip to
  // the task's own editor.
  excludeFromSuggestions: boolean;
  // Seeds Task.weatherWait on the task this item creates: the task is held for
  // the first day with this kind of forecast. Null (the default through
  // normalizeTemplateItem, and what stored JSON from before the field reads as)
  // seeds a task that is not waiting. Only a plain one-off may wait, so an item
  // that repeats or is a chain seeds nothing (see canWaitForWeather).
  weatherWait?: WeatherCondition | null;
  // Seeds Task.slotIn on the task this item creates: true waits for a day
  // that isn't full, false keeps the date even in a category set to wait.
  // Null (the default, and what stored JSON from before the field reads as)
  // seeds no answer, so the task follows its category.
  slotIn?: boolean | null;
  // Seeds Task.pinEachOccurrence on the task this item creates.
  pinEachOccurrence?: boolean;
  // Weather gear: the kind of weather this item is for (an umbrella for rainy,
  // a warm coat for cold). The apply sheet starts it ticked when the destination
  // forecast has that weather during the run, and also whenever the forecast
  // can't say, and starts it unticked only when the forecast covers every day
  // and none has it. It replaces `optional` the way conditions do, and says why
  // on the row. Only where the item *starts*: the person can tick it either way.
  // See `weatherGearVerdict` in tripForecast.ts. Null (and absent) means none.
  weatherGear?: WeatherCondition | null;
  // Adds one subtask per medication you currently take, read from the
  // medication log when the template runs, after the item's own subtasks. The
  // list is never stored on the item: it is whatever "what you take" is on the
  // day of the run (`medicationVocabulary`, archived ones left out), so a
  // packing list stays right as medicines come and go. Absent reads as false.
  medicationChecklist?: boolean;
  estimatedMinutes: number | null;
  // Seeds Task.completionTimerMinutes — a routine (like a recurring
  // medication) that always wants the same "remind me N later" offer
  // shouldn't need it re-set by hand on every application.
  completionTimerMinutes: number | null;
  // Seeds Task.completionTimerNote.
  completionTimerNote: string | null;

  // Seed Task.penaltyMinutes / Task.penaltyCutoffTime. A morning routine whose
  // whole point is that the walk costs something would otherwise hand out
  // tasks that cost nothing, and the cost would have to be re-set by hand on
  // every application — the same reasoning completionTimerMinutes carries
  // above. There is no counterpart to penaltyFiredAt: the cost carries, the
  // charge doesn't, exactly as deliverableKind carries without
  // deliverableValue.
  penaltyMinutes: number | null;
  penaltyCutoffTime: string | null;
  // Seeds Task.gatesApps, on the same reasoning as the pair above: a morning
  // routine whose point is that nothing else happens until the walk does would
  // otherwise hand out tasks that gate nothing.
  gatesApps: boolean;
  // Seed Task.medicationName / medicationAmount / medicationUnit. The same
  // reasoning completionTimerMinutes carries above, which already names a
  // recurring medication as its case: a morning-routine template whose whole
  // point is the tablets would otherwise hand out a task that records nothing,
  // and the dose would have to be re-entered by hand on every application.
  // There is no template-side counterpart to the dose itself — the instruction
  // carries, the record doesn't, exactly as deliverableKind carries without
  // deliverableValue.
  medicationName: string | null;
  medicationAmount: number | null;
  medicationUnit: string | null;
  // Seeds Task.logMealSlot, same reasoning as the medication triple above: a
  // daily "Log breakfast" routine would otherwise need its slot re-picked by
  // hand on every application.
  logMealSlot: LogMealSlot | null;
  // Seeds Task.logMealSlotByTime: the slot is picked from the clock when the
  // task is completed. Optional so a stored item from before it reads as off.
  logMealSlotByTime?: boolean;

  // What the task created from this item asks for when it's completed, or null
  // for the ordinary "ticking it is the whole answer" item. Another field
  // alongside the ones above rather than a template-item "kind", exactly as
  // Task.deliverableKind is — a decision item is where a template earns its
  // keep ("Pick dates", "Decide on the budget"), and without this it had to be
  // set by hand on every application. There is no template-side counterpart to
  // deliverableValue: the question carries, the answer doesn't.
  deliverableKind: DeliverableKind | null;
  // The options a 'choice' question offers, and whether a date answer sets
  // the trip's departure. Both seed the Task fields of the same names.
  deliverableOptions?: string[];
  deliverableSetsAway?: boolean;

  chainEnabled: boolean;
  chainItems: ChainItem[];
  // The named set a task created from this item counts over — seeds
  // Task.rotationItems. Configuration, so it carries exactly as chainItems
  // does; the ledger, the period stamp and the last-done memory are the run's
  // own record and have no template-side counterpart, the same split the
  // medication triple and deliverableKind already make.
  rotationEnabled: boolean;
  rotationItems: RotationItem[];
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
  // How several conditions combine: 'all' (every one must match, the default
  // and what an item stored before this reads as) or 'any' (one is enough),
  // so "bring a passport if flying or international" is one item rather than
  // two. One switch over the whole list rather than nested groups: it covers
  // every case an item has asked for, and "this and (that or the other)" is a
  // second item. Meaningless with fewer than two live conditions.
  conditionsMatch?: 'all' | 'any';

  // Alternative title/notes for particular answers; see TemplateItemVariant.
  // Empty for every item stored before this shipped, which is "no variants".
  variants: TemplateItemVariant[];

  /**
   * `Task.answerGate` before there is a task: "only if <another item in this
   * template> is answered one of these". The item is named by its id, which
   * is stable for exactly this kind of reference, and `applyTemplate` points
   * the gate at the task that item became. Dropped at apply time when that
   * item wasn't ticked, since a gate on a question nobody will be asked would
   * hold the task back for good. Optional: absent on every older template.
   *
   * Different from `conditions`, which decide what's *ticked* in the apply
   * sheet from an answer given then; this waits for an answer given later.
   */
  answerGate?: TemplateAnswerGate | null;

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
  // Applied into a project, the section is a checklist (TaskGroup.checklist):
  // a packing list saved from a trip comes back as one. Optional so templates
  // saved before it read as ordinary sections.
  checklist?: boolean;
}

// Where one apply of a template puts the tasks it creates. Item titles are
// written to be read next to the template's name ("Buy tickets" under "Plan an
// activity"), so loose in Today they lose the thing they were about — a
// container carries that context once instead of repeating it in every title.
//   'none'    — loose tasks, the original behavior
//   'stack'   — one TaskGroup named after the run
//   'project' — one Project named after the run, the apply's two anchor dates
//               becoming its deadline
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
  /**
   * Whether this template's two anchor dates are days *away from home*, so a
   * run fills in the project's away span rather than only its deadline.
   *
   * Authored on the template, and it has to be: nothing is remembered between
   * runs (`ApplyTemplateSheet` zeroes every field on open and answers never
   * leave component state), so there is no memory an "ask once, remember it"
   * scheme could live in.
   *
   * **Not inferred from a `fromDates` question**, tempting as that is — the one
   * template in the repo that uses one is the trip. `'days'` is genuinely
   * ambiguous (eight days of renovation is not eight days away), and inferring
   * is the move `Project.weekendSource`'s note forbids in as many words. The
   * template editor may surface this toggle more prominently when a `'nights'`
   * question exists; that is a hint, not a rule.
   *
   * **It never sets `Project.awayPauses`.** `TemplateSchedule` can fire a run
   * unattended, so a template that could set that could switch vacation mode on
   * with nobody having asked. The two nominations answer different questions —
   * this one is about *placement*, that one about *suppression* — and are
   * deliberately kept apart. See `docs/arch/away-dates.md`.
   */
  anchorsAreAway: boolean;
  /**
   * A run that makes a project makes a list (`Project.list`). Set when the
   * template is saved from a list project, and on the editor's List row.
   * Only read where a run creates its own project: a run applied into an
   * existing project leaves that project's own setting alone. Optional for
   * rows built before it existed.
   */
  list?: boolean;
}
