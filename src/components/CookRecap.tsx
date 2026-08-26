import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  classifyPlanned,
  consumedRows,
  plannedIngredientsForRecipe,
  restockRows,
} from '../utils/mealPlanGroceries';
import { leftoverKeepDaysFor, leftoverPartsFor } from '../utils/leftovers';
import { standingSwapMap } from '../utils/standingSwaps';
import { CookRecapSheet } from './CookRecapSheet';
import { LeftoverSheet } from './LeftoverSheet';
import { RecipeToListSheet } from './RecipeToListSheet';

/**
 * The post-cook sheet and everything it needs, reading its whole subject from
 * `useMealPlanStore.cookRecap`.
 *
 * **Self-contained so it can be rendered from more than one screen with one
 * line**, which is the point of it: a meal is marked cooked from the plan and
 * from the "Make X" task on Today, and none of what the sheet asks about should
 * depend on which. That's also what let the leftovers question stop being the
 * task list's alone — it used to be a banner raised only by `setCookedPaired`,
 * because the plan already had the row on a meal's own sheet and the task list
 * had nothing.
 *
 * **Every list is recomputed live, never snapshotted at cook time.** The rows,
 * the restock count, the leftover parts and the keep-for window are all read
 * off the recipe as it now stands — same call the banners this replaced made,
 * and the same payoff: ticking things off in the sheet takes them out of
 * `consumedRows`, so the section empties as it's answered rather than sitting
 * there restating what was already said.
 *
 * **It declines to open when there is nothing to ask.** A cooking with no
 * pantry lines to name, nothing to buy, a rating already given and a meal that
 * can't leave leftovers (it *is* leftovers) has no sheet — the recap is cleared
 * instead, which is the "hidden rather than hedged" call the banners made by
 * rendering null at 0.
 */
export function CookRecap() {
  const recap = useMealPlanStore(s => s.cookRecap);
  const clearCookRecap = useMealPlanStore(s => s.clearCookRecap);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const setVote = useRecipeStore(s => s.setVote);
  const items = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const logLeftover = useLeftoverStore(s => s.logLeftover);
  // Ranked behind the one other thing a tick can raise — see `waiting` below.
  const pendingFinishLeftoverId = useLeftoverStore(s => s.pendingFinishLeftoverId);
  const cookRecapEnabled = useSettingsStore(s => s.cookRecapEnabled);
  const restockOfferEnabled = useSettingsStore(s => s.restockOfferEnabled);

  const [leftoverVisible, setLeftoverVisible] = useState(false);
  const [shopVisible, setShopVisible] = useState(false);

  const recipesById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);
  // What the cook actually cooked with — see standingSwaps.ts.
  const swaps = useMemo(() => standingSwapMap(itemSubs, items), [itemSubs, items]);

  // Resolve-or-shrug, like every other cross-row pointer here: a recipe deleted
  // between cooking it and answering leaves a meal that can still have left
  // something in the fridge, and nothing else to say.
  const recipe = recap?.recipeId ? recipesById.get(recap.recipeId) ?? null : null;

  const classified = useMemo(() => {
    if (!recap || !recipe) return [];
    return classifyPlanned(
      plannedIngredientsForRecipe(recipe, recipesById, { chosen: recap.choices }, recap.scale, swaps),
      items,
      new Date()
    );
  }, [recap, recipe, recipesById, items, swaps]);

  const rows = useMemo(() => consumedRows(classified), [classified]);
  const restockCount = useMemo(
    () => (restockOfferEnabled ? restockRows(classified).length : 0),
    [classified, restockOfferEnabled]
  );

  /**
   * Whether to put the rating question, decided once per cooking rather than
   * read live.
   *
   * Live, answering it would take the section away mid-sheet — the control you
   * just used vanishing under your finger, with no way back if you picked the
   * wrong one. Latched to the cooking, the track stays and shows what you chose.
   *
   * A ref rather than state on purpose: state would settle a render *after* the
   * recap arrives, and the "nothing to ask" check below would have already run
   * against `false` — a cooking whose only question is the rating would clear
   * itself before the answer landed.
   */
  const askVoteRef = useRef<{ entryId: string; ask: boolean } | null>(null);
  if (recap && askVoteRef.current?.entryId !== recap.entryId) {
    askVoteRef.current = { entryId: recap.entryId, ask: !!recipe && recipe.vote === null };
  }
  const askVote = !!recap && !!askVoteRef.current?.ask;

  const seed = useMemo(() => {
    if (!recap) return null;
    return {
      title: recap.title,
      recipeId: recap.recipeId,
      sourceEntryId: recap.entryId,
      // Under this cooking's own choices, so a night the roast potatoes won
      // never offers to log leftover mash — the mash was never made.
      parts: leftoverPartsFor(recap.title, recipe ?? undefined, recipesById, { chosen: recap.choices }),
      // What the dish itself says it keeps for, so the usual log is still one
      // tap for a recipe that lasts a week rather than a stepper to correct
      // every time. A free-text meal has no recipe to ask and falls back.
      keepDays: leftoverKeepDaysFor(recipe ?? undefined),
    };
  }, [recap, recipe, recipesById]);

  const askLeftovers = !!recap?.canLogLeftovers;
  const hasSomethingToAsk = askVote || askLeftovers || rows.length > 0 || restockCount > 0;

  /**
   * Held back while the one other thing a tick can raise is up.
   *
   * Ticking a leftover-backed meal off completes its task, and `completeTask`
   * asks whether that was the last of the container (`FinishLeftoverPrompt`, an
   * Alert). Both come off the same tap, and a page sheet sliding up under an
   * alert is the stacking the old banners were ranked to avoid. This waits
   * instead: answering the alert clears the pending id and the sheet arrives.
   */
  const waiting = !!pendingFinishLeftoverId;

  const close = () => {
    setLeftoverVisible(false);
    setShopVisible(false);
    clearCookRecap();
  };

  // A cooking that turns out to have nothing to ask about is cleared rather
  // than merely rendered as nothing: the recap is what says the moment is still
  // open, and one left set with an empty sheet behind it would be a tap that
  // swallowed itself. Same for the setting being off.
  //
  // Not while a sheet this one opened is up, though — answering the pantry
  // through "Add to list" empties the section by design, and closing on that
  // would take the shop down with it, since both sheets are rendered inside
  // this Modal (see CookRecapSheet's `children`).
  useEffect(() => {
    if (recap && !leftoverVisible && !shopVisible && (!cookRecapEnabled || !hasSomethingToAsk)) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recap, cookRecapEnabled, hasSomethingToAsk, leftoverVisible, shopVisible]);

  if (!recap || !cookRecapEnabled || waiting || !hasSomethingToAsk) return null;

  return (
    <CookRecapSheet
      // Keyed to the cooking, so a second one arriving can't inherit the
      // first's ticks — the sheet's own reset runs on `visible` going true, and
      // this one never does.
      key={recap.entryId}
      visible
      title={recap.title}
      vote={
        askVote && recipe
          ? { value: recipe.vote, onChange: next => setVote(recipe.id, next) }
          : undefined
      }
      onLogLeftovers={askLeftovers ? () => setLeftoverVisible(true) : undefined}
      rows={rows}
      restockCount={restockCount}
      onAddToList={restockOfferEnabled && recipe ? () => setShopVisible(true) : undefined}
      onClose={close}
    >
      {seed && (
        <LeftoverSheet
          visible={leftoverVisible}
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
            sourceEntryId: recap.entryId,
          }))}
          // Never called: this only ever logs new containers. The rows it writes
          // are edited from the fridge, where the whole of that half already is.
          onRename={() => {}}
          onSetStoredAt={() => {}}
          onSetKeepDays={() => {}}
          onFinish={() => {}}
          onSetFrozen={() => {}}
          onSplit={() => {}}
          onReopen={() => {}}
          onDelete={() => {}}
          // Back to the recap rather than out of both: the fridge is one of
          // three questions, and logging a container is not an answer to the
          // other two.
          onClose={() => setLeftoverVisible(false)}
        />
      )}

      {/* Ticks stay scoped to what this cooking put into `restockRows` — the
          same `initialSelection` the restock banner opened with, and for the
          same reason: the user named the moment, not the lines. */}
      <RecipeToListSheet
        visible={shopVisible}
        recipe={recipe}
        recipesById={recipesById}
        initialChoices={recap.choices}
        initialScale={recap.scale}
        initialSelection="restock"
        onClose={() => setShopVisible(false)}
      />
    </CookRecapSheet>
  );
}
