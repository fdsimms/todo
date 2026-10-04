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
import { wouldCreateCycle } from '../../src/utils/templateUtils';

export const CONTAINERS: readonly TemplateContainer[] = ['none', 'stack', 'project', 'task'];
export const QUESTION_KINDS: readonly TemplateQuestionKind[] = ['text', 'number', 'choice', 'people'];
export const QUESTION_SOURCES: readonly TemplateQuestionSource[] = ['none', 'days', 'nights'];
export const SCHEDULE_FREQUENCIES: readonly TemplateScheduleFrequency[] = ['weekly', 'monthly', 'yearly'];
export const ANCHORS: readonly TemplateAnchor[] = ['start', 'end'];

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
  prompt: string;
  kind: TemplateQuestionKind;
  /** Required for a choice, meaningless otherwise. The first is the default. */
  options?: string[];
  defaultValue?: string;
  /** A number question can take its answer off the anchor dates instead. */
  fromDates?: TemplateQuestionSource;
}

export interface ConditionPlan {
  /** A choice question's `name`. Only a choice can gate an item. */
  question: string;
  /** Which of that question's options switch this item on. */
  values: string[];
}

/**
 * One item. Every field `TemplateItem` has is accepted and optional, because
 * `normalizeTemplateItem` fills the rest — restating its defaults here would be
 * a second copy to keep in step.
 */
export interface ItemPlan extends Partial<Omit<TemplateItem, 'id' | 'groupId' | 'conditions' | 'refTemplateId' | 'answerGate'>> {
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
  onlyIfAnswer?: { item: string; answers: string[] };
  /** A `GroupPlan.key`. */
  groupKey?: string;
  conditions?: ConditionPlan[];
  /** An existing template's id, or its name when that names exactly one. */
  refTemplate?: string;
}

export interface SchedulePlan {
  frequency: TemplateScheduleFrequency;
  /** 0-6, for a weekly schedule. */
  weekday?: number;
  /** 1-31, for monthly and yearly. */
  monthDay?: number;
  /** 0-11, for yearly. */
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
  month: 0,
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
  for (const question of questions) {
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
      errors.push('every question except a people one needs a name.');
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

  for (const item of items) {
    const label = item.title || '(untitled)';
    errors.push(...gateErrors(item, label, itemAnswers));
    if (!item.title?.trim()) errors.push('every item needs a title.');

    if (item.anchor !== undefined && !oneOf(item.anchor, ANCHORS)) {
      errors.push(`item "${label}" anchor must be start or end.`);
    }
    if (item.groupKey !== undefined && !groupKeys.has(item.groupKey)) {
      errors.push(`item "${label}" names group "${item.groupKey}", which the plan does not define.`);
    }
    errors.push(...conditionErrors(item, label, choices, questionNames));
    errors.push(...refErrors(item, label, existing, selfId));
    errors.push(...rangeErrors(item, label));
  }

  errors.push(...scheduleErrors(plan.schedule));
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

function rangeErrors(item: ItemPlan, label: string): string[] {
  const errors: string[] = [];
  const positive = (value: number | null | undefined, field: string) => {
    if (value !== undefined && value !== null && value <= 0) errors.push(`item "${label}" ${field} must be above zero.`);
  };

  positive(item.recurrenceInterval, 'recurrenceInterval');
  positive(item.estimatedMinutes, 'estimatedMinutes');
  positive(item.completionTimerMinutes, 'completionTimerMinutes');
  positive(item.recurrenceCount, 'recurrenceCount');
  if (item.recurrenceMonth != null && (item.recurrenceMonth < 1 || item.recurrenceMonth > 12)) {
    errors.push(`item "${label}" recurrenceMonth must be 1 to 12.`);
  }
  if (item.polarity !== undefined && !['positive', 'negative'].includes(item.polarity)) {
    errors.push(`item "${label}" polarity must be positive or negative.`);
  }
  if (item.weatherWait != null && !['sunny', 'rainy', 'snowy', 'cold', 'hot'].includes(item.weatherWait)) {
    errors.push(`item "${label}" weatherWait must be sunny, rainy, snowy, cold or hot.`);
  }

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
  if (schedule.month !== undefined && (schedule.month < 0 || schedule.month > 11)) {
    errors.push('schedule month must be 0 to 11.');
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
  const gateTargets = new Set(template.items.map(i => i.answerGate?.itemId).filter((x): x is string => !!x));
  const questionName = new Map(template.questions.map(q => [q.id, q.name]));
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    container: template.applyContainer,
    anchorsAreAway: template.anchorsAreAway,
    schedule: template.schedule,
    groups: template.itemGroups.map(g => ({ key: g.id, title: g.title, ...(g.checklist ? { checklist: true } : {}) })),
    questions: template.questions.map(q => ({
      ...(q.name ? { name: q.name } : {}),
      prompt: q.prompt,
      kind: q.kind,
      ...(q.options.length ? { options: q.options } : {}),
      ...(q.defaultValue ? { defaultValue: q.defaultValue } : {}),
      ...(q.fromDates !== 'none' ? { fromDates: q.fromDates } : {}),
    })),
    items: template.items.map(item => {
      const { groupId, conditions, refTemplateId, refTemplateName, answerGate, ...fields } = item;
      return {
        ...fields,
        ...(gateTargets.has(item.id) ? { key: item.id } : {}),
        ...(groupId ? { groupKey: groupId } : {}),
        ...(conditions.length
          ? { conditions: conditions.map(c => ({ question: questionName.get(c.questionId) ?? '', values: c.values })) }
          : {}),
        ...(answerGate ? { onlyIfAnswer: { item: answerGate.itemId, answers: answerGate.answers } } : {}),
        ...(refTemplateId ? { refTemplate: refTemplateId } : {}),
      };
    }),
  };
}
