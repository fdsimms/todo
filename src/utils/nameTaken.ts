/**
 * Whether a typed name is one the store would refuse, for the sheets that say
 * so under the field while it is being typed.
 *
 * Each of these is the rule the matching store action refuses on, lifted out
 * so the store and the sheet call one function. A sheet that wrote its own
 * check (a bare `toLowerCase()`, an exact compare) would disagree with the
 * store about "Errands" against "errands", and either flag a name the store
 * accepts or let through one it refuses. The store still checks at the write,
 * since a sheet can be open while another screen changes the list.
 */
import type { Cookbook, ProjectCategory, Recipe } from '../types';
import { cleanRecipeName, cleanRecipeSource, cookbookKey, recipeInBook, recipeNameKey } from './recipeUtils';

/**
 * A task category renamed to `typed`. Task categories compare exactly, with no
 * case folding (`useCategoryStore.renameCategory`), so "errands" is free next
 * to "Errands". Renaming to its own name, or to nothing, is not a clash.
 */
export function categoryRenameTaken(names: readonly string[], current: string, typed: string): boolean {
  const trimmed = typed.trim();
  return trimmed !== '' && trimmed !== current && names.includes(trimmed);
}

/**
 * The project category called `name`, ignoring case (`Project.category` stores
 * the name, so two that differ only in case would merge two sections). With
 * `exceptId`, the row being renamed is not a clash with itself, which is what
 * makes "travel" to "Travel" a rename.
 */
export function projectCategoryTakenBy(
  categories: readonly ProjectCategory[],
  name: string,
  exceptId?: string,
): ProjectCategory | undefined {
  const key = name.trim().toLocaleLowerCase();
  if (!key) return undefined;
  return categories.find(c => c.id !== exceptId && c.name.toLocaleLowerCase() === key);
}

/**
 * A recipe renamed to `typed`: another recipe in the same cookbook already has
 * that name (`recipeNameKey`, so "Chicken Tacos" and "Chicken taco" are one
 * name). A rename that only changes capitalization keeps its key and is free.
 */
export function recipeRenameTaken(
  recipes: readonly Pick<Recipe, 'id' | 'nameKey' | 'cookbookId'>[],
  recipe: Pick<Recipe, 'id' | 'nameKey' | 'cookbookId'>,
  typed: string,
): boolean {
  const clean = cleanRecipeName(typed);
  if (!clean || recipeNameKey(clean) === recipe.nameKey) return false;
  return recipeInBook(recipes.filter(r => r.id !== recipe.id), clean, recipe.cookbookId) !== null;
}

/**
 * A cookbook retitled to `title` by `author`. A book is its title and author
 * together, so the same title under another author is free.
 */
export function cookbookRenameTaken(
  cookbooks: readonly Pick<Cookbook, 'titleKey'>[],
  cookbook: Pick<Cookbook, 'titleKey'>,
  title: string,
  author: string | null,
): boolean {
  const cleanTitle = cleanRecipeSource(title);
  if (!cleanTitle) return false;
  const key = cookbookKey(cleanTitle, cleanRecipeSource(author ?? '') || null);
  return key !== cookbook.titleKey && cookbooks.some(c => c.titleKey === key);
}
