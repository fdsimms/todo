import {
  clampUseUpLeadDays,
  useUpTaskDraft,
  useUpTaskFields,
  useUpTaskNeedsUpdate,
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
    inCatalog: true,
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
    shelfLifeDays: null,
    useUpTask: null,
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

describe('useUpTaskNeedsUpdate', () => {
  const spinach = item({ name: 'Spinach', expiresAt: '2026-08-17' });
  const inStep = { ...useUpTaskFields(spinach, 1) };

  it('is quiet when the task already says the right thing', () => {
    expect(useUpTaskNeedsUpdate(inStep, spinach, 1)).toBe(false);
  });

  it('notices a fresher purchase moving the date out', () => {
    expect(useUpTaskNeedsUpdate(inStep, item({ expiresAt: '2026-08-24' }), 1)).toBe(true);
  });

  it('notices the lead time changing', () => {
    expect(useUpTaskNeedsUpdate(inStep, spinach, 3)).toBe(true);
  });

  it('reads a task the user re-dated as drifted — the item owns the day', () => {
    expect(useUpTaskNeedsUpdate({ ...inStep, dueDate: '2026-09-01T12:00:00.000Z' }, spinach, 1)).toBe(true);
  });

  it('notices a task whose link no longer points at the kitchen', () => {
    expect(useUpTaskNeedsUpdate({ ...inStep, linkUrl: null }, spinach, 1)).toBe(true);
  });
});
