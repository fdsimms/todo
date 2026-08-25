import React, { useEffect, useMemo } from 'react';
import { Alert } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { LeftoverSheet } from './LeftoverSheet';

/**
 * What completing a "Use up X" task actually resolves.
 *
 * Checking the task off used to be the whole interaction — the reminder went
 * quiet and the pantry/fridge stayed exactly as it was, so the bag of
 * spinach the task was about could still read as on hand a week later.
 * useTaskStore.completeTask now points a session-only flag at the item
 * (pendingUseUpItemId / pendingUseUpLeftoverId, one per store, the same
 * shape useMealPlanStore's cookedOffer already uses for the cook task) and
 * this is what watches it — asking directly which way the item went, rather
 * than handing the user the item's whole editor and leaving them to work out
 * that "Out of it" on the Pantry field is the answer.
 *
 * **A grocery item gets an explicit prompt, not its own sheet.** This used to
 * open GroceryItemSheet on the Pantry field, the same full editor a catalog
 * row opens from a tap — aisle, stores, substitutes and all, with nothing on
 * screen actually asking "did you eat it or did it go bad?". A leftover
 * container's Finished it/Threw it out buttons are a real, if buried,
 * version of that question, so LeftoverSheet is left as it is; a grocery
 * item had no equivalent to lean on, so this asks directly instead — the
 * same "Used it up"/"Went bad" wording `ItemDisposalOffer` uses for the same
 * question elsewhere, as a native prompt rather than that offer's banner: a
 * dismissible banner can scroll away unanswered, and completing the task is
 * the one moment this question is actually about. `markOutOfMany` records
 * the answer with the outcome already known, so it never raises
 * `disposalOffer` — that banner stays the ✕ tap's own, unrelated to this.
 * Skipping the prompt (or an item that's already out, or gone) leaves the
 * pantry untouched, same as closing the old sheet without touching the
 * Pantry field did.
 *
 * **Mounted once, in AppNavigator beside DemoBanner/UndoBar,
 * not on any one screen.** Completion can land here from Today, Search,
 * Waiting, the widget, or a bulk-complete, and the flag has to raise the
 * prompt wherever the tap happened to come from.
 *
 * Both flows share the same wiring KitchenScreen uses for the same rows — see
 * that component's doc comment for why a container carries no ✕ and a
 * catalog row opens on the Pantry field.
 */
export function UseUpResolveSheet() {
  const pendingItemId = useGroceryStore(s => s.pendingUseUpItemId);
  const setPendingUseUpItem = useGroceryStore(s => s.setPendingUseUpItem);
  const items = useGroceryStore(useShallow(s => s.items));
  const markOutOfMany = useGroceryStore(s => s.markOutOfMany);

  useEffect(() => {
    if (!pendingItemId) return;
    const item = items.find(i => i.id === pendingItemId);
    // Resolve-or-shrug, same as everywhere else a pointer like this is read:
    // deleted, or already resolved (e.g. from Kitchen), leaves nothing to ask.
    if (!item || item.onHandUntil === OUT_OF_IT_UNTIL) {
      setPendingUseUpItem(null);
      return;
    }
    Alert.alert(
      item.name,
      'How did it go?',
      [
        { text: 'Not now', style: 'cancel', onPress: () => setPendingUseUpItem(null) },
        {
          text: 'Went bad',
          onPress: () => { markOutOfMany([item.id], 'spoiled'); setPendingUseUpItem(null); },
        },
        {
          text: 'Used it up',
          onPress: () => { markOutOfMany([item.id], 'usedUp'); setPendingUseUpItem(null); },
        },
      ]
    );
    // Fires once per id, not on every render the item list happens to
    // update on — see FinishLeftoverPrompt's identical effect for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItemId]);

  const pendingLeftoverId = useLeftoverStore(s => s.pendingUseUpLeftoverId);
  const setPendingUseUpLeftover = useLeftoverStore(s => s.setPendingUseUpLeftover);
  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const setLeftoverFrozen = useLeftoverStore(s => s.setFrozen);
  const splitLeftover = useLeftoverStore(s => s.splitLeftover);
  const reopenLeftover = useLeftoverStore(s => s.reopenLeftover);
  const deleteLeftover = useLeftoverStore(s => s.deleteLeftover);

  // Read live from the store by id, same discipline KitchenScreen keeps, so
  // the sheet's caption follows an edit it just made.
  const pendingLeftover = useMemo(
    () => leftovers.find(l => l.id === pendingLeftoverId) ?? null,
    [leftovers, pendingLeftoverId]
  );

  return (
    <LeftoverSheet
      visible={pendingLeftover !== null}
      leftover={pendingLeftover}
      // Never called: this always opens an existing container, never logs
      // a new one. Same as KitchenScreen's own wiring.
      onLog={() => {}}
      onRename={title => pendingLeftover && renameLeftover(pendingLeftover.id, title)}
      onSetStoredAt={storedAt => pendingLeftover && setLeftoverStoredAt(pendingLeftover.id, storedAt)}
      onSetKeepDays={days => pendingLeftover && setLeftoverKeepDays(pendingLeftover.id, days)}
      onFinish={outcome => pendingLeftover && finishLeftover(pendingLeftover.id, outcome)}
      onSetFrozen={frozen => pendingLeftover && setLeftoverFrozen(pendingLeftover.id, frozen)}
      onSplit={() => pendingLeftover && splitLeftover(pendingLeftover.id)}
      onReopen={() => pendingLeftover && reopenLeftover(pendingLeftover.id)}
      onDelete={() => pendingLeftover && deleteLeftover(pendingLeftover.id)}
      onClose={() => setPendingUseUpLeftover(null)}
    />
  );
}
