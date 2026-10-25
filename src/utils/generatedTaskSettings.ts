import type { DeliverableKind, GeneratedTaskExtras, TaskDraft, TaskFieldDefaults, TimeOfDay } from '../types';
import type { GeneratedKind } from './generatedTasks';
import { describeTaskFieldDefaults } from './taskFieldDefaults';
import { capitalize } from './capitalize';

/**
 * A kind of generated task's "Task settings": one sheet in Settings showing a
 * task of that kind field by field, with the fields the generator writes shown
 * locked (and where their value comes from) and the rest editable.
 *
 * What the sheet edits lives in three places, deliberately not merged:
 *
 * - the kind's own category setting (`groceryUseUpTaskCategory`, …), which the
 *   generator itself reads when it builds its draft;
 * - `generatedTaskDefaults` (`TaskFieldDefaults`), which Backfill also writes;
 * - `generatedTaskExtras` (`GeneratedTaskExtras`, this file), for the fields no
 *   generator writes at all.
 *
 * **A setting here fills a field the generator left alone and never overrides
 * one it wrote**, the contract `newTaskFromDraft` already gives
 * `TaskFieldDefaults`. That is why the locked fields are locked: the generator
 * owns them, and a reconcile rewrites some of them as the source changes.
 * Changes apply to tasks created afterwards; a live task is left as it is.
 *
 * Not every kind has a sheet yet. `TASK_SETTINGS_SPECS` lists the ones that
 * do, each with the fields its generator owns; a kind without an entry keeps
 * the older "Task defaults" and "File them under" rows.
 */

export const NO_GENERATED_TASK_EXTRAS: GeneratedTaskExtras = {
  tags: [],
  timeSegments: [],
  deliverableKind: null,
  deliverableOptions: [],
};

const SEGMENTS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];
const KINDS: readonly DeliverableKind[] = ['text', 'date', 'number', 'yesno', 'choice'];

export function hasGeneratedTaskExtras(e: GeneratedTaskExtras | null | undefined): e is GeneratedTaskExtras {
  return !!e && (e.tags.length > 0 || e.timeSegments.length > 0 || e.deliverableKind !== null);
}

const stringList = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? [...new Set(raw.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(Boolean))]
    : [];

/**
 * One kind's stored value, read field by field so a bad field drops alone
 * (the reasoning `parseTaskFieldDefaults` gives). Null when nothing is left.
 */
export function parseGeneratedTaskExtrasValue(raw: unknown): GeneratedTaskExtras | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const deliverableKind = KINDS.includes(o.deliverableKind as DeliverableKind)
    ? (o.deliverableKind as DeliverableKind)
    : null;
  const result: GeneratedTaskExtras = {
    tags: stringList(o.tags),
    timeSegments: stringList(o.timeSegments).filter((s): s is TimeOfDay => SEGMENTS.includes(s as TimeOfDay)),
    deliverableKind,
    deliverableOptions: deliverableKind === 'choice' ? stringList(o.deliverableOptions) : [],
  };
  return hasGeneratedTaskExtras(result) ? result : null;
}

/** The whole setting, keyed by kind. A corrupt value reads as nothing set. */
export function parseGeneratedTaskExtras(raw: string | null): Record<string, GeneratedTaskExtras> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, GeneratedTaskExtras> = {};
    for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
      const e = parseGeneratedTaskExtrasValue(value);
      if (e) out[kind] = e;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The four fields `extras` fills on a new generated task, beneath the draft.
 *
 * Tags are additive, the way a title rule's are: the kind's tags join whatever
 * the draft carries. The other three are a slot the draft claims by naming
 * it: a draft with its own time of day (a meal slot's) or its own question
 * keeps it. A choice question's options travel with the kind that set them,
 * so a draft's own kind never picks up the setting's options.
 */
export function generatedExtrasFill(
  draft: Pick<Partial<TaskDraft>, 'tags' | 'timeSegments' | 'deliverableKind' | 'deliverableOptions'>,
  extras: GeneratedTaskExtras | null | undefined,
): Pick<Partial<TaskDraft>, 'tags' | 'timeSegments' | 'deliverableKind' | 'deliverableOptions'> {
  const own = {
    tags: draft.tags,
    timeSegments: draft.timeSegments,
    deliverableKind: draft.deliverableKind,
    deliverableOptions: draft.deliverableOptions,
  };
  if (!hasGeneratedTaskExtras(extras)) return own;
  const draftTags = draft.tags ?? [];
  const asks = !!draft.deliverableKind;
  return {
    tags: extras.tags.length > 0 ? [...draftTags, ...extras.tags.filter(t => !draftTags.includes(t))] : draft.tags,
    timeSegments: (draft.timeSegments?.length ?? 0) > 0 || extras.timeSegments.length === 0
      ? draft.timeSegments
      : [...extras.timeSegments],
    deliverableKind: asks ? draft.deliverableKind : (extras.deliverableKind ?? draft.deliverableKind),
    deliverableOptions: asks || extras.deliverableKind === null ? draft.deliverableOptions : [...extras.deliverableOptions],
  };
}

/** One field the generator writes, as the sheet shows it. */
export interface OwnedTaskField {
  key: string;
  label: string;
  /** What the field holds on a task of this kind, in general terms. */
  summary: string;
  /**
   * Where the value comes from, or when it appears, for a field whose summary
   * doesn't already say. Most don't need one: "Opens the item in Kitchen" has
   * nothing to add.
   */
  hint?: string;
}

/** What the sheet needs to describe the owned half of one kind's task. */
export interface TaskSettingsContext {
  groceryUseUpLeadDays: number;
  birthdayLeadDays: number;
  birthdayGiftLeadDays: number;
  mealShortfallLeadDays: number;
}

/** An editable row the sheet leaves out for a kind whose generator owns it. */
export type LockableField = 'time' | 'ask';

export interface TaskSettingsSpec {
  /** A sample title for the example row. */
  example: string;
  /** The sheet's title: what one of these tasks is called. */
  noun: string;
  owned: (ctx: TaskSettingsContext) => OwnedTaskField[];
  /**
   * Editable rows to leave out: the generator writes the field itself (a time
   * of day from its own setting), or the field can't mean anything on this
   * task (a question on a task that is never completed). Every owned field
   * keyed `time` or `ask` must be listed here, which the tests hold.
   */
  locks?: readonly LockableField[];
  /**
   * The category row's hint, for a kind whose rules can name their own
   * category, so the setting is only the fallback.
   */
  categoryHint?: string;
}

/**
 * When a task that is dated the day it appears does appear: "When the birthday
 * is 3 days away", or "On the birthday" at a lead of 0. Not "3 days before the
 * birthday" as a date, because these tasks are dated whichever day the app
 * first notices the window has opened, never back in the past.
 */
export function appearsPhrase(days: number, what: string): string {
  if (days <= 0) return `On ${what}`;
  return `When ${what} is ${days} ${days === 1 ? 'day' : 'days'} away`;
}

/** "2 days before the use-by date", or "On the use-by date" at a lead of 0. */
export function leadDaysPhrase(days: number, what: string): string {
  if (days <= 0) return `On ${what}`;
  return `${days} ${days === 1 ? 'day' : 'days'} before ${what}`;
}

/** The rule kinds' estimate: learned onto the rule, and ahead of the default below. */
const RULE_ESTIMATE: OwnedTaskField = {
  key: 'estimate',
  label: 'Estimate',
  summary: 'The rule’s own, once it has one',
  hint: 'Learned from how long the task took. Until then, the estimate below is used.',
};

export const TASK_SETTINGS_SPECS: Partial<Record<GeneratedKind, TaskSettingsSpec>> = {
  groceryUseUp: {
    example: 'Use up spinach',
    noun: 'Use-up task',
    owned: ctx => [
      { key: 'title', label: 'Title', summary: 'Use up (item name)' },
      { key: 'date', label: 'Date', summary: leadDaysPhrase(ctx.groceryUseUpLeadDays, 'the use-by date'), hint: 'Moves when the item’s use-by date changes. The number of days is the setting above.' },
      { key: 'deadline', label: 'Deadline', summary: 'The use-by date' },
      { key: 'link', label: 'Link', summary: 'Opens the item in Kitchen' },
    ],
  },
  pantryCheck: {
    example: 'Check if you still have rice',
    noun: 'Pantry check',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Check if you still have (item name)' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added once the item has been around longer than it usually lasts. At most three at a time.' },
      { key: 'link', label: 'Link', summary: 'Opens the item in Kitchen' },
    ],
  },
  pantryReview: {
    example: 'Review what’s in the pantry',
    noun: 'Pantry review task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Review what’s in the pantry' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added when there are enough items to go through, at most every two weeks.' },
      { key: 'link', label: 'Link', summary: 'Opens the pantry review' },
    ],
  },
  leftoverUseUp: {
    example: 'Use up chili',
    noun: 'Use-up task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Use up (leftover name)' },
      { key: 'date', label: 'Date', summary: 'The day before it should be eaten by' },
      { key: 'deadline', label: 'Deadline', summary: 'The day to eat it by', hint: 'Taken from the leftover, and moves if you change it.' },
      { key: 'link', label: 'Link', summary: 'Opens the leftover in Kitchen' },
    ],
  },
  mealSlot: {
    example: 'Dinner',
    noun: 'Meal task',
    locks: ['time', 'ask'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'The meal, or what’s planned for it' },
      { key: 'date', label: 'Date', summary: 'The meal’s day', hint: 'Written up to a week ahead.' },
      { key: 'steps', label: 'Steps', summary: 'Choose, prepare and eat', hint: 'With a recipe planned, make it and eat it. Each step’s estimate is its own.' },
      { key: 'link', label: 'Link', summary: 'Opens the recipe or the meal plan' },
    ],
  },
  mealPlanNudge: {
    example: 'Monday 10/12',
    noun: 'Meal plan task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'The day to plan', hint: 'One task for each day of the week, in a stack called “Plan this week’s meals”.' },
      { key: 'date', label: 'Date', summary: 'The day and time set above', hint: 'Skipped when the week’s meals are already planned.' },
      { key: 'link', label: 'Link', summary: 'Opens that day in the meal plan' },
    ],
  },
  mealShortfall: {
    example: 'Shop for Chili (Thursday dinner)',
    noun: 'Shopping task',
    owned: ctx => [
      { key: 'title', label: 'Title', summary: 'Shop for (recipe) (day and meal)' },
      { key: 'date', label: 'Date', summary: appearsPhrase(ctx.mealShortfallLeadDays, 'the meal'), hint: 'Only when ingredients are missing. At most three at a time.' },
      { key: 'link', label: 'Link', summary: 'Opens what to buy for the meal' },
    ],
  },
  mealThaw: {
    example: 'Take chicken out of the freezer (Thursday dinner)',
    noun: 'Freezer reminder',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Take (food) out of the freezer (day and meal)' },
      { key: 'date', label: 'Date', summary: 'The day before the meal, or that day' },
      { key: 'link', label: 'Link', summary: 'Opens the food in Kitchen', hint: 'Or Kitchen itself when more than one thing is frozen.' },
    ],
  },
  mealLogNudge: {
    example: 'Log Chili (Thursday dinner)',
    noun: 'Log reminder',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Log (meal) (day and meal)' },
      { key: 'date', label: 'Date', summary: 'The day after the meal', hint: 'Only when nothing was logged for it.' },
      { key: 'link', label: 'Link', summary: 'Opens that day in the meal plan' },
    ],
  },
  projectReview: {
    example: 'Review Garden',
    noun: 'Project review task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Review (project)' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added when a project has gone quiet for longer than its own nudge setting. At most three at a time.' },
      { key: 'link', label: 'Link', summary: 'Opens the project’s next tasks' },
    ],
  },
  supplyReorder: {
    example: 'Order more filters',
    noun: 'Reorder task',
    locks: ['ask'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Order more (supply)', hint: 'Named after the supply’s unit, or the task that uses it.' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added when the supply is running low, as set on its task.' },
      { key: 'deadline', label: 'Deadline', summary: 'When it should run out', hint: 'Projected from how fast it’s used.' },
      { key: 'ask', label: 'Ask on completion', summary: 'How many you bought', hint: 'So the supply’s count goes back up.' },
      { key: 'link', label: 'Link', summary: 'The supply task’s link', hint: 'Copied from the task that uses it, so you can reorder from the same place.' },
    ],
  },
  calendarReview: {
    example: 'Review tomorrow’s calendar',
    noun: 'Calendar review task',
    locks: ['time'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Review tomorrow’s calendar' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Only when tomorrow has events.' },
      { key: 'time', label: 'Time of day', summary: 'The part of the day set above', hint: 'Any time when none is set.' },
    ],
  },
  birthdayGift: {
    example: 'Get Sam’s birthday gift',
    noun: 'Gift task',
    owned: ctx => [
      { key: 'title', label: 'Title', summary: 'Get (name)’s birthday gift', hint: 'Uses the person’s nickname if they have one.' },
      { key: 'date', label: 'Date', summary: appearsPhrase(ctx.birthdayGiftLeadDays, 'the birthday'), hint: 'The number of days is the setting above.' },
      { key: 'deadline', label: 'Deadline', summary: 'The birthday', hint: 'Taken from the person’s page, and moves if you correct it.' },
      { key: 'notes', label: 'Notes', summary: 'Gift ideas', hint: 'Copied from the person’s gift ideas when the task is added. Changes after that are made on the task.' },
      { key: 'link', label: 'Link', summary: 'Opens the person' },
    ],
  },
  reachOut: {
    example: 'Catch up with Sam',
    noun: 'Keep-in-touch task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Catch up with (name)', hint: 'Or “Ask (name) about …” when you noted something to ask about.' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added when it’s been longer than you set for that person. At most two at a time.' },
      { key: 'link', label: 'Link', summary: 'Opens the person' },
      { key: 'phone', label: 'Phone', summary: 'Their phone number' },
    ],
  },
  waitingFollowUp: {
    example: 'Follow up with Sam about “Send the lease”',
    noun: 'Follow-up task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Follow up with (name) about (task)' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added after a week of waiting, or on the follow-up date set on the task.' },
      { key: 'project', label: 'Project', summary: 'The waiting task’s project' },
      { key: 'link', label: 'Link', summary: 'Opens the person' },
      { key: 'phone', label: 'Phone', summary: 'Their phone number' },
    ],
  },
  weather: {
    example: 'Put on sunscreen (sunny from 10 AM)',
    noun: 'Weather task',
    categoryHint: 'Used when a rule doesn’t name its own category. With none, these tasks appear at the top of Today.',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'The rule’s title, with when', hint: 'Each rule names its task. The app adds the hours the forecast matches, like “(rain from 3 PM)”.' },
      { key: 'date', label: 'Date', summary: 'Today, or tomorrow from 6 PM', hint: 'Today when today’s forecast matches. From 6 PM, also tomorrow when tomorrow’s does.' },
      { key: 'link', label: 'Link', summary: 'Opens the Weather app' },
      RULE_ESTIMATE,
    ],
  },
  screenTime: {
    example: 'Go for a walk',
    noun: 'Screen Time task',
    categoryHint: 'Used when a rule doesn’t name its own category. With none, these tasks appear at the top of Today.',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'The rule’s title' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added once a rule’s time limit is passed, and removed when the day ends.' },
      RULE_ESTIMATE,
    ],
  },
  blockOffer: {
    example: 'Block Games for 1 hour (10 coins)',
    noun: 'Block for coins task',
    categoryHint: 'Used when a rule doesn’t name its own category. With none, these tasks appear at the top of Today.',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'The rule’s title, with its coins' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Offered once a day, and removed when the day ends unless you started the block.' },
      { key: 'notes', label: 'Notes', summary: 'How the offer works', hint: 'Says when the block ends once you start it.' },
    ],
  },
  health: {
    example: 'Go for a walk',
    noun: 'Health task',
    categoryHint: 'Used when a rule doesn’t name its own category. With none, these tasks appear at the top of Today.',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'The rule’s title' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added when a rule’s reading is reached, and removed when the day ends.' },
      { key: 'notes', label: 'Notes', summary: 'The reading, for some rules', hint: 'Sleep and nutrient rules note what Apple Health recorded.' },
      { key: 'link', label: 'Link', summary: 'For sleep rules, opens Lighten the day' },
      RULE_ESTIMATE,
    ],
  },
  eventTask: {
    example: 'Buy a gift',
    noun: 'Calendar event task',
    categoryHint: 'Used when a rule doesn’t name its own category. With none, these tasks appear at the top of Today.',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'The rule’s title', hint: 'Each rule names the task it adds, not the event.' },
      { key: 'date', label: 'Date', summary: 'Days before the event, or after it', hint: 'Set by each rule. A follow-up rule adds its task after the event. The date stays put if the event moves.' },
      { key: 'location', label: 'Location', summary: 'The event’s location' },
      RULE_ESTIMATE,
    ],
  },
  travel: {
    example: 'Leave for Dentist',
    noun: 'Leave-by reminder',
    locks: ['time'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Leave for (event name)', hint: 'Adds the travel time and, when transit alerts are on, any MTA service note.' },
      { key: 'date', label: 'Date', summary: 'The day of the event' },
      { key: 'reminder', label: 'Reminder', summary: 'When to leave', hint: 'The event’s start minus the travel time, kept up to date with the travel time.' },
      { key: 'time', label: 'Time window', summary: 'Ends when the event starts', hint: 'So the task is gone once it’s too late to leave.' },
      { key: 'location', label: 'Location', summary: 'The event’s location' },
    ],
  },
  wakeUp: {
    example: 'Wake up at 6:20',
    noun: 'Wake-up task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Wake up at (time)', hint: 'The event’s start minus the trip, the arrive-early time and getting ready.' },
      { key: 'date', label: 'Date', summary: 'The evening before', hint: 'It shows on the day before the early event, so there is time to set the alarm.' },
      { key: 'link', label: 'Link', summary: 'Shows tomorrow’s alarm', hint: 'Tap the row to keep or change it.' },
    ],
  },
  moodLog: {
    example: 'Log how you’re feeling',
    noun: 'Mood check-in',
    locks: ['time'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Log how you’re feeling' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'One a day, or one for each part of the day you picked.' },
      { key: 'time', label: 'Time of day', summary: 'The parts of the day set above', hint: 'With none picked, one task a day at any time.' },
      { key: 'link', label: 'Link', summary: 'Opens the mood log' },
    ],
  },
  moodNudge: {
    example: 'Plan something you enjoy this week',
    noun: 'Low-mood nudge',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Plan something you enjoy this week' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added after the run of low days set above, at most once a week.' },
      { key: 'notes', label: 'Notes', summary: 'How many low days in a row', hint: 'Counts only the days you logged.' },
    ],
  },
  weekendNudge: {
    example: 'Make plans for the weekend',
    noun: 'Weekend nudge',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Make plans for the weekend' },
      { key: 'date', label: 'Date', summary: 'The Friday before the weekend', hint: 'It appears the number of days set above ahead of that.' },
      { key: 'notes', label: 'Notes', summary: 'What’s planned so far', hint: 'Also names a project you marked as a place to look for weekend plans.' },
      { key: 'link', label: 'Link', summary: 'Opens that project', hint: 'Only when a project is marked for weekend plans.' },
    ],
  },
  weighIn: {
    example: 'Record your weight',
    noun: 'Weigh-in task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Record your weight' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added when Apple Health has no weight for the number of days set above.' },
      { key: 'notes', label: 'Notes', summary: 'How long since a weight was recorded', hint: 'From Apple Health.' },
      { key: 'link', label: 'Link', summary: 'Opens Weight' },
    ],
  },
  bloodPressureLog: {
    example: 'Record your blood pressure',
    noun: 'Blood pressure task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Record your blood pressure' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added when Apple Health has no reading for the number of days set above.' },
      { key: 'notes', label: 'Notes', summary: 'How long since a reading was recorded', hint: 'From Apple Health.' },
      { key: 'link', label: 'Link', summary: 'Opens Blood pressure' },
    ],
  },
  waterShortfall: {
    example: 'Drink 250 ml more water',
    noun: 'Water task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Drink (amount) more water' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added when the water target goes up after the daily water task is done.' },
      { key: 'notes', label: 'Notes', summary: 'Why it was added' },
      { key: 'logs', label: 'Completing it', summary: 'Logs that much water', hint: 'Checking it off adds the amount to today’s food log.' },
    ],
  },
  snackNudge: {
    example: 'Have a snack (900 of 2,000 kcal logged)',
    noun: 'Snack nudge',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Have a snack (calories so far)' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added from the hour set above, when much of the day’s calorie target is still unlogged.' },
      { key: 'notes', label: 'Notes', summary: 'Where the figure comes from' },
    ],
  },
  produceNudge: {
    example: 'Add vegetables or fruit (1.5 of 4 servings logged)',
    noun: 'Produce nudge',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Add vegetables or fruit (servings so far)' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added from the hour set above, when the day’s servings are under your goal.' },
      { key: 'notes', label: 'Notes', summary: 'Where the figure comes from, and a recipe idea', hint: 'The idea uses vegetables and fruit your pantry lists, and changes as the pantry does.' },
    ],
  },
  produceFloor: {
    example: 'Restock vegetables and fruit (1 of 4 on hand)',
    noun: 'Restock task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Restock vegetables and fruit (count on hand)' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'Added once a week while the pantry is under the number set above.' },
      { key: 'notes', label: 'Notes', summary: 'Why it was added, and what you have bought before', hint: 'Names vegetables and fruit from your grocery history that are not on hand.' },
    ],
  },
  limitWarning: {
    example: 'Stay under 2,300 mg sodium · 1,200 mg so far',
    noun: 'Limit task',
    locks: ['time', 'ask'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Stay under (limit) (nutrient)' },
      { key: 'kind', label: 'Kind', summary: 'Something to avoid', hint: 'Never checked off. Going past the limit logs a slip.' },
      { key: 'date', label: 'Date', summary: 'None', hint: 'It stays on Today every day the limit is set.' },
      { key: 'streak', label: 'Streak', summary: 'Days under the limit' },
      { key: 'notes', label: 'Notes', summary: 'Today’s total and where it came from' },
      { key: 'link', label: 'Link', summary: 'Opens the food log' },
    ],
  },
  goalTarget: {
    example: 'Aim for 120g protein · 80g so far',
    noun: 'Goal task',
    locks: ['time', 'ask'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Aim for (goal) (nutrient)' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'A new one is added each day the goal is set.' },
      { key: 'notes', label: 'Notes', summary: 'Today’s total and where it came from' },
      { key: 'link', label: 'Link', summary: 'Opens the food log' },
    ],
  },
  bookEvent: {
    example: 'Book Dentist',
    noun: 'Booking task',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Book (saved event)' },
      { key: 'date', label: 'Date', summary: 'A month before the next one is due', hint: 'Counted from the last appointment and how often it repeats, set in Saved events.' },
      { key: 'notes', label: 'Notes', summary: 'When the last one was', hint: 'From the calendar.' },
    ],
  },
  journalLog: {
    example: 'Write in your journal',
    noun: 'Journal reminder',
    locks: ['time'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Write in your journal', hint: 'With parts of the day set above, “Add to today’s journal” instead.' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'One a day, or one for each part of the day you picked.' },
      { key: 'time', label: 'Time of day', summary: 'The parts of the day set above', hint: 'With none picked, one task a day at any time.' },
      { key: 'link', label: 'Link', summary: 'Opens the journal' },
    ],
  },
  dreamLog: {
    example: 'Write down your dream',
    noun: 'Dream reminder',
    owned: () => [
      { key: 'title', label: 'Title', summary: 'Write down your dream' },
      { key: 'date', label: 'Date', summary: 'Today', hint: 'One a day.' },
      { key: 'link', label: 'Link', summary: 'Opens the dream log' },
    ],
  },
  birthday: {
    example: 'Sam’s birthday',
    noun: 'Birthday task',
    owned: ctx => [
      { key: 'title', label: 'Title', summary: '(name)’s birthday', hint: 'Uses the person’s nickname if they have one.' },
      { key: 'date', label: 'Date', summary: appearsPhrase(ctx.birthdayLeadDays, 'the birthday'), hint: 'The number of days is the setting above.' },
      { key: 'deadline', label: 'Deadline', summary: 'The birthday', hint: 'Taken from the person’s page, and moves if you correct it.' },
      { key: 'notes', label: 'Notes', summary: 'Gift ideas', hint: 'Copied from the person’s gift ideas when the task is added. Changes after that are made on the task.' },
      { key: 'link', label: 'Link', summary: 'Opens the person' },
      { key: 'phone', label: 'Phone', summary: 'Their phone number' },
    ],
  },
  wanikani: {
    example: 'WaniKani: 42 reviews',
    noun: 'WaniKani task',
    locks: ['time'],
    owned: () => [
      { key: 'title', label: 'Title', summary: 'WaniKani: (number) reviews, or lessons', hint: 'The count follows your WaniKani queue and is left off when it is empty.' },
      { key: 'date', label: 'Date', summary: 'The day the reviews arrive', hint: 'Today when reviews are waiting, otherwise the day enough are due.' },
      { key: 'time', label: 'Time window', summary: 'Starts at the hour they arrive', hint: 'Held on Later until that hour. The hour changes if you do the reviews in WaniKani first.' },
      { key: 'reminder', label: 'Reminder', summary: 'The hour they arrive', hint: 'Sent only when Notify when reviews arrive is on.' },
      { key: 'link', label: 'Link', summary: 'Opens WaniKani', hint: 'The review page on a reviews task, the lesson page on a lessons task.' },
    ],
  },
};

export function hasTaskSettingsSheet(kind: GeneratedKind): boolean {
  return TASK_SETTINGS_SPECS[kind] !== undefined;
}

/** "Morning, Evening" for a time-of-day list, or null when it's empty. */
export function describeTimeSegments(segments: readonly TimeOfDay[]): string | null {
  return segments.length > 0 ? segments.map(capitalize).join(', ') : null;
}

/**
 * The one-line summary under a kind's "Task settings" row: its category, then
 * whatever else is set, or null when nothing is.
 */
export function describeGeneratedTaskSettings(
  categoryLabel: string | null,
  defaults: TaskFieldDefaults | null | undefined,
  extras: GeneratedTaskExtras | null | undefined,
): string | null {
  const parts: string[] = [];
  if (categoryLabel) parts.push(categoryLabel);
  const d = describeTaskFieldDefaults(defaults);
  if (d) parts.push(d);
  if (hasGeneratedTaskExtras(extras)) {
    if (extras.tags.length > 0) parts.push(extras.tags.map(t => `#${t}`).join(' '));
    const segs = describeTimeSegments(extras.timeSegments);
    if (segs) parts.push(segs);
    if (extras.deliverableKind) parts.push('Asks on completion');
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
