/**
 * Template questions — what a run of a template is asked before it creates
 * anything, and what its answers decide.
 *
 * A template already collected three things at apply time: two anchor dates, a
 * run name, and a value for every `{blank}` its items happened to mention. What
 * it could not do is *ask* — so "how long is the trip" had to be typed into
 * every title that counted days, and "is this a work trip" could only be
 * expressed by ticking the laptop by hand every time. A question is the
 * declaration those two needed (see TaskTemplate.questions):
 *
 * - its answer fills the blank of the same name, arithmetic included, so one
 *   "7" reaches "Pack {nights} shirts" and "Pack {nights / 2} pairs of jeans"
 *   (the maths lives with the rest of the placeholder engine, in
 *   templateUtils);
 * - and items can be conditioned on it, which decides whether they arrive
 *   ticked.
 *
 * Pure and store-free, like templateUtils beside it. The apply sheet owns the
 * *state* of the answers; everything about what they mean is here.
 */
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { startOfDay } from 'date-fns/startOfDay';
import type { TaskTemplate, TemplateItem, TemplateItemCondition, TemplateQuestion } from '../types';
import type { ApplyTreeNode, TemplateAnchors } from './templateUtils';

/**
 * Every question asked by a run of this tree, in the order it should be shown:
 * the template's own first, then each nested template's the first time that
 * template appears.
 *
 * Nested templates contribute their questions rather than being answered on
 * their author's behalf — a packing list nested inside "Go on a trip" asks how
 * many nights whichever way it's reached, and the alternative is a question
 * that silently stops being asked the moment the template is used inside
 * another one.
 */
export function questionsForTree(
  nodes: ApplyTreeNode[],
  templatesById: Map<string, TaskTemplate>,
): TemplateQuestion[] {
  const seenTemplates = new Set<string>();
  const questions: TemplateQuestion[] = [];
  const visit = (node: ApplyTreeNode) => {
    if (!seenTemplates.has(node.sourceTemplateId)) {
      seenTemplates.add(node.sourceTemplateId);
      questions.push(...(templatesById.get(node.sourceTemplateId)?.questions ?? []));
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return questions;
}

/**
 * What a number question reads off the run's own dates — the whole reason
 * "7 days" never has to be typed. Null when it isn't that kind of question, or
 * when the dates can't answer it (either one unset, or an end before its
 * start).
 *
 * A trip entered as the 3rd to the 10th is **7 nights and 8 days**, which is
 * why the source is one or the other rather than a single "length": both are
 * what someone means by "a week away", depending on whether they're counting
 * hotel nights or shirts.
 */
export function answerFromDates(question: TemplateQuestion, anchors: TemplateAnchors): string | null {
  if (question.kind !== 'number' || question.fromDates === 'none') return null;
  if (!anchors.start || !anchors.end) return null;
  const nights = differenceInCalendarDays(startOfDay(anchors.end), startOfDay(anchors.start));
  if (nights < 0) return null;
  return String(question.fromDates === 'nights' ? nights : nights + 1);
}

/**
 * What a question's field starts at, before anyone touches it: the dates when
 * it reads them, then the author's own default, then — for a choice — its
 * first option.
 *
 * **A choice defaults to its first option**, deliberately rather than to
 * unanswered: an item conditioned on "Work" has to be either ticked or not the
 * moment the sheet opens, and "no answer yet" is a third state that every
 * condition would then have to have an opinion about. It's also the rule the
 * app already uses for the alternatives on a recipe (see
 * RecipeComponent.choiceGroup), so ordering the options *is* saying which is
 * usual.
 */
export function defaultAnswer(question: TemplateQuestion, anchors: TemplateAnchors): string {
  const fromDates = answerFromDates(question, anchors);
  if (fromDates !== null) return fromDates;
  if (question.kind === 'choice') return question.options[0] ?? '';
  // Deliberately not the choice rule above, and this is the one place that
  // matters most: a 'people' question always starts at nobody, never at a
  // guessed answer. checkScheduledTemplates() calls resolveAnswers with
  // nothing typed, so this is what an unattended run's "who" resolves to —
  // see personIdsForAnswers, and docs/arch/people.md on why a generated task
  // carries no personIds. normalizeTemplateQuestion keeps defaultValue empty
  // for this kind, so there is nothing here that could answer otherwise.
  return question.defaultValue;
}

/**
 * The answers a run is actually working with: what's been typed or picked,
 * falling back to each question's default.
 *
 * `typed` is keyed by question id and holds only what the user has touched, so
 * an untouched number question keeps tracking the dates as they change while a
 * typed one stays where it was put. An entry that's been emptied out counts as
 * untouched, which is how a field is handed back to the dates.
 */
export function resolveAnswers(
  questions: readonly TemplateQuestion[],
  typed: Record<string, string>,
  anchors: TemplateAnchors,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const question of questions) {
    const entered = (typed[question.id] ?? '').trim();
    resolved[question.id] = entered || defaultAnswer(question, anchors);
  }
  return resolved;
}

/**
 * Answers keyed by the blank each one fills, ready to merge with the values
 * collected for undeclared `{blanks}`.
 *
 * A question with no name fills nothing — that's the one that exists only to
 * condition items ("What kind of trip?"), and it has no business writing a word
 * into a title. Two questions sharing a name is a mistake with no good answer,
 * so the first wins: it's the outer template's, the one the person applying is
 * looking at.
 */
export function placeholderValuesFor(
  questions: readonly TemplateQuestion[],
  answers: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const question of questions) {
    if (!question.name) continue;
    if (question.name in values) continue;
    values[question.name] = answers[question.id] ?? '';
  }
  return values;
}

/**
 * The conditions on this item that can still decide anything — one naming a
 * deleted question, or offering no values, is inert.
 *
 * Resolve-or-shrug, like every other cross-row pointer in this app: deleting a
 * question must not empty a packing list, and an item whose every condition has
 * gone stale is simply back to being unconditional.
 *
 * Takes the conditions rather than a whole item, so the editor can ask it about
 * the draft it's holding in state — the same shape `itemPlaceholders` takes for
 * the same reason.
 */
export function liveConditions(
  conditions: readonly TemplateItemCondition[],
  questions: readonly TemplateQuestion[],
): TemplateItemCondition[] {
  return conditions.filter(
    c => c.values.length > 0 && questions.some(q => q.id === c.questionId)
  );
}

/** True if the run's answers include this item — every live condition matched, with any one of its values enough. */
export function itemMatchesAnswers(
  item: TemplateItem,
  questions: readonly TemplateQuestion[],
  answers: Record<string, string>,
): boolean {
  return liveConditions(item.conditions, questions).every(c => c.values.includes(answers[c.questionId] ?? ''));
}

/**
 * Which leaf items start ticked in the apply sheet.
 *
 * Conditions decide the items that carry them and `optional` decides the rest —
 * see TemplateItem.conditions for why the two don't stack. An optional
 * nested-template block still suppresses everything under it: its items answer
 * to their own template's questions, and "this whole block is off unless I say
 * so" is the more specific statement about them.
 */
export function initialLeafSelection(
  nodes: ApplyTreeNode[],
  questions: readonly TemplateQuestion[],
  answers: Record<string, string>,
): Set<string> {
  const selected = new Set<string>();
  const visit = (node: ApplyTreeNode, ancestorOptional: boolean) => {
    if (node.broken) return;
    if (node.item.refTemplateId !== null) {
      node.children.forEach(child => visit(child, ancestorOptional || node.item.optional));
      return;
    }
    const conditioned = liveConditions(node.item.conditions, questions).length > 0;
    const included = conditioned
      ? itemMatchesAnswers(node.item, questions, answers) && !ancestorOptional
      : !node.item.optional && !ancestorOptional;
    if (included) selected.add(node.item.id);
  };
  nodes.forEach(node => visit(node, false));
  return selected;
}

/**
 * The selection after an answer changes: conditioned items are re-decided,
 * everything else keeps whatever the user has ticked.
 *
 * Re-deciding a conditioned item can undo a tick the user made by hand, and
 * that's the intended reading — answering "work trip" is a statement about
 * exactly the items that question governs, and the alternative is a sheet whose
 * answers stop working as soon as you touch anything. Items with no conditions
 * are never touched, so ticking one extra thing on is safe whatever gets
 * answered afterwards.
 */
export function reselectForAnswers(
  nodes: ApplyTreeNode[],
  questions: readonly TemplateQuestion[],
  answers: Record<string, string>,
  previous: ReadonlySet<string>,
): Set<string> {
  const selected = new Set(previous);
  const visit = (node: ApplyTreeNode, ancestorOptional: boolean) => {
    if (node.broken) return;
    if (node.item.refTemplateId !== null) {
      node.children.forEach(child => visit(child, ancestorOptional || node.item.optional));
      return;
    }
    if (liveConditions(node.item.conditions, questions).length === 0) return;
    const included = itemMatchesAnswers(node.item, questions, answers) && !ancestorOptional;
    if (included) selected.add(node.item.id);
    else selected.delete(node.item.id);
  };
  nodes.forEach(node => visit(node, false));
  return selected;
}

/**
 * The person ids a 'people' answer names, or `[]` for one nobody has answered.
 *
 * Stored the same way `Task.personIds` itself is on its own SQLite column — a
 * JSON array of ids — because a person picker's answer is a set and the
 * answer model everywhere else in this module is one string per question
 * (`Record<string, string>`, see `resolveAnswers`). Never throws: a
 * corrupted or hand-edited answer reads as "nobody", the same resolve-or-shrug
 * every other cross-row pointer in the people layer already follows.
 */
export function personIdsFromAnswer(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** The reverse of `personIdsFromAnswer` — what a pick actually writes into the answer string. */
export function personIdsToAnswer(ids: readonly string[]): string {
  return ids.length > 0 ? JSON.stringify(ids) : '';
}

/**
 * Everybody named by any 'people' question's answer, across the whole set —
 * what every task the run creates gets written onto its own `personIds`.
 *
 * **This is what makes an unattended run safe, and the safety lives in
 * `defaultAnswer`, not here.** `docs/arch/people.md`: a generated task
 * carries no `personIds`, because nobody present chose to name them. A
 * scheduled run calls `resolveAnswers(questions, {}, anchors)` — nothing
 * typed — so every 'people' question resolves through `defaultAnswer`, which
 * never gives this kind anything but `''`. This function stays generic
 * exactly because that's already guaranteed: it doesn't need to know whether
 * a person present is answering or an unattended run is, the same way
 * `placeholderValuesFor` beside it doesn't.
 *
 * Several 'people' questions union rather than pick one: a template can ask
 * "who's on the flight" and "who's at the hotel" separately, and a task
 * naming either of them is a task naming somebody, the same as `personIds`
 * means everywhere else in the app.
 */
export function personIdsForAnswers(
  questions: readonly TemplateQuestion[],
  answers: Record<string, string>,
): string[] {
  const ids = new Set<string>();
  for (const question of questions) {
    if (question.kind !== 'people') continue;
    for (const id of personIdsFromAnswer(answers[question.id] ?? '')) ids.add(id);
  }
  return [...ids];
}

/** What a question is called where it's listed — its prompt, or the blank it fills when it hasn't got one. */
export function questionLabel(question: TemplateQuestion): string {
  return question.prompt.trim() || (question.name ? `{${question.name}}` : 'Question');
}

/**
 * What a question takes, for the row that lists it in the template editor —
 * "Work · Vacation", "A number, from the dates · {nights}".
 *
 * The answers themselves rather than "3 options", for the same reason
 * describeConditions names them: the list is where an author checks that the
 * template asks what they think it asks, and a count says nothing about that.
 */
export function describeQuestion(question: TemplateQuestion): string {
  const parts: string[] = [];
  if (question.kind === 'choice') {
    parts.push(question.options.length > 0 ? question.options.join(' · ') : 'No answers yet');
  } else if (question.kind === 'number') {
    parts.push(
      question.fromDates === 'none'
        ? 'A number'
        : `A number, from the dates (${question.fromDates})`
    );
  } else if (question.kind === 'people') {
    parts.push('Who');
  } else {
    parts.push('Text');
  }
  if (question.name) parts.push(`{${question.name}}`);
  return parts.join(' · ');
}

/**
 * The item editor's one-line summary of what an item is conditioned on —
 * "Trip type: Work", "Trip type: Work, Long trip: Yes". Null when nothing is.
 *
 * Named in full rather than counted ("2 conditions") because the collapsed row
 * is the only place this is visible while scanning a template, and which
 * answers those are is the entire content.
 */
export function describeConditions(
  conditions: readonly TemplateItemCondition[],
  questions: readonly TemplateQuestion[],
): string | null {
  const parts = liveConditions(conditions, questions).map(c => {
    const question = questions.find(q => q.id === c.questionId)!;
    const label = questionLabel(question);
    // No colon after a prompt that already ends in a question mark — "What kind
    // of trip?: Work" is two punctuation marks doing one job. A question and
    // its answer separated by a space reads as exactly what it is.
    return `${label}${label.endsWith('?') ? '' : ':'} ${c.values.join(' or ')}`;
  });
  return parts.length > 0 ? parts.join(' · ') : null;
}
