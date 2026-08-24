import type { Category } from '../types';

/**
 * A category-level field the Backfill screen can walk and fill in, one
 * category at a time — the same mechanism as `fieldBackfill.ts`'s
 * `BackfillFieldId`, over `Category` instead of `Task`. Kept as a separate
 * module rather than folded into `fieldBackfill.ts` because every candidate
 * here is a toggle read straight off the category (no "missing value" case
 * to size or pick, and no subtask/completed/archived filtering — a category
 * has none of those), so the shape of "missing" and "apply" differs enough
 * that sharing the type would just mean branching on entity kind everywhere.
 */
export type CategoryBackfillFieldId = 'vacation' | 'suggestions' | 'newBanner';

export interface CategoryBackfillFieldDef {
  id: CategoryBackfillFieldId;
  /** The row's own label in CategoryEditor — reused here so the field reads
   * as the same setting wherever it's found. */
  label: string;
  /** One line explaining what the field does, shown under its row on the
   * field-picker step. */
  hint: string;
}

// Order matters: the order these render in on the field-picker step. Same
// order CategoryEditor's own Visibility group uses.
export const CATEGORY_BACKFILL_FIELDS: CategoryBackfillFieldDef[] = [
  {
    id: 'vacation',
    label: 'Hide on vacation',
    hint: 'Tucks tasks in this category away while vacation mode is on.',
  },
  {
    id: 'suggestions',
    label: 'Skip in suggestions',
    hint: 'Keeps tasks in this category out of suggested pins and focus sessions.',
  },
  {
    id: 'newBanner',
    label: 'Skip in new todos banner',
    hint: 'Keeps tasks in this category off the new todos banner and the new dot on their row.',
  },
];

/** Whether `category` still has `fieldId` at its default (off) — the backfill queue's inclusion test. */
export function isCategoryFieldMissing(category: Category, fieldId: CategoryBackfillFieldId): boolean {
  switch (fieldId) {
    case 'vacation':
      return !category.hideOnVacation;
    case 'suggestions':
      return !category.excludeFromSuggestions;
    case 'newBanner':
      return !category.excludeFromNewTasksBanner;
  }
}

/**
 * Whether the user has told the backfill screen not to ask about `fieldId`
 * on this category again — "this one genuinely doesn't need to hide on
 * vacation", not "not right now" (that's the screen's own session-only
 * `skippedIds`, which never touches the category itself). See
 * `Category.backfillDismissedFields`.
 */
export function isCategoryBackfillDismissed(category: Category, fieldId: CategoryBackfillFieldId): boolean {
  return category.backfillDismissedFields.includes(fieldId);
}

// Every category is a candidate — unlike tasks there's no subtask/completed/
// archived state to exclude, and no recurrence gate: all three fields are
// meaningful for any category regardless of what's filed under it.
export function categoryBackfillCandidates(categories: Category[], fieldId: CategoryBackfillFieldId): Category[] {
  return categories
    .filter(c => isCategoryFieldMissing(c, fieldId) && !isCategoryBackfillDismissed(c, fieldId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many categories are still at the default for each field, for the field-picker step's counts. */
export function categoryBackfillFieldCounts(categories: Category[]): Record<CategoryBackfillFieldId, number> {
  const counts = { vacation: 0, suggestions: 0, newBanner: 0 } as Record<CategoryBackfillFieldId, number>;
  for (const c of categories) {
    for (const field of CATEGORY_BACKFILL_FIELDS) {
      if (isCategoryFieldMissing(c, field.id) && !isCategoryBackfillDismissed(c, field.id)) counts[field.id]++;
    }
  }
  return counts;
}

/**
 * The patch that records "leave this field off" for `category` — appended to
 * whatever else is already dismissed, deduped, so dismissing twice is a
 * no-op rather than growing the array. Same shape as the task-side
 * `dismissBackfillField`.
 */
export function dismissCategoryBackfillField(
  category: Category, fieldId: CategoryBackfillFieldId
): Pick<Category, 'backfillDismissedFields'> {
  return {
    backfillDismissedFields: category.backfillDismissedFields.includes(fieldId)
      ? category.backfillDismissedFields
      : [...category.backfillDismissedFields, fieldId],
  };
}
