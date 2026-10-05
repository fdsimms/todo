import type { GroceryItem, ItemProduct, Leftover, UnattendedEntry } from '../types';
import {
  leftoverSnapshot,
  pantryRecordPlan,
  pantryRevertOf,
  pantrySnapshot,
  type PantryRecordState,
} from '../utils/agentPantryRevert';

const item = (over: Partial<GroceryItem> = {}): GroceryItem =>
  ({ id: 'g1', name: 'Spinach', onHandUntil: null, isStaple: false, expiresAt: null, runningLowAt: null, openedAt: null, frozenAt: null,
    shelfLifeDays: null, useUpTask: null, usedUpCount: 0, spoiledCount: 0, lastSpoiledAt: null, pantryReviewedAt: null, lastAddedAt: null, ...over }) as GroceryItem;

const box = (over: Partial<ItemProduct> = {}): ItemProduct =>
  ({ id: 'b1', itemId: 'g1', onHandUntil: null, expiresAt: null, frozenAt: null, openedAt: null, isPortion: false, ...over }) as ItemProduct;

const leftover = (over: Partial<Leftover> = {}): Leftover =>
  ({ id: 'l1', title: 'Chili', storedAt: '2026-08-20T12:00:00.000Z', keepUntil: '2026-08-23', frozenAt: null, finishedAt: null, outcome: null, ...over }) as Leftover;

const state = (over: Partial<PantryRecordState> = {}): PantryRecordState => ({
  groceryItem: () => null, itemBoxes: () => [], groceryHome: () => null, leftover: () => null, ...over,
});

const entry = (over: Partial<UnattendedEntry>): UnattendedEntry =>
  ({ id: 'e1', at: '2026-08-23T12:00:00.000Z', actor: 'agent', subject: 'pantry', action: 'edited', title: 'Spinach', taskId: null, recordId: 'g1', ...over }) as UnattendedEntry;

describe('pantryRevertOf', () => {
  it('is null when nothing the entry records changed', () => {
    const snap = pantrySnapshot(item(), [], false);
    expect(pantryRevertOf(snap, pantrySnapshot(item(), [], false))).toBeNull();
    expect(pantryRevertOf(snap, pantrySnapshot(item({ isStaple: true }), [], false))).not.toBeNull();
  });
});

describe('pantryRecordPlan for an item', () => {
  const before = pantrySnapshot(item(), [], false);
  const after = pantrySnapshot(item({ onHandUntil: '1970-01-01T00:00:00.000Z' }), [], false);
  const e = entry({ revert: pantryRevertOf(before, after) });

  it('restores while the item matches the after snapshot', () => {
    const plan = pantryRecordPlan(e, state({ groceryItem: () => item({ onHandUntil: '1970-01-01T00:00:00.000Z' }) }));
    expect(plan).toMatchObject({ kind: 'restorePantryItem', itemId: 'g1', removeFromList: false, removeBoxIds: [] });
  });

  it('says Undone when it matches the before, Changed since when it matches neither, Removed since when gone', () => {
    expect(pantryRecordPlan(e, state({ groceryItem: () => item() }))).toEqual({ kind: 'none', reason: 'Undone' });
    expect(pantryRecordPlan(e, state({ groceryItem: () => item({ onHandUntil: '2030-01-01T00:00:00.000Z' }) }))).toEqual({ kind: 'none', reason: 'Changed since' });
    expect(pantryRecordPlan(e, state())).toEqual({ kind: 'none', reason: 'Removed since' });
  });

  it('judges the boxes and the list too, and removes only the boxes the agent made', () => {
    const b = box({ id: 'new', isPortion: true, frozenAt: '2026-08-23T12:00:00.000Z' });
    const made = entry({ revert: pantryRevertOf(pantrySnapshot(item(), [box()], false), pantrySnapshot(item(), [box(), b], true)) });
    const world = state({ groceryItem: () => item(), itemBoxes: () => [box(), b], groceryHome: () => ({ checked: false }) });
    expect(pantryRecordPlan(made, world)).toMatchObject({ kind: 'restorePantryItem', removeBoxIds: ['new'], removeFromList: true, boxes: [expect.objectContaining({ id: 'b1' })] });
    // The portion was thawed and had its own day set since: not how the agent left it.
    const moved = state({ groceryItem: () => item(), itemBoxes: () => [box(), { ...b, frozenAt: null }], groceryHome: () => ({ checked: false }) });
    expect(pantryRecordPlan(made, moved)).toEqual({ kind: 'none', reason: 'Changed since' });
  });

  it('has nothing to offer without a revert', () => {
    expect(pantryRecordPlan(entry({ revert: null }), state({ groceryItem: () => item() }))).toEqual({ kind: 'none', reason: null });
  });
});

describe('pantryRecordPlan for a leftover', () => {
  const frozen = leftover({ frozenAt: '2026-08-23T12:00:00.000Z' });
  const e = entry({ recordId: 'l1', revert: pantryRevertOf(leftoverSnapshot(leftover()), leftoverSnapshot(frozen)) });

  it('restores while still frozen as the agent left it', () => {
    expect(pantryRecordPlan(e, state({ leftover: () => frozen }))).toMatchObject({ kind: 'restoreLeftover', id: 'l1', patch: expect.objectContaining({ frozenAt: null }) });
    expect(pantryRecordPlan(e, state({ leftover: () => leftover() }))).toEqual({ kind: 'none', reason: 'Undone' });
    expect(pantryRecordPlan(e, state({ leftover: () => leftover({ finishedAt: 'x', frozenAt: null, outcome: 'eaten' }) }))).toEqual({ kind: 'none', reason: 'Changed since' });
  });

  it('removes a logged container while it is open and not once finished', () => {
    const made = entry({ action: 'created', recordId: 'l1' });
    expect(pantryRecordPlan(made, state({ leftover: () => leftover() }))).toEqual({ kind: 'removeLeftover', id: 'l1' });
    expect(pantryRecordPlan(made, state({ leftover: () => leftover({ finishedAt: 'x' }) }))).toEqual({ kind: 'none', reason: 'Finished since' });
    expect(pantryRecordPlan(made, state())).toEqual({ kind: 'none', reason: 'Removed since' });
  });
});
