import {
  questionsForTree,
  answerFromDates,
  defaultAnswer,
  resolveAnswers,
  placeholderValuesFor,
  liveConditions,
  itemMatchesAnswers,
  initialLeafSelection,
  reselectForAnswers,
  questionLabel,
  describeQuestion,
  describeConditions,
} from '../utils/templateQuestions';
import { normalizeTemplateItem, buildApplyTree } from '../utils/templateUtils';
import type { TaskTemplate, TemplateItem, TemplateQuestion } from '../types';

const makeQuestion = (overrides: Partial<TemplateQuestion> = {}): TemplateQuestion => ({
  id: 'q-type',
  name: 'trip type',
  prompt: 'What kind of trip?',
  kind: 'choice',
  options: ['Work', 'Vacation'],
  defaultValue: '',
  fromDates: 'none',
  ...overrides,
});

const nights = makeQuestion({
  id: 'q-nights',
  name: 'nights',
  prompt: 'How many nights?',
  kind: 'number',
  options: [],
  fromDates: 'nights',
});

const makeItem = (overrides: Partial<TemplateItem> = {}): TemplateItem =>
  normalizeTemplateItem({ id: 'i1', title: 'Pack socks', ...overrides });

const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id: 'tpl',
  name: 'Packing list',
  items: [],
  itemGroups: [],
  questions: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  applyContainer: 'stack',
  schedule: null,
  scheduleLastFiredKey: null,
  ...overrides,
});

const treeOf = (templates: TaskTemplate[], rootId: string) => {
  const byId = new Map(templates.map(t => [t.id, t]));
  const root = byId.get(rootId)!;
  return { tree: buildApplyTree(root.items, root.id, byId), byId };
};

describe('answerFromDates', () => {
  const start = new Date('2026-03-03T09:00:00');
  const end = new Date('2026-03-10T18:00:00');

  it('counts nights between the anchors', () => {
    expect(answerFromDates(nights, { start, end })).toBe('7');
  });

  it('counts days as nights plus one — the 3rd to the 10th is 8 days', () => {
    expect(answerFromDates({ ...nights, fromDates: 'days' }, { start, end })).toBe('8');
  });

  // Both are the same day, so a day trip is 1 day and 0 nights.
  it('handles a same-day run', () => {
    expect(answerFromDates(nights, { start, end: start })).toBe('0');
    expect(answerFromDates({ ...nights, fromDates: 'days' }, { start, end: start })).toBe('1');
  });

  it('answers nothing without both anchors, or with an end before its start', () => {
    expect(answerFromDates(nights, { start, end: null })).toBeNull();
    expect(answerFromDates(nights, { start: null, end })).toBeNull();
    expect(answerFromDates(nights, { start: end, end: start })).toBeNull();
  });

  it('answers nothing for a question that doesn\'t read the dates', () => {
    expect(answerFromDates({ ...nights, fromDates: 'none' }, { start, end })).toBeNull();
    expect(answerFromDates(makeQuestion(), { start, end })).toBeNull();
  });
});

describe('defaultAnswer', () => {
  const noAnchors = { start: null, end: null };

  it('starts a choice on its first option', () => {
    expect(defaultAnswer(makeQuestion(), noAnchors)).toBe('Work');
  });

  it('starts a text/number question on its authored default', () => {
    expect(defaultAnswer(makeQuestion({ kind: 'text', options: [], defaultValue: 'Portland' }), noAnchors))
      .toBe('Portland');
  });

  it('prefers the dates to the authored default', () => {
    const question = { ...nights, defaultValue: '3' };
    expect(defaultAnswer(question, noAnchors)).toBe('3');
    expect(defaultAnswer(question, { start: new Date('2026-03-03'), end: new Date('2026-03-05') })).toBe('2');
  });
});

describe('resolveAnswers', () => {
  const anchors = { start: new Date('2026-03-03'), end: new Date('2026-03-10') };

  it('takes what was typed over the default', () => {
    expect(resolveAnswers([nights], { 'q-nights': '2' }, anchors)['q-nights']).toBe('2');
  });

  // Clearing the box is how a field is handed back to the dates.
  it('treats an emptied answer as untouched', () => {
    expect(resolveAnswers([nights], { 'q-nights': '  ' }, anchors)['q-nights']).toBe('7');
  });
});

describe('placeholderValuesFor', () => {
  it('keys answers by the blank they fill', () => {
    expect(placeholderValuesFor([nights], { 'q-nights': '7' })).toEqual({ nights: '7' });
  });

  it('skips a question that fills no blank', () => {
    const gate = makeQuestion({ name: '' });
    expect(placeholderValuesFor([gate], { 'q-type': 'Work' })).toEqual({});
  });

  it('gives a duplicated name to the first question that claims it', () => {
    const second = { ...nights, id: 'q-other' };
    expect(placeholderValuesFor([nights, second], { 'q-nights': '7', 'q-other': '2' }))
      .toEqual({ nights: '7' });
  });
});

describe('conditions', () => {
  const questions = [makeQuestion(), nights];

  it('ignores a condition naming a deleted question, or offering no values', () => {
    const item = makeItem({
      conditions: [
        { questionId: 'q-gone', values: ['Work'] },
        { questionId: 'q-type', values: [] },
      ],
    });
    expect(liveConditions(item.conditions, questions)).toEqual([]);
    expect(itemMatchesAnswers(item, questions, { 'q-type': 'Vacation' })).toBe(true);
  });

  it('matches any one of a condition\'s values', () => {
    const item = makeItem({ conditions: [{ questionId: 'q-type', values: ['Work', 'Vacation'] }] });
    expect(itemMatchesAnswers(item, questions, { 'q-type': 'Vacation' })).toBe(true);
    expect(itemMatchesAnswers(item, questions, { 'q-type': 'Day trip' })).toBe(false);
  });

  it('requires every condition to match', () => {
    const item = makeItem({
      conditions: [
        { questionId: 'q-type', values: ['Work'] },
        { questionId: 'q-nights', values: ['7'] },
      ],
    });
    expect(itemMatchesAnswers(item, questions, { 'q-type': 'Work', 'q-nights': '7' })).toBe(true);
    expect(itemMatchesAnswers(item, questions, { 'q-type': 'Work', 'q-nights': '2' })).toBe(false);
  });
});

describe('initialLeafSelection', () => {
  const questions = [makeQuestion()];
  const laptop = makeItem({
    id: 'laptop',
    title: 'Pack laptop',
    conditions: [{ questionId: 'q-type', values: ['Work'] }],
  });
  const socks = makeItem({ id: 'socks', title: 'Pack socks' });
  const snorkel = makeItem({ id: 'snorkel', title: 'Pack snorkel', optional: true });

  const { tree } = treeOf(
    [makeTemplate({ items: [socks, laptop, snorkel], questions })],
    'tpl'
  );

  it('ticks a conditioned item only for the answers it names', () => {
    expect(initialLeafSelection(tree, questions, { 'q-type': 'Work' }))
      .toEqual(new Set(['socks', 'laptop']));
    expect(initialLeafSelection(tree, questions, { 'q-type': 'Vacation' }))
      .toEqual(new Set(['socks']));
  });

  // Conditions replace `optional` rather than stacking with it — otherwise an
  // item that's off for one answer and on for another could never be on.
  it('lets a matched condition tick an item its author also marked optional', () => {
    const optionalLaptop = { ...laptop, optional: true };
    const { tree: t } = treeOf([makeTemplate({ items: [optionalLaptop], questions })], 'tpl');
    expect(initialLeafSelection(t, questions, { 'q-type': 'Work' })).toEqual(new Set(['laptop']));
  });

  it('leaves an unconditioned item to the optional flag', () => {
    expect(initialLeafSelection(tree, questions, { 'q-type': 'Work' }).has('snorkel')).toBe(false);
  });

  it('still suppresses everything under an optional nested-template block', () => {
    const nested = makeTemplate({ id: 'inner', name: 'Work kit', items: [laptop], questions });
    const outer = makeTemplate({
      id: 'outer',
      items: [makeItem({ id: 'ref', optional: true, refTemplateId: 'inner', refTemplateName: 'Work kit' })],
    });
    const { tree: t } = treeOf([outer, nested], 'outer');
    expect(initialLeafSelection(t, questions, { 'q-type': 'Work' })).toEqual(new Set());
  });
});

describe('reselectForAnswers', () => {
  const questions = [makeQuestion()];
  const laptop = makeItem({
    id: 'laptop',
    conditions: [{ questionId: 'q-type', values: ['Work'] }],
  });
  const snorkel = makeItem({ id: 'snorkel', optional: true });
  const { tree } = treeOf([makeTemplate({ items: [laptop, snorkel], questions })], 'tpl');

  it('re-decides the conditioned items when the answer moves', () => {
    const afterWork = reselectForAnswers(tree, questions, { 'q-type': 'Work' }, new Set());
    expect(afterWork.has('laptop')).toBe(true);
    const afterVacation = reselectForAnswers(tree, questions, { 'q-type': 'Vacation' }, afterWork);
    expect(afterVacation.has('laptop')).toBe(false);
  });

  it('keeps a hand-ticked item that no question governs', () => {
    const picked = new Set(['snorkel']);
    expect(reselectForAnswers(tree, questions, { 'q-type': 'Work' }, picked).has('snorkel')).toBe(true);
  });
});

describe('questionsForTree', () => {
  it('collects the template\'s own questions and each nested template\'s, once each', () => {
    const inner = makeTemplate({ id: 'inner', items: [makeItem({ id: 'i-inner' })], questions: [nights] });
    const outer = makeTemplate({
      id: 'outer',
      questions: [makeQuestion()],
      items: [
        makeItem({ id: 'r1', refTemplateId: 'inner', refTemplateName: 'Packing' }),
        makeItem({ id: 'r2', refTemplateId: 'inner', refTemplateName: 'Packing' }),
      ],
    });
    const { tree, byId } = treeOf([outer, inner], 'outer');
    expect(questionsForTree(tree, byId).map(q => q.id)).toEqual(['q-type', 'q-nights']);
  });
});

describe('labels', () => {
  it('falls back to the blank when a question has no prompt', () => {
    expect(questionLabel(makeQuestion({ prompt: '' }))).toBe('{trip type}');
    expect(questionLabel(makeQuestion({ prompt: '', name: '' }))).toBe('Question');
  });

  it('names a question\'s answers rather than counting them', () => {
    expect(describeQuestion(makeQuestion())).toBe('Work · Vacation · {trip type}');
    expect(describeQuestion(makeQuestion({ options: [] }))).toBe('No answers yet · {trip type}');
    expect(describeQuestion(nights)).toBe('A number, from the dates (nights) · {nights}');
    expect(describeQuestion({ ...nights, fromDates: 'none' })).toBe('A number · {nights}');
  });

  it('describes what an item is conditioned on, without doubling up the punctuation', () => {
    const questions = [makeQuestion(), nights];
    expect(describeConditions([], questions)).toBeNull();
    // A prompt that doesn't ask a question keeps its colon.
    expect(describeConditions(
      [{ questionId: 'q-type', values: ['Work'] }],
      [{ ...questions[0], prompt: 'Trip type' }],
    )).toBe('Trip type: Work');
    expect(describeConditions([{ questionId: 'q-type', values: ['Work', 'Vacation'] }], questions))
      .toBe('What kind of trip? Work or Vacation');
    expect(describeConditions(
      [{ questionId: 'q-type', values: ['Work'] }, { questionId: 'q-nights', values: ['7'] }],
      questions,
    )).toBe('What kind of trip? Work · How many nights? 7');
  });
});
