import {
  mergeYnabCategories,
  ynabCategoryNow,
  ynabMinorFromMilliunits,
  ynabMonthKey,
  ynabPickableCategories,
  ynabPlansFrom,
  ynabQueueFrom,
  ynabTransactionIdsFrom,
  type YnabSnapshot,
} from '../utils/ynabPlan';

function category(id: string, name: string, balance: number, extra: Record<string, unknown> = {}) {
  return { id, name, balance, budgeted: 0, activity: 0, hidden: false, deleted: false, internal: false, category_group_id: 'g1', ...extra };
}

function categoriesBody(groups: unknown[], serverKnowledge = 10) {
  return { data: { category_groups: groups, server_knowledge: serverKnowledge } };
}

const everyday = (categories: unknown[], extra: Record<string, unknown> = {}) =>
  ({ id: 'g1', name: 'Everyday', hidden: false, deleted: false, internal: false, categories, ...extra });

describe('ynabMinorFromMilliunits', () => {
  it('divides by ten and rounds, since the app keeps hundredths', () => {
    expect(ynabMinorFromMilliunits(123930)).toBe(12393);
    expect(ynabMinorFromMilliunits(-220)).toBe(-22);
    expect(ynabMinorFromMilliunits(1235)).toBe(124);
    expect(ynabMinorFromMilliunits(0)).toBe(0);
  });
});

describe('ynabMonthKey', () => {
  it('is the UTC month, which is the month YNAB amounts are for', () => {
    const at = new Date(Date.UTC(2026, 10, 30, 23, 30));
    expect(ynabMonthKey(at)).toBe('2026-11');
    expect(ynabMonthKey(new Date(Date.UTC(2026, 11, 1, 0, 30)))).toBe('2026-12');
  });
});

describe('ynabPlansFrom', () => {
  it('reads id and name, and skips a malformed plan', () => {
    expect(ynabPlansFrom({ data: { plans: [{ id: 'p1', name: 'Home' }, { id: 'p2' }], default_plan: null } }))
      .toEqual([{ id: 'p1', name: 'Home' }]);
  });

  it('refuses a body that is not a plans answer', () => {
    expect(ynabPlansFrom({ error: { id: '401', name: 'unauthorized', detail: 'x' } })).toBeNull();
  });
});

describe('mergeYnabCategories', () => {
  it('reads a full answer, leaving out internal categories and groups', () => {
    const body = categoriesBody([
      everyday([category('c1', 'Groceries', 36000), category('rta', 'Inflow: Ready to Assign', 5000, { internal: true })]),
      { id: 'gi', name: 'Internal Master Category', internal: true, deleted: false, hidden: false, categories: [category('u', 'Uncategorized', 0)] },
    ]);
    expect(mergeYnabCategories(null, body)).toEqual({
      serverKnowledge: 10,
      categories: [{ id: 'c1', name: 'Groceries', groupId: 'g1', groupName: 'Everyday', balanceMinor: 3600, hidden: false }],
    });
  });

  it('merges a delta: changed ones replace, deleted ones go, the rest stay', () => {
    const first = mergeYnabCategories(null, categoriesBody([
      everyday([category('c1', 'Groceries', 36000), category('c2', 'Dining Out', 5000), category('c3', 'Gifts', 0)]),
    ]))!;
    const delta = mergeYnabCategories(first.categories, categoriesBody([
      everyday([category('c2', 'Dining Out', -12400), category('c3', 'Gifts', 0, { deleted: true })]),
    ], 12))!;
    expect(delta.serverKnowledge).toBe(12);
    expect(delta.categories.map(c => [c.id, c.balanceMinor])).toEqual([['c1', 3600], ['c2', -1240]]);
  });

  it('carries a group rename to categories the delta did not mention', () => {
    const first = mergeYnabCategories(null, categoriesBody([everyday([category('c1', 'Groceries', 1000)])]))!;
    const renamed = mergeYnabCategories(first.categories, categoriesBody([everyday([], { name: 'Food' })]))!;
    expect(renamed.categories[0].groupName).toBe('Food');
  });

  it('drops every category of a deleted group', () => {
    const first = mergeYnabCategories(null, categoriesBody([everyday([category('c1', 'Groceries', 1000)])]))!;
    expect(mergeYnabCategories(first.categories, categoriesBody([everyday([], { deleted: true })]))!.categories).toEqual([]);
  });

  it('marks a category hidden when it or its group is', () => {
    const merged = mergeYnabCategories(null, categoriesBody([
      everyday([category('c1', 'Old', -500, { hidden: true })]),
      { id: 'g2', name: 'Hidden', hidden: true, deleted: false, internal: false, categories: [category('c2', 'Older', 0)] },
    ]))!;
    expect(merged.categories.map(c => c.hidden)).toEqual([true, true]);
  });

  it('refuses a body that is not a categories answer, so a bad read cannot empty the list', () => {
    expect(mergeYnabCategories([], { data: {} })).toBeNull();
  });

  it('reads no knowledge as null, so the next read is a full one', () => {
    expect(mergeYnabCategories(null, { data: { category_groups: [] } })!.serverKnowledge).toBeNull();
  });
});

describe('the queue', () => {
  it('reads the live ids out of a transactions answer', () => {
    expect(ynabTransactionIdsFrom({ data: { transactions: [{ id: 't1' }, { id: 't2', deleted: true }, {}], server_knowledge: 4 } }))
      .toEqual(['t1']);
    expect(ynabTransactionIdsFrom({ data: {} })).toBeNull();
  });

  it('counts a transaction that is both unapproved and uncategorized once', () => {
    expect(ynabQueueFrom(['a', 'b'], ['b', 'c'])).toEqual({ unapproved: 2, uncategorized: 2, total: 3 });
  });
});

describe('ynabCategoryNow', () => {
  const now = new Date(Date.UTC(2026, 10, 5, 12));
  const snapshot: YnabSnapshot = {
    fetchedAt: now.toISOString(),
    planId: 'p1',
    monthKey: '2026-11',
    serverKnowledge: 1,
    queue: null,
    categories: [{ id: 'c1', name: 'Groceries', groupId: 'g1', groupName: 'Everyday', balanceMinor: 3600, hidden: false }],
  };

  it('finds the category in a read of this month', () => {
    expect(ynabCategoryNow(snapshot, 'c1', now)?.balanceMinor).toBe(3600);
  });

  it('reads last month as nothing, since that balance is not what is left now', () => {
    expect(ynabCategoryNow(snapshot, 'c1', new Date(Date.UTC(2026, 11, 1, 1)))).toBeNull();
  });

  it('is null with no read, no category chosen, or one the plan no longer has', () => {
    expect(ynabCategoryNow(null, 'c1', now)).toBeNull();
    expect(ynabCategoryNow(snapshot, null, now)).toBeNull();
    expect(ynabCategoryNow(snapshot, 'gone', now)).toBeNull();
  });

  it('offers only visible categories, by group then name', () => {
    const many: YnabSnapshot = {
      ...snapshot,
      categories: [
        { id: 'b', name: 'Rent', groupId: 'g2', groupName: 'Bills', balanceMinor: 0, hidden: false },
        { id: 'z', name: 'Groceries', groupId: 'g1', groupName: 'Everyday', balanceMinor: 0, hidden: false },
        { id: 'a', name: 'Dining Out', groupId: 'g1', groupName: 'Everyday', balanceMinor: 0, hidden: false },
        { id: 'h', name: 'Old', groupId: 'g1', groupName: 'Everyday', balanceMinor: 0, hidden: true },
      ],
    };
    expect(ynabPickableCategories(many).map(c => c.id)).toEqual(['b', 'a', 'z']);
  });
});
