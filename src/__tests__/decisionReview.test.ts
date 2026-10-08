import type { Task } from '../types';
import {
  canReviewDecision, decisionOutcomes, isReviewAfter, pendingReviewOf, reviewDueDay, reviewTaskDraft,
} from '../utils/decisionReview';
import { dayKeyOf } from '../utils/dateUtils';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const task = (over: Partial<Task>): Task => ({
  id: 't', title: 'Which contractor?', completed: false, completedAt: null, missedAt: null,
  createdAt: '2026-01-01T09:00:00', archived: false, deliverableKind: 'text', deliverableValue: null,
  reviewOfTaskId: null, category: null, projectId: null, tags: [], chainEnabled: false, chainItems: [], chainIndex: 0,
  ...over,
}) as Task;

describe('when to look back', () => {
  it('counts weeks and months from the decision\'s day, at noon', () => {
    const day = new Date(2026, 0, 31);
    expect(dayKeyOf(reviewDueDay(day, '2w'))).toBe('2026-02-14');
    // A short month clamps rather than spilling into the next.
    expect(dayKeyOf(reviewDueDay(day, '1m'))).toBe('2026-02-28');
    expect(dayKeyOf(reviewDueDay(day, '6m'))).toBe('2026-07-31');
    expect(reviewDueDay(day, '3m').getHours()).toBe(12);
  });

  it('knows its own options', () => {
    expect(isReviewAfter('3m')).toBe(true);
    expect(isReviewAfter('1y')).toBe(false);
  });

  it('wants a real answer on something that is not a look-back already', () => {
    expect(canReviewDecision(task({}), 'Bob')).toBe(true);
    expect(canReviewDecision(task({}), '  ')).toBe(false);
    expect(canReviewDecision(task({}), null)).toBe(false);
    expect(canReviewDecision(task({}), 'Maybe')).toBe(false);
    expect(canReviewDecision(task({ reviewOfTaskId: 'x' }), 'Fine')).toBe(false);
  });

  it('asks about the live chain step\'s question, and quotes the answer as shown', () => {
    const chained = task({
      id: 'c', title: 'Kitchen', chainEnabled: true, chainIndex: 1,
      chainItems: [{ id: 'a', title: 'Measure', estimatedMinutes: null }, { id: 'b', title: 'Pick a tile', estimatedMinutes: null }],
      deliverableValue: 'Matte white',
    });
    const draft = reviewTaskDraft(chained, '2w', new Date(2026, 2, 10));
    expect(draft.title).toBe('How did it turn out? Pick a tile');
    expect(draft.notes).toBe('You answered "Matte white" on Mar 10, 2026.');
    expect(draft.reviewOfTaskId).toBe('c');
  });
});

describe('outcomes', () => {
  const review = (over: Partial<Task>) => task({ title: 'How did it turn out?', reviewOfTaskId: 'd', ...over });

  it('are the latest answered look-back on each decision', () => {
    const outcomes = decisionOutcomes([
      review({ id: 'r1', completed: true, completedAt: '2026-02-01T10:00:00', deliverableValue: 'Late, but fine' }),
      review({ id: 'r2', completed: true, completedAt: '2026-05-01T10:00:00', deliverableValue: 'Roof held all winter' }),
      task({ id: 'd', completed: true, deliverableValue: 'Bob' }),
    ]);
    expect(outcomes.get('d')).toEqual({ text: 'Roof held all winter', at: '2026-05-01T10:00:00', reviewTaskId: 'r2' });
    expect(outcomes.size).toBe(1);
  });

  it('say nothing for a look-back missed, left open, or finished without an answer', () => {
    expect(decisionOutcomes([
      review({ id: 'r1', completed: true, missedAt: '2026-02-01T10:00:00', deliverableValue: 'x' }),
      review({ id: 'r2', completed: false, deliverableValue: null }),
      review({ id: 'r3', completed: true, completedAt: '2026-02-01T10:00:00', deliverableValue: null }),
    ]).size).toBe(0);
  });

  it('finds the look-back still waiting', () => {
    const open = review({ id: 'r1' });
    expect(pendingReviewOf([open, review({ id: 'r2', completed: true })], 'd')).toBe(open);
    expect(pendingReviewOf([open], 'other')).toBeNull();
  });
});
