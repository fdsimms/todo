import { normalizeGtin } from './gtin';

/**
 * The little sticker on loose produce.
 *
 * A PLU is not a barcode. It is four or five digits assigned centrally by the
 * IFPS, it identifies a *kind* of produce rather than a package, and it has no
 * check digit — which is the whole reason this is a separate module rather than
 * a branch in `gtin.ts`. Nothing here can be validated, only recognized.
 *
 * **There is almost no built-in lexicon, and that is deliberate rather than
 * unfinished.** The full IFPS list is about 1,500 codes, and mapping a sticker
 * to the wrong fruit is worse than mapping it to nothing: the user sees a
 * confident name, accepts it, and the pantry quietly holds the wrong thing.
 * Shipping a list transcribed from memory would guarantee some of that, so this
 * ships the one code everybody knows and lets the rest be learned. Importing
 * the real list is a data task, not a code one — see `PLU_SEED`.
 *
 * **What does the work instead is `storeAliases.ts`.** A PLU typed into the
 * scan sheet is a phrase like any other, so naming it once records it, and
 * every later sticker with those digits resolves without asking. That path is
 * live from the first use and needs no list at all.
 */

/** A PLU is 4 or 5 digits. Anything else is a name or a barcode. */
const PLU_PATTERN = /^\d{4,5}$/;

/**
 * The digits as a PLU, or null.
 *
 * Refuses anything that reads as a real barcode first, so a short GTIN can
 * never be mistaken for produce. In practice they don't collide — the shortest
 * GTIN is 8 digits — but the ordering is what makes that a guarantee rather
 * than an observation.
 */
export function normalizePlu(raw: string): string | null {
  const digits = raw.trim();
  if (!PLU_PATTERN.test(digits)) return null;
  if (normalizeGtin(digits)) return null;
  return digits;
}

/**
 * The organic form of a code, split into its conventional code and a flag.
 *
 * **The one rule here that is safe to hardcode.** A five-digit PLU beginning
 * with 9 is the organic version of the four-digit code that follows it: 94011
 * is organic bananas exactly because 4011 is bananas. It is structural rather
 * than a per-item fact, so it holds over codes this app has *learned* as
 * readily as over the seed below, which is most of its value.
 *
 * The 83000/84000 range has been reassigned more than once and carries no such
 * rule, so nothing is inferred from it.
 */
export function splitOrganicPlu(code: string): { base: string; organic: boolean } {
  if (code.length === 5 && code.startsWith('9')) return { base: code.slice(1), organic: true };
  return { base: code, organic: false };
}

/**
 * The codes shipped in the box.
 *
 * Deliberately tiny. Every entry here is a claim this app makes without being
 * told, so the bar is "would be embarrassing to get wrong and isn't", and only
 * one code clears it by memory alone. Growing this from the published IFPS list
 * is a worthwhile change; growing it by recall is not.
 *
 * A name from here is treated as a suggestion and never pre-checked — see
 * `pluNameFor`'s callers — which is the safety net that makes even a wrong
 * entry a visible one.
 */
const PLU_SEED: Record<string, string> = {
  '4011': 'Bananas',
};

/**
 * What a PLU is, as a shopping-list name, or null if nothing here knows.
 *
 * Null is the overwhelmingly common answer and is not a failure: the sheet
 * shows the code and an empty name to type into, which is the same row a
 * barcode nobody has heard of produces. Making those one row is what keeps
 * produce from being a second feature.
 */
export function pluNameFor(code: string): string | null {
  const { base, organic } = splitOrganicPlu(code);
  const name = PLU_SEED[base];
  if (!name) return null;
  return organic ? `Organic ${name.toLowerCase()}` : name;
}
