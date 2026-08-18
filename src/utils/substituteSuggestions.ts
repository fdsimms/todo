import { GROCERY_NAME_MAX_LENGTH } from '../types';
import { groceryNameKey } from './groceryParse';
import { parseQuantity } from './quantity';

/**
 * Validating what the model hands back for "what can I use instead of
 * butter?" (#1578) — the pure half, so the refusals are pinned by a test
 * rather than trusted to the prompt. The network call is `suggestSubstitutes`
 * in `src/services/aiSuggestions.ts`; this is what turns its raw response
 * into rows `SubstituteSheet` can actually offer.
 *
 * A schema description is a request, not a guarantee — same discipline
 * `dedupeMealIdeas` applies to an invented meal title.
 */

/** Five is a glance, not a scroll — the same reasoning DEFAULT_PILL_LIMIT gives. */
export const MAX_SUGGESTED_SUBSTITUTES = 5;

export interface SuggestedSubstitute {
  name: string;
  /** Both set or both null — a ratio typed on only one side isn't a ratio. */
  ratioFrom: string | null;
  ratioTo: string | null;
}

/** The un-validated shape a tool_use response hands back. */
export interface RawSuggestedSubstitute {
  name?: unknown;
  ratio_from?: unknown;
  ratio_to?: unknown;
}

// A joiner the model reaches for when it wants to name two ingredients at
// once ("milk + lemon juice", "flour and butter"). Checked against the raw
// text, not the groceryNameKey — that key strips "+", "&" and "/" outright,
// which would erase the very evidence this is looking for.
const JOINERS = [' and ', ' + ', '/', ',', '&', ' with '];

function namesOneIngredient(name: string): boolean {
  const padded = ` ${name.toLowerCase()} `;
  return !JOINERS.some(joiner => padded.includes(joiner));
}

/**
 * Both halves have to parse as a quantity, or the ratio is dropped —
 * `substituteQuantity`'s own refusal, applied one step earlier. A named
 * substitute with an unusable ratio is still useful, so only the ratio goes;
 * see #1573's "keep the name, drop the ratio."
 */
function validRatio(ratioFrom: string, ratioTo: string): boolean {
  return parseQuantity(ratioFrom).amount !== null && parseQuantity(ratioTo).amount !== null;
}

/**
 * Cleans a model response into offerable rows: drops blanks, drops anything
 * naming more than one ingredient, caps the count, and dedupes
 * case-insensitively — against each other and against `excludedNames` (the
 * item itself, plus whatever it's already linked to, so the model can't
 * suggest a swap that's already recorded).
 */
export function dedupeSuggestedSubstitutes(
  raw: readonly RawSuggestedSubstitute[] | undefined,
  excludedNames: readonly string[] = []
): SuggestedSubstitute[] {
  if (!raw) return [];
  const seen = new Set(
    excludedNames.map(n => groceryNameKey(n) || n.trim().toLowerCase()).filter(Boolean)
  );
  const out: SuggestedSubstitute[] = [];
  for (const item of raw) {
    const name = typeof item?.name === 'string'
      ? item.name.trim().slice(0, GROCERY_NAME_MAX_LENGTH)
      : '';
    if (!name || !namesOneIngredient(name)) continue;
    const key = groceryNameKey(name) || name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const ratioFromRaw = typeof item?.ratio_from === 'string' ? item.ratio_from.trim() : '';
    const ratioToRaw = typeof item?.ratio_to === 'string' ? item.ratio_to.trim() : '';
    const hasRatio = !!ratioFromRaw && !!ratioToRaw && validRatio(ratioFromRaw, ratioToRaw);

    out.push({
      name,
      ratioFrom: hasRatio ? ratioFromRaw.slice(0, GROCERY_NAME_MAX_LENGTH) : null,
      ratioTo: hasRatio ? ratioToRaw.slice(0, GROCERY_NAME_MAX_LENGTH) : null,
    });
    if (out.length === MAX_SUGGESTED_SUBSTITUTES) break;
  }
  return out;
}
