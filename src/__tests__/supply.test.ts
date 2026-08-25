import type { GroceryItem, Task } from '../types';
import {
  DEFAULT_SUPPLY_REORDER_AT,
  MAX_SUPPLY_COUNT,
  MAX_SUPPLY_REORDER_TASKS,
  canHoldSupply,
  clampSupplyCount,
  clampSupplyLeadDays,
  clampSupplyRefillCount,
  clampSupplyReorderAt,
  describeSupply,
  describeSupplyRunOut,
  describeSupplyStock,
  describeSupplyStockCaption,
  formatSupplyLeft,
  isSupplyTask,
  restockedSupplyCount,
  staleSupplyReorderTasks,
  suppliesStockedFrom,
  suppliesWantingList,
  supplyOrderByDate,
  supplyReorderReason,
  supplyReorderSourceId,
  supplyReorderTitle,
  supplyRunOutDate,
  wantedSupplyReorders,
} from '../utils/supply';
import { dayKeyOf } from '../utils/dateUtils';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

const BASE: Task = {
  id: 'task-1',
  title: 'Test',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: new Date().toISOString(),
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceAnchorDay: null,
  recurrenceAnchorDate: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  supplyCount: null,
  supplyUnit: null,
  supplyRefillCount: null,
  supplyReorderAt: 1,
  supplyLeadDays: null,
  supplyDeclinedAtCount: null,
  supplyGroceryItemId: null,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  progressCount: 0,
  tags: [],
  sortOrder: 0,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null,
  parentId: null,
  groupId: null,
  projectId: null,
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  waitingOnPersonId: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  backfillDismissedFields: [],
  personIds: [],
};
/** Noon on a day offset from today, which is where every real due date sits. */
const dayFromToday = (offset: number): string => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};

/** A daily recurring task with a supply, the shape every case below starts from. */
const supplyTask = (overrides: Partial<Task> = {}): Task => ({
  ...BASE,
  id: 'supply-1',
  title: 'Replace CPAP filter',
  dueDate: dayFromToday(0),
  recurrenceType: 'daily',
  recurrenceInterval: 1,
  supplyCount: 5,
  supplyUnit: 'filters',
  supplyReorderAt: 1,
  ...overrides,
});

const reorderTask = (sourceId: string, overrides: Partial<Task> = {}): Task => ({
  ...BASE,
  id: `reorder-${sourceId}`,
  title: 'Order more filters',
  generatedKind: 'supplyReorder',
  generatedSourceId: sourceId,
  ...overrides,
});

const item = (id: string, overrides: Partial<GroceryItem> = {}): Pick<GroceryItem, 'id' | 'runningLowAt'> => ({
  id,
  runningLowAt: null,
  ...overrides,
});

// ─── clamps ─────────────────────────────────────────────────────────────────

describe('the clamps', () => {
  it('treats a null count as "not a supply" and keeps zero as a real value', () => {
    expect(clampSupplyCount(null)).toBeNull();
    expect(clampSupplyCount(undefined)).toBeNull();
    // Zero is the state the whole feature points at, not an absence.
    expect(clampSupplyCount(0)).toBe(0);
  });

  it('floors a count at zero and caps it, and drops fractions', () => {
    expect(clampSupplyCount(-4)).toBe(0);
    expect(clampSupplyCount(2.7)).toBe(2);
    expect(clampSupplyCount(10_000)).toBe(MAX_SUPPLY_COUNT);
  });

  it('never lets the reorder threshold reach zero', () => {
    // A threshold of 0 means "ask once I have run out", which is the state the
    // feature exists to get ahead of.
    expect(clampSupplyReorderAt(0)).toBe(1);
    expect(clampSupplyReorderAt(-3)).toBe(1);
    expect(clampSupplyReorderAt(null)).toBe(DEFAULT_SUPPLY_REORDER_AT);
    expect(clampSupplyReorderAt(4)).toBe(4);
  });

  it('allows a zero-day lead time but not a negative one', () => {
    expect(clampSupplyLeadDays(0)).toBe(0);
    expect(clampSupplyLeadDays(-2)).toBe(0);
    expect(clampSupplyLeadDays(null)).toBeNull();
    expect(clampSupplyLeadDays(7)).toBe(7);
  });

  it('floors a refill at one, since a pack of nothing is not a pack', () => {
    expect(clampSupplyRefillCount(0)).toBe(1);
    expect(clampSupplyRefillCount(null)).toBeNull();
    expect(clampSupplyRefillCount(6)).toBe(6);
  });
});

// ─── what counts as a supply ────────────────────────────────────────────────

describe('isSupplyTask', () => {
  it('counts a supply of zero, which is the whole point of the feature', () => {
    expect(isSupplyTask({ supplyCount: 0 })).toBe(true);
    expect(isSupplyTask({ supplyCount: 3 })).toBe(true);
    expect(isSupplyTask({ supplyCount: null })).toBe(false);
  });
});

describe('canHoldSupply', () => {
  it('refuses a one-off, which would never count down', () => {
    // A supply rides onto the successor completeTask spawns; a task that
    // spawns none would sit at its starting number for ever.
    expect(canHoldSupply({ recurrenceType: 'none', parentId: null })).toBe(false);
    expect(canHoldSupply({ recurrenceType: 'daily', parentId: null })).toBe(true);
  });

  it('refuses a subtask', () => {
    expect(canHoldSupply({ recurrenceType: 'daily', parentId: 'parent-1' })).toBe(false);
  });
});

// ─── run-out date ───────────────────────────────────────────────────────────

describe('supplyRunOutDate', () => {
  it('runs out on this very occurrence when there is one unit left', () => {
    const task = supplyTask({ supplyCount: 1 });
    expect(dayKeyOf(supplyRunOutDate(task)!)).toBe(dayKeyOf(new Date(task.dueDate!)));
  });

  it('counts the current occurrence as one of the units it spends', () => {
    // Five left on a daily task: today plus the next four days.
    expect(dayKeyOf(supplyRunOutDate(supplyTask({ supplyCount: 5 }))!))
      .toBe(dayKeyOf(new Date(dayFromToday(4))));
  });

  it('follows the real interval rather than assuming days', () => {
    const weekly = supplyTask({ supplyCount: 3, recurrenceType: 'weekly', recurrenceInterval: 1 });
    expect(dayKeyOf(supplyRunOutDate(weekly)!)).toBe(dayKeyOf(new Date(dayFromToday(14))));
  });

  it('has no answer for a supply already spent', () => {
    // There is no future occurrence that spends a unit it hasn't got.
    expect(supplyRunOutDate(supplyTask({ supplyCount: 0 }))).toBeNull();
  });

  it('has no answer for a schedule that cannot be projected', () => {
    // Inherits canProject's refusals wholesale rather than inventing a grid —
    // a from-completion task's next date is anchored to a day that has not
    // happened.
    expect(supplyRunOutDate(supplyTask({ recurrenceFromCompletion: true }))).toBeNull();
    expect(supplyRunOutDate(supplyTask({ recurrenceType: 'none' }))).toBeNull();
    expect(supplyRunOutDate(supplyTask({ dueDate: null }))).toBeNull();
  });

  it('stops where the recurrence itself stops', () => {
    // Six filters but only three occurrences left to spend them on.
    expect(supplyRunOutDate(supplyTask({ supplyCount: 6, recurrenceCount: 3 }))).toBeNull();
  });
});

describe('supplyOrderByDate', () => {
  it('works back from the run-out day by the delivery time', () => {
    const task = supplyTask({ supplyCount: 10, supplyLeadDays: 3 });
    // Runs out on day 9; ordering has to happen by day 6.
    expect(dayKeyOf(supplyOrderByDate(task)!)).toBe(dayKeyOf(new Date(dayFromToday(6))));
  });

  it('says nothing without a lead time', () => {
    expect(supplyOrderByDate(supplyTask({ supplyCount: 10 }))).toBeNull();
  });

  it('is allowed to land in the past, because being late is a real state', () => {
    const task = supplyTask({ supplyCount: 2, supplyLeadDays: 30 });
    expect(supplyOrderByDate(task)!.getTime()).toBeLessThan(Date.now());
  });
});

// ─── the trigger ────────────────────────────────────────────────────────────

describe('supplyReorderReason', () => {
  it('fires on the count once the supply reaches the threshold', () => {
    expect(supplyReorderReason(supplyTask({ supplyCount: 2, supplyReorderAt: 1 }))).toBeNull();
    expect(supplyReorderReason(supplyTask({ supplyCount: 1, supplyReorderAt: 1 }))).toBe('count');
    expect(supplyReorderReason(supplyTask({ supplyCount: 0, supplyReorderAt: 1 }))).toBe('count');
  });

  it('fires on the lead time long before the count would', () => {
    // Four filters left is nowhere near a threshold of 1, but a monthly change
    // runs them out about three months from now and this one takes four months
    // to arrive — so it has to be ordered today. This is the case a count
    // threshold cannot express, and the whole reason the lead time exists.
    const task = supplyTask({
      supplyCount: 4,
      recurrenceType: 'monthly',
      supplyReorderAt: 1,
      supplyLeadDays: 120,
    });
    expect(supplyReorderReason(task)).toBe('leadTime');
  });

  it('caps the lead time, so no delivery outlasts a year of runway', () => {
    // 365 is the clamp; a monthly supply of twenty is roughly nineteen months
    // out, which nothing can reach forward to.
    const task = supplyTask({
      supplyCount: 20,
      recurrenceType: 'monthly',
      supplyReorderAt: 1,
      supplyLeadDays: 9999,
    });
    expect(supplyReorderReason(task)).toBeNull();
  });

  it('stays quiet while the run-out day is further off than the delivery', () => {
    const task = supplyTask({ supplyCount: 30, supplyLeadDays: 3 });
    expect(supplyReorderReason(task)).toBeNull();
  });

  it('falls back to the count alone when the schedule cannot be projected', () => {
    // The reason the count trigger can never be the optional one.
    const fromCompletion = supplyTask({
      supplyCount: 1,
      supplyLeadDays: 7,
      recurrenceFromCompletion: true,
    });
    expect(supplyReorderReason(fromCompletion)).toBe('count');
    expect(supplyReorderReason({ ...fromCompletion, supplyCount: 9 })).toBeNull();
  });

  it('goes quiet at or below the count the offer was turned down at', () => {
    const declined = supplyTask({ supplyCount: 1, supplyDeclinedAtCount: 1 });
    expect(supplyReorderReason(declined)).toBeNull();
    // And stays quiet as it keeps falling — the order is already placed.
    expect(supplyReorderReason({ ...declined, supplyCount: 0 })).toBeNull();
  });

  it('speaks up again once a restock lifts the count past the stamp', () => {
    // The store clears the stamp on a rising count; even left in place, a
    // count above it is not suppressed.
    const restocked = supplyTask({ supplyCount: 6, supplyDeclinedAtCount: 1, supplyReorderAt: 6 });
    expect(supplyReorderReason(restocked)).toBe('count');
  });

  it('says nothing about a task that could never count down', () => {
    expect(supplyReorderReason(supplyTask({ supplyCount: 0, recurrenceType: 'none' }))).toBeNull();
    expect(supplyReorderReason(supplyTask({ supplyCount: 0, completed: true }))).toBeNull();
    expect(supplyReorderReason(supplyTask({ supplyCount: 0, archived: true }))).toBeNull();
  });

  it('refuses a generated task, so a reorder task cannot ask for a reorder task', () => {
    const generated = supplyTask({ supplyCount: 0, generatedKind: 'supplyReorder' });
    expect(supplyReorderReason(generated)).toBeNull();
  });
});

// ─── wording ────────────────────────────────────────────────────────────────

describe('the wording', () => {
  it('drops the unit when there is not one', () => {
    expect(formatSupplyLeft(3, 'filters')).toBe('3 filters left');
    expect(formatSupplyLeft(3, null)).toBe('3 left');
    expect(formatSupplyLeft(3, '  filters ')).toBe('3 filters left');
  });

  it('says out loud that a supply is spent rather than rendering it as a number', () => {
    expect(describeSupply({ ...supplyTask(), supplyCount: 0 })).toBe('Out of filters');
    expect(describeSupply({ ...supplyTask(), supplyCount: 0, supplyUnit: null })).toBe('Out');
    expect(describeSupply({ ...supplyTask(), supplyCount: 2 })).toBe('2 filters left');
    expect(describeSupply({ ...supplyTask(), supplyCount: null })).toBeNull();
  });

  it('dates the run-out absolutely, never as "Today"', () => {
    const thisYear = new Date();
    thisYear.setMonth(10, 12);
    expect(describeSupplyRunOut(thisYear)).toBe('Runs out 12 Nov');
    expect(describeSupplyRunOut(new Date('2099-11-12T12:00:00'))).toBe('Runs out 12 Nov 2099');
  });

  it('names the unit in the reorder task, and falls back to naming the task', () => {
    expect(supplyReorderTitle({ title: 'Replace CPAP filter', supplyUnit: 'filters' }))
      .toBe('Order more filters');
    // Never a bare "Order more", which is a row with its content missing.
    expect(supplyReorderTitle({ title: 'Replace CPAP filter', supplyUnit: null }))
      .toBe('Order more for Replace CPAP filter');
  });
});

// ─── what the sweep asks for ────────────────────────────────────────────────

describe('wantedSupplyReorders', () => {
  it('names only the supplies that are actually asking', () => {
    const low = supplyTask({ id: 'low', supplyCount: 1 });
    const fine = supplyTask({ id: 'fine', supplyCount: 9 });
    expect(wantedSupplyReorders([low, fine]).map(w => w.taskId)).toEqual(['low']);
  });

  it('leaves a linked supply to the shopping list', () => {
    // The item goes on the list instead; a task saying "buy X" beside a list
    // line saying "buy X" is two nags for one errand.
    const linked = supplyTask({ id: 'linked', supplyCount: 0, supplyGroceryItemId: 'item-1' });
    expect(wantedSupplyReorders([linked])).toEqual([]);
  });

  it('puts the soonest run-out first and the unknowable ones last', () => {
    const soon = supplyTask({ id: 'soon', supplyCount: 1 });
    const later = supplyTask({
      id: 'later', supplyCount: 1, recurrenceType: 'weekly', dueDate: dayFromToday(5),
    });
    const unknown = supplyTask({ id: 'unknown', supplyCount: 1, recurrenceFromCompletion: true });
    const order = wantedSupplyReorders([unknown, later, soon]).map(w => w.taskId);
    expect(order).toEqual(['soon', 'later', 'unknown']);
  });

  it('carries the deadline, the pack size, the buying link and the category onto the want', () => {
    const task = supplyTask({
      supplyCount: 1,
      supplyRefillCount: 6,
      linkUrl: 'https://example.com/filters',
      category: 'Bathroom',
    });
    const [want] = wantedSupplyReorders([task]);
    expect(want.refillCount).toBe(6);
    expect(want.linkUrl).toBe('https://example.com/filters');
    expect(want.category).toBe('Bathroom');
    expect(dayKeyOf(want.runOut!)).toBe(dayKeyOf(new Date(task.dueDate!)));
  });

  it('caps the set, so a bulk import cannot fill Today with reorders', () => {
    const many = Array.from({ length: MAX_SUPPLY_REORDER_TASKS + 4 }, (_, i) =>
      supplyTask({ id: `t${i}`, supplyCount: 1 })
    );
    expect(wantedSupplyReorders(many)).toHaveLength(MAX_SUPPLY_REORDER_TASKS);
  });
});

describe('staleSupplyReorderTasks', () => {
  it('keeps a reorder task whose supply is still low', () => {
    const source = supplyTask({ id: 'src', supplyCount: 1 });
    expect(staleSupplyReorderTasks([source, reorderTask('src')])).toEqual([]);
  });

  it('clears one whose supply has been topped back up', () => {
    const source = supplyTask({ id: 'src', supplyCount: 8 });
    expect(staleSupplyReorderTasks([source, reorderTask('src')]).map(t => t.id))
      .toEqual(['reorder-src']);
  });

  it('clears one whose source has gone entirely', () => {
    expect(staleSupplyReorderTasks([reorderTask('vanished')]).map(t => t.id))
      .toEqual(['reorder-vanished']);
  });

  it('keeps a row the cap kept out of the wanted set', () => {
    // Losing the cap contest is not a reason to delete a row the user has
    // already deferred to Saturday.
    const sources = Array.from({ length: MAX_SUPPLY_REORDER_TASKS + 2 }, (_, i) =>
      supplyTask({ id: `t${i}`, supplyCount: 1 })
    );
    const rows = sources.map(s => reorderTask(s.id));
    expect(staleSupplyReorderTasks([...sources, ...rows])).toEqual([]);
  });

  it('leaves a completed reorder task alone', () => {
    // It is the record of an order that was placed, not a row to tidy.
    const source = supplyTask({ id: 'src', supplyCount: 8 });
    const done = reorderTask('src', { completed: true });
    expect(staleSupplyReorderTasks([source, done])).toEqual([]);
  });
});

describe('suppliesStockedFrom', () => {
  it('names the supplies a catalog item stocks', () => {
    const a = supplyTask({ id: 'a', supplyGroceryItemId: 'item-1' });
    const b = supplyTask({ id: 'b', supplyGroceryItemId: 'item-2' });
    expect(suppliesStockedFrom('item-1', [a, b]).map(t => t.id)).toEqual(['a']);
  });

  it('names every one of them, since two tasks can share an item', () => {
    // A filter changed at home and one at the office. A sheet naming only the
    // first would be quietly wrong about the second.
    const home = supplyTask({ id: 'home', supplyGroceryItemId: 'item-1' });
    const work = supplyTask({ id: 'work', supplyGroceryItemId: 'item-1' });
    expect(suppliesStockedFrom('item-1', [home, work]).map(t => t.id)).toEqual(['home', 'work']);
  });

  it('ignores a task that has been finished or filed away', () => {
    // Same two exclusions liveGeneratedTask makes: neither is still counting
    // on the cupboard, so naming them would report a dependency that has
    // stopped existing.
    const done = supplyTask({ id: 'done', supplyGroceryItemId: 'item-1', completed: true });
    const filed = supplyTask({ id: 'filed', supplyGroceryItemId: 'item-1', archived: true });
    expect(suppliesStockedFrom('item-1', [done, filed])).toEqual([]);
  });

  it('ignores a task that names an item but tracks no supply', () => {
    const stray = supplyTask({ id: 'stray', supplyGroceryItemId: 'item-1', supplyCount: null });
    expect(suppliesStockedFrom('item-1', [stray])).toEqual([]);
  });
});

describe('the provenance line', () => {
  const t = (title: string) => ({ title });

  it('names one task in the sheet and on the row, in each surface\'s own words', () => {
    expect(describeSupplyStock([t('Change the water filter')]))
      .toBe('Stocked for “Change the water filter”');
    // Shorter on the row, and phrased to match the recipe caption beside it.
    expect(describeSupplyStockCaption([t('Change the water filter')]))
      .toBe('For “Change the water filter”');
  });

  it('names both when two tasks share an item', () => {
    expect(describeSupplyStock([t('Filter at home'), t('Filter at work')]))
      .toBe('Stocked for “Filter at home” and “Filter at work”');
  });

  it('counts instead of listing once naming stops being a sentence', () => {
    expect(describeSupplyStock([t('A'), t('B'), t('C')])).toBe('Stocked for 3 tasks');
    expect(describeSupplyStockCaption([t('A'), t('B'), t('C')])).toBe('For 3 tasks');
  });

  it('says nothing at all for an ordinary catalog row', () => {
    expect(describeSupplyStock([])).toBeNull();
    expect(describeSupplyStockCaption([])).toBeNull();
  });
});

describe('suppliesWantingList', () => {
  it('names the item behind a linked supply that has run low', () => {
    const linked = supplyTask({ supplyCount: 1, supplyGroceryItemId: 'item-1' });
    expect(suppliesWantingList([linked], [item('item-1')])).toEqual(['item-1']);
  });

  it('leaves an item already flagged low alone, so the flag keeps its date', () => {
    const linked = supplyTask({ supplyCount: 1, supplyGroceryItemId: 'item-1' });
    expect(suppliesWantingList([linked], [item('item-1', { runningLowAt: '2026-01-01T00:00:00Z' })]))
      .toEqual([]);
  });

  it('ignores a link pointing at an item that has been deleted', () => {
    const linked = supplyTask({ supplyCount: 1, supplyGroceryItemId: 'gone' });
    expect(suppliesWantingList([linked], [item('item-1')])).toEqual([]);
  });

  it('names an item once even when two supplies share it', () => {
    const a = supplyTask({ id: 'a', supplyCount: 1, supplyGroceryItemId: 'item-1' });
    const b = supplyTask({ id: 'b', supplyCount: 0, supplyGroceryItemId: 'item-1' });
    expect(suppliesWantingList([a, b], [item('item-1')])).toEqual(['item-1']);
  });
});

// ─── restocking ─────────────────────────────────────────────────────────────

describe('restockedSupplyCount', () => {
  it('adds to what is left rather than replacing it', () => {
    // The whole point of a lead time is ordering while you still have some.
    expect(restockedSupplyCount(2, 6)).toBe(8);
  });

  it('leaves the count alone when nobody said how many', () => {
    // Null is a real answer to every deliverable prompt; it means "the app
    // does not know", never "zero arrived".
    expect(restockedSupplyCount(2, null)).toBe(2);
    expect(restockedSupplyCount(2, NaN)).toBe(2);
    expect(restockedSupplyCount(2, -5)).toBe(2);
  });

  it('says nothing about a task that has no supply', () => {
    expect(restockedSupplyCount(null, 6)).toBeNull();
  });

  it('stays inside the ceiling', () => {
    expect(restockedSupplyCount(MAX_SUPPLY_COUNT, 50)).toBe(MAX_SUPPLY_COUNT);
  });
});

describe('supplyReorderSourceId', () => {
  it('reads the source only off a reorder task', () => {
    expect(supplyReorderSourceId(reorderTask('src'))).toBe('src');
    // One column holds seven generators' ids; a grocery item's read as a task
    // id would restock a task that does not exist.
    expect(supplyReorderSourceId({ generatedKind: 'pantryCheck', generatedSourceId: 'item-1' }))
      .toBeNull();
  });
});
