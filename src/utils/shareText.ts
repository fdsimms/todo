import { format } from 'date-fns/format';
import type { GroceryItem, MealPlanEntry, Recipe, RecipeIngredient } from '../types';
import { flattenRecipeIngredients } from './recipeComponents';
import { describeAttribution, formatServings, totalMinutes } from './recipeUtils';
import { formatDuration } from './effort';
import { scaleQuantity } from './recipeScale';
import { convertQuantity, type UnitSystem } from './unitConvert';
import { dayKeyOf } from './dateUtils';
import { describeWeekRange, entriesForDay, slotLabel, titleForEntry } from './mealPlan';

/**
 * Plain text for RN's `Share.share`, for the three things in this app worth
 * sending to someone else. Deliberately plain text rather than a custom
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
 */
function formatShareIngredientLine(
  ingredient: RecipeIngredient,
  scale: number,
  unitSystem: UnitSystem,
): string {
  const scaled = scaleQuantity(ingredient.quantity, scale).text;
  const quantity = convertQuantity(scaled, unitSystem).text;
  const line = [quantity, ingredient.name].filter(Boolean).join(' ').trim();
  const trailing = [ingredient.prep, ingredient.purpose ? `for ${ingredient.purpose}` : null]
    .filter(Boolean)
    .join(', ');
  return trailing ? `${line}, ${trailing}` : line;
}

/**
 * A recipe as text — name, servings/time, every ingredient (a composed
 * recipe's components included, each under its own heading — see
 * `flattenRecipeIngredients`), the method, and attribution.
 *
 * `scale`/`unitSystem` default to as-written/asWritten so a caller with
 * nothing to say about either still gets a sensible share; pass the screen's
 * own live values to match what's on screen.
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
  options: { scale?: number; unitSystem?: UnitSystem } = {},
): string {
  const scale = options.scale ?? 1;
  const unitSystem = options.unitSystem ?? 'asWritten';
  const lines: string[] = [recipe.name];

  const subtitle: string[] = [];
  const servings = formatServings(recipe);
  if (servings) subtitle.push(`Serves ${servings}`);
  if (recipe.recipeYield) subtitle.push(`Makes ${recipe.recipeYield}`);
  const minutes = totalMinutes(recipe);
  if (minutes) subtitle.push(formatDuration(minutes));
  if (subtitle.length > 0) lines.push(subtitle.join(' · '));

  const flat = flattenRecipeIngredients(recipe, recipesById);
  if (flat.length > 0) {
    lines.push('', 'Ingredients:');
    let headingFor: string | null = null;
    for (const line of flat) {
      if (line.recipe.id !== recipe.id && line.recipe.id !== headingFor) {
        lines.push(`For the ${line.recipe.name}:`);
        headingFor = line.recipe.id;
      }
      lines.push(`- ${formatShareIngredientLine(line.ingredient, scale, unitSystem)}`);
    }
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
 * The shopping list as a checklist someone else can pick up — every item
 * still on the list and not yet ticked, in the order the caller hands them
 * (list order, so it reads like the actual list rather than a re-sort this
 * function would have to justify).
 *
 * Empty string for nothing to share, so a caller can gate the share action
 * on it directly rather than sending a bare "Grocery list" header.
 */
export function buildGroceryListShareText(items: readonly GroceryItem[]): string {
  const onList = items.filter(i => i.onList && !i.checked);
  if (onList.length === 0) return '';
  const lines = onList.map(item => `- ${item.quantity ? `${item.quantity} ` : ''}${item.name}`);
  return ['Grocery list', ...lines].join('\n');
}

/**
 * A week's meal plan as text — "here's what we're eating", one line per
 * planned slot, days with nothing planned omitted rather than padded out
 * with blanks.
 *
 * Empty string for a week with nothing planned at all, same gating
 * convention as `buildGroceryListShareText`.
 */
export function buildWeekPlanShareText(
  days: readonly Date[],
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
): string {
  const lines = [`This week's meals (${describeWeekRange(days)})`];
  for (const day of days) {
    const dayEntries = entriesForDay(entries, dayKeyOf(day));
    if (dayEntries.length === 0) continue;
    lines.push('', format(day, 'EEEE'));
    for (const entry of dayEntries) {
      lines.push(`- ${slotLabel(entry.slot)}: ${titleForEntry(entry, recipesById)}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}
