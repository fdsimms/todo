import { RECIPE_SECTION_MAX_LENGTH } from '../types';

/**
 * Sections, as a thing you drag into rather than a string you retype.
 *
 * `RecipeIngredient.section` is a label on a flat list, not a nested groups
 * type (see the field's own note) — a *populated* heading is still only ever
 * inferred, drawn wherever a row's section differs from the row before it
 * (`RecipeDetailScreen`'s own render-time pass). But a heading with nothing
 * under it yet has no row to infer from, which is exactly the gap
 * `Recipe.emptySections` exists to cover (see the field's own note) — a small,
 * explicitly-declared list of headings that aren't derived from anything.
 *
 * Dragging has to reconcile both. `RecipeDetailScreen` builds one *merged*
 * list for its `SortableList` — every ingredient row plus one marker per
 * heading, populated or empty, at the position it renders — so that a
 * heading is something a row can be dropped next to whether or not it has
 * members yet. Once a heading is an explicit marker at a real position,
 * "which section does this row belong to" stops being an inference problem:
 * it's whatever marker precedes it, full stop. `sectionsFromMergedOrder`
 * is that one-pass walk, and it's what the reorder handler recomputes for
 * every row on every commit — not just the one that moved, which is what
 * `resolveSectionDrop` (gone now) had to do, and why it needed a heuristic
 * for "which neighbour wins" at a boundary. There is no such ambiguity left
 * once the boundary itself is a row in the list rather than a guess about
 * two labels meeting.
 */

/** Tolerates a null column, a corrupt blob, or a shape from a newer app version. */
export function parseEmptySections(raw: unknown): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const cleaned = entry.trim().slice(0, RECIPE_SECTION_MAX_LENGTH);
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

/** Anything the drop rule can act on: identity plus the label it carries. */
export interface SectionedRow {
  id: string;
  section: string | null;
}

/** One entry of a merged ingredient+heading order — see `sectionsFromMergedOrder`. */
export type SectionListEntry =
  | { kind: 'heading'; name: string }
  | { kind: 'row'; id: string };

/**
 * Walks a merged ingredient+heading order — `RecipeDetailScreen`'s
 * `SortableList` data, after a drag commits — and assigns every row the name
 * of the nearest heading marker before it, null if none. A heading marker
 * updates "current section" for everything after it up to the next marker or
 * the end of the list; it doesn't matter whether that marker started the
 * commit already carrying rows (a populated heading) or empty
 * (`Recipe.emptySections`) — a row dropped right after it joins it either way.
 *
 * The whole function is this simple *because* the marker is explicit. There's
 * nothing left to disagree about the way `resolveSectionDrop` (removed) had
 * to when a boundary was only ever two adjacent rows' labels.
 */
export function sectionsFromMergedOrder(
  entries: readonly SectionListEntry[],
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  let current: string | null = null;
  for (const entry of entries) {
    if (entry.kind === 'heading') { current = entry.name; continue; }
    result.set(entry.id, current);
  }
  return result;
}

/** Every section label a list uses, in list order and without repeats. */
export function sectionsOf(rows: readonly SectionedRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    if (row.section && !seen.includes(row.section)) seen.push(row.section);
  }
  return seen;
}

/**
 * Every heading a recipe has to offer — the sections its rows already use, in
 * list order, followed by any declared-but-empty headings (`Recipe.emptySections`)
 * that no row has adopted yet. Pickers (the Section field, the sticky heading
 * input) read this instead of `sectionsOf` alone so a heading created ahead of
 * its ingredients is choosable before anything's filed under it.
 */
export function allSectionsOf(
  rows: readonly SectionedRow[],
  emptySections: readonly string[],
): string[] {
  const used = sectionsOf(rows);
  const usedSet = new Set(used);
  return [...used, ...emptySections.filter(s => !usedSet.has(s))];
}

/** One flattened ingredient line, as the heading walk below reads it. */
export interface FlatSectionRow {
  /** The recipe the line is written on — see `FlatIngredient.recipe`. */
  recipe: { id: string };
  /** 0 for the root's own lines, 1 for a direct component's, and so on. */
  depth: number;
  ingredient: { section: string | null };
}

/** Which headings open on one line of a flattened list — see `ingredientHeadings`. */
export interface IngredientHeading {
  /**
   * True where the line's own recipe changes and isn't the root: a component's
   * lines start here. The caller draws the name, because the three surfaces
   * word it differently ("For the mash:" in a share, the bare name in a panel).
   */
  dish: boolean;
  /** The section heading opening on this line, null where it carries on the one above or has none. */
  section: string | null;
}

/**
 * The headings a *flattened* ingredient list opens, line by line — a component's
 * name where one starts, and the `section` label where one does.
 *
 * `RecipeDetailScreen` infers a populated heading for the recipe's own lines
 * (see the module note above); every surface that flattens components in was
 * inferring the component heading the same way and dropping sections on the
 * floor, so a cook-mode panel read "garlic, ginger, soy sauce…" as one run
 * where the recipe itself says Sauce and then For serving. This is that same
 * one-pass inference, for the list that has both kinds of boundary in it.
 *
 * **A recipe boundary resets the section walk.** Two recipes' section labels
 * are separate vocabularies that happen to collide — a component opening with
 * "Sauce" under a root whose last line was also "Sauce" is a new heading, not
 * a continuation of somebody else's.
 */
export function ingredientHeadings(
  rows: readonly FlatSectionRow[],
): IngredientHeading[] {
  const out: IngredientHeading[] = [];
  let prevRecipeId: string | null = null;
  let prevSection: string | null = null;
  for (const row of rows) {
    if (row.recipe.id !== prevRecipeId) prevSection = null;
    const label = row.ingredient.section;
    out.push({
      dish: row.depth > 0 && row.recipe.id !== prevRecipeId,
      section: label && label !== prevSection ? label : null,
    });
    prevRecipeId = row.recipe.id;
    prevSection = label;
  }
  return out;
}
