import type { LogMealSlot, MealSlot } from './mealPlan';
import type { Effort } from './task';

/**
 * A closed set rather than an open vocabulary, on purpose — see
 * `SegmentedControl`'s own rule for what makes a set "closed": these are the
 * conditions `classifyWeather()` (`src/utils/weatherCondition.ts`) can ever
 * report, so a rule naming anything else could never fire. `sunny` and `cold`
 * (or `sunny` and `hot`) can both be true of the same day at once — see that
 * module for why the classifier returns a list rather than picking one.
 */
export type WeatherCondition = 'sunny' | 'rainy' | 'snowy' | 'cold' | 'hot';

/**
 * "On a sunny day, add a task to put on sunscreen" — a user-authored rule
 * matched against today's weather, the same "vocabulary the user wrote down"
 * shape as `TitleRule` above and stored the same way (`weatherRules` in
 * settings, see `useSettingsStore.ts` and `parseWeatherRules` in
 * `weatherTasks.ts`). Unlike a title rule, a match doesn't fill in fields on a
 * task somebody's already creating — it creates the task, through the shared
 * generated-task mechanism (`generatedBy('weather', ...)`), which is why a
 * rule needs its own `lastFiredDayKey` rather than reading the tri-state
 * opt-out every sourced generator gets: the "source" here is a rule living in
 * settings, not a row anything could stamp a decline onto (see the
 * `'weather'` case of `GeneratedKind` above).
 */
/**
 * How long the task a rule writes takes, carried on the rule so each task it
 * writes starts with it. Written back from the task, never asked for on the
 * rule sheet; see `src/utils/ruleEstimate.ts`. Both absent on a rule nobody
 * has estimated.
 */
export interface RuleTaskEstimate {
  estimatedMinutes?: number | null;
  effort?: Effort;
}

/**
 * Where the task a rule writes is filed, when that differs from the rest of its
 * kind. Absent means the generator's own "File them under" setting; see
 * `src/utils/ruleCategory.ts`.
 */
export interface RuleTaskCategory {
  category?: string;
}

/**
 * What completing the task a rule writes records: a dose in the medication log
 * (`Task.medicationName`/`medicationAmount`/`medicationUnit`), a food log entry
 * (`Task.logMealSlot`/`logSavedMealId`/`logMealSlotByTime`), either or both.
 * The same fields and meanings as on a task; a rule carries them so each task it
 * writes starts with them. See `src/utils/ruleLog.ts`. All absent on a rule that
 * logs nothing.
 */
export interface RuleTaskLog {
  medicationName?: string | null;
  medicationAmount?: number | null;
  medicationUnit?: string | null;
  logMealSlot?: LogMealSlot | null;
  logSavedMealId?: string | null;
  logMealSlotByTime?: boolean;
}

export interface WeatherRule extends RuleTaskEstimate, RuleTaskCategory, RuleTaskLog {
  id: string;
  condition: WeatherCondition;
  /** The task's title, e.g. "Put on sunscreen". */
  title: string;
  // Off keeps the rule written down but stops it firing — the same call
  // TitleRule.enabled makes, so turning one off doesn't mean losing it.
  enabled: boolean;
  /**
   * The day key (`dayKeyOf`) this rule last created a task on, or was
   * considered and found not to apply — whichever happened most recently.
   * Written unconditionally before the day's weather is even checked, the
   * same "mark the day considered before deciding" order calendarReview's
   * `calendarReviewLastDayKey` uses, so a task swiped away doesn't come
   * straight back on the next foreground sweep the same day.
   */
  lastFiredDayKey: string | null;
  /**
   * The day key of the *weather* this rule last produced a day-ahead task for
   * — tomorrow's, written the evening before (see `checkWeatherTasks`).
   *
   * A second mark rather than a second meaning for the one above, because the
   * two are live at the same time and mean different things: on the evening of
   * the 17th a rule has answered "what is today doing" for the 17th and "what
   * is tomorrow doing" for the 18th, and one scalar holding whichever was
   * written last would let the other question be asked again. That would
   * recreate a task the user had already swiped away, which is the single
   * thing both marks exist to prevent.
   */
  lastAheadDayKey: string | null;
}

/**
 * "After 30 minutes on the apps I picked, add a task" — the same
 * user-authored-rule shape as `WeatherRule` above, against iOS Screen Time
 * instead of the forecast, and stored the same way (`screenTimeRules` in
 * settings, see `screenTimeRules.ts`).
 *
 * The one place it parts company with `WeatherRule` is `thresholdMinutes`.
 * `weatherCondition.ts` deliberately refuses a per-rule number on the grounds
 * that a rule's title says what its threshold is for ("Put on sunscreen" wants
 * a lower bar than "Bring a heavy coat"). That move isn't available here: the
 * number *is* the rule, and two rules over the same apps at 30 and 90 minutes
 * are a perfectly ordinary pair to want.
 *
 * Which apps is not stored here, and can't be. The picked set lives in the App
 * Group as opaque tokens iOS never resolves for the app, so every rule watches
 * the same one selection — see modules/todo-screentime-bridge.
 */
export interface ScreenTimeRule extends RuleTaskEstimate, RuleTaskCategory, RuleTaskLog {
  id: string;
  /** Minutes of use across the chosen apps that trips this rule. */
  thresholdMinutes: number;
  /**
   * The app group whose apps this rule counts time across (`appGroups.ts`).
   * Absent means the fallback group, which is also what a removed group reads
   * as, so a rule saved before groups existed watches what it always did.
   */
  groupId?: string;
  /** The task's title, e.g. "Take a walk". */
  title: string;
  // Off keeps the rule written down but stops it firing, same as WeatherRule.
  enabled: boolean;
  /**
   * The day key (`dayKeyOf`) this rule last created a task on.
   *
   * Serves the job `WeatherRule.lastFiredDayKey` does — a task swiped away
   * must not come straight back — but it cannot be written the same way. The
   * weather mark is stamped before the day is even checked, because the app
   * is what does the deciding; here the deciding happens in the OS and arrives
   * as a crossing the app drains. So this is written when a crossing is
   * actually turned into a task, and it is what makes a second report of the
   * same rule on the same day a no-op.
   */
  lastFiredDayKey: string | null;
}

/**
 * A speed bump, stored in settings as `speedBumpRules` — see
 * `src/utils/speedBump.ts`. When the total time today on `groupId` reaches
 * `thresholdMinutes`, the monitor extension blocks `blockGroupId` for
 * `blockMinutes`, and can do it again as the time keeps growing.
 */
export interface SpeedBumpRule {
  id: string;
  /** What the person calls it, e.g. "Social wind-down". */
  title: string;
  /** The app group whose use is timed. Absent means the fallback group. */
  groupId?: string;
  /** The app group that gets blocked. Absent means the timed group. */
  blockGroupId?: string;
  /** Minutes of use today that trip it the first time. */
  thresholdMinutes: number;
  /** How long each block lasts; never under the quarter hour iOS allows a window to be. */
  blockMinutes: number;
  /** Minutes of further use between repeats, or null for a rule that fires once a day. */
  repeatEveryMinutes: number | null;
  /** The most times it fires in a day. 1 when it does not repeat. */
  maxTimes: number;
  /**
   * The weekdays it runs on, 0 = Sunday. Absent means every day. Two rules on
   * the same groups with different days are how a weekend gets a looser limit.
   */
  days?: number[];
  enabled: boolean;
}

/**
 * A rule offering coins for blocking apps ("Block Games for an hour: 10
 * coins"), stored in settings as `blockOfferRules` — see
 * `src/utils/blockOfferTasks.ts`. One task a day per enabled rule, and the task
 * pays only after the block it starts has run to its end.
 */
export interface BlockOfferRule extends RuleTaskCategory {
  id: string;
  /** The task's title, e.g. "Block Games for 1 hour". */
  title: string;
  /** The app group this rule blocks (`appGroups.ts`). Absent means the fallback group. */
  groupId?: string;
  /** How long the block lasts, within `manualMinutesProblem`'s range. */
  minutes: number;
  /** Coins paid when the finished block's task is checked off. Fixed on the rule, not worked out from effort. */
  coins: number;
  enabled: boolean;
  /**
   * The day key this rule last offered on. Written before the offer is made,
   * the way `WeatherRule.lastFiredDayKey` is, so a task swiped away or
   * forfeited cannot come straight back the same day.
   */
  lastFiredDayKey: string | null;
}

/**
 * What a health-target task ("walk 8,000 steps", "close the Stand ring") can
 * read: the mood axis's two readings plus the three Activity rings' figures.
 *
 * Its own type rather than a widened `HealthMetric` or `HealthRuleMetric`, for
 * the reason the latter gives: a target is a number to reach, and the mood
 * axes and the rules each answer a different question about different fields.
 * `activeEnergyKcal` is the Move ring's calories and `standHours` exists only
 * on the Activity summary. See `utils/healthTarget.ts`.
 */
export type HealthTargetMetric =
  | 'steps' | 'sleepHours' | 'exerciseMinutes' | 'activeEnergyKcal' | 'standHours';

/**
 * The metrics a health rule can watch — a superset of `HealthMetric`
 * (`moodInsights.ts`'s steps/sleep axis) plus eight nutrients, none of which
 * have a mood axis of their own since `MoodDay` carries no nutrient fields.
 * Kept as its own type rather than widening `HealthMetric` itself, so
 * `moodInsights.ts`'s axis functions — written against `MoodDay`'s actual
 * fields — don't gain a case they can't answer.
 *
 * **It lives here rather than in `healthRules.ts` because it used to be written
 * out twice.** The union was declared in that module *and* inlined on
 * `HealthRule.metric` below, so a ninth metric meant editing both with nothing
 * to catch a miss: the two copies agreeing was luck rather than structure. This
 * file already owns every model's shape, and a field's type is part of that
 * shape, so the declaration belongs on this side of the boundary and
 * `healthRules.ts` imports it — which is also the direction the dependency
 * already ran, since utils reads types and never the reverse.
 */
export type HealthRuleMetric =
  | 'steps' | 'sleepHours' | 'exerciseMinutes'
  | 'sodiumMg' | 'proteinG' | 'satFatG' | 'fiberG' | 'sugarG' | 'caffeineMg' | 'waterMl' | 'calorieKcal';

/**
 * A rule matching today's Apple Health reading against a threshold the user
 * wrote — "under six hours of sleep, keep today light".
 *
 * Between its two neighbours. Like `WeatherRule` the app holds the reading and
 * does the deciding itself, so the idempotency mark can be spent before the
 * decision; like `ScreenTimeRule` the number *is* the rule, so the threshold is
 * per rule rather than carried by the title. See `src/utils/healthRules.ts` for
 * both, and `docs/arch/health-data.md` for why a missing reading can never
 * match.
 */
export interface HealthRule extends RuleTaskEstimate, RuleTaskCategory, RuleTaskLog {
  id: string;
  /** Which reading this rule watches. */
  metric: HealthRuleMetric;
  /**
   * The number the reading is compared against, in the metric's own unit —
   * steps, whole hours asleep, milligrams of sodium or caffeine, grams of
   * protein, saturated fat, fiber or sugar, millilitres of water, or
   * kilocalories.
   *
   * Both directions still describe a shortfall against the number the user
   * picked, which is what keeps this from being a general greater/less
   * toggle: there is no rule here that fires on "you did enough" — see
   * `direction` below for which way this particular rule reads.
   */
  threshold: number;
  /**
   * The hour of the logical day this rule is judged from, for a metric that
   * wants more than one checkpoint in a day rather than one fixed floor — the
   * eight nutrients, today. Steps and sleep take a fixed hour from
   * `HEALTH_METRIC_EARLIEST_HOUR` instead and ignore this field. `undefined`
   * for those two; see `HEALTH_METRIC_EARLIEST_HOUR`'s own comment in
   * `healthRules.ts` for why the nutrient rules needed a per-rule hour where
   * steps and sleep don't.
   */
  checkpointHour?: number;
  /**
   * Which way this rule compares its reading — 'under' (a floor) or 'over'
   * (a ceiling). `undefined` reads as the metric's own default
   * (`HEALTH_METRIC_DIRECTION` in `healthRules.ts`: a floor for most
   * nutrients, a ceiling for saturated fat, sugar and caffeine). Only the
   * eight nutrients let this be set per rule in `HealthRulesSheet` — steps and
   * sleep have no case for a ceiling ("over 3,000 steps" describes something
   * that already happened and needs no task), where a nutrient goal genuinely
   * can point either way depending on the diet behind it (a sodium ceiling
   * for blood pressure is as real as a sodium floor for POTS). Read through
   * `healthRuleDirection(rule)`, never this field directly, so a rule with no
   * override still resolves correctly.
   */
  direction?: 'under' | 'over';
  /** The task's title, e.g. "Keep today light". */
  title: string;
  // Off keeps the rule written down but stops it firing, same as WeatherRule.
  enabled: boolean;
  /**
   * The day key (`dayKeyOf`) this rule last created a task on.
   *
   * Written the moment the rule is *considered*, the way `WeatherRule`'s is
   * rather than `ScreenTimeRule`'s, because the app is what does the deciding
   * here. The one exception is the whole of `ruleCanBeJudgedYet`: a steps rule
   * cannot be judged before evening, and spending the mark at 8am would mean
   * it never fires that day.
   */
  lastFiredDayKey: string | null;
}

/**
 * "When an event whose title says *flight* is on the calendar, add a task to
 * pack, three days before it" — the fourth user-authored rule shape, after
 * `WeatherRule`, `ScreenTimeRule` and `HealthRule` above, and the first
 * matched against text rather than against a number or a named condition.
 *
 * **What it may read, and why that is settled.** The cue is the event's own
 * `title`, never its attendees: `docs/arch/people.md`'s "Where the two lines
 * actually fall" states that boundary for the one existing title reader
 * (`peopleNamedInTitle`), and `BusyEvent` carries no attendee field precisely
 * so the question cannot be reopened by accident. A title is what *you* typed
 * about your own plans; an attendee list is everybody you happened to sit in
 * a room with.
 *
 * **What keeps it clear of "a guess is never written down".** The same doc
 * forbids the app deciding, off a title, that something is true. This does not
 * decide anything: the user wrote the word to match and the task to write, so
 * the app's whole contribution is noticing that the word is there. That is the
 * position `WeatherRule` and `ScreenTimeRule` are already in, and it is why
 * this reads titles where `calendarHistory.ts` — which infers — may only
 * offer.
 */
export interface EventTaskRule extends RuleTaskEstimate, RuleTaskCategory, RuleTaskLog {
  id: string;
  /**
   * The words or phrases looked for in an event's title — the rule fires if
   * **any** of them appears, matched case-insensitively and on **whole words
   * only**, the same test `peopleNamedInTitle` applies for the same reason: a
   * substring match makes "gym" fire on "Gymnastics recital", and a rule that
   * fires on the wrong events is one nobody can trust enough to leave on.
   *
   * Always at least one entry — a rule with none matches nothing and is
   * dropped by `parseEventRules`, the same call an empty single `match` used
   * to get. Each entry is floored at `EVENT_MATCH_MIN_LENGTH` and capped at
   * `EVENT_RULE_MAX_MATCHES` entries (see `eventTasks.ts`) — a two-letter cue
   * matches far too much to be a cue, and an unbounded list is a text field
   * wearing a chip UI.
   */
  matches: string[];
  /** The task's title, e.g. "Pack a bag". */
  title: string;
  /**
   * How many days before the event the task lands on. 0 is the event's own
   * day, which is what a "bring the slides" rule wants; a "pack" rule wants
   * three.
   *
   * Capped at `EVENT_LEAD_DAYS_MAX`, and the ceiling is not a product call: it
   * is `CALENDAR_WINDOW_DAYS`, how far ahead the app reads the calendar at
   * all. A rule with a longer lead than the window could never fire, because
   * the event would not be visible yet on the day the task was supposed to
   * appear. See `eventTasks.ts`.
   */
  leadDays: number;
  /**
   * Fire once the event is over instead of ahead of it. The task lands on the
   * day the event ended, and `leadDays` is ignored (always stored as 0). For a
   * follow-up ("book the next appointment") that is only worth asking once the
   * visit has happened. Absent reads as false, so every rule saved before this
   * existed keeps firing ahead of its event.
   */
  afterEvent?: boolean;
  /**
   * With `afterEvent`: write nothing while another event that matches this rule
   * is still ahead. The follow-up is already booked, so the task would be noise.
   * Ignored on a rule that fires ahead of its event.
   */
  skipIfUpcoming?: boolean;
  /**
   * The task has to be done before leaving for the event: it lands on the
   * event's own day (`leadDays` is stored as 0), and the event's "Leave for X"
   * row names it while it is open and asks before it is ticked. Linked by the
   * shared occurrence key, so there is no field on the task. Does nothing for
   * an event with no location, which gets no Leave row. Ignored with
   * `afterEvent`. See `leavePrep.ts`.
   */
  beforeLeaving?: boolean;
  // Off keeps the rule written down but stops it firing, same as WeatherRule.
  enabled: boolean;
}


/**
 * How a capture target files what it creates, beyond the words in the reminder
 * itself.
 *
 * Every arm here lands an ordinary `Task`, and that is the whole reason this
 * feature is small. The two destinations that predate it (`remindersImport*`
 * for the Inbox, `groceryImport*` for the grocery list) each had to answer
 * "what row does a dictated sentence become"; these answer only "how is that
 * task filed", which is a field on a draft the drain already builds.
 *
 * It is deliberately not a list of *app areas*. A dictated title is a complete
 * record for a task and for a grocery row, and for nothing else in this app —
 * a `FoodLogEntry` refuses to exist without a nutrition figure
 * (`useFoodLogStore.addEntry`), a weight has no table at all, a mood is a
 * number. So `meal` below does not write to the food log: it stamps
 * `logMealSlot` and lets the tick raise the offer that field already exists to
 * raise. See `docs/arch/reminders-import.md`.
 */
export type ReminderCaptureFiling =
  /**
   * Lands in the Inbox carrying `Task.logMealSlot`, so ticking it offers the
   * food log's own manual-entry sheet prefilled with the dictated words.
   *
   * The slot is derived from when the reminder was *created* rather than being
   * fixed per list, so one "Food" list serves every meal of the day: dictate at
   * 08:00 and it is breakfast, at 19:00 and it is dinner. `null` means derive
   * it; a real slot pins the whole list to one meal for somebody who wants
   * that.
   */
  | { kind: 'meal'; slot: MealSlot | null }
  /** Lands in a project — meant for a running list of undated tasks. */
  | { kind: 'project'; projectId: string }
  /** Lands in a task category. */
  | { kind: 'category'; category: string }
  /** Lands carrying one tag. */
  | { kind: 'tag'; tag: string };

/**
 * One extra Reminders list the app drains, beyond the two that have their own
 * settings rows.
 *
 * **One JSON settings row holding a list, rather than four flat settings per
 * destination.** `remindersImport*` and `groceryImport*` are four keys each
 * because they are two fixed features; this is an open set the user builds, so
 * the same shape would mean a migration per capture. Same call `healthRules`
 * and `weatherRules` make, and `RuleListSheet` is already the UI for it.
 *
 * `confirmedListId` is not a duplicate of `listId`, and dropping it would be
 * the one unsafe edit here: importing *deletes* the user's reminders, so a
 * drain may only ever run against a list they confirmed by name and count, and
 * keying the confirmation on the id is what makes re-pointing a capture at a
 * different list ask again rather than silently swallowing a fresh backlog.
 */
export interface ReminderCapture {
  id: string;
  /** What the user calls this capture. Shown in settings; never written to a task. */
  title: string;
  /** Off keeps the row and its confirmation while draining nothing. */
  enabled: boolean;
  listId: string | null;
  /** The list the confirmation alert was answered for — see the note above. */
  confirmedListId: string | null;
  /**
   * `remindersImportDelete`'s twin, per capture, and the default is inverted
   * from that one. A capture's list is usually a dictation inbox the user wants
   * emptied, so on; it is exposed per row because a shared list is not.
   */
  deleteAfterImport: boolean;
  filing: ReminderCaptureFiling;
}
