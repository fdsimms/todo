/**
 * Cookware: the pots, pans, lids and tubs a person has weighed empty, so a dish
 * weighed with its pot on can be turned into the food's own weight on the phone
 * (`src/utils/cookware.ts`).
 *
 * Every write goes through `useCookwareStore`'s own actions by way of the
 * replica, so a blank name or a weight that is not one is refused as the sheet
 * refuses it. The list is a convenience for typing a number and nothing else
 * points at it: `update_recipe`'s `cookedWeightG` and a leftover's weight are
 * the food alone, so an agent that is told a dish's weight with the pot on
 * subtracts the saved pot itself, and never writes the gross figure.
 */
import type { Cookware, CookwareType } from '../../src/types';
import { effectiveCookwareType } from '../../src/utils/cookware';
import type { Replica } from './replica';

export interface CookwareRow {
  id: string;
  name: string;
  /** What it weighs empty, in grams. */
  weightG: number;
  /** The type it is listed under on the phone: the chosen one, else read from the name. */
  type: CookwareType;
  /** True when the person chose the type; false when it is read from the name. */
  typeChosen: boolean;
}

const NOT_STORED = 'Cookware only helps work out a dish\'s weight: cookedWeightG on a recipe is the food alone, with the pot already taken off. Nothing remembers which pot a dish was weighed in, so changing or deleting one rewrites no recipe.';

function row(c: Cookware): CookwareRow {
  return { id: c.id, name: c.name, weightG: c.weightG, type: effectiveCookwareType(c), typeChosen: c.kind !== null };
}

export interface CookwareList {
  cookware: CookwareRow[];
  note: string;
}

export function listCookware(replica: Replica): CookwareList {
  return { cookware: replica.cookware().map(row), note: NOT_STORED };
}

export interface AddCookwareInput {
  name: string;
  weightG: number;
  /** Omit to let the phone read the type from the name. */
  type?: CookwareType;
}

export function addCookware(replica: Replica, input: AddCookwareInput): { cookware: CookwareRow; note: string } {
  return { cookware: row(replica.addCookware(input.name, input.weightG, input.type ?? null)), note: NOT_STORED };
}

export interface CookwarePatchInput {
  name?: string;
  weightG?: number;
  /** A type, or null to go back to reading it from the name. */
  type?: CookwareType | null;
}

export function updateCookware(replica: Replica, id: string, patch: CookwarePatchInput): { cookware: CookwareRow } {
  if (patch.name === undefined && patch.weightG === undefined && patch.type === undefined) throw new Error('Nothing to change: give a name, a weightG, a type, or any of them.');
  const { type, ...rest } = patch;
  return { cookware: row(replica.updateCookware(id, type === undefined ? rest : { ...rest, kind: type })) };
}

export function deleteCookware(replica: Replica, id: string): { removed: CookwareRow } {
  return { removed: row(replica.deleteCookware(id)) };
}
