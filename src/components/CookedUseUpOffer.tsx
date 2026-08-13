import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import {
  classifyPlanned,
  consumedRows,
  plannedIngredientsForRecipe,
} from '../utils/mealPlanGroceries';
import { CookedOfferBanner } from './CookedOfferBanner';
import { CookedUseUpSheet } from './CookedUseUpSheet';

/**
 * The post-cook "out of anything?" offer, banner and sheet together, reading
 * its whole subject from `useMealPlanStore.cookedOffer`.
 *
 * **Self-contained so it can be rendered from more than one screen with one
 * line**, which is the point of it: a meal is marked cooked from the plan and
 * from the "Cook X" task on Today, and the consumption signal shouldn't depend
 * on which. Anything the screens need to know about it, they know from the
 * store offer being set — see MealPlanScreen, which ranks its restock banner
 * behind this one that way.
 *
 * **The rows are recomputed live, never snapshotted at cook time.** Same call
 * the restock banner makes and the same payoff: ticking things off in the sheet
 * takes them out of `consumedRows`, the set empties, and the offer retires
 * itself with no dismissal stamp to keep. Its own answers are what end it.
 */
export function CookedUseUpOffer() {
  const offer = useMealPlanStore(s => s.cookedOffer);
  const clearCookedOffer = useMealPlanStore(s => s.clearCookedOffer);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const items = useGroceryStore(useShallow(s => s.items));

  const [sheetVisible, setSheetVisible] = useState(false);

  const recipesById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);

  const rows = useMemo(() => {
    if (!offer) return [];
    // Resolve-or-shrug, like every other cross-row pointer here: a recipe
    // deleted between cooking it and answering leaves nothing to ask about.
    const recipe = recipesById.get(offer.recipeId);
    if (!recipe) return [];
    return consumedRows(
      classifyPlanned(
        plannedIngredientsForRecipe(recipe, recipesById, { chosen: offer.choices }, offer.scale),
        items,
        new Date()
      )
    );
  }, [offer, recipesById, items]);

  // Answering every line — or the recipe going away — leaves an offer with
  // nothing to say. Clearing it rather than merely rendering null is what hands
  // the moment on: the restock banner waits behind a live offer, so an empty
  // one left set would suppress it for good.
  useEffect(() => {
    if (offer && rows.length === 0) {
      clearCookedOffer();
      setSheetVisible(false);
    }
  }, [offer, rows.length, clearCookedOffer]);

  if (!offer || rows.length === 0) return null;

  // Says what the app knows, not what it wants — "you had these" rather than
  // "did you finish these?". The question is the sheet's, and the button is
  // the same word its sibling uses rather than a second question on a control.
  const lead = `${rows.length} thing${rows.length === 1 ? '' : 's'}`;
  const rest = `you had before cooking ${offer.recipeName}`;

  return (
    <>
      <CookedOfferBanner
        lead={lead}
        rest={rest}
        actionLabel="Review"
        onAction={() => setSheetVisible(true)}
        onDismiss={clearCookedOffer}
        accessibilityLabel={`${lead} you probably had before cooking ${offer.recipeName}`}
        actionAccessibilityLabel={`Say which of ${lead} cooking ${offer.recipeName} used up`}
        dismissAccessibilityLabel="Dismiss used-up notice"
      />
      <CookedUseUpSheet
        visible={sheetVisible}
        recipeName={offer.recipeName}
        rows={rows}
        onClose={() => {
          setSheetVisible(false);
          // Closed either way, ticked or cancelled. It was asked, and asking
          // twice about one cooking is the nagging this stays clear of — what
          // it can't reach by hand is still on every item's own sheet.
          clearCookedOffer();
        }}
      />
    </>
  );
}
