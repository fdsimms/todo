/**
 * Where an imported recipe says it's from, and what to do about it.
 *
 * Both import sheets (`RecipeCreateSheet`, `RecipeExtractSheet`) ask the same
 * two questions — what does the "Where it's from" row open with, and what gets
 * written when it's ticked — and they are the same sheet twice over, so the
 * answers live here rather than being hand-copied into each. The sheets keep
 * only the fields and the store calls.
 *
 * The rule that matters is which statement wins. A link import reads its
 * attribution out of the page's own `schema.org`/OpenGraph markup, which is the
 * publisher saying so in a machine-readable field; a model reading a byline off
 * body text or a running head is an inference about a picture. Both beat an
 * empty field, markup beats both, and neither may overwrite something the user
 * typed — see `sourceFieldsFor`.
 */

import type { Cookbook, RecipeSourceType } from '../types';
import { cleanRecipeSource, cookbookKey } from './recipeUtils';

/** The subset of an `ExtractedRecipe` this cares about. */
export interface ExtractedSource {
  sourceTitle: string | null;
  sourceAuthor: string | null;
  sourcePage: string | null;
  sourceType: RecipeSourceType | null;
}

/** The page a link import fetched, as far as attribution is concerned. */
export interface FetchedSourcePage {
  siteName: string | null;
  author: string | null;
}

/** What the "Where it's from" row opens with. Empty strings, because they're inputs. */
export interface SourceFields {
  source: string;
  author: string;
  /** Only ever non-empty for a cookbook — see `Recipe.sourcePage`. */
  page: string;
  sourceType: RecipeSourceType | null;
}

/**
 * What the row shows before the user touches it.
 *
 * A fetched page pins the type to 'website' whatever the model thought it was
 * looking at: we know how we got there, and a page that prints a cookbook
 * extract is still a website as far as the URL we're about to store is
 * concerned. Its markup fills each field it actually has, and the model's read
 * fills the ones it doesn't — a recipe site that names the author in markup but
 * not the publication used to leave the publication blank for no better reason
 * than that the other half arrived first.
 */
export function sourceFieldsFor(
  page: FetchedSourcePage | null,
  extracted: ExtractedSource,
): SourceFields {
  if (page) {
    return {
      source: page.siteName ?? extracted.sourceTitle ?? '',
      author: page.author ?? extracted.sourceAuthor ?? '',
      // A URL was fetched, so there is no page number to have.
      page: '',
      sourceType: 'website',
    };
  }
  return {
    source: extracted.sourceTitle ?? '',
    author: extracted.sourceAuthor ?? '',
    // Dropped for any other type, the same rule `setSourceType` enforces on the
    // way into the store: a page number only means anything alongside a book.
    page: extracted.sourceType === 'cookbook' ? (extracted.sourcePage ?? '') : '',
    sourceType: extracted.sourceType,
  };
}

/**
 * What editing a linked recipe's book title means.
 *
 * One text field is being asked to say two different things — "this book is
 * called something else" and "this recipe is from a different book" — and
 * nothing about the typing distinguishes them. Rather than pick one and be
 * wrong half the time, this narrows the question to the only case where it
 * genuinely matters and asks then.
 *
 * - `'refile'`: find-or-create the typed book and point this recipe at it.
 *   Nothing else moves. The answer whenever there's no book to rename, or
 *   when nothing about the title or author actually changed.
 * - `'rename'`: correct the book itself. Safe without asking when this recipe
 *   is the only one using it, since "everywhere" and "just this one" are the
 *   same place.
 * - `'ask'`: the two readings would do visibly different things to recipes the
 *   user isn't looking at, which is exactly when a silent choice is wrong.
 */
export type CookbookEditIntent = 'refile' | 'rename' | 'ask';

export function cookbookEditIntent(
  current: { title: string; author: string | null } | null | undefined,
  typedTitle: string,
  typedAuthor: string,
  /** How many recipes point at `current`, this one included. */
  linkedCount: number,
): CookbookEditIntent {
  if (!current) return 'refile';
  const sameTitle = current.title.trim() === typedTitle.trim();
  const sameAuthor = (current.author ?? '').trim() === typedAuthor.trim();
  if (sameTitle && sameAuthor) return 'refile';
  return linkedCount > 1 ? 'ask' : 'rename';
}

/** How many shelf books the import sheets' picker offers at once. */
export const SHELF_SUGGESTION_LIMIT = 6;

/**
 * The books already on the shelf that the "Where it's from" row can point at.
 *
 * An import links by find-or-create on title *and* author together
 * (`ensureCookbook`), so a title typed correctly with an author spelled
 * differently ("Molinaro" against "Joanne Lee Molinaro") quietly files a second
 * copy of the book. Offering the shelf is what lets a person say "that one"
 * rather than retype it exactly. A book is left out only when the typed pair
 * already resolves to it, since offering it would change nothing; a book with
 * the right title and a different author is exactly the one to offer.
 *
 * With nothing typed it is the shelf in its own order. Typed, it is the books
 * whose title or author contains the text, exact title matches first.
 */
export function shelfSuggestions(
  cookbooks: readonly Cookbook[],
  title: string,
  author: string,
): Cookbook[] {
  const typedTitle = cleanRecipeSource(title);
  const typedAuthor = cleanRecipeSource(author);
  const resolved = typedTitle ? cookbookKey(typedTitle, typedAuthor || null) : null;
  const q = typedTitle.toLowerCase();

  const open = cookbooks.filter(c => c.titleKey !== resolved);
  const matches = q
    ? open.filter(c => c.title.toLowerCase().includes(q) || (c.author ?? '').toLowerCase().includes(q))
    : open;
  const exact = (c: Cookbook) => (c.title.toLowerCase() === q ? 0 : 1);
  return [...matches]
    .sort((a, b) => exact(a) - exact(b) || a.sortOrder - b.sortOrder)
    .slice(0, SHELF_SUGGESTION_LIMIT);
}

/** The writes a ticked "Where it's from" row turns into. Nulls are "don't write". */
export interface SourcePlan {
  url: string | null;
  /** Set only when no cookbook is being linked — linking implies 'cookbook'. */
  sourceType: RecipeSourceType | null;
  /**
   * The book to find-or-create and point the recipe at, via
   * `useRecipeStore.linkNewCookbook`. Non-null only for a cookbook that
   * actually has a title: a type with nothing to name it is not a book, it's
   * just a classification, and `Cookbook` rows with empty titles are how a
   * shelf fills up with things nobody can pick.
   */
  cookbook: { title: string; author: string | null } | null;
  source: string | null;
  author: string | null;
  page: string | null;
}

/**
 * Turns the row's final state into the writes it implies.
 *
 * Everything is read back out of the fields rather than off the extraction, so
 * a value the user retyped over the model's is the one that lands — the
 * extraction's only job was to fill the box in the first place.
 */
export function sourcePlanFor(url: string | null, fields: SourceFields): SourcePlan {
  const source = fields.source.trim();
  const author = fields.author.trim();
  const page = fields.page.trim();
  const isCookbook = fields.sourceType === 'cookbook';

  return {
    url: url || null,
    // A linked book carries the type itself, so writing it here too would be a
    // second, redundant writer of one field.
    sourceType: isCookbook && source ? null : fields.sourceType,
    cookbook: isCookbook && source ? { title: source, author: author || null } : null,
    source: isCookbook && source ? null : (source || null),
    author: isCookbook && source ? null : (author || null),
    page: isCookbook ? (page || null) : null,
  };
}
