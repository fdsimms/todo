import type { FoodCooking, FoodNutrition } from '../types';

/**
 * A food that is weighed in two states: raw on the scale before cooking, cooked
 * on the plate after. Rice triples in weight and chicken loses a quarter, so a
 * panel written for one state is wrong by that factor when a weight in the
 * other is typed against it.
 *
 * **The panel is stored once, in the state its source stated, and one ratio
 * relates the two weights.** Nothing here knows what rice or pasta does: there
 * is no table of cooking yields, for the reason `FoodPortion` gives against a
 * global density table (a yield differs by variety, method and how long it sat
 * in the water). The ratio is typed or measured by the person, and a food
 * without one offers no raw/cooked amounts at all.
 *
 * **A raw or cooked amount typed against a food that has no ratio is refused,
 * never read as plain grams.** "100 g cooked" otherwise parses as 100 g with a
 * trailing word and logs the wrong state without a sign of it, which is the
 * mistake this whole file exists to prevent.
 */

const G_PER_OZ = 28.349523125;
const G_PER_LB = 453.59237;

const COOKED_WORDS = ['cooked'];
const RAW_WORDS = ['raw', 'dry', 'uncooked'];

/** The ratio's accepted range: wide enough for pasta (about 2.2) and meat (about 0.7), narrow enough to catch a typo. */
export const MIN_COOKED_PER_RAW = 0.1;
export const MAX_COOKED_PER_RAW = 20;

/** A stored `cooking` value, or null when it can't be read whole. */
export function readCooking(value: unknown): FoodCooking | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const state = raw.panelState === 'raw' || raw.panelState === 'cooked' ? raw.panelState : null;
  const ratio = raw.cookedPerRaw;
  if (state === null || typeof ratio !== 'number' || !Number.isFinite(ratio)) return null;
  if (ratio < MIN_COOKED_PER_RAW || ratio > MAX_COOKED_PER_RAW) return null;
  return { panelState: state, cookedPerRaw: ratio };
}

/** The `cooking` field of a record when it has a readable one, else nothing, so an absent field adds no key. */
export function readCookingField(value: unknown): { cooking: FoodCooking } | Record<string, never> {
  const cooking = readCooking(value);
  return cooking ? { cooking } : {};
}

/** The state a panel's figures do not describe: the one a second unit pill offers. */
export function otherState(panelState: FoodCooking['panelState']): 'raw' | 'cooked' {
  return panelState === 'raw' ? 'cooked' : 'raw';
}

/** The unit pill's text for the state the panel is not in: "g cooked" over a raw panel. */
export function stateUnitLabel(cooking: FoodCooking): string {
  return `g ${otherState(cooking.panelState)}`;
}

/** Whether a panel can take a raw or cooked amount at all: it needs a ratio and a weight to scale by. */
export function takesStateAmount(panel: FoodNutrition): boolean {
  if (!panel.cooking) return false;
  return panel.basis === 'per100g' || (panel.basis === 'perServing' && panel.servingGrams !== null);
}

/**
 * Cooked grams per raw gram from one weighed batch (what went in, what came
 * out), or null for a weight that isn't a positive number or a ratio outside
 * the accepted range. A measured ratio is the better one: it is this pot, this
 * pan and this much water.
 */
export function ratioFromBatch(rawGrams: number, cookedGrams: number): number | null {
  if (!(rawGrams > 0) || !(cookedGrams > 0)) return null;
  const ratio = cookedGrams / rawGrams;
  return ratio >= MIN_COOKED_PER_RAW && ratio <= MAX_COOKED_PER_RAW ? Math.round(ratio * 100) / 100 : null;
}

/** An amount of the form "100 g raw", read apart, or null for anything else. */
export interface StatedAmount {
  grams: number;
  state: 'raw' | 'cooked';
}

const STATED = new RegExp(
  `^(\\d+(?:[.,]\\d+)?)\\s*(g|grams?|oz|ounces?|lbs?|pounds?)?\\s*(${[...RAW_WORDS, ...COOKED_WORDS].join('|')})$`,
  'i',
);

/** "100 g raw", "3.5 oz dry", "250 cooked" (grams when no unit is given), or null when the text isn't one. */
export function parseStatedAmount(quantity: string): StatedAmount | null {
  const match = STATED.exec(quantity.trim());
  if (!match) return null;
  const number = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) return null;
  const unit = (match[2] ?? 'g').toLowerCase();
  const grams = unit.startsWith('oz') || unit.startsWith('ounce')
    ? number * G_PER_OZ
    : unit.startsWith('lb') || unit.startsWith('pound')
      ? number * G_PER_LB
      : number;
  const state = COOKED_WORDS.includes(match[3].toLowerCase()) ? 'cooked' : 'raw';
  return { grams, state };
}

/**
 * What a raw or cooked amount comes to as grams of the panel's own state, or
 * a refusal.
 *
 * `null` means the text isn't a raw/cooked amount at all, so the caller reads
 * it as it always has. `'refused'` means it is one and this food can't answer
 * it (no ratio, or no weight to scale by), which the caller must not read as
 * plain grams. Otherwise `grams` is what is on the plate in the unit the
 * panel's figures are written in.
 */
export function panelGramsFor(panel: FoodNutrition, quantity: string): { grams: number } | 'refused' | null {
  const stated = parseStatedAmount(quantity);
  if (!stated) return null;
  if (!takesStateAmount(panel) || !panel.cooking) return 'refused';
  const { panelState, cookedPerRaw } = panel.cooking;
  if (stated.state === panelState) return { grams: stated.grams };
  return { grams: panelState === 'raw' ? stated.grams / cookedPerRaw : stated.grams * cookedPerRaw };
}

/** The hint's sentence about the extra unit, empty for a food that doesn't take one. */
export function stateAmountHint(panel: FoodNutrition): string {
  if (!takesStateAmount(panel) || !panel.cooking) return '';
  const other = otherState(panel.cooking.panelState);
  return `A weight as ${other}, like 100 g ${other}, is converted using this food’s ratio.`;
}
