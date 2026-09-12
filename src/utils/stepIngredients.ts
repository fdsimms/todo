/**
 * The ingredients a step names, said in the step's own sentence (#1695).
 *
 * Cook mode's ingredient panel already knows that the sugar line is 200 g and
 * that the milk line is oat milk because of a standing swap. What it can't do
 * is put either fact where the cook is looking, which mid-step is the sentence
 * itself — so the panel gets opened, read, folded, and opened again two steps
 * later. This annotates the sentence instead: the step renders exactly as the
 * recipe wrote it, with a parenthetical after the ingredient's own word.
 *
 * The whole design is about never being wrong, because the failure mode here is
 * a number beside an ingredient in a method someone is following with their
 * hands full. So it refuses far more often than it guesses, and every refusal
 * below is deliberate:
 *
 * - **It matches the recipe's own vocabulary and nothing else.** A step is
 *   matched against the ingredient lines of the recipe it is *written on*, on
 *   the name the recipe gave the line — `swappedFrom` for a line a standing
 *   swap renamed, since the method was written in the recipe's words rather
 *   than in the swap's. No lexicon and no stemming: nothing outside the
 *   recipe's own list can put a word under an amount.
 * - **A line also answers to a shorter form of its own name**, and only through
 *   two closed tables (`CUTS`, `MODIFIERS`): "slice the chicken" finds "chicken
 *   breasts", "add the pepper" finds "red bell pepper". Without this the
 *   annotation is silent on most of a real method, since a method rarely
 *   repeats a line's full name. The tables are adjectives and cuts rather than
 *   a rule about the first or last word, which is what keeps "soy sauce" from
 *   answering to "sauce" and lending its amount to a pan sauce. **An alias two
 *   lines share is dropped outright** — "olive oil" and "sesame oil" both offer
 *   "oil", so neither gets it — and a line's real name always outranks another
 *   line's alias, so plain "sugar" belongs to the sugar line rather than to the
 *   brown sugar one. The residual is a step using a word the recipe never did:
 *   "season with salt and pepper" in a recipe whose only pepper is a bell one
 *   takes that line's amount, which is wrong and cheap.
 * - **Whole words, longest first.** "brown sugar" wins over "sugar" in a recipe
 *   holding both, and a claimed span is never matched into again, so the
 *   "sugar" line can still annotate a second, standalone mention further along.
 *   Word boundaries are checked by hand rather than through a `RegExp`, because
 *   an ingredient name is user text and can hold any of `.`, `(`, `+` or `*`.
 *   `stepNamesIngredient` is this rule shared with `cookQuestions`' substitute
 *   chip, so one sentence can't be read two ways by two features on one screen.
 * - **One annotation per ingredient per step**, on its first mention. Cook mode
 *   shows one step at a time, so saying it again on the *next* step is not
 *   repetition — the cook cannot see the previous one — but saying it twice in
 *   one sentence is.
 * - **A name used as a verb is refused.** "Butter the dish" is a step about
 *   greasing a tin, not a step calling for 115 g of butter (see `verbUse`).
 * - **An amount the method spends across several steps says "in total".** A
 *   line's amount is what the *recipe* calls for, and pinning it unqualified to
 *   one of the four steps that use it would be a claim nobody made. Naming it
 *   as the total is honest at every one of them, which matters because the cook
 *   only ever sees one of them at a time.
 * - **A name two lines of one recipe share loses its amount.** Which of the two
 *   salts a step means is unanswerable, so the mention keeps only what both
 *   lines agree on.
 * - **An amount the sentence already gives is not repeated.** "Add 200 g sugar
 *   (200 g)" is what a naive version prints; at 2x the same step correctly
 *   reads "Add 200 g sugar (400 g)", which is the case this feature is for.
 *
 * Like everything else in cook mode, this is **display only**. Nothing is
 * written back onto the recipe, and the annotation is the app's own text —
 * tinted at both call sites the way a scaled or converted amount is, the same
 * job the conversion marker does one module over.
 */

import { parseQuantity, rationalToNumber } from './quantity';
import type { FlatIngredient } from './recipeComponents';
import { scaleQuantity } from './recipeScale';
import { convertQuantity, type UnitSystem } from './unitConvert';

/** A step, as the annotator needs it. */
export interface AnnotatableStep {
  id: string;
  text: string;
  /**
   * The recipe the step is written on — the root, or a component at any depth.
   * A step matches only that recipe's own lines: a step written on the mash was
   * written against the mash's ingredient list, and matching it against the
   * whole flattened meal is how "potatoes" in the roast's method would acquire
   * the mash's amount.
   */
  recipeId: string;
}

/** One ingredient line, as the annotator needs it. */
export interface StepIngredientLine {
  recipeId: string;
  /**
   * The recipe's own word for this line: `swappedFrom` where a standing swap
   * renamed it, the line's own name everywhere else. The method was written in
   * the recipe's vocabulary, so that is the only word a step can be matched on.
   */
  name: string;
  /** What the cook is using instead, where a standing swap renamed the line. */
  swappedTo: string | null;
  /**
   * The amount as the ingredient panel shows it — scaled, then converted,
   * already formatted. Empty where the line gives none.
   *
   * A formatted string rather than a raw quantity because the annotation has to
   * agree, character for character, with the panel and the ingredient row: two
   * renderings of one amount on one screen is the drift this shape can't have.
   * `stepIngredientLines` below is the one builder, for the same reason.
   */
  quantity: string;
}

/** One run of a step: its own words, or its own words plus what they're worth. */
export type StepSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ingredient'; text: string; note: string };

/**
 * Shortest name worth matching. Nothing real is one character, and a single
 * letter loose in a sentence matches something in nearly every step.
 */
const MIN_NAME_LENGTH = 2;

/**
 * Words that make the token after them a noun.
 *
 * Read `verbUse` for what this is for: it is the escape hatch on that one
 * refusal, not a general part-of-speech table, so it holds only what actually
 * turns up in front of an ingredient in a method sentence.
 */
const DETERMINERS = new Set([
  'the', 'a', 'an', 'of', 'your', 'some', 'all', 'more', 'remaining',
  'reserved', 'extra', 'other', 'rest', 'both', 'each',
]);

/** What a name is followed by when it's being used as an instruction. */
const VERB_OBJECTS = new Set(['the', 'a', 'an']);

/**
 * Words that describe an ingredient without saying what it is.
 *
 * Dropping these off the front of a name is how "the pepper" finds "red bell
 * pepper" and "the oats" finds "rolled oats" (see `aliasesFor`). It is a closed
 * table of *adjectives* rather than a rule about the last word, and that
 * distinction is the whole safety of it: "soy", "olive" and "chicken" name what
 * the thing is, so "soy sauce" never reduces to "sauce" and a step reducing a
 * pan sauce never picks up the soy line's amount.
 *
 * Left out on purpose, each because the modifier makes it a different
 * ingredient rather than a described one: "sweet" (a sweet potato is not a
 * potato), "hot" (hot sauce is not sauce), "smoked", "toasted", "roasted".
 */
const MODIFIERS = new Set([
  'red', 'green', 'yellow', 'orange', 'purple', 'white', 'black', 'brown',
  'golden', 'large', 'small', 'medium', 'baby', 'bell', 'heavy', 'light',
  'fresh', 'dried', 'frozen', 'canned', 'tinned', 'ground', 'whole', 'rolled',
  'boneless', 'skinless', 'unsalted', 'salted', 'plain', 'ripe', 'raw',
  'organic', 'free-range', 'extra', 'extra-virgin', 'virgin', 'all-purpose',
  'low-fat', 'reduced-fat', 'fat-free', 'nonfat', 'skim',
]);

/**
 * Words naming which part of a thing, which the thing's own name precedes.
 *
 * Dropping these off the *end* is the other half of `aliasesFor`, and the half
 * `MODIFIERS` can't do: "chicken breasts" and "salmon fillets" carry their
 * identity in the first word, not the last, so a step saying "the chicken"
 * needs the trailing cut taken off rather than a leading adjective.
 */
const CUTS = new Set([
  'breast', 'breasts', 'thigh', 'thighs', 'fillet', 'fillets', 'filet',
  'filets', 'steak', 'steaks', 'chop', 'chops', 'cutlet', 'cutlets',
  'tender', 'tenders', 'leg', 'legs', 'wing', 'wings', 'loin', 'shank',
  'shanks', 'drumstick', 'drumsticks',
]);

interface Candidate {
  /** The lower-cased text that gets matched: the line's own name, or an alias of it. */
  key: string;
  /**
   * The line's own name, whatever `key` is.
   *
   * Everything about *which line* a mention belongs to reads this rather than
   * `key`: how many of the method's steps spend it (so a step saying "chicken
   * breasts" and one saying "chicken" are one line used twice, not two lines
   * used once), and the one-mention-per-step rule.
   */
  id: string;
  swappedTo: string | null;
  quantity: string;
}

interface Mention {
  start: number;
  end: number;
  candidate: Candidate;
}

/**
 * The flattened ingredient list, as the annotator reads it.
 *
 * Scale first, then convert — exact multiplication before the rounding
 * conversion, the one order that doesn't compound, and the same pipeline the
 * ingredient panel and the recipe row already run. It is one function rather
 * than a copy on each screen precisely so a step's parenthetical and the row
 * above it can't come to disagree about what the amount is.
 *
 * The swap is already applied: `flattenRecipeIngredients` took the standing
 * rules on the way out, so `swappedFrom` holds the recipe's own word and the
 * line's `name` holds what the cook is actually using. Those are exactly the
 * two halves this needs, in exactly that order.
 */
export function stepIngredientLines(
  flattened: readonly FlatIngredient[],
  scale: number,
  unitSystem: UnitSystem,
): StepIngredientLine[] {
  return flattened.map(entry => ({
    recipeId: entry.recipe.id,
    name: entry.swappedFrom ?? entry.ingredient.name,
    swappedTo: entry.swappedFrom ? entry.ingredient.name : null,
    quantity: convertQuantity(
      scaleQuantity(entry.ingredient.quantity, scale).text,
      unitSystem,
    ).text,
  }));
}

/**
 * Every step's annotated form, keyed by step id.
 *
 * A step with nothing to say about it is absent rather than mapped to a single
 * text segment, so a caller falls back to rendering the plain string and the
 * common case costs no array.
 *
 * Two passes, and the order is forced: what a line's amount *means* depends on
 * whether the method spends it in one step or several, which isn't known until
 * every step has been read. So the mentions are found first, across the whole
 * method, and the notes are written second.
 */
export function annotateSteps(
  steps: readonly AnnotatableStep[],
  lines: readonly StepIngredientLine[],
): Map<string, StepSegment[]> {
  const candidates = candidatesByRecipe(lines);
  const found = steps.map(step => ({
    step,
    mentions: mentionsIn(step.text, candidates.get(step.recipeId) ?? []),
  }));

  const spread = new Map<string, number>();
  for (const { step, mentions } of found) {
    for (const mention of mentions) {
      const key = spreadKey(step.recipeId, mention.candidate.id);
      spread.set(key, (spread.get(key) ?? 0) + 1);
    }
  }

  const out = new Map<string, StepSegment[]>();
  for (const { step, mentions } of found) {
    const noted = mentions
      .map(mention => ({
        mention,
        note: describeMention(
          mention.candidate,
          step.text,
          (spread.get(spreadKey(step.recipeId, mention.candidate.id)) ?? 0) > 1,
        ),
      }))
      // A mention with nothing to say still claimed its span — that is what
      // stops "sugar" annotating the tail of an amount-less "brown sugar" — but
      // it contributes no segment of its own, so it falls back into the plain
      // text either side of it.
      .filter((entry): entry is { mention: Mention; note: string } => entry.note !== null)
      .sort((a, b) => a.mention.start - b.mention.start);
    if (noted.length === 0) continue;
    out.set(step.id, segmentsFor(step.text, noted));
  }
  return out;
}

/**
 * Does this step name this ingredient? The one whole-word rule, shared.
 *
 * `cookQuestions` asks the same question to decide whether to offer a
 * substitute chip, and two answers to it would be two things a step could mean:
 * a chip offering a substitute for something the annotation above it hadn't
 * marked reads as one of the two having misread the sentence.
 */
export function stepNamesIngredient(stepText: string, name: string): boolean {
  const key = name.trim().toLowerCase();
  if (key.length < MIN_NAME_LENGTH) return false;
  return firstWholeWord(stepText.toLowerCase(), key, []) !== null;
}

function spreadKey(recipeId: string, name: string): string {
  return `${recipeId} ${name}`;
}

/**
 * The shorter names a method might call this line by.
 *
 * A recipe writes "2 chicken breasts" and its method says "slice the chicken";
 * it writes "1 red bell pepper" and says "add the pepper". Matching only the
 * line's full name leaves those silent, which is most of a real method. So a
 * name also answers to what's left after dropping trailing cut words and then
 * leading descriptive ones, each off a closed table — see `CUTS` and
 * `MODIFIERS` for why it is those two tables rather than "the last word", which
 * would turn a pan sauce into the soy sauce line.
 *
 * Longest first, and never the whole name (that's the line's own key). The
 * caller drops any alias that collides with another line, which is the guard
 * that matters: "olive oil" and "sesame oil" both offer "oil", so a step saying
 * "the oil" gets nothing from either.
 */
function aliasesFor(name: string): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  let current = words;
  while (current.length > 1 && CUTS.has(current[current.length - 1])) current = current.slice(0, -1);
  const out: string[] = [];
  if (current.length !== words.length) out.push(current.join(' '));
  while (current.length > 1 && MODIFIERS.has(current[0])) {
    current = current.slice(1);
    out.push(current.join(' '));
  }
  return [...new Set(out)].filter(alias => alias !== name && alias.length >= MIN_NAME_LENGTH);
}

/**
 * The names each recipe answers to, longest first so the longest match wins,
 * and the line's own names ahead of any alias whatever their length.
 *
 * The two tiers never compete: a recipe holding both "sugar" and "brown sugar"
 * gives "sugar" to the line actually called that, not to the alias the other
 * one offers. Only after every real name has claimed what it names does an
 * alias get a look at what's left.
 *
 * A name two of one recipe's lines share keeps only what both agree on: the
 * amount goes outright (which of the two salts a step means is unanswerable,
 * and their sum is not what either line says), and the swap survives only where
 * both were rewritten the same way — the ordinary case, since a standing rule
 * is keyed on the catalog item and so reaches both, and the exception is one
 * line carrying `noSwap`. **An alias two lines share is dropped outright**
 * rather than merged: it was inferred rather than written, so there is no
 * reading of it worth keeping once it stops naming one thing.
 */
function candidatesByRecipe(
  lines: readonly StepIngredientLine[],
): Map<string, Candidate[]> {
  const byRecipe = new Map<string, Map<string, Candidate>>();
  const aliasesByRecipe = new Map<string, Map<string, Candidate | null>>();
  for (const line of lines) {
    const key = line.name.trim().toLowerCase();
    if (key.length < MIN_NAME_LENGTH) continue;
    let group = byRecipe.get(line.recipeId);
    if (!group) {
      group = new Map<string, Candidate>();
      byRecipe.set(line.recipeId, group);
    }
    const swapped = line.swappedTo?.trim() ?? '';
    // A swap onto the recipe's own word is nothing to report — it can only come
    // from a catalog row differing from the recipe's line by case or spacing.
    const swappedTo = swapped && swapped.toLowerCase() !== key ? swapped : null;
    const existing = group.get(key);
    const candidate: Candidate = existing === undefined
      ? { key, id: key, swappedTo, quantity: line.quantity.trim() }
      : {
        key,
        id: key,
        swappedTo: existing.swappedTo === swappedTo ? swappedTo : null,
        quantity: '',
      };
    group.set(key, candidate);

    let aliases = aliasesByRecipe.get(line.recipeId);
    if (!aliases) {
      aliases = new Map<string, Candidate | null>();
      aliasesByRecipe.set(line.recipeId, aliases);
    }
    for (const alias of aliasesFor(key)) {
      // Null means "two lines offered this", which is how it stays dropped even
      // if a third line offers it as well.
      aliases.set(alias, aliases.has(alias) ? null : { ...candidate, key: alias });
    }
  }

  return new Map([...byRecipe].map(([recipeId, group]) => {
    const own = [...group.values()].sort((a, b) => b.key.length - a.key.length);
    const aliases = [...(aliasesByRecipe.get(recipeId)?.values() ?? [])]
      // An alias that is some other line's real name belongs to that line, and
      // that line is already in `own` — this is the "brown sugar" case in a
      // recipe that also calls for plain sugar.
      .filter((c): c is Candidate => c !== null && !group.has(c.key))
      // The candidate captured before the duplicate-name merge above could be
      // holding an amount that merge went on to drop, so read it back.
      .map(c => ({ ...c, ...group.get(c.id)!, key: c.key }))
      .sort((a, b) => b.key.length - a.key.length);
    return [recipeId, [...own, ...aliases]];
  }));
}

/**
 * Where this step names each of the recipe's lines, at most once apiece.
 *
 * Once per *line*, not once per name it answers to: a step saying "sear the
 * chicken breasts, then slice the chicken" is one ingredient mentioned twice.
 */
function mentionsIn(text: string, candidates: readonly Candidate[]): Mention[] {
  if (candidates.length === 0) return [];
  const haystack = text.toLowerCase();
  const claimed: Mention[] = [];
  const spoken = new Set<string>();
  for (const candidate of candidates) {
    if (spoken.has(candidate.id)) continue;
    const at = firstWholeWord(haystack, candidate.key, claimed);
    if (at === null) continue;
    spoken.add(candidate.id);
    claimed.push({ start: at, end: at + candidate.key.length, candidate });
  }
  return claimed;
}

/**
 * The first whole-word occurrence of `needle` that no earlier match has claimed
 * and that isn't an instruction, or null.
 *
 * Scanning on rather than stopping at the first rejected hit is what lets
 * "sugar" annotate its own standalone mention in a step that opened with "brown
 * sugar", and what lets a noun mention survive a verb one earlier in the
 * sentence ("Butter the dish, then beat the butter into the eggs").
 */
function firstWholeWord(
  haystack: string,
  needle: string,
  claimed: readonly Mention[],
): number | null {
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return null;
    const end = at + needle.length;
    const free = !claimed.some(m => at < m.end && end > m.start);
    if (free && wholeWord(haystack, at, end) && !verbUse(haystack, at, end)) return at;
    from = at + 1;
  }
  return null;
}

function wholeWord(haystack: string, at: number, end: number): boolean {
  const before = at === 0 ? ' ' : haystack[at - 1];
  const after = end >= haystack.length ? ' ' : haystack[end];
  return !isWordChar(before) && !isWordChar(after);
}

/**
 * Is this name an instruction rather than a thing? "Butter the dish."
 *
 * A method is written in the imperative, and several ingredients are also the
 * verb for what you do with them — butter, oil, salt, flour, water, sugar,
 * cream. A step telling you to grease a tin is not a step calling for 115 g of
 * butter, and an amount printed beside one is the single way this feature looks
 * plainly broken.
 *
 * The tell is the word after: an ingredient noun is essentially never followed
 * straight by "the", "a" or "an", and a verb taking an object nearly always is.
 * The one noun reading of that shape is a trailing time clause — "serve over
 * the rice the next day" — where the name carries its own determiner in front,
 * which is what the second half of this checks. A name with a determiner
 * already on it is a thing whatever follows it.
 */
function verbUse(haystack: string, at: number, end: number): boolean {
  if (!VERB_OBJECTS.has(wordAfter(haystack, end))) return false;
  return !DETERMINERS.has(wordBefore(haystack, at));
}

function wordAfter(haystack: string, from: number): string {
  let at = from;
  while (at < haystack.length && !isWordChar(haystack[at])) at += 1;
  let end = at;
  while (end < haystack.length && isWordChar(haystack[end])) end += 1;
  return haystack.slice(at, end);
}

function wordBefore(haystack: string, from: number): string {
  let end = from;
  while (end > 0 && !isWordChar(haystack[end - 1])) end -= 1;
  let at = end;
  while (at > 0 && isWordChar(haystack[at - 1])) at -= 1;
  return haystack.slice(at, end);
}

function isWordChar(ch: string): boolean {
  return /[a-z0-9]/.test(ch);
}

/**
 * What the parenthetical says, or null when there's nothing worth saying.
 *
 * The swap leads because it changes what you reach for; the amount follows
 * because it is how much of it. "in total" is the whole honesty of the amount
 * half — see the module note.
 */
function describeMention(
  candidate: Candidate,
  stepText: string,
  spread: boolean,
): string | null {
  const parts: string[] = [];
  const { swappedTo, quantity } = candidate;
  // Lower-cased because this lands mid-sentence, where a catalog row's own
  // capital reads as the start of a new one. Same call `describeStandingSwap`
  // makes for the same reason, and the same trade: a genuinely capitalised
  // brand comes out lower-case, which is worth less than every ordinary
  // ingredient reading as part of the step it sits in.
  if (swappedTo && !alreadySaid(stepText, swappedTo)) {
    parts.push(`${swappedTo.toLowerCase()} instead`);
  }
  if (quantity && !saysNothing(quantity) && !alreadySaid(stepText, quantity)) {
    parts.push(spread ? `${quantity} in total` : quantity);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Is this amount worth printing next to the word it belongs to?
 *
 * A bare "1" is the one that isn't. "half the lemon (1)" tells a cook nothing
 * the singular noun didn't, and the spread form — "half the lemon (1 in
 * total)" — is actively worse, because "in total" implies a quantity being
 * divided up and there is no unit for it to be divided into. Every other count
 * says something ("carrots (3)"), and anything carrying a unit or a container
 * always does ("asparagus (1 bunch)").
 */
function saysNothing(quantity: string): boolean {
  const parsed = parseQuantity(quantity);
  if (parsed.amount === null || parsed.rest || parsed.container) return false;
  return rationalToNumber(parsed.amount) === 1;
}

/**
 * Does the sentence already say this?
 *
 * A method that says "add 200 g sugar" has given the amount, and repeating it
 * is a stutter; a method that already says "oat milk" is not owed a note about
 * using oat milk. The marker a conversion carries is dropped first, since the
 * recipe would have written the number without it — and a scaled or converted
 * amount that genuinely differs from the recipe's own simply isn't found here,
 * which is exactly the case worth printing.
 *
 * On a word boundary, not a raw substring, and that isn't a nicety: a bare
 * count is one character, so "3 carrots" went silent in a step that also said
 * "bake at 350F".
 */
function alreadySaid(stepText: string, phrase: string): boolean {
  const said = phrase.replace(/^≈\s*/, '').trim().toLowerCase();
  if (!said) return false;
  const haystack = stepText.toLowerCase();
  let from = 0;
  while (from <= haystack.length - said.length) {
    const at = haystack.indexOf(said, from);
    if (at < 0) return false;
    if (wholeWord(haystack, at, at + said.length)) return true;
    from = at + 1;
  }
  return false;
}

function segmentsFor(
  text: string,
  noted: readonly { mention: Mention; note: string }[],
): StepSegment[] {
  const out: StepSegment[] = [];
  let at = 0;
  for (const { mention, note } of noted) {
    if (mention.start > at) out.push({ kind: 'text', text: text.slice(at, mention.start) });
    out.push({ kind: 'ingredient', text: text.slice(mention.start, mention.end), note });
    at = mention.end;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}
