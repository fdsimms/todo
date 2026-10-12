import {
  batchOptionsFor, taskBatchScopes, personBatchScopes, itemBatchScopes, recipeBatchScopes,
  canBatchApply, canBatchDismiss, canBatch,
} from '../utils/backfillBatch';

type T = Parameters<typeof taskBatchScopes>[0];
const task = (o: Partial<T> = {}): T => ({ generatedKind: null, projectId: null, category: null, groupId: null, ...o });

describe('taskBatchScopes', () => {
  it('lists every set a task belongs to, and none for a loose task', () => {
    expect(taskBatchScopes(task())).toEqual([]);
    expect(taskBatchScopes(task({ projectId: 'p', category: 'Work', groupId: 'g' })).map(s => s.key))
      .toEqual(['project:p', 'category:Work', 'stack:g']);
  });
});

describe('batchOptionsFor', () => {
  it('reaches only the queued members that share the scope, current included', () => {
    const a = task({ category: 'Work' });
    const b = task({ category: 'Work' });
    const c = task({ category: 'Home' });
    const opts = batchOptionsFor([a, b, c], a, taskBatchScopes);
    expect(opts).toHaveLength(1);
    expect(opts[0].scope.key).toBe('category:Work');
    expect(opts[0].members).toEqual([a, b]);
  });

  it('leaves out a scope that would reach only this card', () => {
    const a = task({ projectId: 'p', category: 'Work' });
    const b = task({ category: 'Work' });
    expect(batchOptionsFor([a, b], a, taskBatchScopes).map(o => o.scope.kind)).toEqual(['category']);
  });

  it('offers each scope separately when a card belongs to several sets', () => {
    const a = task({ projectId: 'p', category: 'Work' });
    const b = task({ projectId: 'p' });
    const c = task({ category: 'Work' });
    expect(batchOptionsFor([a, b, c], a, taskBatchScopes).map(o => [o.scope.kind, o.members.length]))
      .toEqual([['project', 2], ['category', 2]]);
  });

  it('does not count a card that has left the queue', () => {
    const a = task({ category: 'Work' });
    expect(batchOptionsFor([a], a, taskBatchScopes)).toEqual([]);
  });
});

describe('the other pools’ scopes', () => {
  it('uses a person’s group, an item’s aisle and a recipe’s cookbook', () => {
    expect(personBatchScopes({ groupId: 'g' }).map(s => s.key)).toEqual(['personGroup:g']);
    expect(personBatchScopes({ groupId: null })).toEqual([]);
    expect(itemBatchScopes({ aisle: 'Spices' }).map(s => s.key)).toEqual(['aisle:Spices']);
    expect(recipeBatchScopes({ cookbookId: 'c' }).map(s => s.key)).toEqual(['cookbook:c']);
    expect(recipeBatchScopes({ cookbookId: null })).toEqual([]);
  });

  it('does not treat the unplaced "Other" aisle as a set', () => {
    expect(itemBatchScopes({ aisle: 'Other' })).toEqual([]);
  });
});

describe('which fields batch', () => {
  it('answers only what a set plausibly shares', () => {
    expect(canBatchApply('task', 'priority')).toBe(true);
    expect(canBatchApply('task', 'reminder')).toBe(false);
    expect(canBatchApply('item', 'nutrition')).toBe(false);
    expect(canBatchApply('recipe', 'cookedWeight')).toBe(false);
  });

  it('dismisses more than it answers', () => {
    expect(canBatchDismiss('task', 'reminder')).toBe(true);
    expect(canBatchDismiss('item', 'nutrition')).toBe(true);
    expect(canBatchDismiss('recipe', 'cookedWeight')).toBe(true);
    expect(canBatch('person', 'birthday')).toBe(false);
  });
});
