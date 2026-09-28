import { useUpSweepOrder } from '../utils/useUpSweep';
import { useUpTaskFields } from '../utils/groceryExpiry';
import type { GroceryItem, Leftover, Task } from '../types';

// The chain reaches dateUtils, which reaches the settings store for
// dayResetTime. Nothing here needs it: every date is a calendar day key.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    nameFromScan: false,
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
    pantryReviewedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null, nutrition: null, backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

function leftover(overrides: Partial<Leftover> = {}): Leftover {
  return {
    id: `lo-${++seq}`,
    title: 'Chilli',
    recipeId: null,
    sourceEntryId: null,
    storedAt: '2026-08-10T18:00:00.000Z',
    keepUntil: '2026-08-16',
    finishedAt: null,
    outcome: null,
    frozenAt: null,
    weightG: null,
    createdAt: '2026-08-10T18:00:00.000Z',
    useUpTask: null,
    ...overrides,
  };
}

type SweepTask = Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived' | 'deadline'>;

function useUpTask(of: GroceryItem, overrides: Partial<SweepTask> = {}): SweepTask {
  return {
    generatedKind: 'groceryUseUp',
    generatedSourceId: of.id,
    completed: false,
    archived: false,
    deadline: useUpTaskFields(of, 0).deadline,
    ...overrides,
  };
}

describe('useUpSweepOrder', () => {
  it('queues both kinds by live use-by day, soonest first', () => {
    const yogurt = item({ name: 'Yogurt', expiresAt: '2026-08-20' });
    const spinach = item({ expiresAt: '2026-08-15' });
    const chilli = leftover({ keepUntil: '2026-08-16' });
    const soup = leftover({ keepUntil: '2026-08-22' });

    expect(useUpSweepOrder([yogurt, spinach], [soup, chilli], [], true)).toEqual([
      { kind: 'groceryUseUp', id: spinach.id },
      { kind: 'leftoverUseUp', id: chilli.id },
      { kind: 'groceryUseUp', id: yogurt.id },
      { kind: 'leftoverUseUp', id: soup.id },
    ]);
  });

  it('keeps the given order on a tie, leftovers first', () => {
    const spinach = item({ expiresAt: '2026-08-16' });
    const chilli = leftover({ keepUntil: '2026-08-16' });
    expect(useUpSweepOrder([spinach], [chilli], [], true).map(s => s.id)).toEqual([chilli.id, spinach.id]);
  });

  it('lists every live leftover, and a frozen one last', () => {
    // The same set reconcileAllLeftoverTasks sweeps: each one's own reconcile
    // decides whether it wants a task.
    const frozen = leftover({ keepUntil: '2026-08-01', frozenAt: '2026-08-02T09:00:00.000Z' });
    const finished = leftover({ finishedAt: '2026-08-12T09:00:00.000Z', outcome: 'eaten' });
    const live = leftover({ keepUntil: '2026-08-30' });
    expect(useUpSweepOrder([], [frozen, finished, live], [], true).map(s => s.id)).toEqual([live.id, frozen.id]);
  });

  it('lists only the grocery items that want a task', () => {
    const dated = item();
    const undated = item({ name: 'Rice', expiresAt: null });
    const frozen = item({ name: 'Chicken', frozenAt: '2026-08-12T09:00:00.000Z' });
    const optedOut = item({ name: 'Kale', useUpTask: false });
    expect(useUpSweepOrder([dated, undated, frozen, optedOut], [], [], true).map(s => s.id)).toEqual([dated.id]);
    // The setting off leaves only an item's own opt-in.
    const optedIn = item({ name: 'Basil', useUpTask: true });
    expect(useUpSweepOrder([dated, optedIn], [], [], false).map(s => s.id)).toEqual([optedIn.id]);
  });

  it('skips an item whose task for this use-by day was already finished', () => {
    // Ticked off and the resolve sheet dismissed: a sweep on every foreground
    // must not hand "Use up spinach" straight back.
    const spinach = item();
    expect(useUpSweepOrder([spinach], [], [useUpTask(spinach, { completed: true })], true)).toEqual([]);
    expect(useUpSweepOrder([spinach], [], [useUpTask(spinach, { archived: true })], true)).toEqual([]);
  });

  it('still lists an item whose finished task was for an earlier packet', () => {
    // A new purchase re-dates the row, and that bag needs its own task.
    const spinach = item({ expiresAt: '2026-08-24' });
    const lastWeek = useUpTask(item({ id: spinach.id, expiresAt: '2026-08-17' }), { completed: true });
    expect(useUpSweepOrder([spinach], [], [lastWeek], true).map(s => s.id)).toEqual([spinach.id]);
  });

  it('still lists an item with a live task, so the reconcile can keep it in line', () => {
    const spinach = item();
    expect(useUpSweepOrder([spinach], [], [useUpTask(spinach)], true).map(s => s.id)).toEqual([spinach.id]);
  });
});
