import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { leftoverKeepDaysFor, leftoverPartsFor } from '../utils/leftovers';
import { OfferBanner } from './OfferBanner';
import { LeftoverSheet } from './LeftoverSheet';

/**
 * The post-cook "anything left over?" offer, banner and log sheet together,
 * reading its whole subject from `useMealPlanStore.leftoverOffer`.
 *
 * **This is what ticking a cook task off Today gets you.** The meal plan has
 * put "Log leftovers" on a meal's own sheet since the fridge existed; the task
 * list had nothing, so a cook task finished the cooking and the two tubs on the
 * counter had to be recorded by going to find the meal on the plan. Completing
 * the task is the moment the answer is known, so it's the moment to ask.
 *
 * **A banner, not a sheet that opens itself** — the same call the ingredients
 * question makes right beside it (see `OfferBanner`), and the reason the
 * meal plan made logging an action on the entry rather than something
 * mark-cooked did by itself: plenty of meals leave nothing, and a modal after
 * every cooking is one more thing to dismiss on the nights they don't.
 *
 * **It ranks itself behind `cookedOffer` rather than leaving that to the
 * screen**, so a caller still renders it in one line. Two of these stacked is
 * the noise the passive treatment exists to avoid, and the consumption
 * question goes first because it retires itself the moment it's answered — a
 * cooking that raises both shows this one as soon as that one is done with.
 *
 * The parts and the keep-for window are recomputed here rather than snapshotted
 * at cook time, the same call `CookedUseUpOffer` makes about its rows: the
 * recipe is read as it now stands.
 */
export function LogLeftoversOffer() {
  const offer = useMealPlanStore(s => s.leftoverOffer);
  const cookedOffer = useMealPlanStore(s => s.cookedOffer);
  const clearLeftoverOffer = useMealPlanStore(s => s.clearLeftoverOffer);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const logLeftover = useLeftoverStore(s => s.logLeftover);

  const [sheetVisible, setSheetVisible] = useState(false);

  const seed = useMemo(() => {
    if (!offer) return null;
    const recipesById = new Map(recipes.map(r => [r.id, r]));
    // Resolve-or-shrug, like every other cross-row pointer here: a recipe
    // deleted between cooking it and logging what it left still leaves a
    // container with a name, which is all the sheet needs.
    const recipe = offer.recipeId ? recipesById.get(offer.recipeId) : undefined;
    return {
      title: offer.title,
      recipeId: offer.recipeId,
      sourceEntryId: offer.entryId,
      // Under this cooking's own choices, so a night the roast potatoes won
      // never offers to log leftover mash — the mash was never made.
      parts: leftoverPartsFor(offer.title, recipe, recipesById, { chosen: offer.choices }),
      keepDays: leftoverKeepDaysFor(recipe),
    };
  }, [offer, recipes]);

  if (!offer || !seed || cookedOffer) return null;

  return (
    <>
      <OfferBanner
        lead="Anything left over"
        rest={`from ${offer.title}?`}
        actionLabel="Log"
        onAction={() => setSheetVisible(true)}
        onDismiss={clearLeftoverOffer}
        accessibilityLabel={`Anything left over from ${offer.title}?`}
        actionAccessibilityLabel={`Log leftovers from ${offer.title}`}
        dismissAccessibilityLabel="Dismiss leftovers offer"
      />
      <LeftoverSheet
        visible={sheetVisible}
        leftover={null}
        seed={seed}
        onLog={(picks, storedAt, keepDays) => picks.forEach(pick => logLeftover({
          title: pick.title,
          storedAt,
          keepDays,
          frozen: pick.frozen,
          recipeId: pick.recipeId,
          // The one thing the sheet can't have changed: every container here
          // came out of that cooking, whichever part of it it is.
          sourceEntryId: offer.entryId,
        }))}
        // Never called: this only ever logs new containers. The rows it writes
        // are edited from the fridge, where the whole of that half already is.
        onRename={() => {}}
        onSetStoredAt={() => {}}
        onSetKeepDays={() => {}}
        onFinish={() => {}}
        onSetFrozen={() => {}}
        onReopen={() => {}}
        onDelete={() => {}}
        onClose={() => {
          setSheetVisible(false);
          // Closed either way, logged or cancelled. It was asked, and asking
          // twice about one cooking is the nagging this stays clear of — the
          // fridge is one tap away in the drawer either way.
          clearLeftoverOffer();
        }}
      />
    </>
  );
}
