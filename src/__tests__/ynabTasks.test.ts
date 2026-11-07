import {
  wantsYnabQueueTask,
  ynabOverspentCategories,
  ynabOverspentCategoryOf,
  ynabOverspentMonthOf,
  ynabOverspentSourceId,
  ynabOverspentTitle,
  ynabQueueSourceId,
  ynabQueueTitle,
  ynabTaskKind,
} from '../utils/ynabTasks';
import type { YnabSnapshot } from '../utils/ynabPlan';

describe('source ids', () => {
  it('names the queue task by its day and an overspent task by month and category', () => {
    expect(ynabQueueSourceId('2026-11-05')).toBe('queue:2026-11-05');
    const id = ynabOverspentSourceId('cat-1', '2026-11');
    expect(ynabOverspentMonthOf(id)).toBe('2026-11');
    expect(ynabOverspentCategoryOf(id)).toBe('cat-1');
  });

  it('reads the kind off a row, and nothing off another generator\'s', () => {
    expect(ynabTaskKind({ generatedKind: 'ynab', generatedSourceId: 'queue:2026-11-05' })).toBe('queue');
    expect(ynabTaskKind({ generatedKind: 'ynab', generatedSourceId: ynabOverspentSourceId('c', '2026-11') })).toBe('overspent');
    expect(ynabTaskKind({ generatedKind: 'wanikani', generatedSourceId: 'queue:2026-11-05' })).toBeNull();
  });

  it('reads a malformed overspent id as nothing', () => {
    expect(ynabOverspentMonthOf('overspent:2026-11')).toBeNull();
    expect(ynabOverspentCategoryOf('overspent:2026-11:')).toBeNull();
    expect(ynabOverspentCategoryOf('queue:2026-11-05')).toBeNull();
  });
});

describe('ynabQueueTitle', () => {
  it('says approve when everything waiting is unapproved', () => {
    expect(ynabQueueTitle({ unapproved: 4, uncategorized: 0, total: 4 })).toBe('Approve 4 transactions in YNAB');
    expect(ynabQueueTitle({ unapproved: 1, uncategorized: 0, total: 1 })).toBe('Approve 1 transaction in YNAB');
  });

  it('says categorize when everything waiting is approved but has no category', () => {
    expect(ynabQueueTitle({ unapproved: 0, uncategorized: 2, total: 2 })).toBe('Categorize 2 transactions in YNAB');
  });

  it('says review for a mix, counting each transaction once', () => {
    expect(ynabQueueTitle({ unapproved: 3, uncategorized: 2, total: 4 })).toBe('Review 4 transactions in YNAB');
  });

  it('drops the number once nothing is waiting', () => {
    expect(ynabQueueTitle({ unapproved: 0, uncategorized: 0, total: 0 })).toBe('Review transactions in YNAB');
  });
});

describe('ynabOverspentTitle', () => {
  it('names the amount while the category is below zero, and drops it once covered', () => {
    expect(ynabOverspentTitle({ name: 'Dining Out', balanceMinor: -1240 }, '$')).toBe('Cover $12.40 overspending in Dining Out');
    expect(ynabOverspentTitle({ name: 'Dining Out', balanceMinor: 0 }, '$')).toBe('Cover overspending in Dining Out');
  });
});

describe('wantsYnabQueueTask', () => {
  const waiting = { unapproved: 2, uncategorized: 0, total: 2 };
  it('wants one when something is waiting and none was written today', () => {
    expect(wantsYnabQueueTask(waiting, '2026-11-05', '2026-11-04')).toBe(true);
    expect(wantsYnabQueueTask(waiting, '2026-11-05', null)).toBe(true);
  });

  it('wants none twice in a day, or with nothing waiting, or without a read', () => {
    expect(wantsYnabQueueTask(waiting, '2026-11-05', '2026-11-05')).toBe(false);
    expect(wantsYnabQueueTask({ unapproved: 0, uncategorized: 0, total: 0 }, '2026-11-05', null)).toBe(false);
    expect(wantsYnabQueueTask(null, '2026-11-05', null)).toBe(false);
  });
});

describe('ynabOverspentCategories', () => {
  it('is the visible categories below zero', () => {
    const snapshot: YnabSnapshot = {
      fetchedAt: '', planId: 'p', monthKey: '2026-11', serverKnowledge: 1, queue: null,
      categories: [
        { id: 'a', name: 'Dining Out', groupId: 'g', groupName: 'G', balanceMinor: -100, hidden: false },
        { id: 'b', name: 'Groceries', groupId: 'g', groupName: 'G', balanceMinor: 0, hidden: false },
        { id: 'c', name: 'Old', groupId: 'g', groupName: 'G', balanceMinor: -500, hidden: true },
      ],
    };
    expect(ynabOverspentCategories(snapshot).map(c => c.id)).toEqual(['a']);
  });
});
