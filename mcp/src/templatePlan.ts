/**
 * A whole template, described in one object, with its cross-references written
 * as names instead of ids.
 *
 * This is the input `create_template` takes and the validation that stands in
 * front of it. Both halves are pure, so they run in the repo's jest with no
 * database and no SDK; applying a plan is `replica.createTemplate`.
 *
 * ## Why names rather than ids
 *
 * A template's parts point at each other: an item sits in an item group, and a
 * condition names the question it rides on. Those pointers are generated ids,
 * which the caller cannot know because they do not exist until the store mints
 * them. So a plan refers to a group by an author-chosen `key` and to a question
 * by its `name`, and applying resolves both. The alternative is four round
 * trips (create, read back the ids, add groups, add items) with a half-built
 * template sitting in the user's list between each one.
 *
 * ## Why validate at all, when the normalizers are tolerant
 *
 * `normalizeTemplateItem` and `normalizeTemplateQuestion` **coerce rather than
 * refuse**: an unknown `kind` becomes `'text'`, an unknown `anchor` becomes
 * `'start'`, a missing field takes a default. That is exactly right for their
 * real job, which is reading a stored blob written by an older build — a row
 * that cannot be parsed is worse than a row read charitably.
 *
 * It is exactly wrong for authoring. A caller that typos `kind: 'choise'` would
 * get a text question, silently, and a template that looks right in the list
 * and behaves differently on every run. The normalizers stay as they are; this
 * refuses first. Every check here is one the normalizer would otherwise have
 * swallowed, or a cross-reference it has no way to see.
 *
 * **Errors are collected, not thrown on the first one.** A caller fixing one
 * mistake per round trip is the thing a single call was supposed to avoid.
 */
import type {
  Effort,
  Priority,
  RecurrenceType,
  TaskTemplate,
  TemplateAnchor,
  TemplateContainer,
  TemplateItem,
  TemplateQuestionKind,
  TemplateQuestionSource,
  TemplateScheduleFrequency,
  TimeOfDay,
} from '../../src/types';
import { deliverableOptionsFor } from '../../src/utils/deliverables';
import { RUN_PLACEHOLDER, itemPlaceholders, placeholderKey, wouldCreateCycle } from '../../src/utils/templateUtils';
import { MIN_ROTATION_ITEMS, rotationMemberTitle, rotationMemberToInput, type RotationMemberInput } from '../../src/utils/rotation';

export const CONTAINERS: readonly TemplateContainer[] = ['none', 'stack', 'project', 'task'];
export const QUESTION_KINDS: readonly TemplateQuestionKind[] = ['text', 'number', 'choice', 'people'];
export const QUESTION_SOURCES: readonly TemplateQuestionSource[] = ['none', 'days', 'nights'];
export const SCHEDULE_FREQUENCIES: readonly TemplateScheduleFrequency[] = ['weekly', 'monthly', 'yearly'];
export const ANCHORS: readonly TemplateAnchor[] = ['start', 'end'];
export const RECURRENCE_TYPES: readonly RecurrenceType[] = ['none', 'daily', 'weekly', 'monthly', 'yearly', 'hours'];

export interface GroupPlan {
  /**
   * The caller's own handle for this group, referenced by an item's `groupKey`.
   * On an update, the id of an existing group keeps that group (and so the
   * items filed in it) rather than replacing it with a new one.
   */
  key: string;
  title: string;
  /** Run into a project, the section is a checklist. */
  checklist?: boolean;
}

export interface QuestionPlan {
  /**
   * The `{blank}` this fills, and how an item's condition names it. Forced
   * empty for a `people` question by `normalizeTemplateQuestion`, so one of
   * those can never be referenced or conditioned on.
   */
  name?: string;
  /**
   * A handle for a question with no name, which fills no blank: a choice
   * that only decides what is ticked, or a people question. A condition names
   * the question by its name or this key. `get_template` hands back the
   * question's id here, and an update that keeps it keeps the question.
   */
  key?: string;
  prompt: string;
  kind: TemplateQuestionKind;
  /** Required for a choice, meaningless otherwise. The first is the default. */
  options?: string[];
  defaultValue?: string;
  /** A number question can take its answer off the anchor dates instead. */
  fromDates?: TemplateQuestionSource;
}

export interface ConditionPlan {
  /** A choice question's `name`, or its `key` when it has none. Only a choice can gate an item. */
  question: string;
  /** Which of that question's options switch this item on. */
  values: string[];
}

/**
 * One item. Every field `TemplateItem` has is accepted and optional, because
 * `normalizeTemplateItem` fills the rest — restating its defaults here would be
 * a second copy to keep in step.
 */
export interface ChainStepPlan {
  title: string;
  estimatedMinutes?: number | null;
  /** A question this step asks when ticked. A step cannot ask a pick-one question. */
  asks?: 'text' | 'date' | 'number' | 'yesno' | null;
  /** Only with asks: 'date': the answer dates the step after it. */
  answerSchedulesNextStep?: boolean;
}

export interface VariantPlan {
  /** A choice question's `name`. */
  question: string;
  /** One of that question's options. */
  answer: string;
  /** Replaces the item's title for this answer. Omit to keep it. */
  title?: string;
  /** Replaces the item's notes for this answer. Omit to keep them. */
  notes?: string;
}

export interface ItemPlan extends Partial<Omit<TemplateItem, 'id' | 'groupId' | 'conditions' | 'variants' | 'refTemplateId' | 'answerGate' | 'blockedByItemIds' | 'chainEnabled' | 'chainItems' | 'chainIndex' | 'rotationEnabled' | 'rotationItems'>> {
  /** Steps done one after another, each appearing when the one before is done. null removes it. */
  chain?: { steps: ChainStepPlan[] } | null;
  /** Named things each done once a week in any order: two or more, all different. null removes it. */
  rotation?: { members: RotationMemberInput[] } | null;
  /** Required, except on an update where `id` names the item that already has one. */
  title?: string;
  /**
   * Update only: the id of an item this template already has. The stored item
   * is the starting point and the fields given here are written over it, so a
   * field this plan has no name for survives, and `{ id }` alone keeps an item
   * exactly as it is. An item with no id is new; an existing item left out of
   * `items` is removed.
   */
  id?: string;
  /** The caller's own handle for this item, which another item's `onlyIfAnswer` names. An item with an `id` is also known by it. */
  key?: string;
  /**
   * TemplateItem.answerGate: shown only for these answers to the question
   * the item with this `key` asks. Becomes Task.answerGate when applied.
   */
  onlyIfAnswer?: { item: string; answers: string[] } | null;
  /** TemplateItem.blockedByItemIds: keys of other items in this plan to wait on. */
  waitsOn?: string[];
  /** A `GroupPlan.key`. null (on an update) takes the item out of its group. */
  groupKey?: string | null;
  conditions?: ConditionPlan[];
  /** Different title and/or notes for particular answers of a choice question (TemplateItemVariant). */
  variants?: VariantPlan[];
  /** An existing template's id, or its name when that names exactly one. */
  refTemplate?: string;
}

export interface SchedulePlan {
  frequency: TemplateScheduleFrequency;
  /** 0-6, for a weekly schedule. */
  weekday?: number;
  /** 1-31, for monthly and yearly. */
  monthDay?: number;
  /** 1-12, for yearly: `TemplateSchedule.month`'s own convention (January is 1). */
  month?: number;
  /** "HH:MM". */
  time?: string;
  anchorSpanDays?: number | null;
}

export interface TemplatePlan {
  name: string;
  category?: string | null;
  container?: TemplateContainer;
  /** Whether the template's anchors mean "days away". Off unless said. */
  anchorsAreAway?: boolean;
  schedule?: SchedulePlan | null;
  groups?: GroupPlan[];
  questions?: QuestionPlan[];
  items?: ItemPlan[];
}

/**
 * An edit to a template: any part of a plan, with what is left out unchanged.
 * `groups`, `questions` and `items` replace their whole list when given, since
 * items point at both of the others. `schedule: null` removes the schedule.
 */
export type TemplatePatch = Partial<TemplatePlan>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What a schedule's unset fields fall back to.
 *
 * `TemplateSchedule` has no optional fields, so a plan naming only a frequency
 * still has to produce a whole one. Monday, the 1st, January and 9am are the
 * same defaults the schedule editor opens on.
 */
export const DEFAULT_SCHEDULE = {
  weekday: 1,
  monthDay: 1,
  month: 1,
  time: '09:00',
  anchorSpanDays: null,
} as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): boolean {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * Everything wrong with a plan, in one list.
 *
 * `existing` is every template already stored, needed only to resolve
 * `refTemplate`. An empty list means the plan is safe to apply.
 *
 * **Cycles are deliberately not checked here, and that is not an oversight.**
 * `wouldCreateCycle` matters when an *existing* template gains a reference,
 * because the target may already reach back. A template being created cannot be
 * the target of anything: nothing that exists can name an id that has not been
 * minted. `update_template` passes `selfId`, which is what turns the guard on.
 */
export function validateTemplatePlan(
  plan: TemplatePlan,
  existing: readonly TaskTemplate[],
  /** The template being updated, if any. Turns on the checks only an edit needs. */
  selfId?: string
): string[] {
  const errors: string[] = [];
  const self = selfId === undefined ? undefined : existing.find(t => t.id === selfId);

  if (!plan.name?.trim()) errors.push('name is required.');
  if (plan.container !== undefined && !oneOf(plan.container, CONTAINERS)) {
    errors.push(`container must be one of ${CONTAINERS.join(', ')}.`);
  }

  const groups = plan.groups ?? [];
  const groupKeys = new Set<string>();
  for (const group of groups) {
    if (!group.key?.trim()) errors.push('every group needs a key.');
    else if (groupKeys.has(group.key)) errors.push(`two groups share the key "${group.key}".`);
    else groupKeys.add(group.key);
    if (!group.title?.trim()) errors.push(`group "${group.key}" needs a title.`);
  }

  const questions = plan.questions ?? [];
  const choices = new Map<string, string[]>();
  const questionNames = new Set<string>();
  const questionKeys = new Set<string>();
  for (const question of questions) {
    if (question.key !== undefined) {
      if (!question.key.trim()) errors.push('a question key cannot be blank.');
      else if (questionKeys.has(question.key)) errors.push(`two questions share the key "${question.key}".`);
      questionKeys.add(question.key);
    }
    if (!oneOf(question.kind, QUESTION_KINDS)) {
      errors.push(`question kind must be one of ${QUESTION_KINDS.join(', ')}.`);
      continue;
    }
    if (question.fromDates !== undefined && !oneOf(question.fromDates, QUESTION_SOURCES)) {
      errors.push(`question "${question.name}" fromDates must be one of ${QUESTION_SOURCES.join(', ')}.`);
    } else if (question.fromDates && question.fromDates !== 'none' && question.kind !== 'number') {
      // The normalizer drops it silently for every other kind, which reads as
      // the answer simply not coming off the dates rather than as a mistake.
      errors.push(`fromDates only applies to a number question, not "${question.name}".`);
    }

    if (question.kind === 'people') {
      // normalizeTemplateQuestion forces the name empty, so a people question
      // is unnameable by construction. Saying so beats silently dropping one.
      if (question.name) errors.push('a people question fills no blank, so it cannot have a name.');
      continue;
    }

    if (!question.name?.trim()) {
      // A choice with a key and no name is the app's "only decides what is
      // ticked" question: it fills no blank, and conditions name it by key.
      if (question.kind === 'choice' && question.key?.trim()) {
        const options = question.options ?? [];
        if (options.length < 2) errors.push(`choice question "${question.key}" needs at least two options.`);
        else choices.set(question.key, options);
        questionNames.add(question.key);
        continue;
      }
      errors.push('every question except a people one needs a name (or, for a choice that fills no blank, a key).');
      continue;
    }
    if (questionNames.has(question.name)) {
      // The arch doc calls two questions claiming one blank "a mistake with no
      // good answer". Authoring is where it can still be refused.
      errors.push(`two questions share the name "${question.name}".`);
      continue;
    }
    questionNames.add(question.name);

    if (question.kind === 'choice') {
      const options = question.options ?? [];
      if (options.length < 2) errors.push(`choice question "${question.name}" needs at least two options.`);
      else choices.set(question.name, options);
    }
  }

  const items = plan.items ?? [];
  if (items.length === 0) errors.push('a template needs at least one item.');

  const seenIds = new Set<string>();
  for (const item of items) {
    if (item.id === undefined) continue;
    if (!self?.items.some(i => i.id === item.id)) errors.push(`item id "${item.id}" is not an item of this template.`);
    else if (seenIds.has(item.id)) errors.push(`item id "${item.id}" is used twice.`);
    seenIds.add(item.id);
  }

  // Item keys, and what each keyed item offers as answers, for onlyIfAnswer.
  const itemAnswers = new Map<string, string[]>();
  for (const item of items) {
    const key = item.key ?? item.id;
    if (key === undefined) continue;
    if (itemAnswers.has(key)) errors.push(`item key "${key}" is used twice.`);
    itemAnswers.set(key, deliverableOptionsFor({
      deliverableKind: item.deliverableKind ?? null,
      deliverableOptions: item.deliverableOptions,
      chainEnabled: false,
      chainItems: [],
      chainIndex: 0,
    } as Parameters<typeof deliverableOptionsFor>[0]));
  }

  errors.push(...waitsOnErrors(items, itemAnswers));
  for (const item of items) {
    const label = item.title || '(untitled)';
    errors.push(...gateErrors(item, label, itemAnswers));
    if (!item.title?.trim()) errors.push('every item needs a title.');

    if (item.anchor !== undefined && !oneOf(item.anchor, ANCHORS)) {
      errors.push(`item "${label}" anchor must be start or end.`);
    }
    if (item.groupKey != null && !groupKeys.has(item.groupKey)) {
      errors.push(`item "${label}" names group "${item.groupKey}", which the plan does not define.`);
    }
    errors.push(...conditionErrors(item, label, choices, questionNames));
    errors.push(...variantErrors(item, label, choices, questionNames));
    errors.push(...refErrors(item, label, existing, selfId));
    errors.push(...rangeErrors(item, label));
  }

  errors.push(...scheduleErrors(plan.schedule));
  return errors;
}

function variantErrors(
  item: ItemPlan,
  label: string,
  choices: Map<string, string[]>,
  questionNames: Set<string>
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const variant of item.variants ?? []) {
    const options = choices.get(variant.question);
    if (!options) {
      errors.push(
        questionNames.has(variant.question)
          ? `item "${label}" has a variant on "${variant.question}", which is not a choice question.`
          : `item "${label}" has a variant on "${variant.question}", which the plan does not define.`
      );
      continue;
    }
    if (!options.includes(variant.answer)) {
      errors.push(`item "${label}" has a variant for "${variant.question}" = "${variant.answer}", which is not one of its options (${options.join(', ')}).`);
    }
    if (!variant.title?.trim() && !variant.notes?.trim()) {
      errors.push(`item "${label}" has a variant for "${variant.question}" = "${variant.answer}" with no title or notes.`);
    }
    const key = `${variant.question}\u0000${variant.answer}`;
    if (seen.has(key)) errors.push(`item "${label}" has two variants for "${variant.question}" = "${variant.answer}".`);
    seen.add(key);
  }
  return errors;
}

function conditionErrors(
  item: ItemPlan,
  label: string,
  choices: Map<string, string[]>,
  questionNames: Set<string>
): string[] {
  const errors: string[] = [];
  for (const condition of item.conditions ?? []) {
    const options = choices.get(condition.question);
    if (!options) {
      // Two different mistakes, and the distinction is worth the words: naming
      // nothing is a typo, naming a non-choice is a misunderstanding of what
      // can gate an item.
      errors.push(
        questionNames.has(condition.question)
          ? `item "${label}" is conditioned on "${condition.question}", which is not a choice question. Only a choice can gate an item.`
          : `item "${label}" is conditioned on "${condition.question}", which the plan does not define.`
      );
      continue;
    }
    if ((condition.values ?? []).length === 0) {
      errors.push(`item "${label}" has a condition on "${condition.question}" with no values.`);
    }
    for (const value of condition.values ?? []) {
      if (!options.includes(value)) {
        errors.push(
          `item "${label}" is conditioned on "${condition.question}" = "${value}", which is not one of its options (${options.join(', ')}).`
        );
      }
    }
  }
  return errors;
}

function refErrors(item: ItemPlan, label: string, existing: readonly TaskTemplate[], selfId?: string): string[] {
  if (item.refTemplate === undefined) return [];

  const matches = resolveRef(item.refTemplate, existing);
  // A reference the template already held when its target was deleted is
  // kept as it stands (the app shows it as broken, and a run skips it).
  // Refusing it would make every structural edit of such a template fail
  // until someone found and removed the item by hand.
  const self = selfId === undefined ? undefined : existing.find(t => t.id === selfId);
  if (matches.length === 0 && self?.items.some(i => i.refTemplateId === item.refTemplate)) return [];
  if (matches.length === 0) return [`item "${label}" references template "${item.refTemplate}", which does not exist.`];
  if (matches.length > 1) {
    return [`item "${label}" references "${item.refTemplate}", which names ${matches.length} templates. Use an id.`];
  }
  if (selfId !== undefined && wouldCreateCycle(existing as TaskTemplate[], selfId, matches[0].id)) {
    return [`item "${label}" nests "${matches[0].name}", which would make the template contain itself.`];
  }
  return [];
}

/** By id first, then by exact name. Several matches is the caller's to resolve. */
export function resolveRef(ref: string, existing: readonly TaskTemplate[]): TaskTemplate[] {
  const byId = existing.find(t => t.id === ref);
  if (byId) return [byId];
  return existing.filter(t => t.name === ref);
}

/**
 * The numeric fields whose wrong values the normalizer would keep verbatim.
 *
 * It only fills absent ones, so a negative interval or a 40th of the month
 * stores exactly as given and surfaces later as a schedule that never fires.
 */
/**
 * An `onlyIfAnswer` has to name another keyed item that asks a Yes/No or Pick
 * one question, and answers it offers: a gate on an answer the question can't
 * give would never open, and the task would be not needed on every run.
 */
function gateErrors(item: ItemPlan, label: string, itemAnswers: Map<string, string[]>): string[] {
  const gate = item.onlyIfAnswer;
  if (!gate) return [];
  const offered = itemAnswers.get(gate.item);
  if (!offered) return [`item "${label}" is only if "${gate.item}", which is not an item key in this plan.`];
  if (gate.item === item.key) return [`item "${label}" can't depend on its own answer.`];
  if (offered.length < 2) return [`item "${label}" is only if "${gate.item}", which doesn't ask a Yes/No or pick-one question.`];
  if ((gate.answers ?? []).length === 0) return [`item "${label}" has an onlyIfAnswer with no answers.`];
  return gate.answers
    .filter(a => !offered.some(o => o.toLowerCase() === a.trim().toLowerCase()))
    .map(a => `item "${label}" is only if "${gate.item}" = "${a}", which is not one of its answers (${offered.join(', ')}).`);
}

/**
 * Every `waitsOn` names another keyed item, and no two items wait on each
 * other however long the loop: a cycle would hold every task in it for good.
 */
function waitsOnErrors(items: readonly ItemPlan[], itemAnswers: Map<string, string[]>): string[] {
  const errors: string[] = [];
  const edges = new Map<string, string[]>();
  for (const item of items) {
    const label = item.title || '(untitled)';
    const self = item.key ?? item.id;
    for (const target of item.waitsOn ?? []) {
      if (!itemAnswers.has(target)) errors.push(`item "${label}" waits on "${target}", which is not an item key in this plan.`);
      else if (target === self) errors.push(`item "${label}" can't wait on itself.`);
    }
    if (self !== undefined) edges.set(self, (item.waitsOn ?? []).filter(t => t !== self));
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (key: string): boolean => {
    if (state.get(key) === 'done') return false;
    if (state.get(key) === 'visiting') return true;
    state.set(key, 'visiting');
    const looped = (edges.get(key) ?? []).some(visit);
    state.set(key, 'done');
    return looped;
  };
  if ([...edges.keys()].some(visit)) errors.push('items wait on each other in a loop, so none of them could ever start.');
  return errors;
}

function rangeErrors(item: ItemPlan, label: string): string[] {
  const errors: string[] = [];
  const positive = (value: number | null | undefined, field: string) => {
    if (value !== undefined && value !== null && value <= 0) errors.push(`item "${label}" ${field} must be above zero.`);
  };

  // normalizeTemplateItem stores any string here verbatim, and a "biweekly"
  // reads as a repeat in the editor while getNextDueDate matches none of it.
  if (item.recurrenceType !== undefined && !RECURRENCE_TYPES.includes(item.recurrenceType)) {
    errors.push(`item "${label}" recurrenceType must be one of ${RECURRENCE_TYPES.join(', ')}.`);
  }
  if (item.deliverableKind === 'choice' && (item.deliverableOptions ?? []).filter(o => o.trim()).length < 2) {
    errors.push(`item "${label}" asks a choice question, which needs at least two deliverableOptions.`);
  }
  positive(item.recurrenceInterval, 'recurrenceInterval');
  positive(item.estimatedMinutes, 'estimatedMinutes');
  positive(item.completionTimerMinutes, 'completionTimerMinutes');
  positive(item.recurrenceCount, 'recurrenceCount');
  if (item.recurrenceMonth != null && (item.recurrenceMonth < 1 || item.recurrenceMonth > 12)) {
    errors.push(`item "${label}" recurrenceMonth must be 1 to 12.`);
  }
  const chain = item.chain;
  if (chain) {
    if (chain.steps.length < 2) errors.push(`item "${label}" chain needs at least two steps. One step is just a task.`);
    chain.steps.forEach((step, i) => {
      if (!step.title?.trim()) errors.push(`item "${label}" chain step ${i + 1} needs a title.`);
      if (step.asks != null && !['text', 'date', 'number', 'yesno'].includes(step.asks)) {
        errors.push(`item "${label}" chain step ${i + 1} asks must be text, date, number or yesno.`);
      }
      if (step.answerSchedulesNextStep && step.asks !== 'date') errors.push(`item "${label}" chain step ${i + 1} answerSchedulesNextStep needs asks: "date".`);
      positive(step.estimatedMinutes, `chain step ${i + 1} estimatedMinutes`);
    });
  }
  const rotation = item.rotation;
  if (rotation) {
    const names = rotation.members.map(rotationMemberTitle);
    if (names.length < MIN_ROTATION_ITEMS) errors.push(`item "${label}" rotation needs at least ${MIN_ROTATION_ITEMS} members. One is just a task.`);
    if (names.some(n => !n)) errors.push(`item "${label}" rotation members cannot be blank.`);
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) errors.push(`item "${label}" rotation members must all be different.`);
  }
  if (chain && rotation) errors.push(`item "${label}" cannot be both a chain and a rotation.`);
  if (item.polarity !== undefined && !['positive', 'negative'].includes(item.polarity)) {
    errors.push(`item "${label}" polarity must be positive or negative.`);
  }
  if (item.weatherWait != null && !['sunny', 'rainy', 'snowy', 'cold', 'hot'].includes(item.weatherWait)) {
    errors.push(`item "${label}" weatherWait must be sunny, rainy, snowy, cold or hot.`);
  }

  if (item.recurrenceWeekOrdinal != null) {
    if (![1, 2, 3, 4, -1].includes(item.recurrenceWeekOrdinal)) errors.push(`item "${label}" recurrenceWeekOrdinal must be 1 to 4, or -1 for the last.`);
    if (item.recurrenceType !== 'monthly') errors.push(`item "${label}" recurrenceWeekOrdinal only applies to a monthly repeat.`);
    if ((item.recurrenceDays ?? []).length === 0) errors.push(`item "${label}" recurrenceWeekOrdinal needs the weekday in recurrenceDays.`);
    if (item.recurrenceMonthDay != null) errors.push(`item "${label}" can't have both recurrenceWeekOrdinal and recurrenceMonthDay.`);
  }
  if (item.targetCount != null && item.targetCount < 2) errors.push(`item "${label}" targetCount must be 2 or more (one is just a task).`);
  if (item.quotaPeriod !== undefined && !['day', 'week'].includes(item.quotaPeriod)) errors.push(`item "${label}" quotaPeriod must be day or week.`);
  if (item.recurrenceMonthDay != null && (item.recurrenceMonthDay < 1 || item.recurrenceMonthDay > 31)) {
    errors.push(`item "${label}" recurrenceMonthDay must be 1 to 31.`);
  }
  for (const day of item.recurrenceDays ?? []) {
    if (day < 0 || day > 6) errors.push(`item "${label}" recurrenceDays must be 0 to 6.`);
  }
  for (const field of ['windowStart', 'windowEnd'] as const) {
    const value = item[field];
    if (value != null && !HHMM.test(value)) errors.push(`item "${label}" ${field} must be HH:MM.`);
  }
  for (const segment of (item.timeSegments ?? []) as TimeOfDay[]) {
    if (!['morning', 'afternoon', 'evening'].includes(segment)) {
      errors.push(`item "${label}" timeSegments must be morning, afternoon or evening.`);
    }
  }
  if (item.priority !== undefined && ![0, 1, 2, 3, 4].includes(item.priority as Priority)) {
    errors.push(`item "${label}" priority must be 0 to 4.`);
  }
  // 0 to 6, not 0 to 4 like priority: EFFORT_LABELS runs '—' then XXS to XL.
  if (item.effort !== undefined && ![0, 1, 2, 3, 4, 5, 6].includes(item.effort as Effort)) {
    errors.push(`item "${label}" effort must be 0 to 6.`);
  }
  return errors;
}

export function scheduleErrors(schedule: SchedulePlan | null | undefined): string[] {
  if (!schedule) return [];
  const errors: string[] = [];

  if (!oneOf(schedule.frequency, SCHEDULE_FREQUENCIES)) {
    errors.push(`schedule frequency must be one of ${SCHEDULE_FREQUENCIES.join(', ')}.`);
  }
  if (schedule.time !== undefined && !HHMM.test(schedule.time)) errors.push('schedule time must be HH:MM.');
  if (schedule.weekday !== undefined && (schedule.weekday < 0 || schedule.weekday > 6)) {
    errors.push('schedule weekday must be 0 to 6.');
  }
  if (schedule.monthDay !== undefined && (schedule.monthDay < 1 || schedule.monthDay > 31)) {
    errors.push('schedule monthDay must be 1 to 31.');
  }
  if (schedule.month !== undefined && (schedule.month < 1 || schedule.month > 12)) {
    errors.push('schedule month must be 1 to 12.');
  }
  return errors;
}

/**
 * A stored template written back as a plan, which is what `get_template`
 * returns and what `update_template` takes pieces of. Groups are keyed by their
 * id and items carry theirs, so handing a piece back keeps the thing it names.
 * An item is also given a `key` when another item's answer gate points at it.
 */
export function templateToPlan(template: TaskTemplate): TemplatePlan & { id: string } {
  // What the plan hands back has to pass validateTemplatePlan unchanged, or a
  // template can't be edited at all. So pointers every reader already shrugs
  // off (a condition on a deleted question or with no values, a gate on an
  // item that is gone) are left out here rather than echoed back as errors.
  const itemIds = new Set(template.items.map(i => i.id));
  const liveGate = (item: TemplateItem) => (item.answerGate && itemIds.has(item.answerGate.itemId) ? item.answerGate : null);
  const liveWaits = (item: TemplateItem) => (item.blockedByItemIds ?? []).filter(id => itemIds.has(id) && id !== item.id);
  const gateTargets = new Set([
    ...template.items.map(i => liveGate(i)?.itemId).filter((x): x is string => !!x),
    ...template.items.flatMap(liveWaits),
  ]);
  // A question with no name is named by its id, so it keeps that id and its
  // conditions still find it.
  const questionHandle = new Map(template.questions.map(q => [q.id, q.name || q.id]));
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    container: template.applyContainer,
    anchorsAreAway: template.anchorsAreAway,
    schedule: template.schedule,
    groups: template.itemGroups.map(g => ({ key: g.id, title: g.title, ...(g.checklist ? { checklist: true } : {}) })),
    questions: template.questions.map(q => ({
      ...(q.name ? { name: q.name } : { key: q.id }),
      prompt: q.prompt,
      kind: q.kind,
      ...(q.options.length ? { options: q.options } : {}),
      ...(q.defaultValue ? { defaultValue: q.defaultValue } : {}),
      ...(q.fromDates !== 'none' ? { fromDates: q.fromDates } : {}),
    })),
    items: template.items.map(item => {
      const { groupId, conditions, variants, refTemplateId, refTemplateName, answerGate, blockedByItemIds, chainEnabled, chainItems, chainIndex, rotationEnabled, rotationItems, ...fields } = item;
      void blockedByItemIds;
      void chainIndex;
      return {
        ...fields,
        ...(chainEnabled && chainItems.length > 1
          ? { chain: { steps: chainItems.map(c => ({ title: c.title, estimatedMinutes: c.estimatedMinutes, ...(c.deliverableKind ? { asks: c.deliverableKind as ChainStepPlan['asks'] } : {}), ...(c.deliverableDatesNextStep ? { answerSchedulesNextStep: true } : {}) })) } }
          : {}),
        ...(rotationEnabled && rotationItems.length >= 2 ? { rotation: { members: rotationItems.map(rotationMemberToInput) } } : {}),
        ...(gateTargets.has(item.id) ? { key: item.id } : {}),
        ...(groupId ? { groupKey: groupId } : {}),
        ...(() => {
          const live = conditions.filter(c => questionHandle.has(c.questionId) && c.values.length > 0);
          return live.length ? { conditions: live.map(c => ({ question: questionHandle.get(c.questionId)!, values: c.values })) } : {};
        })(),
        // A variant on a deleted question is left out for the reason a
        // condition on one is: every reader already ignores it.
        ...(() => {
          const live = (variants ?? []).filter(v => questionHandle.has(v.questionId));
          return live.length
            ? { variants: live.map(v => ({ question: questionHandle.get(v.questionId)!, answer: v.answer, ...(v.title ? { title: v.title } : {}), ...(v.notes ? { notes: v.notes } : {}) })) }
            : {};
        })(),
        ...(liveGate(item) ? { onlyIfAnswer: { item: answerGate!.itemId, answers: answerGate!.answers } } : {}),
        ...(liveWaits(item).length > 0 ? { waitsOn: liveWaits(item) } : {}),
        ...(refTemplateId ? { refTemplate: refTemplateId } : {}),
      };
    }),
  };
}

/**
 * A short fingerprint of what a template holds, handed out by `get_template`
 * and checked by `update_template`'s `expectedVersion`.
 *
 * `update_template` rebuilds whole lists from what the caller sends, so an
 * edit composed against a read made before the phone changed the template
 * would silently undo that change. There is no stored revision to compare,
 * so this is a hash of the content itself. `scheduleLastFiredKey` is left out:
 * it moves when a schedule fires, which is not an edit anyone made.
 */
export function templateVersion(template: TaskTemplate): string {
  const { scheduleLastFiredKey, ...content } = template;
  void scheduleLastFiredKey;
  const text = JSON.stringify(stableValue(content));
  // FNV-1a, 32-bit, twice with different seeds: no crypto needed, and a
  // collision would only mean a stale edit is not caught.
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return fnv(0x811c9dc5) + fnv(0x01000193);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object).sort()
        .filter(k => (value as Record<string, unknown>)[k] !== undefined)
        .map(k => [k, stableValue((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Things a template will do that its author probably didn't mean, which the
 * normalizer or a run would otherwise swallow without a word. Not errors: each
 * is a legal template, and refusing them would refuse templates the app's own
 * editor makes. Returned with a create or an edit so the caller can fix them
 * or say why not.
 */
export function templateWarnings(
  template: TaskTemplate,
  /** Every task category the person has, to flag one a run would create. */
  categories: readonly string[],
): string[] {
  const warnings: string[] = [];
  const blankOwners = new Set(template.questions.map(q => placeholderKey(q.name)).filter(Boolean));
  blankOwners.add(RUN_PLACEHOLDER);
  const known = new Set(categories.map(c => c.toLowerCase()));
  const label = (item: TemplateItem) => `item "${item.title || item.refTemplateName || item.id}"`;

  for (const item of template.items) {
    if (item.refTemplateId !== null) {
      if (item.conditions.length > 0) warnings.push(`${label(item)} nests a template, so its conditions are ignored; only "optional" decides whether the nested block starts ticked.`);
      continue;
    }
    const undeclared = itemPlaceholders(item).filter(name => !blankOwners.has(name));
    for (const name of undeclared) {
      warnings.push(`${label(item)} uses {${name}}, which no question fills. The app asks for it as a blank, but a scheduled run or apply_template leaves it empty and drops it from the text. Add a question named "${name}", or remove the braces if they are not a blank.`);
    }
    if (item.reminderOffsetMinutes != null && item.dueOffsetDays == null) {
      warnings.push(`${label(item)} has reminderOffsetMinutes but no dueOffsetDays, so there is no date to remind before and no reminder is set.`);
    }
    if (item.weatherWait && (item.recurrenceType !== 'none' || item.chainEnabled)) {
      warnings.push(`${label(item)} waits for weather but repeats or is a chain; only a one-off can wait, so the wait is dropped.`);
    }
    if (item.dueOffsetDays != null && item.deferOffsetDays != null && item.deferOffsetDays > item.dueOffsetDays) {
      warnings.push(`${label(item)} is hidden until after its due date (deferOffsetDays ${item.deferOffsetDays} > dueOffsetDays ${item.dueOffsetDays}).`);
    }
    if (item.dueOffsetDays != null && item.deadlineOffsetDays != null && item.deadlineOffsetDays < item.dueOffsetDays) {
      warnings.push(`${label(item)} has a deadline before its due date.`);
    }
    if (item.windowStart && item.windowEnd && item.windowEnd <= item.windowStart) {
      warnings.push(`${label(item)} has a time window that ends before it starts, so the end is ignored.`);
    }
    if (item.recurrenceDays.length > 0 && item.recurrenceType !== 'weekly') {
      warnings.push(`${label(item)} lists recurrenceDays but repeats ${item.recurrenceType}, so the days are ignored.`);
    }
    if (item.deliverableOptions && item.deliverableOptions.length > 0 && item.deliverableKind !== 'choice') {
      warnings.push(`${label(item)} has deliverableOptions but does not ask a choice question, so they are unused.`);
    }
    if (item.category && !known.has(item.category.toLowerCase())) {
      warnings.push(`${label(item)} is in category "${item.category}", which does not exist yet; running the template creates it.`);
    }
  }
  return warnings;
}

/**
 * What an edit changed, in plain words, for the preview an edit is confirmed
 * from. "Change the template X" was all the person saw before, which is not
 * something anyone can say yes to.
 */
export function describeTemplateChanges(before: TaskTemplate, after: TaskTemplate): string[] {
  const out: string[] = [];
  if (before.name !== after.name) out.push(`Rename to "${after.name}".`);
  if (before.category !== after.category) out.push(`Category: ${before.category ?? 'none'} → ${after.category ?? 'none'}.`);
  if (before.applyContainer !== after.applyContainer) out.push(`Runs into: ${before.applyContainer} → ${after.applyContainer}.`);
  if (before.anchorsAreAway !== after.anchorsAreAway) out.push(after.anchorsAreAway ? 'Its dates now mean days away.' : 'Its dates no longer mean days away.');
  if (JSON.stringify(stableValue(before.schedule)) !== JSON.stringify(stableValue(after.schedule))) {
    out.push(after.schedule ? (before.schedule ? 'Change the schedule.' : 'Add a schedule.') : 'Remove the schedule.');
  }

  const title = (i: TemplateItem) => i.title || i.refTemplateName || '(untitled)';
  const beforeItems = new Map(before.items.map(i => [i.id, i]));
  const afterIds = new Set(after.items.map(i => i.id));
  for (const item of after.items) {
    const old = beforeItems.get(item.id);
    if (!old) { out.push(`Add item "${title(item)}".`); continue; }
    const fields = (Object.keys({ ...old, ...item }) as (keyof TemplateItem)[])
      .filter(k => k !== 'id' && JSON.stringify(stableValue(old[k])) !== JSON.stringify(stableValue(item[k])));
    if (fields.length > 0) out.push(`Change item "${title(old)}": ${fields.join(', ')}.`);
  }
  for (const item of before.items) if (!afterIds.has(item.id)) out.push(`Remove item "${title(item)}".`);
  if (before.items.map(i => i.id).filter(id => afterIds.has(id)).join() !== after.items.map(i => i.id).filter(id => beforeItems.has(id)).join()) {
    out.push('Reorder items.');
  }

  const qLabel = (q: TaskTemplate['questions'][number]) => q.name || q.prompt || q.id;
  const beforeQ = new Map(before.questions.map(q => [q.id, q]));
  const afterQ = new Set(after.questions.map(q => q.id));
  for (const q of after.questions) {
    const old = beforeQ.get(q.id);
    if (!old) out.push(`Add question "${qLabel(q)}".`);
    else if (JSON.stringify(stableValue(old)) !== JSON.stringify(stableValue(q))) out.push(`Change question "${qLabel(old)}".`);
  }
  for (const q of before.questions) if (!afterQ.has(q.id)) out.push(`Remove question "${qLabel(q)}".`);

  const beforeG = new Map(before.itemGroups.map(g => [g.id, g]));
  const afterG = new Set(after.itemGroups.map(g => g.id));
  for (const g of after.itemGroups) {
    const old = beforeG.get(g.id);
    if (!old) out.push(`Add group "${g.title}".`);
    else if (old.title !== g.title || !!old.checklist !== !!g.checklist) out.push(`Change group "${old.title}".`);
  }
  for (const g of before.itemGroups) if (!afterG.has(g.id)) out.push(`Remove group "${g.title}".`);
  return out;
}
