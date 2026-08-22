/**
 * Filtering and keyboard rules for the category picker (see
 * `src/components/CategoryPicker.tsx`).
 *
 * Three places pick a category — quick add, the task editor, the bulk-action
 * bar — and until this existed each had written its own filter, its own
 * "did they mean an existing one?" check and its own Enter behaviour. They had
 * already drifted (only two of the three matched against the emoji prefix, and
 * only one refused to create a duplicate), which is the same drift `PillGroup`
 * and `SheetHeaderButton` were made to undo.
 *
 * Pure and separate from the component because it is the whole behaviour, and
 * there are no component tests in this repo to catch it otherwise.
 */

export interface CategoryOption {
  name: string;
  /** Shown in place of the folder glyph, and matched by the filter. */
  emoji: string | null;
}

export interface CategoryFilterResult {
  /** Categories to list, in the order they were given. */
  matches: CategoryOption[];
  /** A category whose name *is* the query — so creating would be a duplicate. */
  exact: CategoryOption | null;
  /** A non-empty query that named no existing category. */
  noMatches: boolean;
}

const normalize = (s: string) => s.trim().toLowerCase();

/** The text a row shows and the filter searches: "🍕 Leftovers", or just the name. */
export function optionLabel(option: CategoryOption): string {
  return option.emoji ? `${option.emoji} ${option.name}` : option.name;
}

/**
 * Order is never re-ranked, for the same reason `resolvePillOverflow` doesn't:
 * categories are hand-arranged (`reorderCategories` / `CategoryOrderSheet`),
 * and a list that re-sorts itself is one you can't learn the shape of. The
 * filter narrows the set; it never moves what's left.
 */
export function filterCategories(options: CategoryOption[], query: string): CategoryFilterResult {
  const q = normalize(query);
  if (!q) return { matches: options, exact: null, noMatches: false };

  // Matched against the emoji-prefixed label as well as the bare name, so the
  // text on the row is always the text being searched.
  const matches = options.filter(
    o => normalize(o.name).includes(q) || normalize(optionLabel(o)).includes(q),
  );
  return {
    matches,
    exact: matches.find(o => normalize(o.name) === q) ?? null,
    noMatches: matches.length === 0,
  };
}

export type CategorySubmit =
  | { action: 'pick'; name: string }
  | { action: 'create'; name: string }
  | { action: 'none' };

/**
 * What the keyboard's done key does to the find-or-add field.
 *
 * Picking beats creating, so Enter can never mint a second "Work". The case
 * worth keeping honest is the middle one: with several categories still
 * matching, Enter does **nothing**. A filter is typed a letter at a time, so
 * "wo" on the way to "Work" is a state the field is in constantly, and
 * creating from it leaves a junk category behind — one that then shows up as
 * its own section on the Categories screen. Ambiguity is what the
 * `Create "…"` row is for; creating is a tap on the control that says create.
 */
export function resolveCategorySubmit(
  result: CategoryFilterResult,
  { text, canCreate }: { text: string; canCreate: boolean },
): CategorySubmit {
  const trimmed = text.trim();
  if (!trimmed) return { action: 'none' };
  if (result.exact) return { action: 'pick', name: result.exact.name };
  if (result.matches.length === 1) return { action: 'pick', name: result.matches[0].name };
  if (result.matches.length > 1) return { action: 'none' };
  return canCreate ? { action: 'create', name: trimmed } : { action: 'none' };
}
