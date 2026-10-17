import type { FoodKind, Recipe, RecipeBlank, RecipeIngredient, RecipeOverride } from '../types';
import { GROCERY_NAME_MAX_LENGTH, RECIPE_INGREDIENT_QUANTITY_MAX_LENGTH, RECIPE_SECTION_MAX_LENGTH } from '../types';
import { isFoodKind, FOOD_KIND_LABELS } from './foodKinds';
import { groceryNameKey } from './groceryParse';
import { generateId } from './id';
import { scaleQuantity } from './recipeScale';

/**
 * A recipe's blanks (`RecipeBlank`) and what one cooking fills them with.
 *
 * The rules a reader has to agree on live here: how a blank is stored, how its
 * amount is shared across the things picked for it, and how a fill is carried
 * on a meal (an override aimed at the blank, `RecipeOverride.fill`). Which food
 * the picker *offers* is `blankPicker.ts`, which needs the kitchen; this file
 * needs nothing past the recipe, so `flattenRecipeIngredients` can read it.
 */

/** A blank's label is a heading, like an ingredient section's. */
export const RECIPE_BLANK_LABEL_MAX_LENGTH = RECIPE_SECTION_MAX_LENGTH;
/** More than any real "feta, goat cheese or cheddar"; it only bounds a corrupt blob. */
export const RECIPE_BLANK_OPTIONS_MAX = 24;
/** "Pick up to N" past this reads as "pick any", so the stepper stops here. */
export const RECIPE_BLANK_MAX_PICKS = 6;

/** A stored list of names, trimmed, bounded and without repeats by catalog key. */
function cleanNames(raw: unknown): string[] {
  const names: string[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim().slice(0, GROCERY_NAME_MAX_LENGTH);
    if (!name || names.some(o => groceryNameKey(o) === groceryNameKey(name))) continue;
    names.push(name);
    if (names.length >= RECIPE_BLANK_OPTIONS_MAX) break;
  }
  return names;
}

/** Repairs one stored blank. Null for one with no label and no kind, which has nothing to say. */
export function normalizeBlank(raw: unknown): RecipeBlank | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecipeBlank>;
  const kind = isFoodKind(r.kind) ? r.kind : null;
  const typed = typeof r.label === 'string' ? r.label.trim().slice(0, RECIPE_BLANK_LABEL_MAX_LENGTH) : '';
  const label = typed || (kind ? FOOD_KIND_LABELS[kind] : '');
  if (!label) return null;
  const max = typeof r.max === 'number' && Number.isInteger(r.max) && r.max >= 1
    ? Math.min(r.max, RECIPE_BLANK_MAX_PICKS)
    : null;
  const options = cleanNames(r.options);
  const excluded = cleanNames(r.excluded);
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    label,
    kind,
    max,
    quantity: typeof r.quantity === 'string' ? r.quantity.trim().slice(0, RECIPE_INGREDIENT_QUANTITY_MAX_LENGTH) : '',
    options,
    excluded,
  };
}

/** The `blanks` column. Tolerates NULL and a corrupt blob like every other JSON column here. */
export function parseRecipeBlanks(raw: unknown): RecipeBlank[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeBlank).filter((b): b is RecipeBlank => b !== null);
}

/** A new blank from the editor's fields, or null when it would say nothing. */
export function makeBlank(fields: {
  label?: string;
  kind: FoodKind | null;
  max: number | null;
  quantity?: string;
  options?: readonly string[];
  excluded?: readonly string[];
}): RecipeBlank | null {
  return normalizeBlank({ ...fields, id: generateId(), options: [...(fields.options ?? [])], excluded: [...(fields.excluded ?? [])] });
}

/** "Pick one", "Pick up to 2", "Pick any". */
export function describeBlankRule(max: number | null): string {
  if (max === 1) return 'Pick one';
  if (max !== null) return `Pick up to ${max}`;
  return 'Pick any';
}

/** One line for the recipe page: "2 cups · Vegetables · Pick any". */
export function describeBlank(blank: RecipeBlank): string {
  return [blank.quantity, blank.label, describeBlankRule(blank.max)].filter(Boolean).join(' · ');
}

/**
 * Each pick's share of the blank's amount, when `count` things fill it.
 *
 * Even shares, as the person asked for: "2 cups" across three is "2/3 cup"
 * each, and they change any one by hand. An amount the scaler can't divide
 * ("a handful") is kept whole on a single pick and left blank on several,
 * since writing "a handful" against each of three would claim three handfuls.
 */
export function shareOfBlank(quantity: string, count: number): string {
  if (!quantity.trim() || count <= 1) return quantity.trim();
  const share = scaleQuantity(quantity, 1 / count);
  return share.scaled ? share.text : '';
}

/**
 * One picked food as an ingredient line of this cooking. Filed under the
 * blank's label so cook mode heads it the way the recipe page does.
 */
export function blankFillLine(blank: RecipeBlank, name: string, quantity: string): RecipeIngredient | null {
  const cleaned = name.trim().slice(0, GROCERY_NAME_MAX_LENGTH);
  if (!cleaned) return null;
  return {
    id: generateId(),
    name: cleaned,
    nameKey: groceryNameKey(cleaned),
    quantity: quantity.trim().slice(0, RECIPE_INGREDIENT_QUANTITY_MAX_LENGTH),
    aisle: null,
    prep: null,
    purpose: null,
    section: blank.label,
    choiceGroup: null,
  };
}

/**
 * The lines for `names` picked into `blank`, each with its even share of the
 * amount. `quantities` keeps a share a person already changed by hand, keyed by
 * the name's catalog key, so picking a fourth thing doesn't undo their edit.
 */
export function fillBlank(
  blank: RecipeBlank,
  names: readonly string[],
  quantities: ReadonlyMap<string, string> = new Map(),
): RecipeIngredient[] {
  // Deduped before the amount is shared, so a repeat doesn't take a share.
  const picked: string[] = [];
  for (const name of names) {
    const key = groceryNameKey(name);
    if (key && !picked.some(p => groceryNameKey(p) === key)) picked.push(name);
  }
  const share = shareOfBlank(blank.quantity, picked.length);
  return picked
    .map(name => blankFillLine(blank, name, quantities.get(groceryNameKey(name)) ?? share))
    .filter((l): l is RecipeIngredient => l !== null);
}

/** What a meal fills `blankId` with, or an empty list when it fills nothing. */
export function blankFillOf(overrides: readonly RecipeOverride[] | undefined, blankId: string): RecipeIngredient[] {
  return overrides?.find(o => o.targetId === blankId)?.fill ?? [];
}

/**
 * `overrides` with `blankId` filled by `lines`, replacing any earlier fill. An
 * empty list takes the fill off, which leaves the blank empty again.
 */
export function withBlankFill(
  overrides: readonly RecipeOverride[],
  blankId: string,
  lines: readonly RecipeIngredient[],
): RecipeOverride[] {
  const rest = overrides.filter(o => o.targetId !== blankId);
  return lines.length > 0 ? [...rest, { targetId: blankId, replacement: null, fill: [...lines] }] : rest;
}

/** Whether `override` fills a blank, rather than replacing or leaving out a line. */
export function isBlankFill(override: RecipeOverride): boolean {
  return override.fill !== undefined;
}

/** Every blank on the recipe and the parts it uses, with the recipe each sits on. */
export function recipeBlanksIn(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
): { blank: RecipeBlank; recipe: Recipe }[] {
  const out: { blank: RecipeBlank; recipe: Recipe }[] = [];
  const seen = new Set<string>();
  const walk = (node: Recipe) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    for (const blank of node.blanks ?? []) out.push({ blank, recipe: node });
    for (const link of node.components) {
      const target = recipesById.get(link.recipeId);
      if (target) walk(target);
    }
  };
  walk(recipe);
  return out;
}

/** "Rice, tofurky, frozen peas", the fill of a meal in the order its blanks are written. */
export function describeBlankFills(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  overrides: readonly RecipeOverride[] | undefined,
): string | null {
  const names = recipeBlanksIn(recipe, recipesById)
    .flatMap(({ blank }) => blankFillOf(overrides, blank.id).map(l => l.name));
  return names.length > 0 ? names.join(', ') : null;
}
