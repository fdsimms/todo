import React, { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { haptics } from '../utils/haptics';
import { LeftoverSheet } from './LeftoverSheet';
import { PantryAnswerSheet, type PantryAnswerRow } from './PantryAnswerSheet';

type UseUpKey = 'usedUp' | 'froze' | 'spoiled';

const USED_UP_ROW: PantryAnswerRow<UseUpKey> = {
  key: 'usedUp',
  icon: 'checkmark-circle-outline',
  tone: 'accent',
  label: 'Used it up',
  detail: 'Takes it out of your pantry.',
  feedback: haptics.success,
};
const FROZE_ROW: PantryAnswerRow<UseUpKey> = {
  key: 'froze',
  icon: 'snow-outline',
  tone: 'accent',
  label: 'Froze it',
  detail: 'Keeps it in your pantry and pauses its use-by date.',
  feedback: haptics.tap,
};
const WENT_BAD_ROW: PantryAnswerRow<UseUpKey> = {
  key: 'spoiled',
  icon: 'close-circle-outline',
  tone: 'red',
  label: 'Went bad',
  detail: 'Takes it out of your pantry and records it as waste.',
  feedback: haptics.tap,
};

/**
 * What completing a "Use up X" task actually resolves.
 *
 * Checking the task off used to be the whole interaction — the reminder went
 * quiet and the pantry/fridge stayed exactly as it was, so the bag of
 * spinach the task was about could still read as on hand a week later.
 * useTaskStore.completeTask now points a session-only flag at the item
 * (pendingUseUpItemId / pendingUseUpLeftoverId, one per store, the same
 * shape useMealPlanStore's cookRecap already uses for the cook task) and
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
 * item had no equivalent to lean on, so this asks directly instead, in the
 * `PantryAnswerSheet` card "Do you still have X?" (`PantryCheckSheet`) is
 * asked in, with the same "Used it up"/"Went bad" wording `ItemDisposalOffer`
 * uses for the same question elsewhere. It was a native `Alert` first, which
 * could only say what each answer does as one run-on paragraph; a card gives
 * each answer its own line. It is not that offer's banner: a dismissible
 * banner can scroll away unanswered, and completing the task is the one
 * moment this question is actually about. `markOutOfMany` records
 * the answer with the outcome already known, so it never raises
 * `disposalOffer` — that banner stays the ✕ tap's own, unrelated to this.
 * "Froze it" is the third answer, and a common one to a use-up reminder:
 * it's `setFrozen`, the same write the item sheet's freezer pill and a
 * drag onto the Pantry's Freezer heading make, so the item stays on hand
 * with its use-by day paused rather than being marked out. Before it, the
 * only way to say so was dismissing the prompt and a trip to the item's own
 * sheet, while a leftover's use-up (LeftoverSheet, below) already had a
 * freezer toggle. Dismissing the card (a tap outside it), or an item that's
 * already out or gone, leaves the pantry untouched, same as closing the old
 * sheet without touching the Pantry field did.
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
  const setFrozen = useGroceryStore(s => s.setFrozen);

  const pendingItem = useMemo(
    () => (pendingItemId ? items.find(i => i.id === pendingItemId) ?? null : null),
    [items, pendingItemId]
  );
  // The item the card is open for. Resolve-or-shrug, same as everywhere else a
  // pointer like this is read: deleted, or already resolved (e.g. from
  // Kitchen), leaves nothing to ask.
  const askable = pendingItem !== null && pendingItem.onHandUntil !== OUT_OF_IT_UNTIL;

  useEffect(() => {
    if (pendingItemId && !askable) setPendingUseUpItem(null);
    // Fires when the pointer or its answerability changes, not on every render
    // the item list happens to update on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItemId, askable]);

  // Offered only while it isn't frozen already: an item in the freezer has
  // nothing left for this answer to change.
  const rows = useMemo(
    () => (pendingItem?.frozenAt ? [USED_UP_ROW, WENT_BAD_ROW] : [USED_UP_ROW, FROZE_ROW, WENT_BAD_ROW]),
    [pendingItem?.frozenAt]
  );

  const answerItem = (key: UseUpKey) => {
    if (!pendingItem) return;
    if (key === 'froze') setFrozen(pendingItem.id, true);
    else markOutOfMany([pendingItem.id], key);
  };

  const pendingLeftoverId = useLeftoverStore(s => s.pendingUseUpLeftoverId);
  const setPendingUseUpLeftover = useLeftoverStore(s => s.setPendingUseUpLeftover);
  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const setLeftoverWeight = useLeftoverStore(s => s.setLeftoverWeight);
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
    <>
    <PantryAnswerSheet
      name="UseUpResolveSheet"
      visible={askable}
      title={pendingItem?.name ?? ''}
      subtitle="What happened to it?"
      rows={rows}
      onAnswer={answerItem}
      onClose={() => setPendingUseUpItem(null)}
    />
    <LeftoverSheet
      visible={pendingLeftover !== null}
      leftover={pendingLeftover}
      // Never called: this always opens an existing container, never logs
      // a new one. Same as KitchenScreen's own wiring.
      onLog={() => {}}
      onRename={title => pendingLeftover && renameLeftover(pendingLeftover.id, title)}
      onSetStoredAt={storedAt => pendingLeftover && setLeftoverStoredAt(pendingLeftover.id, storedAt)}
      onSetKeepDays={days => pendingLeftover && setLeftoverKeepDays(pendingLeftover.id, days)}
      onSetWeight={grams => pendingLeftover && setLeftoverWeight(pendingLeftover.id, grams)}
      onFinish={outcome => pendingLeftover && finishLeftover(pendingLeftover.id, outcome)}
      onSetFrozen={frozen => pendingLeftover && setLeftoverFrozen(pendingLeftover.id, frozen)}
      onSplit={() => pendingLeftover && splitLeftover(pendingLeftover.id)}
      onReopen={() => pendingLeftover && reopenLeftover(pendingLeftover.id)}
      onDelete={() => pendingLeftover && deleteLeftover(pendingLeftover.id)}
      onClose={() => setPendingUseUpLeftover(null)}
      actionsOnly
    />
    </>
  );
}
