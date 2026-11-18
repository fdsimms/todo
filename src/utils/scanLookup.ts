import type { FoodNutrition } from '../types';

/**
 * What a "Look up barcode" row says about the product's nutrition: the
 * headline figures and what they are measured against, on one line.
 *
 * **Only figures the source stated are named.** An absent key in
 * `FoodNutrition.amounts` is unknown, never zero, so a product with calories
 * and protein but no stated carbs reads "140 cal · 12 g protein" and says
 * nothing about carbs. A real 0 survives, since a food can state that it has
 * no fat. Nothing is converted between bases (a per-100g record is not turned
 * into a per-serving one), because that needs a serving weight the source may
 * not have given: the line says what the figures are against, as the source did.
 *
 * Returns null when no headline figure was stated, so the caller can say the
 * product has no nutrition facts instead of printing a bare basis.
 */
export function describeScanPanel(panel: FoodNutrition | null | undefined): string | null {
  if (!panel) return null;
  const { calorieKcal, proteinG, carbsG, fatG } = panel.amounts;
  const figures: string[] = [];
  if (calorieKcal !== undefined) figures.push(`${Math.round(calorieKcal)} cal`);
  if (proteinG !== undefined) figures.push(`${roundGrams(proteinG)} g protein`);
  if (carbsG !== undefined) figures.push(`${roundGrams(carbsG)} g carbs`);
  if (fatG !== undefined) figures.push(`${roundGrams(fatG)} g fat`);
  if (figures.length === 0) return null;
  return `${figures.join(' · ')} ${basisPhrase(panel)}`;
}

/** Whole grams from 10 up, one decimal below that, so 0.5 g doesn't read as 1. */
function roundGrams(grams: number): string {
  if (grams >= 10) return String(Math.round(grams));
  return String(Math.round(grams * 10) / 10);
}

function basisPhrase(panel: FoodNutrition): string {
  if (panel.basis === 'per100g') return 'per 100 g';
  if (panel.basis === 'per100ml') return 'per 100 ml';
  const serving = panel.servingText?.trim();
  return serving ? `per serving (${serving})` : 'per serving';
}
