/**
 * Read-only formatting checks over saved recipes, for `lint_recipes`. Each check names
 * something a person would fix by hand and that a patch can fix mechanically: a quantity
 * that carries a note, a source link with tracking junk, a recipe with nothing in it.
 * Nothing here judges style (fractions, unit spelling, title case); that is a preference
 * the person has to set, so it is not a finding.
 */
import type { Recipe } from '../../src/types';

export type LintCode =
  | 'quantity-unclosed-paren'
  | 'quantity-parenthetical'
  | 'quantity-note'
  | 'quantity-alternative'
  | 'source-tracking-url'
  | 'no-steps'
  | 'no-ingredients'
  | 'placeholder-name';

export interface LintIssue {
  code: LintCode;
  /** 1-based, in get_recipe's order (what patch_recipe addresses). Absent for a whole-recipe issue. */
  ingredient?: number;
  /** The offending text, verbatim. */
  text?: string;
}

export interface RecipeLint {
  id: string;
  name: string;
  issues: LintIssue[];
}

/** A word that says what to do to an ingredient, so it belongs in prep, not the amount. */
const PREP_WORD = /\b(divided|plus more|to taste|melted|softened|chopped|minced|diced|sliced|shredded|grated|crumbled|drained|rinsed|peeled|fresh|frozen)\b/i;
const TRACKING_PARAM = /[?&](unlocked_article_code|smid|utm_[a-z]+|fbclid|gclid)=/i;

function quantityIssues(quantity: string): LintCode[] {
  const out: LintCode[] = [];
  const open = (quantity.match(/\(/g) ?? []).length;
  const close = (quantity.match(/\)/g) ?? []).length;
  if (open !== close) out.push('quantity-unclosed-paren');
  else if (open > 0 || / \| /.test(quantity)) out.push('quantity-parenthetical');
  if (quantity.includes(',') || PREP_WORD.test(quantity)) out.push('quantity-note');
  if (/\bor\b/i.test(quantity)) out.push('quantity-alternative');
  return out;
}

export function lintRecipe(r: Recipe): RecipeLint {
  const issues: LintIssue[] = [];
  if (/^new recipe$/i.test(r.name.trim())) issues.push({ code: 'placeholder-name', text: r.name });
  if (r.ingredients.length === 0 && r.components.length === 0 && (r.blanks ?? []).length === 0) issues.push({ code: 'no-ingredients' });
  if (r.steps.length === 0) issues.push({ code: 'no-steps' });
  if (r.sourceUrl && TRACKING_PARAM.test(r.sourceUrl)) issues.push({ code: 'source-tracking-url', text: r.sourceUrl });
  r.ingredients.forEach((ingredient, i) => {
    for (const code of quantityIssues(ingredient.quantity ?? '')) {
      issues.push({ code, ingredient: i + 1, text: ingredient.quantity });
    }
  });
  return { id: r.id, name: r.name, issues };
}

export interface LintRecipesInput {
  /** One recipe, by id. Omit to check them all. */
  id?: string;
  /** Only these checks. */
  codes?: LintCode[];
}

export function lintRecipes(recipes: readonly Recipe[], input: LintRecipesInput = {}): { checked: number; withIssues: number; recipes: RecipeLint[] } {
  const pool = input.id ? recipes.filter(r => r.id === input.id) : recipes;
  const wanted = input.codes?.length ? new Set<LintCode>(input.codes) : null;
  const found = pool
    .map(lintRecipe)
    .map(l => (wanted ? { ...l, issues: l.issues.filter(i => wanted.has(i.code)) } : l))
    .filter(l => l.issues.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { checked: pool.length, withIssues: found.length, recipes: found };
}
