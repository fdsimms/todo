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
import type { Cookbook, ProjectCategory, Recipe, RecipeIngredient } from '../types';
import { groceryNameKey } from './groceryParse';
import {
  cleanChoiceGroup,
  cleanRecipeName,
  cleanRecipeSource,
  cookbookKey,
  ingredientDedupeKey,
  recipeInBook,
  recipeNameKey,
} from './recipeUtils';

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

/**
 * An either/or group of a recipe's lines renamed to `typed`: another group in
 * the same recipe already has that label, which would fold the two into one
 * choice. The label is shared by ingredients and used recipes, so both lists
 * count. Compared exactly (`renameChoiceGroup` does), and keeping its own label
 * or typing nothing is not a clash.
 */
export function choiceGroupRenameTaken(
  recipe: Pick<Recipe, 'ingredients' | 'components'>,
  oldLabel: string,
  typed: string,
): boolean {
  const clean = cleanChoiceGroup(typed);
  if (!clean || clean === oldLabel) return false;
  return recipe.ingredients.some(i => i.choiceGroup === clean)
    || recipe.components.some(c => c.choiceGroup === clean);
}

/**
 * The other line of a recipe that an ingredient edited to `draft` would
 * duplicate, or undefined when it would not. A recipe refuses a second line
 * with the same name, heading, prep and purpose (`ingredientDedupeKey`), so the
 * clash is those four together, not the name alone. Only an edit that changes
 * one of them can clash: a duplicate already on the recipe doesn't block saving
 * something else on the line.
 */
export function ingredientLineClash<I extends RecipeIngredient>(
  lines: readonly I[],
  ingredient: I,
  draft: { name: string; section: string; prep: string; purpose: string },
): I | undefined {
  const name = draft.name.trim();
  const edited: I = {
    ...ingredient,
    nameKey: name && name !== ingredient.name ? groceryNameKey(name) : ingredient.nameKey,
    section: draft.section.trim() || null,
    prep: draft.prep.trim() || null,
    purpose: draft.purpose.trim() || null,
  };
  const key = ingredientDedupeKey(edited);
  if (key === ingredientDedupeKey(ingredient)) return undefined;
  return lines.find(i => i.id !== ingredient.id && ingredientDedupeKey(i) === key);
}
