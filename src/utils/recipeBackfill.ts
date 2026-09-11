import type { Recipe } from '../types';

/**
 * A recipe field the Backfill screen can walk and fill in, one recipe at a
 * time — the same mechanism as `fieldBackfill.ts`/`itemBackfill.ts`, over
 * `Recipe`. Its own module for the same reason those are: the pool is a
 * different store with a different notion of "missing", and none of these
 * three is a toggle. Each is a count somebody has to supply, so the card is a
 * stepper rather than a button, closer to the task side's `estimate` than to
 * `streak`.
 *
 * **`cookedWeight` is the odd one of the four**, and worth knowing before
 * adding a fifth: it is the only one that cannot be answered from the couch.
 * A serving count and a cook time are things you know about a recipe; what the
 * finished dish weighs is something you find out with the pan on a scale (see
 * `Recipe.cookedWeightG`, and the cook recap that asks for it at that moment).
 * It is in the pool anyway because a queue is the only way to fill in the
 * dishes you cook often and have already weighed once in your head, and
 * because "Don't ask again" is one tap for the ones you never will.
 *
 * **`servings` is load-bearing rather than decorative**, which is what makes
 * this pool worth walking at all. Without it `recipeHelpingNutrition` has no
 * per-serving figures to return, and `FoodLogEntrySheet` won't offer the
 * recipe as something to log — so a dish you cook every week is one you cannot
 * record eating. The other two are ordinary gaps: `totalMinutes` reads prep
 * plus cook whenever either is set, and a recipe with neither can't say how
 * long it takes.
 *
 * Deliberately just these four. A recipe carries plenty of other nullable
 * fields — `sourceUrl`, `author`, `cookbookId`, `mealType`, `imagePath`,
 * `recipeYield` — and every one of them is a fact about where the recipe came
 * from or how you'd like it filed, not a number the app is waiting on. Asking
 * for a photo of every dish in a queue is the version of this that nobody
 * finishes.
 *
 * **`servingsMax` is not one either, on the sibling rule `projectBackfill.ts`
 * applies to `autoSchedule`**: it is meaningless until `servings` is already
 * set, and a recipe that isn't a range is the ordinary case rather than one
 * missing an answer.
 */
export type RecipeBackfillFieldId = 'servings' | 'cookTime' | 'prepTime' | 'cookedWeight';

export interface RecipeBackfillFieldDef {
  id: RecipeBackfillFieldId;
  /** The row's own label in the recipe editor — reused here so the field
   * reads as the same setting wherever it's found. */
  label: string;
  /** One line explaining what the field does, shown under its row on the
   * field-picker step. */
  hint: string;
}

// Order matters: the order these render in on the field-picker step. Servings
// leads because it is the one that unblocks anything.
export const RECIPE_BACKFILL_FIELDS: RecipeBackfillFieldDef[] = [
  {
    id: 'servings',
    label: 'Servings',
    hint: 'How many the recipe makes, so a helping of it can be logged and its nutrition read per serving.',
  },
  {
    id: 'cookTime',
    label: 'Cook time',
    hint: 'How long the cooking itself takes, once anything that needed chopping is chopped.',
  },
  {
    id: 'prepTime',
    label: 'Prep time',
    hint: 'How long the chopping and measuring take before the cooking starts.',
  },
  // Last, because it is the one you answer at the scale rather than from
  // memory. Its hint says what the number buys, since nothing else in the app
  // asks for a weight in grams.
  {
    id: 'cookedWeight',
    label: 'Cooked weight',
    hint: 'What the whole finished dish weighs, so a plate of it can be logged by weight instead of by servings.',
  },
];

/** Whether `recipe` still needs a value for `fieldId` — the backfill queue's inclusion test. */
export function isRecipeFieldMissing(recipe: Recipe, fieldId: RecipeBackfillFieldId): boolean {
  switch (fieldId) {
    case 'servings':
      return recipe.servings == null;
    // `estimatedMinutes` is cook time alone on a recipe, unlike a task's field
    // of the same name — see Recipe.estimatedMinutes, and note that a measured
    // cook fills it in on its own the first time (`applyMeasuredCookTime`), so
    // a recipe somebody has actually timed leaves this queue without being
    // asked.
    case 'cookTime':
      return recipe.estimatedMinutes == null;
    case 'prepTime':
      return recipe.prepMinutes == null;
    case 'cookedWeight':
      return recipe.cookedWeightG == null;
  }
}

/**
 * Whether the user has told the backfill screen not to ask about `fieldId`
 * on this recipe again — "this one genuinely has no serving count", not "not
 * right now" (that's the screen's own session-only `skippedIds`, which never
 * touches the recipe itself). See `Recipe.backfillDismissedFields`.
 */
export function isRecipeBackfillDismissed(recipe: Recipe, fieldId: RecipeBackfillFieldId): boolean {
  return recipe.backfillDismissedFields.includes(fieldId);
}

// Every recipe is a candidate. There is no archived or completed state to
// exclude the way there is for a project — a recipe you haven't cooked in a
// year is still a recipe, and the cookbook it's filed in says nothing about
// whether its serving count is known.
export function recipeBackfillCandidates(recipes: Recipe[], fieldId: RecipeBackfillFieldId): Recipe[] {
  return recipes
    .filter(r => isRecipeFieldMissing(r, fieldId) && !isRecipeBackfillDismissed(r, fieldId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many recipes are still missing each field, for the field-picker step's counts. */
export function recipeBackfillFieldCounts(recipes: Recipe[]): Record<RecipeBackfillFieldId, number> {
  const counts = {
    servings: 0, cookTime: 0, prepTime: 0, cookedWeight: 0,
  } as Record<RecipeBackfillFieldId, number>;
  for (const r of recipes) {
    for (const field of RECIPE_BACKFILL_FIELDS) {
      if (isRecipeFieldMissing(r, field.id) && !isRecipeBackfillDismissed(r, field.id)) counts[field.id]++;
    }
  }
  return counts;
}

/**
 * The patch that records "leave this field unset" for `recipe` — appended to
 * whatever else is already dismissed, deduped, so dismissing twice is a
 * no-op rather than growing the array. Same shape as the task/category/
 * project/person/item-side `dismiss*BackfillField`s.
 */
export function dismissRecipeBackfillField(
  recipe: Recipe, fieldId: RecipeBackfillFieldId
): Pick<Recipe, 'backfillDismissedFields'> {
  return {
    backfillDismissedFields: recipe.backfillDismissedFields.includes(fieldId)
      ? recipe.backfillDismissedFields
      : [...recipe.backfillDismissedFields, fieldId],
  };
}
