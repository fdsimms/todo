import type { NutrientKey, FoodNutrition } from '../types';
import { NUTRIENT_KEYS } from '../types';

/**
 * A model's estimate of what a described meal contains, and the rules about
 * what may be claimed for it.
 *
 * **Restaurant food is the case no database answers**, so this is the one
 * nutrition source in the app with no source behind it: a model's world
 * knowledge about menus and portions. Everything here exists to keep that
 * honest rather than to make it look authoritative.
 *
 * **The model proposes and a person confirms.** Nothing here writes anything.
 * `docs/arch/health-data.md` licenses nutrient figures on one specific
 * argument, that a dietary figure "exists at all only because a person entered
 * it" — an estimate the app invented and stored unconfirmed breaks exactly
 * that, and eventually writes a fabricated number into a medical record. So
 * this module turns a reply into a proposal and stops. Same call
 * `sharedRecipeLinks` makes about a page waiting for a tap rather than
 * importing itself.
 *
 * **`source: 'estimated'` is permanent**, which is what `FoodNutrition.source`
 * exists for. It rides the entry for its whole life, shows on the row through
 * `describeFoodLogEntry`, and is counted apart from a label and a database
 * read by `sourceMix` on the Stats screen. A day half built from guesses says
 * so wherever it is read.
 *
 * **The claim is stated, never levelled up.** "Five Guys cheeseburger" is a
 * chain publishing real figures and "a burger at the pub" is a guess with a
 * wide range, and rendering those identically would be the overclaim this
 * whole tree is arranged against. `basis` and `confidence` come back from the
 * model and `describeEstimate` says them plainly.
 *
 * **No diagnosis, no advice, ever.** The model returns numbers. It does not
 * say the meal was heavy, propose a lighter dinner, or hold any opinion about
 * it. `describeEstimate` is a pure function precisely so that rule is
 * checkable, the same reason `describeHealthInsight` is one and
 * `moodTasks.test.ts` asserts directly that the nudge never names a feeling.
 *
 * **A whole-meal total is one number to either trust or not; a breakdown is
 * several smaller ones a person actually has a prior for.** `breakdown` exists
 * so "51 cal for baguette and butter" can be checked as "40 for the bread, 11
 * for the butter" instead — the same total, made of pieces somebody can
 * eyeball. It carries no `basis`/`confidence` of its own: the claim being
 * graded is still the meal's, and a per-line confidence would let the
 * breakdown read as independently verified when it is the same estimate
 * split apart.
 */

/** What somebody can type as a description of what they ate. */
export const ESTIMATE_DESCRIPTION_MAX_LENGTH = 200;
/** Longest label, quantity or answer this will carry out of a reply. */
const FIELD_MAX_LENGTH = 80;
/** One or two questions, never an interrogation. */
export const MAX_ESTIMATE_QUESTIONS = 2;
const MAX_QUESTION_OPTIONS = 4;
/** More than this and it stops being a meal, it's a shopping list. */
const MAX_BREAKDOWN_ITEMS = 12;

/**
 * Where the figures come from.
 *
 * `published` means a chain states these numbers; `typical` means the model is
 * reasoning about a dish in general. They are different claims and the copy
 * keeps them apart.
 */
export type EstimateBasis = 'published' | 'typical';

/** How sure the model is, which is its own to state rather than ours to infer. */
export type EstimateConfidence = 'high' | 'medium' | 'low';

/**
 * One thing worth asking before believing the number.
 *
 * Only where the answer moves the figures a lot: the size, whether the fries
 * were a side or a large, whether the dressing was on it. Always skippable,
 * for the reason `docs/arch/template-questions.md` gives about asking before
 * creating: a question nobody can decline is a form, and a form is what people
 * stop filling in.
 */
export interface EstimateQuestion {
  /** The question in the model's own words. */
  prompt: string;
  /** Answers, one tap each. Never the only way forward. */
  options: string[];
}

/**
 * What one line of the description contributed, so the total can be checked
 * against something smaller than itself rather than taken whole.
 *
 * Not a second estimate: there is no `basis`/`confidence` per ingredient,
 * because the claim being made is still the meal's, not this line's alone,
 * and letting each row grade itself would let a breakdown read as more
 * separately-verified than it is.
 */
export interface EstimateIngredient {
  /** The ingredient in the model's own words, e.g. "salted butter". */
  label: string;
  amounts: Partial<Record<NutrientKey, number>>;
}

/** A proposal, not an entry. Nothing is stored until somebody confirms it. */
export interface NutritionEstimate {
  /** What the entry would be called. */
  label: string;
  /** The amount these figures are for, in words, since there is no weight. */
  quantity: string;
  amounts: Partial<Record<NutrientKey, number>>;
  basis: EstimateBasis;
  confidence: EstimateConfidence;
  /** Who publishes them, when the model named a chain. Null otherwise. */
  attribution: string | null;
  questions: EstimateQuestion[];
  /**
   * The total split across what was named, so a total that's hard to eyeball
   * can be checked one line at a time instead. Empty when the description
   * named one thing already, or the model didn't split it — the total stands
   * on its own either way, this is a way to double-check it, not a
   * requirement to render one.
   */
  breakdown: EstimateIngredient[];
}

/** The reply shape, before any of it is believed. */
export interface RawNutritionEstimate {
  label?: unknown;
  quantity?: unknown;
  amounts?: unknown;
  basis?: unknown;
  confidence?: unknown;
  attribution?: unknown;
  questions?: unknown;
  breakdown?: unknown;
}

function text(value: unknown, max = FIELD_MAX_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

/**
 * A stated figure, or absent.
 *
 * **Absent stays absent and never becomes zero**, the rule `FoodNutrition.amounts`
 * states and every reader in this tree keeps. A model that says nothing about
 * fibre has said nothing about fibre, and a zero would be a claim it did not
 * make. A real zero survives, since a food genuinely containing none is a
 * thing to state.
 *
 * Negatives and non-finite values are dropped rather than clamped to zero, for
 * the same reason: a figure that cannot be true is not evidence of a low one.
 */
function amount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 10) / 10;
}

function readQuestions(value: unknown): EstimateQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: EstimateQuestion[] = [];
  for (const raw of value) {
    if (out.length >= MAX_ESTIMATE_QUESTIONS) break;
    const row = raw as { prompt?: unknown; options?: unknown };
    const prompt = text(row?.prompt, FIELD_MAX_LENGTH);
    if (!prompt) continue;
    const options = Array.isArray(row?.options)
      ? row.options
        .map(o => text(o))
        .filter((o): o is string => o !== null)
        .slice(0, MAX_QUESTION_OPTIONS)
      : [];
    // A question with nothing to tap is not a question, it is a prompt to type
    // free text — which is what the description field already is.
    if (options.length < 2) continue;
    out.push({ prompt, options });
  }
  return out;
}

/**
 * Reads the per-ingredient split, or drops it entirely rather than showing a
 * partial one.
 *
 * A row with a label but no figures is dropped (nothing to check against),
 * same as a row with figures the model attached to nothing nameable. Amounts
 * are read through the same `amount()` an absent-stays-absent, no-negative
 * rule the total obeys, so a line can't claim a figure the total itself
 * would have refused.
 */
function readBreakdown(value: unknown): EstimateIngredient[] {
  if (!Array.isArray(value)) return [];
  const out: EstimateIngredient[] = [];
  for (const raw of value) {
    if (out.length >= MAX_BREAKDOWN_ITEMS) break;
    const row = raw as { label?: unknown; amounts?: unknown };
    const label = text(row?.label);
    if (!label) continue;
    const source = row?.amounts;
    if (typeof source !== 'object' || source === null || Array.isArray(source)) continue;
    const amounts: Partial<Record<NutrientKey, number>> = {};
    for (const key of NUTRIENT_KEYS) {
      const value = amount((source as Record<string, unknown>)[key]);
      if (value !== undefined) amounts[key] = value;
    }
    if (Object.keys(amounts).length === 0) continue;
    out.push({ label, amounts });
  }
  return out;
}

/**
 * What a reply actually carries, or null when it carries nothing usable.
 *
 * Refuses rather than repairs. An estimate with no figures at all is not a
 * smaller estimate, and one with no name is a row nobody could identify later.
 * The caller shows a failure, which is the honest outcome for a description
 * the model could not read.
 *
 * `basis` and `confidence` fall back to the weaker reading of each, so a reply
 * that omits them or invents a value is treated as the vaguer claim rather
 * than the stronger one. Getting that backwards is the only way this default
 * could do harm.
 */
export function readNutritionEstimate(raw: RawNutritionEstimate | null | undefined): NutritionEstimate | null {
  if (!raw || typeof raw !== 'object') return null;
  const label = text(raw.label);
  if (!label) return null;

  const source = (raw.amounts ?? {}) as Record<string, unknown>;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const value = amount(source[key]);
    if (value !== undefined) amounts[key] = value;
  }
  if (Object.keys(amounts).length === 0) return null;

  return {
    label,
    quantity: text(raw.quantity) ?? '1 serving',
    amounts,
    basis: raw.basis === 'published' ? 'published' : 'typical',
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
    // Only meaningful for a published claim: naming a chain beside figures the
    // model admits are generic would attribute a guess to somebody.
    attribution: raw.basis === 'published' ? text(raw.attribution) : null,
    questions: readQuestions(raw.questions),
    breakdown: readBreakdown(raw.breakdown),
  };
}

/**
 * What the estimate claims, in one or two flat sentences.
 *
 * Three rules, all inherited from `describeHealthInsight` and none of them
 * decoration:
 *
 * - **A description, never advice.** It says where the figures came from and
 *   how sure the model is. It does not say the meal was heavy, suggest
 *   anything, or comment on the food in any way.
 * - **No number.** The figures are on screen beside this; repeating one here
 *   would read as the sentence making a claim of its own.
 * - **The weaker claim is said out loud.** "A rough guess" is a real answer and
 *   gets stated, because hiding it would leave every estimate reading as
 *   confidently as the ones that happen to be published.
 */
export function describeEstimate(estimate: NutritionEstimate): string {
  const where = estimate.basis === 'published'
    ? estimate.attribution
      ? `Published figures for ${estimate.attribution}.`
      : 'Published figures for this dish.'
    : 'Typical for this dish rather than a specific recipe.';
  const sure = estimate.confidence === 'high'
    ? ''
    : estimate.confidence === 'medium'
      ? ' Close, not exact.'
      : ' A rough guess.';
  return `${where}${sure}`;
}

/**
 * The estimate as a panel an entry can carry.
 *
 * `servingGrams` is deliberately null. A weight for "a cheeseburger and fries"
 * would be one more invented number with nothing to check it against, and the
 * quantity in words is what the person actually confirmed. `scalePanelToAmount`
 * makes the same call about an amount it cannot measure.
 *
 * Returns null for an estimate with nothing in it, which `addEntry` would
 * refuse anyway; failing here means the sheet can say so before the tap.
 */
export function estimateToPanel(estimate: NutritionEstimate, now: Date = new Date()): FoodNutrition | null {
  if (Object.keys(estimate.amounts).length === 0) return null;
  return {
    basis: 'perServing',
    servingGrams: null,
    servingText: estimate.quantity,
    amounts: { ...estimate.amounts },
    // Permanent, and the whole reason this is safe to offer at all.
    source: 'estimated',
    sourceId: null,
    portions: [],
    recordedAt: now.toISOString(),
  };
}

/**
 * The description to re-ask with, once questions have been answered.
 *
 * Re-asking rather than adjusting the figures locally: the model knows what a
 * large changes about a portion and this module does not, and scaling a
 * published figure by a guessed multiplier would turn a real number into an
 * invented one. Unanswered questions are simply left out, which is what makes
 * skipping free.
 */
export function refineDescription(
  description: string,
  answers: readonly { prompt: string; answer: string }[],
): string {
  const base = description.trim().slice(0, ESTIMATE_DESCRIPTION_MAX_LENGTH);
  const stated = answers
    .map(a => ({ prompt: a.prompt.trim(), answer: a.answer.trim() }))
    .filter(a => a.prompt && a.answer)
    .map(a => `${a.prompt} ${a.answer}`);
  return stated.length === 0 ? base : `${base}\n${stated.join('\n')}`;
}
