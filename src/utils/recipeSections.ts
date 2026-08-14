import { RECIPE_SECTION_MAX_LENGTH } from '../types';

/**
 * Sections, as a thing you drag into rather than a string you retype.
 *
 * `RecipeIngredient.section` is a label on a flat list, not a nested groups
 * type (see the field's own note), and `RecipeDetailScreen` draws a heading
 * wherever a row's section differs from the row before it. That means the list
 * order *already* decides which section a row is in — everywhere except when
 * you move a row, where the section stayed put and the heading appeared to
 * teleport past it. Filing a row therefore meant opening it and typing the
 * heading again, spelled exactly.
 *
 * So the rule here is `resolveDrop`'s, the one Today's category drag already
 * uses — **a dropped row joins the run it landed in** — with one refinement
 * that plain "take the row above's" needs (see `resolveSectionDrop`). Nothing
 * but the dragged row moves, and a recipe with no sections at all is untouched
 * by any of it, since every row's section is null and adopting null changes
 * nothing.
 *
 * `Recipe.emptySections` is the one heading state that isn't a row property —
 * see the field's own note for why declaring a heading ahead of any ingredient
 * needs a second, small list rather than reusing this one.
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

export interface SectionDrop {
  /** The row that moved. */
  id: string;
  /** The section it lands in — the row above's, or null at the top of the list. */
  section: string | null;
}

/**
 * Which row moved in a reorder, and which section it should now carry. Null
 * when nothing needs re-filing: the order is unchanged, the reorder isn't a
 * single drag, or the row already sits in the section it landed in.
 *
 * **The row keeps its own section whenever it's still touching it.** That's the
 * half a plain "take the row above's" rule gets wrong, and it gets it wrong on
 * the commonest drag there is: reordering two rows *within* a section. Moving
 * the frosting's cream above its sugar makes cream the first frosting row, so
 * the row above it belongs to the cake — and the cream would silently leave the
 * frosting to join it. So the rule is: agree with both neighbours and that's
 * the answer; disagree, and staying where you already were wins over either of
 * them; only a row touching neither of its old neighbours' sections is
 * genuinely being re-filed, and then it joins the run above.
 *
 * Deliberately conservative about what counts as a drag. One reinsertion leaves
 * both arrays identical once the moved row is taken out of each; anything else
 * is a caller this rule has no business rewriting sections for, and it declines
 * rather than guessing which row was the subject.
 */
export function resolveSectionDrop(
  before: readonly SectionedRow[],
  after: readonly SectionedRow[],
): SectionDrop | null {
  if (before.length !== after.length || before.length < 2) return null;

  let first = 0;
  while (first < before.length && before[first].id === after[first].id) first++;
  if (first === before.length) return null; // nothing moved

  let last = before.length - 1;
  while (last > first && before[last].id === after[last].id) last--;

  // A single reinsertion shows up one of two ways: the row that used to be at
  // the far end of the changed run is now at the near end (dragged up), or the
  // reverse (dragged down). Everything between just shuffled along by one.
  let movedIndex: number;
  if (after[first].id === before[last].id) movedIndex = first;
  else if (after[last].id === before[first].id) movedIndex = last;
  else return null;

  const moved = after[movedIndex];
  const withoutBefore = before.filter(r => r.id !== moved.id);
  const withoutAfter = after.filter(r => r.id !== moved.id);
  if (withoutBefore.some((row, i) => row.id !== withoutAfter[i]?.id)) return null;

  // The top of the list is a real section — the ungrouped run every recipe
  // starts with — so it's null rather than "no neighbour". The bottom has no
  // row below it at all, which is why the two ends aren't symmetric.
  const above = movedIndex === 0 ? null : after[movedIndex - 1].section;
  const below = movedIndex === after.length - 1 ? undefined : after[movedIndex + 1].section;

  const section =
    below === undefined || above === below ? above
    : moved.section === above || moved.section === below ? moved.section
    : above;

  return section === moved.section ? null : { id: moved.id, section };
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
