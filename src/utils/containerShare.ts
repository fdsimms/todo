/**
 * How much of a fridge container was eaten: the shares offered as one-tap
 * buttons, and a typed weight turned into the same kind of answer.
 *
 * Both end as a `{ factor, share }` pair, which is what `logContainer` in
 * `FoodLogEntrySheet` already takes: the fraction of the container's figures,
 * and the words the entry reads ("Half of the container").
 */

export interface ContainerShare {
  /** The fraction of the whole container, above 0 and at most 1. */
  factor: number;
  /** The amount as the entry names it ("Half"). Empty for the whole container. */
  share: string;
  /** What the button shows. */
  label: string;
  /** What a screen reader says. */
  spoken: string;
}

export const CONTAINER_SHARES: readonly ContainerShare[] = [
  { factor: 1 / 4, share: 'A quarter', label: '¼', spoken: 'A quarter' },
  { factor: 1 / 3, share: 'A third', label: '⅓', spoken: 'A third' },
  { factor: 1 / 2, share: 'Half', label: '½', spoken: 'Half' },
  { factor: 2 / 3, share: 'Two-thirds', label: '⅔', spoken: 'Two-thirds' },
  { factor: 3 / 4, share: 'Three-quarters', label: '¾', spoken: 'Three-quarters' },
  { factor: 1, share: '', label: 'All', spoken: 'All of it' },
];

/**
 * A weight typed in grams as a share of a container that weighs `totalGrams`.
 * Null for anything that isn't a positive number or is more than the
 * container holds, so the button stays off rather than logging something else.
 */
export function shareFromGrams(typed: string, totalGrams: number | null): ContainerShare | null {
  if (totalGrams === null || !(totalGrams > 0)) return null;
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:g|grams?)?\s*$/i.exec(typed);
  if (!match) return null;
  const grams = Number(match[1].replace(',', '.'));
  if (!(grams > 0) || grams > totalGrams) return null;
  const rounded = Math.round(grams * 10) / 10;
  return {
    factor: grams / totalGrams,
    share: `${rounded} g`,
    label: `${rounded} g`,
    spoken: `${rounded} grams`,
  };
}
