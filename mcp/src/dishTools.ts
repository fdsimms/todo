/**
 * Dishes: restaurant dishes the person has had and whether they would order
 * them again (`DishRating`, `src/utils/dishRating.ts`).
 *
 * Every write goes through `useDishRatingStore`'s own actions, by way of the
 * replica, so a blank name is refused and a dish is keyed the way the Dishes
 * screen keys it. Adding a dish that is already saved under the same name and
 * place updates that one, as the sheet does, so a retry never makes a second.
 *
 * One rule shapes the words here: **an answer is only ever what the person
 * said.** A dish with no verdict is "no opinion yet", not a middling one, and
 * nothing here picks an answer from how a meal was described. Photos are added
 * in the app, since this server holds no image files.
 */
import type { DishRating, DishVerdict } from '../../src/types';
import type { Replica } from './replica';
import { eventNoonIso } from './taskFields';

export interface DishRow {
  id: string;
  name: string;
  /** The restaurant as typed, or null when none was given. */
  place: string | null;
  /** Null is no opinion yet. */
  verdict: DishVerdict | null;
  note: string | null;
  /** `YYYY-MM-DD`, the last day they had it, or null. */
  lastHad: string | null;
  hasPhoto: boolean;
}

const ONLY_THEIR_WORDS = 'A verdict is only what the person told you: loved (would order again), fine, or avoid (never again). A dish with no verdict has no opinion yet, which is not the same as fine. Do not choose one from how a meal was described. Photos are added in the app.';

function row(replica: Replica, d: DishRating): DishRow {
  return {
    id: d.id,
    name: d.name,
    place: d.place,
    verdict: d.verdict,
    note: d.note,
    lastHad: d.lastHadAt ? replica.logicalDayKeyOf(d.lastHadAt) : null,
    hasPhoto: !!d.photo,
  };
}

/** A bare day or an ISO instant as the noon the sheet would store, or a refusal naming the field. */
function noonOf(value: string, field: string): Date {
  const iso = eventNoonIso(value);
  if (!iso) throw new Error(`${field}: "${value}" is not a date I can read. Use YYYY-MM-DD.`);
  return new Date(iso);
}

export interface DishList {
  dishes: DishRow[];
  note: string;
}

export interface ListDishesInput {
  /** Only dishes with this answer. */
  verdict?: DishVerdict;
  /** Only dishes whose place contains this text, ignoring case. */
  place?: string;
}

export function listDishes(replica: Replica, input: ListDishesInput = {}): DishList {
  const place = input.place?.trim().toLowerCase();
  const dishes = replica.dishes()
    .filter(d => !input.verdict || d.verdict === input.verdict)
    .filter(d => !place || (d.place ?? '').toLowerCase().includes(place))
    .map(d => row(replica, d));
  return { dishes, note: ONLY_THEIR_WORDS };
}

export interface AddDishInput {
  name: string;
  place?: string;
  verdict?: DishVerdict;
  note?: string;
  /** `YYYY-MM-DD`. Defaults to the person's logical today. */
  date?: string;
}

export function addDish(replica: Replica, input: AddDishInput): { dish: DishRow; note: string } {
  const dish = replica.addDish({
    name: input.name,
    place: input.place ?? null,
    verdict: input.verdict ?? null,
    note: input.note ?? null,
    lastHadAt: noonOf(input.date ?? replica.todayKey(), 'date'),
  });
  return { dish: row(replica, dish), note: ONLY_THEIR_WORDS };
}

export interface DishPatchInput {
  name?: string;
  /** Null clears it. */
  place?: string | null;
  /** Null clears the answer back to no opinion. */
  verdict?: DishVerdict | null;
  /** Null clears it. */
  note?: string | null;
  /** `YYYY-MM-DD`. */
  date?: string;
}

export function updateDish(replica: Replica, id: string, patch: DishPatchInput): { dish: DishRow } {
  if (
    patch.name === undefined && patch.place === undefined && patch.verdict === undefined
    && patch.note === undefined && patch.date === undefined
  ) {
    throw new Error('Nothing to change: give a name, place, verdict, note or date.');
  }
  const dish = replica.updateDish(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.place !== undefined ? { place: patch.place } : {}),
    ...(patch.verdict !== undefined ? { verdict: patch.verdict } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.date !== undefined ? { lastHadAt: noonOf(patch.date, 'date') } : {}),
  });
  return { dish: row(replica, dish) };
}

export function deleteDish(replica: Replica, id: string): { removed: DishRow } {
  return { removed: row(replica, replica.deleteDish(id)) };
}
