/**
 * What the dismiss button says on each Backfill step, one line per field.
 *
 * Every pool's dismiss writes the same thing (the field id into the row's
 * `backfillDismissedFields`, so the row never queues for it again), but the
 * answer a person is giving differs by field: "this recipe has no cook time",
 * "keep it visible on vacation". A shared "Don't ask again" named the
 * mechanism and left the meaning to be guessed. The label states the state
 * the row is left in instead, and avoids "off" and "unset", which read as
 * ambiguous next to fields like "Skip in suggestions".
 *
 * The same text is reused for the batch checkbox ("{label} for all 12 tasks"),
 * the hint under it, the session review line and the undo bar, so a field
 * can't be worded one way on the card and another in the log. The buttons
 * share a row with "Skip for now" that doesn't wrap, which is what
 * `MAX_DISMISS_LABEL_LENGTH` guards.
 */
import type { BackfillFieldId } from './fieldBackfill';
import type { CategoryBackfillFieldId } from './categoryBackfill';
import type { ProjectBackfillFieldId } from './projectBackfill';
import type { PersonBackfillFieldId } from './peopleBackfill';
import type { ItemBackfillFieldId } from './itemBackfill';
import type { RecipeBackfillFieldId } from './recipeBackfill';

export const MAX_DISMISS_LABEL_LENGTH = 26;

/**
 * Shown on a task that already has a value for the field (a from-scratch
 * run of it): the dismissal leaves that value exactly as it is, so a label
 * describing a blank field would misdescribe what the button does.
 */
export const KEEP_AS_IS_LABEL = 'Keep as is';

export const TASK_DISMISS_LABELS: Record<BackfillFieldId, string> = {
  estimate: 'No time estimate',
  priority: 'No priority',
  difficulty: 'No difficulty',
  category: 'Leave uncategorized',
  streak: "Don’t show streak chip",
  vacation: 'Keep visible on vacation',
  holidays: 'Leave as usual',
  reminder: 'No reminder',
  suggestions: 'Keep in suggestions',
};

export const CATEGORY_DISMISS_LABELS: Record<CategoryBackfillFieldId, string> = {
  vacation: 'Keep visible on vacation',
  suggestions: 'Keep in suggestions',
  newBanner: 'Keep in new tasks banner',
};

export const PROJECT_DISMISS_LABELS: Record<ProjectBackfillFieldId, string> = {
  nudge: "Don’t bring this up",
  weekendSource: 'Never suggest for weekends',
};

export const PERSON_DISMISS_LABELS: Record<PersonBackfillFieldId, string> = {
  birthday: 'No birthday to add',
  cadence: 'No catch-up reminder',
  askAbout: 'Nothing to ask',
  location: 'No location',
};

export const ITEM_DISMISS_LABELS: Record<ItemBackfillFieldId, string> = {
  scannedName: 'Keep this name',
  substitutes: 'No substitutes',
  variety: 'Mark as generic item',
  nutrition: 'No nutrition info',
  nutritionDetail: 'Nothing more to add',
};

export const RECIPE_DISMISS_LABELS: Record<RecipeBackfillFieldId, string> = {
  servings: 'No serving count',
  cookTime: 'No cook time',
  prepTime: 'No prep time',
  cookedWeight: "Don’t track weight",
};
