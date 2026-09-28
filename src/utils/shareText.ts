import { format } from 'date-fns/format';
import type { GroceryItem, MealPlanEntry, Recipe, RecipeIngredient } from '../types';
import { flattenRecipeIngredients } from './recipeComponents';
import { ingredientHeadings } from './recipeSections';
import { describeAttribution, formatServingsRange, totalMinutes } from './recipeUtils';
import { formatDuration } from './effort';
import { scaleQuantity, scaleServings } from './recipeScale';
import { convertQuantity, type UnitSystem } from './unitConvert';
import { ingredientWeightText, type WeightLookups } from './lineWeight';
import { dayKeyOf } from './dateUtils';
import { describeWeekRange, entriesForDay, mealTitleOffPlan, slotLabel, titleForEntry } from './mealPlan';

/**
 * Plain text for RN's `Share.share` (and, for the ingredients, the
 * clipboard), for the things in this app worth sending somewhere else.
 * Deliberately plain text rather than a custom
 * format: what people actually want is something they can paste into
 * Messages, not an import file — see #1692. Every quantity renders through
 * the same scale and unit system the screen sharing it was showing, so what
 * gets sent matches what was on screen, `≈` included.
 */

/**
 * One ingredient line, scaled and converted exactly as `RecipeDetailScreen`
 * renders it: scale first (exact), then convert (rounds) — the only order
 * that doesn't compound. `prep`/`purpose` reattach the way `splitPrep`/
 * `splitPurpose` originally split them off, so a shared line reads the way
 * it would have been typed.
 *
 * With `weights`, a line the recipe page shows a weight under carries it in
 * parentheses after the name ("4 tbsp butter (≈57 g), softened"), so the
 * text sent matches the page. Weighed off the scaled line before conversion,
 * the same order the page uses (see `ingredientWeightText`).
 */
function formatShareIngredientLine(
  ingredient: RecipeIngredient,
  scale: number,
  unitSystem: UnitSystem,
  weights: WeightLookups | null,
): string {
  const scaled = scaleQuantity(ingredient.quantity, scale).text;
  const quantity = convertQuantity(scaled, unitSystem).text;
  const weight = weights ? ingredientWeightText(ingredient, scaled, weights, unitSystem) : null;
  const line = [quantity, ingredient.name, weight && `(${weight})`].filter(Boolean).join(' ').trim();
  const trailing = [ingredient.prep, ingredient.purpose ? `for ${ingredient.purpose}` : null]
    .filter(Boolean)
    .join(', ');
  return trailing ? `${line}, ${trailing}` : line;
}

/**
 * A recipe as text — name, servings/time, every ingredient (a composed
 * recipe's components included, each under its own heading — see
 * `flattenRecipeIngredients` — and under the recipe's own section headings
 * where it has them), the method, and attribution.
 *
 * `scale`/`unitSystem` default to as-written/asWritten so a caller with
 * nothing to say about either still gets a sensible share; pass the screen's
 * own live values to match what's on screen. `weights` (the catalog lookups
 * from `lineWeight.ts`) adds each line's weight where the page shows one, and
 * is omitted for no weights.
 *
 * Resolves every choice group to its default rather than accepting a
 * `ChoiceResolution` — sharing "the recipe" means the version anyone opening
 * it fresh would see, not the sender's mid-cook picks for tonight, which is
 * exactly what `MealPlanEntry.recipeChoices` exists to hold separately.
 *
 * The source link, when there is one, is appended rather than sent alone.
 * Sending only the link would be truer to "the app's `sourceUrl` is the
 * canonical page," but it would silently drop any steps or notes the cook
 * has added locally and everything the scale/unit conversion just did — so
 * this includes both, link last, rather than choosing one.
 */
export function buildRecipeShareText(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  options: { scale?: number; unitSystem?: UnitSystem; weights?: WeightLookups | null } = {},
): string {
  const scale = options.scale ?? 1;
  const unitSystem = options.unitSystem ?? 'asWritten';
  const weights = options.weights ?? null;
  const lines: string[] = [recipe.name];

  const subtitle: string[] = [];
  // The servings the screen's stepper shows at this scale, not the recipe's
  // own: "Serves 4" over a doubled ingredient list reads as twice the food
  // for the same table. The yield stays as written, since "24 cookies" is the
  // recipe's claim and scaling a count of things it names is `recipeScale`'s
  // refusal to make.
  const scaled = scaleServings(recipe.servings || null, recipe.servingsMax, scale);
  const servings = formatServingsRange(scaled.servings, scaled.servingsMax);
  if (servings) subtitle.push(`Serves ${servings}`);
  if (recipe.recipeYield) subtitle.push(`Makes ${recipe.recipeYield}`);
  const minutes = totalMinutes(recipe);
  if (minutes) subtitle.push(formatDuration(minutes));
  if (subtitle.length > 0) lines.push(subtitle.join(' · '));

  // No standing swaps, deliberately (#1571): a swap is a fact about this
  // kitchen, and the person being sent the recipe has their own. What travels
  // is the recipe's own words.
  const flat = flattenRecipeIngredients(recipe, recipesById);
  if (flat.length > 0) {
    lines.push('', 'Ingredients:');
    // Component names and the recipe's own section headings, both inferred
    // from the flat list by the one walk every surface that flattens shares
    // (ingredientHeadings). A section reads as its own line rather than as a
    // "For the …" — the recipe wrote that label, so it travels as written.
    const headings = ingredientHeadings(flat);
    flat.forEach((line, index) => {
      if (headings[index].dish) lines.push(`For the ${line.recipe.name}:`);
      const section = headings[index].section;
      if (section) lines.push(`${section}:`);
      lines.push(`- ${formatShareIngredientLine(line.ingredient, scale, unitSystem, weights)}`);
    });
  }

  if (recipe.steps.length > 0) {
    lines.push('', 'Steps:');
    recipe.steps.forEach((step, i) => lines.push(`${i + 1}. ${step.text}`));
  } else if (recipe.notes) {
    lines.push('', 'Notes:');
    lines.push(recipe.notes);
  }

  const attribution = describeAttribution(recipe);
  if (attribution || recipe.sourceUrl) {
    lines.push('');
    if (attribution) lines.push(attribution);
    if (recipe.sourceUrl) lines.push(recipe.sourceUrl);
  }

  return lines.join('\n');
}

/**
 * Just the ingredients, one per line, and nothing else — the format another
 * recipe or shopping app's "paste your ingredients here" box expects.
 *
 * Deliberately none of the furniture `buildRecipeShareText` adds, because
 * every piece of it becomes a bogus ingredient on the other side: no recipe
 * name, no servings line, no `Ingredients:` header, no `- ` bullets, and
 * neither kind of heading — not the `For the cake:` a component opens, nor
 * the recipe's own `For the frosting:` sections. What travels is N lines for
 * N ingredients, so a parser reading line by line gets N ingredients.
 *
 * Everything else matches the recipe share: components are flattened in (in
 * order, just without their headings), choice groups resolve to their
 * defaults, standing swaps stay out, and each line is scaled then converted
 * through the caller's own `scale`/`unitSystem` so a doubled list pastes
 * doubled.
 *
 * Empty string for a recipe with nothing to list, same gating convention as
 * the two builders below.
 */
export function buildIngredientsText(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  options: { scale?: number; unitSystem?: UnitSystem; weights?: WeightLookups | null } = {},
): string {
  const scale = options.scale ?? 1;
  const unitSystem = options.unitSystem ?? 'asWritten';
  const weights = options.weights ?? null;
  const flat = flattenRecipeIngredients(recipe, recipesById);
  if (flat.length === 0) return '';
  return flat
    .map(line => formatShareIngredientLine(line.ingredient, scale, unitSystem, weights))
    .join('\n');
}

/**
 * The shopping list as a checklist someone else can pick up — every item
 * still on the list and not yet ticked, in the order the caller hands them
 * (list order, so it reads like the actual list rather than a re-sort this
 * function would have to justify).
 *
 * Each line carries what the row itself shows a shopper, because the person
 * reading it is standing at the shelf without the app:
 * - the amount in the caller's `unitSystem`, as `GroceryRow` renders it, so
 *   "500 g" on a US-units screen goes out as the "≈1.1 lbs" that was on it;
 * - the preferred product (`productCaptions`, keyed by item id and worded by
 *   `describeProduct`, the row's own caption) after a colon: "cheddar:
 *   Tillamook sharp", the one caption that decides which box leaves the shelf;
 * - the item's note in parentheses: "milk (the green top one)".
 *
 * `listName` titles the text when the list isn't the home one (a week away
 * has its own list, and "Grocery list" over the cabin's shop is the wrong
 * list to someone who has both); omitted, it's the home list's plain title.
 *
 * Empty string for nothing to share, so a caller can gate the share action
 * on it directly rather than sending a bare "Grocery list" header.
 */
export function buildGroceryListShareText(
  items: readonly GroceryItem[],
  options: {
    unitSystem?: UnitSystem;
    productCaptions?: ReadonlyMap<string, string>;
    listName?: string | null;
  } = {},
): string {
  const onList = items.filter(i => i.onList && !i.checked);
  if (onList.length === 0) return '';
  const unitSystem = options.unitSystem ?? 'asWritten';
  const describe = (item: GroceryItem) => {
    const quantity = convertQuantity(item.quantity ?? '', unitSystem).text;
    const product = options.productCaptions?.get(item.id);
    const note = item.note?.trim();
    return `${quantity ? `${quantity} ` : ''}${item.name}${product ? `: ${product}` : ''}${note ? ` (${note})` : ''}`;
  };
  const lines = groceryShareLines(onList, describe).map(line => `- ${line}`);
  return [options.listName?.trim() || 'Grocery list', ...lines].join('\n');
}

function groceryItemText(item: GroceryItem): string {
  return `${item.quantity ? `${item.quantity} ` : ''}${item.name}`;
}

/**
 * One line per thing to buy, which for an either/or is one line for the
 * whole group ("4 apples or 4 pears"), placed where its first member sits.
 * The list screen stitches a group into one card with an "or pears" caption;
 * sent as two ordinary lines, the person reading it buys both.
 */
function groceryShareLines(
  items: readonly GroceryItem[],
  text: (item: GroceryItem) => string,
): string[] {
  const groups = new Map<string, GroceryItem[]>();
  for (const item of items) {
    if (!item.choiceGroup) continue;
    const members = groups.get(item.choiceGroup);
    if (members) members.push(item);
    else groups.set(item.choiceGroup, [item]);
  }
  const lines: string[] = [];
  const emitted = new Set<string>();
  for (const item of items) {
    const group = item.choiceGroup;
    if (!group) { lines.push(text(item)); continue; }
    if (emitted.has(group)) continue;
    emitted.add(group);
    lines.push((groups.get(group) ?? [item]).map(text).join(' or '));
  }
  return lines;
}

/**
 * The same rows `buildGroceryListShareText` sends, as the plain lines another
 * shopping app's paste box wants: no "Grocery list" title, no `- ` bullets,
 * one item per line. Same reasoning as `buildIngredientsText` — a title line
 * and a bullet each become part of an item on the other side. That's also
 * why the share's product, note and converted amount stay out: "cheddar:
 * Tillamook sharp (the orange one)" or "≈1.1 lbs" pasted into another app is
 * one item with a strange name, so each line is the stored amount and name.
 *
 * Empty string for nothing to copy, same gating convention as the rest.
 */
export function buildGroceryListText(items: readonly GroceryItem[]): string {
  return items
    .filter(i => i.onList && !i.checked)
    .map(groceryItemText)
    .join('\n');
}

/**
 * A week's meal plan as text — "here's what we're eating", one line per
 * planned slot, days with nothing planned omitted rather than padded out
 * with blanks.
 *
 * The heading says "This week's meals" only when the caller says the week is
 * this one (`thisWeek`); any other week is named by its dates, "Meals for
 * Oct 5 – 11", since the plan pages forward and back and "this week" over
 * next week's dinners tells the reader the wrong week. Left out, it's the
 * dates, which are never wrong.
 *
 * Empty string for a week with nothing planned at all, same gating
 * convention as `buildGroceryListShareText`.
 */
export function buildWeekPlanShareText(
  days: readonly Date[],
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  options: { thisWeek?: boolean } = {},
): string {
  const range = describeWeekRange(days);
  const lines = [options.thisWeek ? `This week's meals (${range})` : `Meals for ${range}`];
  for (const day of days) {
    const dayEntries = entriesForDay(entries, dayKeyOf(day));
    if (dayEntries.length === 0) continue;
    lines.push('', format(day, 'EEEE'));
    for (const entry of dayEntries) {
      lines.push(`- ${slotLabel(entry.slot)}: ${mealTitleOffPlan(entry, titleForEntry(entry, recipesById))}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}
