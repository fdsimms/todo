import type { FoodNutrition, NutrientKey } from '../types';
import { NUTRIENT_LABEL } from './foodNutrition';

/**
 * Reasons a panel's figures look wrong, found from the panel alone.
 *
 * **A prompt, never a refusal.** `PER_100_CEILING` in `nutritionParse.ts` drops a
 * figure that is arithmetically impossible, and that is all it may do: a
 * barcode record is written with nobody looking. This is the other half. It
 * flags what is possible but almost certainly a misprint or a misread ("16 g"
 * of sodium on a bar whose label meant 16 mg), and it runs where a person is
 * already standing at the Save button, so the answer to a flag is theirs. A
 * label really can be wrong, and so can the person's copy of it; either way
 * they can look at the packet and decide.
 *
 * Every rule here uses only the panel's own figures and its serving weight.
 * Nothing is a guess about which foods are unusual: the bounds are chosen so
 * that salt, bouillon and pure oil pass, and a real misprint still doesn't.
 */
export interface PanelWarning {
  /** The figure most likely to be the wrong one, so a form can mark it. */
  key: NutrientKey;
  /** One plain sentence, ready to show. */
  message: string;
}

/** Sodium in pure salt is 39.3% by weight; nothing edible carries more per gram. */
const SALT_SODIUM_MG_PER_G = 393;
/**
 * The densest sodium in a real food: bouillon and seasoning salts sit near
 * 200 mg/g, so 250 flags a decimal slip without flagging them.
 */
const SODIUM_MG_PER_G_CEILING = 250;
/** Fat is the densest macronutrient at 9 kcal/g; the slack covers label rounding. */
const KCAL_PER_G_CEILING = 9.5;
/** Rounding on a label lets a child figure exceed its parent by up to this much. */
const ROUNDING_SLACK_G = 1;
/** Shares of a serving's weight the grams of macros may add up to. */
const MASS_SLACK = 1.1;
/** An energy figure further than this from 4P + 4C + 9F is flagged (fiber and sugar alcohols explain a lot). */
const ENERGY_TOLERANCE = 0.4;
const ENERGY_MIN_GAP_KCAL = 50;

/** What one serving of anything can plausibly hold, for a panel with no weight to measure against. */
const PER_SERVING_CEILING: Partial<Record<NutrientKey, number>> = {
  calorieKcal: 2500,
  fatG: 200,
  carbsG: 300,
  proteinG: 200,
  sodiumMg: 5000,
  cholesterolMg: 1500,
  potassiumMg: 6000,
  caffeineMg: 600,
};

function fmt(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString('en-US');
}

function figure(key: NutrientKey, value: number): string {
  const { label, unit } = NUTRIENT_LABEL[key];
  return unit === 'cal' ? `${fmt(value)} calories` : `${label} ${fmt(value)} ${unit}`;
}

/** The grams that the panel's figures are measured against, or null when unknown. */
function referenceGrams(panel: FoodNutrition): number | null {
  // A drink's 100 ml is not 100 g, but the rules below are bounds on the absurd
  // and a few percent of density does not move them.
  if (panel.basis === 'per100g' || panel.basis === 'per100ml') return 100;
  return panel.servingGrams !== null && panel.servingGrams > 0 ? panel.servingGrams : null;
}

export function panelWarnings(panel: FoodNutrition): PanelWarning[] {
  const found = new Map<NutrientKey, string>();
  const flag = (key: NutrientKey, message: string) => {
    if (!found.has(key)) found.set(key, message);
  };
  const a = panel.amounts;
  const grams = referenceGrams(panel);
  const amountOf = grams === null ? '' : panel.basis === 'perServing' ? `a ${fmt(grams)} g serving` : `100 g`;

  // Sodium first: the case that prompted all this, and the likeliest misprint,
  // since the same number is "16 mg" or "16 g" depending on one letter.
  if (a.sodiumMg !== undefined) {
    if (grams !== null && a.sodiumMg > SALT_SODIUM_MG_PER_G * grams) {
      flag('sodiumMg', `${figure('sodiumMg', a.sodiumMg)} is more sodium than ${amountOf} of pure salt holds.`);
    } else if (grams !== null && a.sodiumMg > SODIUM_MG_PER_G_CEILING * grams) {
      flag('sodiumMg', `${figure('sodiumMg', a.sodiumMg)} is far more sodium than ${amountOf} of almost any food holds.`);
    }
  }

  if (grams !== null) {
    const macroGrams = (a.fatG ?? 0) + (a.carbsG ?? 0) + (a.proteinG ?? 0);
    if (macroGrams > grams * MASS_SLACK) {
      const biggest = (['fatG', 'carbsG', 'proteinG'] as const)
        .filter(k => a[k] !== undefined)
        .sort((x, y) => (a[y] ?? 0) - (a[x] ?? 0))[0];
      flag(biggest, `Fat, carbs and protein add up to ${fmt(macroGrams)} g, more than ${amountOf} weighs.`);
    }
    if (a.calorieKcal !== undefined && a.calorieKcal > KCAL_PER_G_CEILING * grams) {
      flag('calorieKcal', `${figure('calorieKcal', a.calorieKcal)} is more than ${amountOf} can hold.`);
    }
  }

  // A part cannot exceed the whole it is part of.
  const parts: Array<[NutrientKey, NutrientKey]> = [
    ['fiberG', 'carbsG'],
    ['sugarG', 'carbsG'],
    ['addedSugarG', 'sugarG'],
    ['satFatG', 'fatG'],
    ['transFatG', 'fatG'],
  ];
  for (const [part, whole] of parts) {
    const p = a[part];
    const w = a[whole];
    if (p !== undefined && w !== undefined && p > w + ROUNDING_SLACK_G) {
      flag(part, `${figure(part, p)} is more than the ${NUTRIENT_LABEL[whole].label.toLowerCase()} it is part of (${fmt(w)} g).`);
    }
  }

  if (a.calorieKcal !== undefined && a.proteinG !== undefined && a.carbsG !== undefined && a.fatG !== undefined) {
    const expected = 4 * a.proteinG + 4 * a.carbsG + 9 * a.fatG;
    const gap = Math.abs(a.calorieKcal - expected);
    if (gap > ENERGY_MIN_GAP_KCAL && gap > expected * ENERGY_TOLERANCE) {
      flag('calorieKcal', `${figure('calorieKcal', a.calorieKcal)} doesn't match the fat, carbs and protein, which come to about ${fmt(expected)} calories.`);
    }
  }

  // With a serving weight the rules above are tighter; these cover the rest.
  if (panel.basis === 'perServing') {
    for (const [key, ceiling] of Object.entries(PER_SERVING_CEILING) as Array<[NutrientKey, number]>) {
      const value = a[key];
      if (value !== undefined && value > ceiling) {
        flag(key, `${figure(key, value)} is more than one serving of almost any food holds.`);
      }
    }
  }

  return Array.from(found, ([key, message]) => ({ key, message }));
}
