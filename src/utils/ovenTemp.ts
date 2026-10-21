// An oven temperature on a recipe, and how it reads. Pure: the stored number and
// unit go in, text comes out. Nothing here knows about the recipe store.

import type { Recipe } from '../types';
import { cookedDishes, type ChoiceResolution } from './recipeComponents';
import type { UnitSystem } from './unitConvert';

export type OvenTempUnit = 'F' | 'C';

export const OVEN_TEMP_UNITS: OvenTempUnit[] = ['F', 'C'];

/** Bounds a home oven can be set to, per unit, so a mistyped extra digit is refused rather than stored. */
export const OVEN_TEMP_RANGE: Record<OvenTempUnit, { min: number; max: number }> = {
  F: { min: 150, max: 600 },
  C: { min: 70, max: 320 },
};

/** The figure to store, or null when it isn't a plausible oven setting. */
export function cleanOvenTemp(value: unknown, unit: OvenTempUnit): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const { min, max } = OVEN_TEMP_RANGE[unit];
  return rounded >= min && rounded <= max ? rounded : null;
}

/** "350°F". */
export function formatOvenTemp(degrees: number, unit: OvenTempUnit): string {
  return `${degrees}°${unit}`;
}

/**
 * Reads "350", "350F", "350°F", "180 C" or "180 degrees C". A figure with no unit
 * takes `fallbackUnit`. Null when no number is found or it is outside what an oven
 * does, which is how a stray "20" (minutes) stays out.
 */
export function parseOvenTemp(
  text: string,
  fallbackUnit: OvenTempUnit = 'F',
): { degrees: number; unit: OvenTempUnit } | null {
  const match = /^\s*(\d{2,3})(?:\.\d+)?\s*(?:°|º|degrees?)?\s*([fFcC])?\b/.exec(text);
  if (!match) return null;
  const unit: OvenTempUnit = match[2] ? (match[2].toUpperCase() as OvenTempUnit) : fallbackUnit;
  const degrees = cleanOvenTemp(Number(match[1]), unit);
  return degrees === null ? null : { degrees, unit };
}

// A cook sets an oven to 350 or 400 and a fan oven to 180 or 200, never 176 or
// 204, so a conversion lands on the dial's own steps rather than the exact figure.
const F_STEP = 25;
const C_STEP = 10;

/**
 * The temperature as the reader's unit system wants it. `asWritten` keeps the
 * recipe's own unit; `metric` and `us` convert when it differs, rounded to the
 * steps above. Null when the recipe has no oven temperature.
 */
export function ovenTempFor(
  recipe: Pick<Recipe, 'ovenTemp' | 'ovenTempUnit'>,
  system: UnitSystem,
): { degrees: number; unit: OvenTempUnit; converted: boolean } | null {
  if (recipe.ovenTemp == null) return null;
  const written = recipe.ovenTempUnit;
  const wanted: OvenTempUnit = system === 'metric' ? 'C' : system === 'us' ? 'F' : written;
  if (wanted === written) return { degrees: recipe.ovenTemp, unit: written, converted: false };
  const degrees = wanted === 'C'
    ? Math.round(((recipe.ovenTemp - 32) * 5 / 9) / C_STEP) * C_STEP
    : Math.round((recipe.ovenTemp * 9 / 5 + 32) / F_STEP) * F_STEP;
  return { degrees, unit: wanted, converted: true };
}

/** What mise en place's pill reads, "350°F". */
export function describeOvenTemp(
  recipe: Pick<Recipe, 'ovenTemp' | 'ovenTempUnit'>,
  system: UnitSystem,
): string | null {
  const temp = ovenTempFor(recipe, system);
  return temp ? formatOvenTemp(temp.degrees, temp.unit) : null;
}

export interface OvenSetup {
  /** The dish's own id, which is what a ticked line is keyed on. */
  recipeId: string;
  /** The dish it belongs to, so a component's temperature isn't read as the whole recipe's. */
  recipeName: string;
  /** False for a component cooked as part of the recipe being opened. */
  whole: boolean;
  /** "350°F", in the reader's unit system. */
  text: string;
  /** True when the figure was converted from the unit the recipe was written in. */
  converted: boolean;
  /** The figure as the recipe wrote it, shown beside a converted one. */
  written: string;
}

/**
 * The oven settings a cooking of `recipe` calls for, root dish first. Walks the
 * same `cookedDishes` the method and the ingredients do, so a component on the
 * road not taken contributes none, and each recipe is read once. A dish with no
 * temperature contributes nothing.
 */
export function ovenSetupsFor(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  system: UnitSystem,
  resolution?: ChoiceResolution,
): OvenSetup[] {
  const out: OvenSetup[] = [];
  for (const dish of cookedDishes(recipe, recipesById, resolution)) {
    const temp = ovenTempFor(dish.recipe, system);
    if (!temp) continue;
    out.push({
      recipeId: dish.recipe.id,
      recipeName: dish.recipe.name,
      whole: dish.whole,
      text: formatOvenTemp(temp.degrees, temp.unit),
      converted: temp.converted,
      written: formatOvenTemp(dish.recipe.ovenTemp as number, dish.recipe.ovenTempUnit),
    });
  }
  return out;
}
