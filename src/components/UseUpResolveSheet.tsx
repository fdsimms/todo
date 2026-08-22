import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { GroceryItemSheet } from './GroceryItemSheet';
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
 * this is what watches it: the moment it's set, the item's own sheet opens —
 * GroceryItemSheet's Pantry pills for a grocery item, LeftoverSheet's
 * Finished it/Threw it out for a leftover — so completing the reminder and
 * correcting the kitchen happen in one motion.
 *
 * **Mounted once, in AppNavigator beside DemoBanner/UndoBar,
 * not on any one screen** — but, unlike those two, inside NavigationContainer
 * (just outside the RootStack). Completion can land here from Today, Search,
 * Waiting, the widget, or a bulk-complete, and the flag has to open the sheet
 * wherever the tap happened to come from. GroceryItemSheet's
 * useKeyboardInsetScroll calls useIsFocused, which throws outside any
 * navigation context at all; inside NavigationContainer it resolves to the
 * container's own always-focused root ref instead.
 *
 * **Opens immediately rather than behind a banner**, unlike CookedUseUpOffer.
 * Cooking a meal can implicate several ingredients at once, worth a beat to
 * review before committing to; a use-up task is about exactly one item, and
 * the point of the task was to prompt this decision, so there's nothing to
 * review first.
 *
 * Both sheets share the same wiring KitchenScreen uses for the same rows — see
 * that component's doc comment for why a container carries no ✕ and a
 * catalog row opens on the Pantry field.
 */
export function UseUpResolveSheet() {
  const pendingItemId = useGroceryStore(s => s.pendingUseUpItemId);
  const setPendingUseUpItem = useGroceryStore(s => s.setPendingUseUpItem);

  const pendingLeftoverId = useLeftoverStore(s => s.pendingUseUpLeftoverId);
  const setPendingUseUpLeftover = useLeftoverStore(s => s.setPendingUseUpLeftover);
  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const setLeftoverFrozen = useLeftoverStore(s => s.setFrozen);
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
      <GroceryItemSheet
        visible={pendingItemId !== null}
        itemId={pendingItemId}
        onClose={() => setPendingUseUpItem(null)}
        initialField="pantry"
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
        onFinish={outcome => pendingLeftover && finishLeftover(pendingLeftover.id, outcome)}
        onSetFrozen={frozen => pendingLeftover && setLeftoverFrozen(pendingLeftover.id, frozen)}
        onReopen={() => pendingLeftover && reopenLeftover(pendingLeftover.id)}
        onDelete={() => pendingLeftover && deleteLeftover(pendingLeftover.id)}
        onClose={() => setPendingUseUpLeftover(null)}
      />
    </>
  );
}
