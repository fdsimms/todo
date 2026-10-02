/**
 * A cookbook's own page: the order its recipes are listed in, and what the
 * "Link a recipe" picker offers and warns about.
 *
 * Kept apart from `recipeProvenance.ts`, which is about what an *import* writes;
 * this is about a book already on the shelf and the recipes filed under it.
 */

import type { Cookbook, Recipe } from '../types';
import { describeAttribution, rankRecipes } from './recipeUtils';

/**
 * How a page number sorts. Front matter (roman numerals) comes before the body
 * (arabic numerals), the way the book itself is bound; a page nobody could read
 * as a number sorts after both, and a recipe with no page at all goes last.
 *
 * Only the leading token is read, so a range ("112-115") sorts by where it
 * starts and "142a" sits with 142.
 */
export interface CookbookPageKey {
  /** 0 roman, 1 arabic, 2 unreadable, 3 none. */
  band: 0 | 1 | 2 | 3;
  n: number;
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanValue(token: string): number | null {
  if (!/^[ivxlcdm]+$/i.test(token)) return null;
  let total = 0;
  const chars = token.toLowerCase();
  for (let i = 0; i < chars.length; i++) {
    const value = ROMAN[chars[i]];
    const next = i + 1 < chars.length ? ROMAN[chars[i + 1]] : 0;
    total += value < next ? -value : value;
  }
  return total > 0 ? total : null;
}

export function cookbookPageKey(page: string | null | undefined): CookbookPageKey {
  // A hand-typed "p. 42" is page 42; the field is a page whatever it's prefixed with.
  const text = (page ?? '').trim().replace(/^(?:pages?|pp?)(?:\.\s*|\s+|(?=\d))/i, '');
  if (!text) return { band: 3, n: 0 };
  const arabic = /^(\d{1,6})/.exec(text);
  if (arabic) return { band: 1, n: Number(arabic[1]) };
  const token = /^([a-z]+)/i.exec(text);
  const roman = token ? romanValue(token[1]) : null;
  if (roman !== null) return { band: 0, n: roman };
  return { band: 2, n: 0 };
}

/** Page order, then name: how a cookbook is browsed. */
export function compareCookbookRecipes(
  a: Pick<Recipe, 'name' | 'sourcePage'>,
  b: Pick<Recipe, 'name' | 'sourcePage'>,
): number {
  const ka = cookbookPageKey(a.sourcePage);
  const kb = cookbookPageKey(b.sourcePage);
  if (ka.band !== kb.band) return ka.band - kb.band;
  if (ka.n !== kb.n) return ka.n - kb.n;
  if (ka.band === 2) {
    const byPage = (a.sourcePage ?? '').localeCompare(b.sourcePage ?? '');
    if (byPage !== 0) return byPage;
  }
  return a.name.localeCompare(b.name);
}

/** The recipes filed under `cookbookId`, in the book's own page order. */
export function recipesInCookbook(recipes: readonly Recipe[], cookbookId: string): Recipe[] {
  return recipes.filter(r => r.cookbookId === cookbookId).sort(compareCookbookRecipes);
}

/**
 * What linking a recipe to a book would overwrite. `linkCookbook` mirrors the
 * book's title and author down onto the recipe, so linking is also a rewrite of
 * its attribution, and a rewrite nobody confirmed is lost for good (there is
 * no undo for it).
 *
 * - `'move'`: the recipe is filed under another book on the shelf, and linking
 *   takes it out of that one.
 * - `'replace'`: no other book, but the recipe names a source or author that
 *   isn't this book's (a website, a magazine, a different author).
 * - `'none'`: nothing is lost. Either there is no attribution, or it already
 *   says this book and linking only fills in what was missing.
 */
export type CookbookLinkEffect =
  | { kind: 'none' }
  | { kind: 'move'; from: Cookbook }
  | { kind: 'replace'; attribution: string };

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

export function cookbookLinkEffect(
  recipe: Recipe,
  target: Cookbook,
  cookbookById: (id: string | null | undefined) => Cookbook | undefined,
): CookbookLinkEffect {
  if (recipe.cookbookId && recipe.cookbookId !== target.id) {
    const from = cookbookById(recipe.cookbookId);
    // A link to a book that's gone reads as no link, same as everywhere else.
    if (from) return { kind: 'move', from };
  }
  const attribution = describeAttribution(recipe);
  if (!attribution) return { kind: 'none' };
  const sourceLost = recipe.source
    ? !sameText(recipe.source, target.title)
    // The legacy byline only shows while neither new field is set, and the
    // mirror sets `source`, so linking hides it.
    : !recipe.author && !!recipe.sourceName && !sameText(recipe.sourceName, target.title);
  const authorLost = !!recipe.author && !sameText(recipe.author, target.author);
  return sourceLost || authorLost ? { kind: 'replace', attribution } : { kind: 'none' };
}

/**
 * The page number a recipe keeps when it's linked to `target`: its own when
 * linking loses nothing (`cookbookLinkEffect` is `'none'`), none when the link
 * moves it out of another book or replaces a source naming another book.
 *
 * A page is a page *of the book the recipe names*, so page 42 of Plenty is
 * not page 42 of Jerusalem, and a moved recipe kept it anyway (#2921's
 * remainder): the book page then listed it at 42 and its credit read
 * "Jerusalem, p. 42", pointing at a page with some other recipe on it. Worked
 * out from the same effect the picker's confirm asks about, so the store and
 * the confirm can't disagree about when the page goes. A recipe with no
 * attribution keeps its page, since there is no other book for it to belong
 * to: that is a page read off a photo, waiting for its book to be named.
 */
export function pageAfterCookbookLink(
  recipe: Recipe,
  target: Cookbook,
  cookbookById: (id: string | null | undefined) => Cookbook | undefined,
): string | null {
  return cookbookLinkEffect(recipe, target, cookbookById).kind === 'none' ? recipe.sourcePage : null;
}

/** One row of the picker: the recipe, and the line under its name, if any. */
export interface CookbookLinkCandidate {
  recipe: Recipe;
  effect: CookbookLinkEffect;
  /** "In Plenty, p. 42" for a recipe filed elsewhere, else its attribution. */
  note: string | null;
}

/** How many rows the picker renders before asking for a search. */
export const COOKBOOK_LINK_LIMIT = 30;

/**
 * The recipes "Link a recipe" offers: everything not already in this book,
 * searched the same way the recipe box is (`rankRecipes`), alphabetical when
 * nothing is typed. `total` is how many matched before the cap, so the sheet
 * can say it is showing a slice rather than letting the cap pass for the whole
 * box.
 */
export function cookbookLinkCandidates(
  recipes: readonly Recipe[],
  target: Cookbook,
  query: string,
  cookbookById: (id: string | null | undefined) => Cookbook | undefined,
  limit: number = COOKBOOK_LINK_LIMIT,
): { shown: CookbookLinkCandidate[]; total: number } {
  // Ranked over the whole box so a component's ingredients are still found,
  // then narrowed: a recipe already in this book would only link to itself.
  const ordered = query.trim()
    ? rankRecipes(query, recipes)
    : [...recipes].sort((a, b) => a.name.localeCompare(b.name));
  const matches = ordered.filter(r => r.cookbookId !== target.id);
  const shown = matches.slice(0, limit).map(recipe => {
    const effect = cookbookLinkEffect(recipe, target, cookbookById);
    const note = effect.kind === 'move'
      ? `In ${effect.from.title}${recipe.sourcePage ? `, p. ${recipe.sourcePage}` : ''}`
      : describeAttribution(recipe);
    return { recipe, effect, note };
  });
  return { shown, total: matches.length };
}

/**
 * The confirm to raise before linking, or null when linking loses nothing.
 * Copy lives here so the two cases can't drift apart in the screen.
 *
 * `page` is the recipe's page number, which either kind of link clears
 * (`pageAfterCookbookLink`), so the confirm says so rather than leaving a
 * page to disappear unannounced.
 */
export function cookbookLinkPrompt(
  recipeName: string,
  target: Cookbook,
  effect: CookbookLinkEffect,
  page: string | null = null,
): { title: string; message: string; confirm: string } | null {
  if (effect.kind === 'move') {
    const pageNote = page
      ? ` Its page number (p. ${page}) is cleared, since that was a page of ${effect.from.title}.`
      : '';
    return {
      title: `Move to ${target.title}?`,
      message: `Linking "${recipeName}" to ${target.title} takes it out of ${effect.from.title}.${pageNote}`,
      confirm: 'Move',
    };
  }
  if (effect.kind === 'replace') {
    const replaces = `replaces its current source (${effect.attribution})`;
    return {
      title: 'Replace the source?',
      message: `Linking "${recipeName}" to ${target.title} ${page ? `${replaces} and clears its page number` : replaces}.`,
      confirm: 'Link',
    };
  }
  return null;
}
