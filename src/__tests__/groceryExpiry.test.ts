import {
  clampUseUpLeadDays,
  useUpTaskDraft,
  useUpTaskDrift,
  useUpTaskFields,
  useUpTaskTitle,
  wantsUseUpTask,
} from '../utils/groceryExpiry';
import type { GroceryItem } from '../types';
import { GROCERY_USE_UP_LEAD_DAYS_MAX } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `item-${++seq}`,
    name: 'Spinach',
    nameKey: 'spinach',
    preferredProductId: null,
    productStrict: false,
    aisle: 'Produce',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    sortOrder: seq,
    purchaseCount: 3,
    lastAddedAt: null,
    lastPurchasedAt: '2026-08-12T09:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    choiceGroup: null,
    isStaple: false,
    expiresAt: '2026-08-17',
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

describe('wantsUseUpTask', () => {
  it('needs a use-by date — that is the whole trigger', () => {
    expect(wantsUseUpTask(item({ expiresAt: null }), true)).toBe(false);
    expect(wantsUseUpTask(item(), true)).toBe(true);
  });

  it('defers to the setting when the item has no opinion', () => {
    expect(wantsUseUpTask(item(), false)).toBe(false);
  });

  it('lets an item opt in with the setting off', () => {
    expect(wantsUseUpTask(item({ useUpTask: true }), false)).toBe(true);
  });

  it('lets an item opt out with the setting on — what deleting the task records', () => {
    expect(wantsUseUpTask(item({ useUpTask: false }), true)).toBe(false);
  });

  it('ignores whether the item is back on this week\'s list', () => {
    // The bag already in the fridge still needs eating.
    expect(wantsUseUpTask(item({ onList: true, checked: true }), true)).toBe(true);
  });
});

describe('useUpTaskTitle', () => {
  it('says the item\'s own label back', () => {
    expect(useUpTaskTitle(item({ name: 'Baby spinach' }))).toBe('Use up Baby spinach');
  });
});

describe('useUpTaskFields', () => {
  it('falls due the lead time before the use-by day, noon-normalized like every other projected task', () => {
    const fields = useUpTaskFields(item({ expiresAt: '2026-08-17' }), 1);
    expect(new Date(fields.dueDate).getFullYear()).toBe(2026);
    expect(new Date(fields.dueDate).getMonth()).toBe(7);
    expect(new Date(fields.dueDate).getDate()).toBe(16);
    expect(new Date(fields.dueDate).getHours()).toBe(12);
  });

  it('carries the use-by day itself as the deadline', () => {
    const fields = useUpTaskFields(item({ expiresAt: '2026-08-17' }), 3);
    expect(new Date(fields.deadline).getDate()).toBe(17);
    expect(new Date(fields.dueDate).getDate()).toBe(14);
  });

  it('a zero lead puts it on the day', () => {
    const fields = useUpTaskFields(item({ expiresAt: '2026-08-17' }), 0);
    expect(fields.dueDate).toBe(fields.deadline);
  });

  it('clamps a lead time out of range rather than dating the task into last month', () => {
    expect(clampUseUpLeadDays(-4)).toBe(0);
    expect(clampUseUpLeadDays(900)).toBe(GROCERY_USE_UP_LEAD_DAYS_MAX);
    const fields = useUpTaskFields(item({ expiresAt: '2026-08-17' }), -4);
    expect(fields.dueDate).toBe(fields.deadline);
  });

  it('opens straight to this item\'s own row in the kitchen view', () => {
    const spinach = item();
    expect(useUpTaskFields(spinach, 1).linkUrl).toBe(`dundundun://kitchen?item=grocery-${spinach.id}`);
  });
});

describe('useUpTaskDraft', () => {
  it('points back at the item and files itself under the configured category', () => {
    const spinach = item();
    const draft = useUpTaskDraft(spinach, 1, 'Home');
    expect(draft.generatedKind).toBe('groceryUseUp');
    expect(draft.generatedSourceId).toBe(spinach.id);
    expect(draft.category).toBe('Home');
    expect(draft.title).toBe('Use up Spinach');
  });

  it('takes no category when none is set', () => {
    expect(useUpTaskDraft(item(), 1).category).toBeNull();
  });
});

describe('useUpTaskDrift', () => {
  const spinach = item({ name: 'Spinach', expiresAt: '2026-08-17' });
  const inStep = { ...useUpTaskFields(spinach, 1) };

  it('is quiet when the task already says the right thing', () => {
    expect(useUpTaskDrift(inStep, spinach, 1)).toBeNull();
  });

  it('carries the task with a fresher purchase moving the use-by out', () => {
    const fresher = { ...spinach, expiresAt: '2026-08-24' };
    expect(useUpTaskDrift(inStep, fresher, 1)).toEqual({
      deadline: useUpTaskFields(fresher, 1).deadline,
      dueDate: useUpTaskFields(fresher, 1).dueDate,
    });
  });

  it('notices the item being renamed', () => {
    expect(useUpTaskDrift(inStep, { ...spinach, name: 'Baby spinach' }, 1)).toEqual({
      title: 'Use up Baby spinach',
    });
  });

  it('notices a task whose link no longer points at the kitchen', () => {
    expect(useUpTaskDrift({ ...inStep, linkUrl: null }, spinach, 1)).toEqual({ linkUrl: inStep.linkUrl });
  });

  // #1953, the grocery half. reconcileUseUpTask also fires on mutations that
  // leave expiresAt alone — un-opening a jar, the item's own use-up switch —
  // and rewriting the day there only undid a date the user had picked.
  it('leaves a task the user re-dated alone while the use-by has not moved', () => {
    expect(useUpTaskDrift({ ...inStep, title: 'Use up Spinach' }, spinach, 1)).toBeNull();
  });

  it('still re-dates a deferred task when the use-by itself moves', () => {
    const fresher = { ...spinach, expiresAt: '2026-08-24' };
    expect(useUpTaskDrift(inStep, fresher, 1)!.dueDate).toBe(useUpTaskFields(fresher, 1).dueDate);
  });

  // The lead is not recoverable from the row (deadline records the expiry, not
  // the offset), and nothing reconciles on a lead change — see the note on
  // useUpTaskDrift.
  it('does not re-date on the lead alone', () => {
    expect(useUpTaskDrift(inStep, spinach, 3)).toBeNull();
  });
});

describe('wantsUseUpTask and the freezer', () => {
  // The case the freezer exists for: the shelf-life lexicon is at its shortest
  // exactly where a freezer is most used (chicken 2 days, ground beef 2), so a
  // month of meat bought on Saturday is otherwise a fistful of "Use up" tasks
  // due Monday about food under an inch of ice.
  it('wants no task for a frozen item, however live its stored date is', () => {
    const chicken = item({ name: 'Chicken', expiresAt: '2026-08-15' });
    expect(wantsUseUpTask(chicken, true)).toBe(true);
    expect(wantsUseUpTask({ ...chicken, frozenAt: '2026-08-13T18:00:00.000Z' }, true)).toBe(false);
  });

  // The date is suspended, not cleared — so the row is one write away from
  // counting again, and the freeze needed no destructive edit to get there.
  it('wants the task back the moment it thaws, off the same stored date', () => {
    const frozen = item({ expiresAt: '2026-08-15', frozenAt: '2026-08-13T18:00:00.000Z' });
    expect(wantsUseUpTask({ ...frozen, frozenAt: null }, true)).toBe(true);
  });

  // An explicit per-item opt-in must not reach past the freezer either: it
  // would otherwise land in useUpTaskFields, which is about a date nothing is
  // counting.
  it('is not overridden by an explicit useUpTask opt-in while frozen', () => {
    const frozen = item({
      expiresAt: '2026-08-15',
      frozenAt: '2026-08-13T18:00:00.000Z',
      useUpTask: true,
    });
    expect(wantsUseUpTask(frozen, false)).toBe(false);
  });
});
