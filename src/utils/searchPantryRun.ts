import { useGroceryStore } from '../store/useGroceryStore';
import { entryFor, listNameFor } from './groceryLists';
import type { SearchActionReceipt } from './searchActionRun';
import type { PantryAction } from './searchActions';

/**
 * The write behind a pantry row ("out of milk"), kept apart from
 * `searchActionRun.ts` so it can be run without the food log and Health the
 * other search actions pull in.
 */
export function runPantry(action: PantryAction): SearchActionReceipt | null {
  const store = useGroceryStore.getState();
  const item = store.items.find(i => i.id === action.itemId);
  if (!item) return null;
  // What the row and its home-list entry were before, since "running low" can
  // put it on the list and only a snapshot knows whether it was already there
  // (the pantry review deck's Undo takes the same two).
  const entry = entryFor(store.listEntries, item.id, null);
  // Through the deck's answer: it writes exactly what the Out of it / Running
  // low pills write, and raises no disposal question, which a search line
  // isn't the place for.
  const portions = store.answerPantryReview(item.id, action.answer);
  const after = useGroceryStore.getState();
  const joined = action.answer === 'low' && !entry && entryFor(after.listEntries, item.id, null) !== null;
  const revert = () => useGroceryStore.getState().revertPantryAnswer(item, entry, portions);
  const receipt: SearchActionReceipt = {
    title: action.answer === 'low' ? `Marked ${item.name} as running low` : `Marked ${item.name} as out`,
    meta: joined ? 'Added to your grocery list' : '',
    undo: revert,
  };
  // The list is offered rather than assumed: "out of milk" may mean "buy it" or
  // may only mean "stop counting on it". Not offered once something has put it
  // there (running low's own setting), or when it already sits on the list.
  const listId = after.activeListId;
  if (joined || entryFor(after.listEntries, item.id, listId) !== null) return receipt;
  const listName = listNameFor(listId, after.lists);
  return {
    ...receipt,
    followUp: {
      label: 'Add to grocery list',
      accessibilityLabel: `Add ${item.name} to ${listName}`,
      run: () => {
        const grocery = useGroceryStore.getState();
        const preexisting = new Set(grocery.items.map(i => i.id));
        // Named explicitly, and no undo of its own, like the grocery row's add:
        // this receipt carries the one undo for both writes.
        const added = grocery.addByName(item.name, undefined, undefined, { registerUndo: false, listId });
        return {
          title: receipt.title,
          meta: `Added to ${listName}`,
          undo: () => {
            useGroceryStore.getState().undoForAdds([added.id], preexisting)();
            revert();
          },
        };
      },
    },
  };
}
