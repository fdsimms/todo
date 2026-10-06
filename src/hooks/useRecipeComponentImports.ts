import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Recipe } from '../types';
import { extractRecipe } from '../services/aiSuggestions';
import { useRecipeStore } from '../store/useRecipeStore';
import { normalizeIngredient, recipeInBook } from '../utils/recipeUtils';
import { describeImportError } from '../services/recipePage';
import { pickRecipePhoto, type RecipePhoto, type RecipePhotoSource } from '../utils/recipePhoto';
import {
  componentCommitFor,
  coveringComponentKeys,
  nextComponentPhotos,
  seededComponentKeys,
  type ComponentImportState,
  type ReferenceCandidate,
} from '../utils/recipeImportComponents';
import { alertPhotoAccessDenied } from './useRecipeImportSource';
import { haptics } from '../utils/haptics';

// The state lives beside the candidates it is keyed by, with the rules that
// read it; re-exported so the row component keeps importing it from here.
export type { ComponentImportState } from '../utils/recipeImportComponents';

const IDLE: ComponentImportState = { status: 'idle' };

/**
 * The second photo: page 45, taken while the book is still open on page 12.
 *
 * **This runs inside the sheet that's already open, rather than handing off to
 * a follow-up flow.** Two designs preceded it and both are worse for the same
 * reason. Creating the parent and *then* asking leaves a half-finished import
 * on screen with a recipe already committed behind it, so backing out means
 * cleaning up. Filing the reference away to offer later loses the only thing
 * that makes this worth offering at all: the book is open now, and page 45 is
 * one page turn away. Later, it is a note about a book that has gone back on
 * the shelf.
 *
 * So a reference is read in place, into state, and nothing is written until the
 * sheet's own Create/Add — at which point the parent, the components and the
 * links all land together. Cancelling the sheet leaves no recipe behind, which
 * is the property that lets the offer be as forward as it is.
 *
 * **Photo only for creating a new one, deliberately.** The main import offers
 * paste and link too, because a recipe you're starting from scratch could
 * come from anywhere. A reference has already told us where it is: page 45 of
 * the book in front of you. Offering a paste box and a URL field for that is
 * offering two dead ends and a wider row to fit them in.
 *
 * **Matching is exact-name-only, so a reference can fail to match a recipe
 * that's genuinely already in the box** — the page calls it one thing, the
 * user saved it as another. `linkTo` is the escape hatch: picking a recipe by
 * hand from the box behaves exactly like an automatic match (ticked, and
 * `commitTo` links rather than creates), it's just chosen rather than found.
 *
 * **A second photo after a successful read adds a page rather than replacing
 * one**, the same page-turn case the main import's `photos` array exists for
 * — page 45 can run onto page 46 same as any other. A photo taken after a
 * *failure* instead starts over: the row has nothing usable to combine with,
 * and the simplest recovery is to try again from scratch. `photosRef`/
 * `statesRef` carry that distinction without going through React state, since
 * nothing here needs a render just to remember what the last status was.
 */
export function useRecipeComponentImports(
  candidates: readonly ReferenceCandidate[],
  availableAisles: readonly string[],
) {
  const [states, setStates] = useState<Record<string, ComponentImportState>>({});
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  // Rows the user has explicitly waved off — "not this one" rather than
  // "haven't gotten to it yet". A dismissed row never renders again for this
  // run, so it also never gets ticked back on by a later photo or link.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const statesRef = useRef<Record<string, ComponentImportState>>({});
  const photosRef = useRef<Record<string, RecipePhoto[]>>({});

  // Which candidates exist is decided by the run that produced them, so the
  // ticks are seeded from the run rather than from a tap. A reference the user
  // already has a recipe for starts ticked: linking two recipes adds nothing
  // and un-links in one tap on the recipe screen, so the tick is the answer
  // that's right nearly every time. One that has to be photographed starts
  // unticked, because there is nothing yet to tick *for*.
  const seed = candidates.map(c => `${c.key}:${c.match?.id ?? ''}`).join('|');
  useEffect(() => {
    statesRef.current = {};
    photosRef.current = {};
    setStates({});
    setAccepted(seededComponentKeys(candidates));
    setDismissed(new Set());
    // `seed` stands in for the candidate list: a new array identity every
    // render would otherwise re-seed the ticks out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const setState = useCallback((key: string, state: ComponentImportState) => {
    statesRef.current = { ...statesRef.current, [key]: state };
    setStates(prev => ({ ...prev, [key]: state }));
  }, []);

  const toggle = useCallback((key: string) => {
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * "Not this one" — drop the row entirely rather than leave it unticked.
   * An unticked row still sits in the sheet forever with nothing to do about
   * it; dismissing removes it from the list, same as never having been
   * offered. Also clears anything already accepted for it, so a match ticked
   * on open doesn't sneak back in via `acceptedKeys` once its row is gone.
   */
  const dismiss = useCallback((key: string) => {
    setDismissed(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
    setAccepted(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  /**
   * Take or choose a photo of the referenced page and read it.
   *
   * A successful read ticks the row itself: someone who has just photographed
   * page 45 has answered the question, and making them tick a box to confirm
   * the answer they just gave is a second ask for the same thing. Untick is
   * still right there if the read came back wrong.
   *
   * Whether a photo adds a page to a read result or starts a fresh set is
   * `nextComponentPhotos`' rule; the combined set is re-read as one recipe.
   */
  const importFrom = useCallback(async (key: string, source: RecipePhotoSource) => {
    // What the row showed when the photo was taken is what decides that, so
    // it's read before the row goes to 'picking'.
    const prior = statesRef.current[key];
    setState(key, { status: 'picking' });
    let photo;
    try {
      const picked = await pickRecipePhoto(source);
      if (picked.status === 'canceled') { setState(key, IDLE); return; }
      if (picked.status === 'denied') {
        alertPhotoAccessDenied(source, picked.canAskAgain, 'read the page it points at');
        setState(key, IDLE);
        return;
      }
      if (picked.status === 'failed') {
        setState(key, { status: 'failed', message: picked.message });
        return;
      }
      photo = picked.photo;
    } catch (e) {
      setState(key, { status: 'failed', message: describeImportError(e) });
      return;
    }

    const photos = nextComponentPhotos(prior, photosRef.current[key], photo);
    photosRef.current = { ...photosRef.current, [key]: photos };

    setState(key, { status: 'reading' });
    try {
      // The method comes across, same as it does for a recipe imported on its
      // own — page 45 is a whole recipe, not an ingredient list. References do
      // not: a component that points at a *third* page has nowhere to offer
      // that, and a row that grows its own rows is a flow with no bottom.
      const extracted = await extractRecipe(photos, [...availableAisles], {
        includeReferences: false,
      });
      setState(key, { status: 'read', extracted, photoCount: photos.length });
      haptics.success();
      setAccepted(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
    } catch (e) {
      setState(key, { status: 'failed', message: describeImportError(e) });
    }
  }, [availableAisles, setState]);

  /**
   * The reference isn't a name match for anything in the box, but the user
   * recognizes it as a recipe they already have under a different name —
   * "Hongos Portobello y Soya Asada Tacos" on the page, "Mushroom tacos" in
   * the box. `importableReferences`' own matching is exact-name-only, so this
   * is the escape hatch for every reference it couldn't place on its own.
   *
   * Ticks the row for the same reason a successful read does: picking a
   * recipe answers the question, and asking for a second confirmation would
   * be asking the same thing twice.
   */
  const linkTo = useCallback((key: string, recipe: Recipe) => {
    setState(key, { status: 'linked', recipe });
    haptics.success();
    setAccepted(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [setState]);

  const stateFor = useCallback(
    (key: string): ComponentImportState => states[key] ?? IDLE,
    [states],
  );

  /**
   * The keys whose ingredients the parent no longer has to shop for — a linked
   * recipe, or one that's been read and is about to be created. An unread
   * reference covers nothing, however it's ticked.
   */
  const acceptedKeys = useMemo(
    () => coveringComponentKeys(candidates, accepted, states),
    [candidates, accepted, states],
  );

  /**
   * Writes the accepted references onto a parent recipe that now exists.
   *
   * Called from the sheet's own Create/Add, *after* the parent is saved, so a
   * cancelled import leaves nothing behind and a committed one lands the
   * recipes and the links in one go.
   *
   * Two details worth not re-deriving:
   *
   * - **A read reference that turns out to collide with an existing recipe is
   *   linked, not skipped.** `addRecipe` refuses a duplicate name and the
   *   recipe the user meant is right there under that name; the point of the
   *   row was the link, not which row created it. The photographed ingredients
   *   are dropped in that case rather than merged, on the same no-overwrite
   *   rule `RecipeExtractSheet` follows: a recipe the user already wrote is not
   *   somewhere to pour a fresh extraction into unasked.
   * - **A created component gets everything a standalone import would**: its
   *   ingredients, servings, time, method and prep tasks. The only thing it
   *   doesn't get is references of its own — see `importFrom`.
   * - **The page number is the source's own statement, so it is kept.** A
   *   recipe read off "page 45" gets `sourceType: 'cookbook'` and
   *   `sourcePage: '45'`, the same provenance-not-a-guess argument a link
   *   import makes for writing the site name. `setSourceType` has to go first,
   *   since it clears the page for any type that isn't a cookbook.
   * - **And it lands in the parent's own book.** "Page 45" is a page of the
   *   book the parent came out of, so a component inherits the parent's
   *   `cookbookId` rather than being filed as a page of nothing. That used to
   *   be unsayable — a component got a page number and a type but no title,
   *   because nothing read a book's name off a photo — so the shelf now gets
   *   the whole citation instead of two thirds of one.
   */
  const commitTo = useCallback((parentRecipeId: string) => {
    const store = useRecipeStore.getState();
    for (const candidate of candidates) {
      const commit = componentCommitFor(candidate, accepted, states[candidate.key]);
      if (commit.kind === 'skip') continue;
      if (commit.kind === 'link') {
        store.addComponent(parentRecipeId, commit.recipeId);
        continue;
      }
      const { name, extracted } = commit;

      // The book first, since the name is only refused within it. The parent's
      // own book first: the reference said "page 45", which is page 45 *of
      // this book*, and the parent has usually been linked to it already by
      // the import that read it. The component's own photo is the fallback
      // for the case where it hasn't — a running head the parent's page
      // didn't show.
      const parent = useRecipeStore.getState().recipeById(parentRecipeId);
      const book = store.cookbookById(parent?.cookbookId)
        ?? (extracted.sourceTitle ? store.ensureCookbook(extracted.sourceTitle, extracted.sourceAuthor) : null);
      const created = store.addRecipe(name, book?.id ?? null);
      const target = created
        ?? recipeInBook(useRecipeStore.getState().recipes, name, book?.id ?? null);
      if (!target) continue;

      if (created) {
        const ingredients = extracted.ingredients
          .map(item => normalizeIngredient(item))
          .filter((i): i is NonNullable<typeof i> => i !== null);
        if (ingredients.length > 0) store.addStructuredIngredients(target.id, ingredients);
        if (extracted.servings !== null) {
          store.setServings(target.id, extracted.servings, extracted.servingsMax);
        }
        if (extracted.prepMinutes !== null) {
          store.setEstimatedMinutes(target.id, extracted.prepMinutes);
        }
        // addRecipe linked the book when there was one; a page number with no
        // book still says it came out of one.
        if (!book && candidate.page) store.setSourceType(target.id, 'cookbook');
        // After whichever of those ran — each sets the type, which clears the
        // page for anything that isn't a cookbook.
        if (candidate.page) store.setSourcePage(target.id, candidate.page);
        // Same two writes `RecipeCreateSheet` makes for a recipe imported on
        // its own — a component read off a photo is a recipe like any other,
        // and one that arrived with no method would be the odd one out.
        extracted.steps.forEach(step => store.addStep(target.id, step));
        extracted.prepTasks.forEach(task => {
          const added = store.addPrepTask(target.id, task.title);
          if (added && task.offsetDays !== added.offsetDays) {
            store.updatePrepTask(target.id, added.id, { offsetDays: task.offsetDays });
          }
        });
      }
      store.addComponent(parentRecipeId, target.id);
    }
  }, [candidates, accepted, states]);

  const reset = useCallback(() => {
    statesRef.current = {};
    photosRef.current = {};
    setStates({});
    setAccepted(new Set());
    setDismissed(new Set());
  }, []);

  return { stateFor, accepted, acceptedKeys, dismissed, toggle, dismiss, importFrom, linkTo, commitTo, reset };
}
