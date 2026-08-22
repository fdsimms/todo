import {
  MAX_PANTRY_CHECK_TASKS,
  PANTRY_CHECK_GRACE_DAYS,
  pantryCheckAnswers,
  pantryCheckItemId,
  pantryCheckLapse,
  pantryCheckLinkUrl,
  pantryCheckTitle,
  stalePantryCheckTasks,
  wantedPantryChecks,
} from '../utils/pantryCheckTasks';
import { OUT_OF_IT_UNTIL, probablyHaveReason } from '../utils/grocerySuggest';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem, Task } from '../types';

// kitchenInventory reaches dateUtils and so the settings store, which opens
// SQLite — the same stub groceryExpiry.test.ts uses for the same import chain.
// Nothing here reads a setting; the link helpers are pure string builders.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const NOW = new Date('2026-08-22T12:00:00.000Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

let seq = 0;
function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  return {
    id: `id-${++seq}`,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    inCatalog: true,
    sortOrder: seq,
    // Three purchases over a year is a 122-day cadence, which is long enough
    // that most of these cases can move `lastPurchasedAt` alone without also
    // having to think about the window moving under them.
    purchaseCount: 3,
    lastAddedAt: null,
    lastPurchasedAt: daysAgo(200),
    createdAt: daysAgo(366),
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    choiceGroup: null,
    isStaple: false,
    expiresAt: null,
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

/** Only the fields these functions read — the shape the store passes in. */
type CheckTask = Pick<
  Task,
  'generatedKind' | 'generatedSourceId' | 'completed' | 'completedAt' | 'archived' | 'archivedAt'
>;

function makeTask(overrides: Partial<CheckTask> = {}): CheckTask {
  return {
    generatedKind: 'pantryCheck',
    generatedSourceId: null,
    completed: false,
    completedAt: null,
    archived: false,
    archivedAt: null,
    ...overrides,
  };
}

// ─── The lapse itself ────────────────────────────────────────────────────────

describe('pantryCheckLapse', () => {
  it('is null while the purchase reading still vouches for the item', () => {
    // 30 days into a 122-day cadence: probablyHaveReason still answers, so
    // there is nothing to ask about.
    const item = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(30) });
    expect(probablyHaveReason(item, NOW)).not.toBeNull();
    expect(pantryCheckLapse(item, NOW)).toBeNull();
  });

  it('reports the days since the window ran out', () => {
    const item = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });
    expect(probablyHaveReason(item, NOW)).toBeNull();
    // 125 days since, against a 366/3 = 122-day cadence.
    expect(pantryCheckLapse(item, NOW)).toBeCloseTo(3, 5);
  });

  it('stays quiet below the cadence gate, however long ago the purchase was', () => {
    // Two purchases is a window nobody knows — a flat fortnight standing in for
    // a cadence — and asking off the back of a made-up number is how a
    // generator earns its way into being switched off.
    const item = makeItem({ name: 'Saffron', purchaseCount: 2, lastPurchasedAt: daysAgo(300) });
    expect(pantryCheckLapse(item, NOW)).toBeNull();
  });

  it('stays quiet for a row nothing was ever bought on', () => {
    const item = makeItem({ name: 'Tahini', purchaseCount: 0, lastPurchasedAt: null });
    expect(pantryCheckLapse(item, NOW)).toBeNull();
  });

  it('stays quiet while something else answers for the item', () => {
    const lapsed = { lastPurchasedAt: daysAgo(200) };
    // A staple is a standing fact, not a guess with a shelf life.
    expect(pantryCheckLapse(makeItem({ name: 'Salt', isStaple: true, ...lapsed }), NOW)).toBeNull();
    // A live "Got it" is the user having already said so.
    expect(pantryCheckLapse(
      makeItem({ name: 'Rice', onHandUntil: '2026-12-01T00:00:00.000Z', ...lapsed }),
      NOW
    )).toBeNull();
    // The freezer measures in months, which is the whole reason it outranks the
    // purchase window in probablyHaveReason.
    expect(pantryCheckLapse(
      makeItem({ name: 'Chicken', frozenAt: daysAgo(60), ...lapsed }),
      NOW
    )).toBeNull();
    // Nearly out is still had — and it puts the row on the list anyway.
    expect(pantryCheckLapse(
      makeItem({ name: 'Oats', runningLowAt: daysAgo(2), ...lapsed }),
      NOW
    )).toBeNull();
  });

  it('stays quiet when the user has already said they are out of it', () => {
    // The one answer probablyHaveReason reports as null, so it needs its own
    // gate: asking "still got this?" of someone who just said they haven't is
    // the app not listening.
    const item = makeItem({ name: 'Sugar', onHandUntil: OUT_OF_IT_UNTIL });
    expect(probablyHaveReason(item, NOW)).toBeNull();
    expect(pantryCheckLapse(item, NOW)).toBeNull();
  });

  it('hands the question back when a "Got it" has merely lapsed', () => {
    // A past stamp that isn't the sentinel is an assertion that ran out, not a
    // claim to be out of something — so the purchase reading decides, and it
    // has run out too.
    const item = makeItem({ name: 'Butter', onHandUntil: daysAgo(40) });
    expect(pantryCheckLapse(item, NOW)).not.toBeNull();
  });

  it('stays quiet for a row already on the list, or one not in the catalog', () => {
    expect(pantryCheckLapse(makeItem({ name: 'Flour', onList: true }), NOW)).toBeNull();
    expect(pantryCheckLapse(makeItem({ name: 'Flour', inCatalog: false }), NOW)).toBeNull();
  });

  it('ignores the grace window, so a live task keeps its reason', () => {
    // The grace bounds *raising* a question, not keeping one — see
    // stalePantryCheckTasks.
    const ancient = makeItem({ name: 'Vanilla', lastPurchasedAt: daysAgo(360) });
    expect(pantryCheckLapse(ancient, NOW)).toBeGreaterThan(PANTRY_CHECK_GRACE_DAYS);
  });
});

// ─── What gets asked ─────────────────────────────────────────────────────────

describe('wantedPantryChecks', () => {
  it('asks about an item whose window has just run out', () => {
    const item = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });
    expect(wantedPantryChecks([item], [], NOW)).toEqual([
      { itemId: item.id, title: 'Check if you still have Flour', lapsedDays: expect.any(Number) },
    ]);
  });

  it('drops a lapse that has gone stale', () => {
    // 122-day cadence, so 122 + 14 + a day is out of grace. Without this the
    // qualifying set on the day this ships is most of the catalog, and the cap
    // would meter that out three at a time for ever.
    const fresh = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });
    const stale = makeItem({ name: 'Vanilla', lastPurchasedAt: daysAgo(140) });
    expect(wantedPantryChecks([fresh, stale], [], NOW).map(w => w.itemId)).toEqual([fresh.id]);
  });

  it('ranks the freshest lapse first, then by name', () => {
    // The opposite of wantedProjectReviews, which puts the longest-quiet
    // project first: a window that ran out this morning is the live question,
    // and one that ran out twelve days ago is nearly out of grace.
    const older = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(130) });
    const newer = makeItem({ name: 'Rice', lastPurchasedAt: daysAgo(123) });
    const alsoNewer = makeItem({ name: 'Barley', lastPurchasedAt: daysAgo(123) });
    expect(wantedPantryChecks([older, newer, alsoNewer], [], NOW).map(w => w.title)).toEqual([
      'Check if you still have Barley',
      'Check if you still have Rice',
      'Check if you still have Flour',
    ]);
  });

  it('caps the rows it asks for', () => {
    const items = ['Flour', 'Rice', 'Oats', 'Barley', 'Lentils'].map((name, i) =>
      makeItem({ name, lastPurchasedAt: daysAgo(125 + i) })
    );
    expect(wantedPantryChecks(items, [], NOW)).toHaveLength(MAX_PANTRY_CHECK_TASKS);
  });

  it('leaves an item alone once it has been turned down since the last purchase', () => {
    const item = makeItem({
      name: 'Flour',
      lastPurchasedAt: daysAgo(125),
      pantryCheckDeclinedAt: daysAgo(2),
    });
    expect(wantedPantryChecks([item], [], NOW)).toEqual([]);
  });

  it('asks again once the item has been bought since it was turned down', () => {
    // The decline is spent against the purchase, not against the day: a new
    // purchase is a new bag, which lapses on its own and earns its own
    // question. Purchase count up too, so the cadence still qualifies.
    const item = makeItem({
      name: 'Flour',
      purchaseCount: 4,
      createdAt: daysAgo(366),
      lastPurchasedAt: daysAgo(95),
      pantryCheckDeclinedAt: daysAgo(200),
    });
    // 366/4 = 91.5-day window, 95 days since: lapsed, and the old stamp is spent.
    expect(wantedPantryChecks([item], [], NOW)).toHaveLength(1);
  });

  it('leaves an item alone once its task was ticked off since the last purchase', () => {
    // Derived from the rows rather than written anywhere — a completion means
    // "I've dealt with this" and nothing more, which is exactly enough.
    const item = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });
    const done = makeTask({
      generatedSourceId: item.id,
      completed: true,
      completedAt: daysAgo(1),
    });
    expect(wantedPantryChecks([item], [done], NOW)).toEqual([]);
  });

  it('counts an archived task as an answer too', () => {
    // The app's other explicit "I've dealt with this", and the blind spot
    // liveGeneratedTasksOfKind would otherwise leave — neither state leaves a
    // live task for the next sweep to find.
    const item = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });
    const filed = makeTask({
      generatedSourceId: item.id,
      archived: true,
      archivedAt: daysAgo(1),
    });
    expect(wantedPantryChecks([item], [filed], NOW)).toEqual([]);
  });

  it('ignores a task answered before the last purchase', () => {
    const item = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });
    const old = makeTask({
      generatedSourceId: item.id,
      completed: true,
      completedAt: daysAgo(300),
    });
    expect(wantedPantryChecks([item], [old], NOW)).toHaveLength(1);
  });

  it('ignores another generator\'s task about the same id', () => {
    // One column holds six generators' source ids now, so a use-up task ticked
    // off must not answer a pantry question.
    const item = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });
    const other = makeTask({
      generatedKind: 'groceryUseUp',
      generatedSourceId: item.id,
      completed: true,
      completedAt: daysAgo(1),
    });
    expect(wantedPantryChecks([item], [other], NOW)).toHaveLength(1);
  });

  it('is unaffected by a live task, which the reconcile handles', () => {
    // wantedPantryChecks answers "who should have one", not "who lacks one" —
    // reconcileGeneratedTask turns that into a create or a drift check.
    const item = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });
    const live = makeTask({ generatedSourceId: item.id });
    expect(wantedPantryChecks([item], [live], NOW)).toHaveLength(1);
  });
});

// ─── Clearing up ─────────────────────────────────────────────────────────────

describe('stalePantryCheckTasks', () => {
  const lapsed = makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(125) });

  it('keeps a task whose item still has no answer', () => {
    const live = { ...makeTask({ generatedSourceId: lapsed.id }), id: 't-1' };
    expect(stalePantryCheckTasks([live], [lapsed], NOW)).toEqual([]);
  });

  it('clears a task once the user has answered from the sheet it links to', () => {
    // Either pill does it: "Got it" gives probablyHaveReason an answer, "Out of
    // it" is the sentinel gate. Neither goes near the task.
    const gotIt = { ...lapsed, onHandUntil: '2026-12-01T00:00:00.000Z' };
    const outOfIt = { ...lapsed, onHandUntil: OUT_OF_IT_UNTIL };
    const live = { ...makeTask({ generatedSourceId: lapsed.id }), id: 't-1' };
    expect(stalePantryCheckTasks([live], [gotIt], NOW)).toEqual([live]);
    expect(stalePantryCheckTasks([live], [outOfIt], NOW)).toEqual([live]);
  });

  it('clears a task once the item is back on the list', () => {
    const live = { ...makeTask({ generatedSourceId: lapsed.id }), id: 't-1' };
    expect(stalePantryCheckTasks([live], [{ ...lapsed, onList: true }], NOW)).toEqual([live]);
  });

  it('clears a task whose item has been deleted', () => {
    const live = { ...makeTask({ generatedSourceId: lapsed.id }), id: 't-1' };
    expect(stalePantryCheckTasks([live], [], NOW)).toEqual([live]);
  });

  it('keeps a task whose lapse has aged past the grace window', () => {
    // The grace decides whether a lapse is fresh enough to *raise*; a question
    // already asked doesn't expire because the user hasn't got to it within a
    // fortnight, and deleting a row someone deferred to Saturday is the failure
    // staleProjectReviewTasks makes the same split to avoid.
    const ancient = { ...lapsed, lastPurchasedAt: daysAgo(360) };
    const live = { ...makeTask({ generatedSourceId: ancient.id }), id: 't-1' };
    expect(wantedPantryChecks([ancient], [], NOW)).toEqual([]);
    expect(stalePantryCheckTasks([live], [ancient], NOW)).toEqual([]);
  });

  it('leaves completed and archived tasks alone', () => {
    // A completed task is the record of a thing that was done, and an archived
    // one is a deliberate filing — the two exclusions liveGeneratedTasksOfKind
    // already makes.
    const done = { ...makeTask({ generatedSourceId: 'gone', completed: true }), id: 't-1' };
    const filed = { ...makeTask({ generatedSourceId: 'gone', archived: true }), id: 't-2' };
    expect(stalePantryCheckTasks([done, filed], [], NOW)).toEqual([]);
  });

  it('leaves another generator\'s tasks alone', () => {
    const other = {
      ...makeTask({ generatedKind: 'projectReview', generatedSourceId: 'p-1' }),
      id: 't-1',
    };
    expect(stalePantryCheckTasks([other], [], NOW)).toEqual([]);
  });
});

// ─── The small stuff ─────────────────────────────────────────────────────────

describe('pantryCheckTitle', () => {
  it('names the verb and the doubt', () => {
    // "Flour" on the widget or in Search is a task to buy flour, which is the
    // one thing this isn't.
    expect(pantryCheckTitle({ name: 'Flour' })).toBe('Check if you still have Flour');
  });
});

describe('pantryCheckItemId', () => {
  it('answers only for its own kind', () => {
    expect(pantryCheckItemId(makeTask({ generatedSourceId: 'g-1' }))).toBe('g-1');
    expect(pantryCheckItemId(
      makeTask({ generatedKind: 'groceryUseUp', generatedSourceId: 'g-1' })
    )).toBeNull();
  });
});

describe('pantryCheckLinkUrl', () => {
  it('points at the item\'s own row in the kitchen', () => {
    expect(pantryCheckLinkUrl('g-1')).toBe('dundundun://kitchen?item=grocery-g-1');
  });
});

describe('pantryCheckAnswers', () => {
  it('keeps the latest answer per item', () => {
    const answers = pantryCheckAnswers([
      makeTask({ generatedSourceId: 'g-1', completed: true, completedAt: daysAgo(9) }),
      makeTask({ generatedSourceId: 'g-1', completed: true, completedAt: daysAgo(2) }),
      makeTask({ generatedSourceId: 'g-2', archived: true, archivedAt: daysAgo(5) }),
    ]);
    expect(answers.get('g-1')).toBe(daysAgo(2));
    expect(answers.get('g-2')).toBe(daysAgo(5));
  });

  it('ignores a task that is still live', () => {
    expect(pantryCheckAnswers([makeTask({ generatedSourceId: 'g-1' })].map(t => t)).size).toBe(0);
  });
});
