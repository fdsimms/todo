import type { RecognizedLine } from 'todo-vision-bridge';
import type { FoodNutrition, NutrientKey } from '../types';
import { groupRecognizedRows } from './receiptOcr';
import {
  NUTRIENT_STORED_UNIT,
  SALT_TO_SODIUM,
  convertNutrientAmount,
  readSourceUnit,
  type NutrientSourceUnit,
} from './nutritionParse';

/**
 * Reading a printed nutrition facts panel off a photograph.
 *
 * **This is the gap the barcode path measurably leaves.** `productLookup.ts`
 * asks three databases what a scanned code is, and for a real share of what
 * people eat none of them answers with a panel: store brands, anything from a
 * bakery or a deli counter, imported packets, and every product whose Open Food
 * Facts row was created by somebody scanning it and typing only the name. The
 * packet is right there in the person's hand with the figures printed on it,
 * and until now the only way to get them in was to type all ten by hand.
 *
 * **It fills a form; it does not write a record.** Everything here produces is
 * proposed text in `NutritionPanelSheet`'s existing fields, which the person
 * reads against the packet and commits with the Save that was already there.
 * That is the whole safety argument, and it is why this may be a best-effort
 * reading where `nutritionParse.ts` may not: a figure this gets wrong is a
 * figure sitting on screen next to the packet it was copied from, where a
 * figure `readOffNutrition` gets wrong is one nobody ever sees before it
 * reaches a Health record. `docs/arch/health-data.md` draws that line between a
 * read and a write; this is on the read side of it because a person stands
 * between it and the write.
 *
 * **The unit arithmetic is still not done here.** `convertNutrientAmount` and
 * the two constants beside it come from `nutritionParse.ts`, which is the one
 * tested place that knows a millilitre from a milligram and what the labelling
 * regulations say salt is. A second opinion about units living in a second file
 * is exactly how the sodium figure ends up a thousand times too high in one
 * path and not the other.
 *
 * **The row geometry is not done here either.** `groupRecognizedRows` is
 * `receiptOcr.ts`'s, unchanged and reused rather than copied: Vision returns
 * text runs and not printed lines, so "Total Fat" and "3.2g" arrive as two
 * observations that merely sit at the same height, and reassembling them from
 * their vertical extents is the identical problem on a receipt and on a label.
 * It lives there because that is where it was written and tested first; the
 * name is about recognized rows rather than about receipts.
 *
 * Nothing here touches the network or the database, and nothing reaches outside
 * SQLite, so there is no demo-mode gate to add — same reasoning `receiptOcr.ts`
 * gives at length. The photo is one the user just framed and the reading is
 * discarded when the sheet closes.
 */

/** What one printed row was found to say. */
interface LabelRow {
  /** The nutrient it names, or `'salt'`, which has no key of its own. */
  target: NutrientKey | 'salt';
  /** Every figure printed on the row, left to right. */
  values: readonly LabelValue[];
}

interface LabelValue {
  amount: number;
  /** The unit printed beside the figure, or undefined when it printed none. */
  unit: NutrientSourceUnit | undefined;
}

/**
 * One value column of a panel — one portion, and what the label says is in it.
 *
 * A US panel prints one of these. A European panel usually prints two, per 100g
 * and per serving, and which of them a person wants is not something a
 * photograph can answer: the figures differ by whatever the serving weighs and
 * nothing about either set says which is which. So both are read and the sheet
 * asks, rather than one being chosen and the choice reported.
 */
export interface LabelColumn {
  /**
   * The basis this column's own heading stated, or null when it had none.
   *
   * Still a proposal rather than an answer even here, since the heading is
   * printed text like everything else. It reaches the sheet's basis control for
   * the person to correct. See `FoodNutrition.basis`.
   */
  basis: FoodNutrition['basis'] | null;
  /** The figures in this column, in this app's own stored units. Absent stays absent. */
  amounts: Partial<Record<NutrientKey, number>>;
}

export interface LabelReading {
  /** The serving as printed, for `FoodNutrition.servingText`. */
  servingText: string | null;
  /** A gram weight the serving line stated in parentheses. */
  servingGrams: number | null;
  /**
   * The panel's value columns, left to right, never empty.
   *
   * More than one and the sheet puts them to the person, because taking the
   * wrong column is wrong by whatever a serving happens to weigh with nothing
   * about the number itself to say so — the one misreading here that a person
   * cannot catch by looking at the figure alone, and can catch instantly by
   * being told which column it came from.
   */
  columns: LabelColumn[];
}

/**
 * Rows below this and the read is not a nutrition panel — a photo of the
 * ingredients list, the back of the wrong packet, a picture of something else.
 *
 * Deliberately low. The US minimum panel is calories, fat, saturated fat,
 * carbohydrate, fibre, sugar, protein and sodium, so a panel photographed
 * whole clears this several times over; what it excludes is the read that
 * found one number and would fill one field from a photo of nothing.
 */
const MIN_LABEL_ROWS = 3;

/**
 * Rows that name a real nutrient this app has no key for, or no nutrient at
 * all, and which are therefore dropped whole.
 *
 * **This runs before the matching below and that ordering is the point.** Every
 * one of these contains a word the matcher would otherwise take: "Trans Fat" and
 * "Polyunsaturated Fat" both end in fat, "Includes 2g Added Sugars" ends in
 * sugars, and the old US "Calories from Fat 30" line contains both. Matched
 * loosely they do not merely get ignored, they overwrite a figure that was
 * right — the total fat row read as 0g because the trans fat row below it was
 * the last one to match.
 *
 * The vitamin and mineral rows are here rather than unmatched because a future
 * micronutrient panel is the obvious next widening of `NutrientKey`, and a rule
 * that quietly starts matching them would be a surprise rather than a feature.
 */
const IGNORED_ROW: readonly RegExp[] = [
  /\btrans\b/,
  /\badded\s*sugars?\b/,
  /\bincludes\b/,
  /\bcholesterol\b/,
  /\bmono-?\s*unsaturated\b/,
  /\bpoly-?\s*unsaturated\b/,
  /\bsugar\s*alcohols?\b/,
  /\bcalories\s*from\b/,
  /\bvitamin\b/,
  /\bcalcium\b/,
  /\biron\b/,
  /\bpotassium\b/,
  /\bdaily\s*values?\b/,
  /\bservings?\s*per\s*(container|pack)/,
];

/**
 * Which nutrient a row's wording names, tried in order.
 *
 * **Most specific first, because the words nest.** "Saturated Fat" and "of
 * which saturates" have to be claimed before anything looks for fat, and
 * "Total Sugars" before anything looks for carbohydrate — a panel prints the
 * breakdown indented under its total, so both wordings appear and the general
 * one would swallow the specific.
 *
 * Both vocabularies are here in one list rather than split by region, since a
 * photograph does not say which country the packet is from and the words do not
 * collide: nothing calls fibre "fiber" and something else "fibre" on the same
 * panel. `salt` is matched to its own target rather than to `sodiumMg` because
 * the two are different figures and the conversion between them is a regulated
 * factor rather than an equality.
 */
const ROW_TARGETS: readonly { target: NutrientKey | 'salt'; pattern: RegExp }[] = [
  { target: 'satFatG', pattern: /\bsaturat/ },
  { target: 'fiberG', pattern: /\bfib(er|re)\b/ },
  { target: 'sugarG', pattern: /\bsugars?\b/ },
  { target: 'carbsG', pattern: /\bcarb/ },
  { target: 'proteinG', pattern: /\bprotein\b/ },
  { target: 'sodiumMg', pattern: /\bsodium\b/ },
  { target: 'salt', pattern: /\bsalt\b/ },
  { target: 'fatG', pattern: /\bfat\b/ },
  { target: 'calorieKcal', pattern: /\b(calories?|energy)\b/ },
  { target: 'caffeineMg', pattern: /\bcaffeine\b/ },
  { target: 'waterMl', pattern: /\bwater\b/ },
];

/**
 * A printed figure and the unit beside it: `265`, `3.2g`, `490 mg`, `1105kJ`.
 *
 * The leading `<` is what a label prints for a figure below its own reporting
 * threshold ("<0.5g"), and taking the stated bound is what the packet means by
 * it. A trailing `*` or footnote dagger is dropped with the rest of the
 * punctuation before this ever runs.
 *
 * **A percentage is refused outright, and that is not a detail.** Every US
 * panel prints a % Daily Value against each nutrient, so "Total Fat 6g 8%"
 * is the ordinary row rather than an unusual one. Read as a figure it would
 * make every such panel report two value columns and warn the person about a
 * second column that is not a portion at all — and on a row whose own figure
 * came through unlabelled it could be taken as the figure. The `%` is left in
 * by `normalizeRow` for exactly this lookahead to find.
 */
const PRINTED_VALUE = /(?:^|\s|<)(\d+(?:[.,]\d+)?)\s*(kcal|kj|mg|mcg|µg|ug|ml|g|l)?\b(?!\s*%)/gi;

/** A gram weight in parentheses on the serving line: "2 cookies (30g)". */
const PAREN_GRAMS = /\((\d+(?:[.,]\d+)?)\s*g\)/i;

/** How the serving line names itself, either vocabulary. */
const SERVING_ROW = /\b(serving\s*size|portion\s*size)\b/;

/**
 * The column headings that settle `basis`, as one scanner rather than three
 * tests, because their *order along the row* is what maps them onto columns.
 *
 * `per 100 ml` is alternated ahead of `per 100 g` so the longer wording wins
 * where both could start matching at the same place.
 */
const BASIS_PHRASE = /per\s*100\s*ml|per\s*100\s*g|per\s*serving/g;

function basisOfPhrase(phrase: string): FoodNutrition['basis'] {
  if (/ml/.test(phrase)) return 'per100ml';
  if (/100/.test(phrase)) return 'per100g';
  return 'perServing';
}

/**
 * A printed row, lower-cased and stripped of the punctuation a panel sets
 * around its words, so one pattern matches "Total Fat:" and "TOTAL FAT".
 *
 * The decimal separators inside figures survive, since the value reader runs
 * against this same text.
 */
function normalizeRow(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.,<%\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Every figure printed on a row, left to right. */
function readValues(text: string): LabelValue[] {
  const values: LabelValue[] = [];
  PRINTED_VALUE.lastIndex = 0;
  let match = PRINTED_VALUE.exec(text);
  while (match !== null) {
    const amount = Number(match[1].replace(',', '.'));
    if (Number.isFinite(amount)) {
      values.push({ amount, unit: match[2] ? readSourceUnit(match[2].replace('µg', 'ug')) : undefined });
    }
    match = PRINTED_VALUE.exec(text);
  }
  return values;
}

/**
 * Which nutrient a row is about, or null when it is about none.
 *
 * A row with no figure on it is refused here rather than later: a panel's
 * headings ("Nutrition Facts", "Amount per serving") name nutrients often
 * enough to matter, and one carrying no number is a heading rather than a
 * reading whatever it says.
 */
function readRow(text: string): LabelRow | null {
  if (IGNORED_ROW.some(pattern => pattern.test(text))) return null;
  const hit = ROW_TARGETS.find(({ pattern }) => pattern.test(text));
  if (!hit) return null;
  const values = readValues(text);
  return values.length > 0 ? { target: hit.target, values } : null;
}

/**
 * How many value columns the panel prints, from the rows that carried figures.
 *
 * **The modal count rather than the maximum**, because a maximum is set by
 * whichever row picked up a stray number — a footnote marker read as a digit,
 * the "%" column on a US panel, the `(30g)` on a serving line. The shape of a
 * panel is what most of its rows agree on.
 *
 * The energy row is excluded from the vote outright: it alone routinely prints
 * two figures per column, in kJ and kcal, so counting it would report a
 * one-column European panel as two-column and warn about a problem it does not
 * have.
 *
 * A tie goes to the smaller count, which is the cheaper way to be wrong. Too
 * few columns costs the person the choice of a column they can still reach by
 * editing the fields; too many puts a column of figures in front of them that
 * the packet does not print.
 */
function countColumns(rows: readonly LabelRow[]): number {
  const votes = new Map<number, number>();
  for (const row of rows) {
    if (row.target === 'calorieKcal') continue;
    votes.set(row.values.length, (votes.get(row.values.length) ?? 0) + 1);
  }
  let best = 1;
  let bestVotes = 0;
  for (const [count, seen] of votes) {
    if (seen > bestVotes || (seen === bestVotes && count < best)) {
      best = count;
      bestVotes = seen;
    }
  }
  return best;
}

/**
 * A row's figure for one column, in the unit it was printed in, or null when
 * the row does not speak for that column.
 *
 * **The row's figures are split into equal groups, one per column.** That is
 * the only division a printed panel actually supports: the columns are set at
 * fixed positions and every row that speaks for all of them prints the same
 * number of figures. A row whose figure count is not a multiple of the column
 * count did not print a full set, and it fills the first column alone rather
 * than having one of its figures copied across the rest — a figure repeated
 * into a column it was not printed in is exactly the wrong-portion error this
 * whole shape exists to avoid.
 *
 * **Energy is why the group can hold more than one figure.** A European panel
 * states it twice per column, in kJ and then kcal, so a two-column panel's
 * energy row prints four figures for two portions. Within a group the kcal one
 * is taken when it is labelled — not because converting the kJ would be wrong,
 * which it would not, but because the packet's own kcal figure is what the
 * packet claims and a converted one differs from it by the rounding. The last
 * of the group is the fallback, kcal being printed second by convention.
 */
function valueForColumn(row: LabelRow, index: number, count: number): LabelValue | null {
  const { values } = row;
  if (count <= 0 || values.length === 0 || values.length % count !== 0) {
    return index === 0 ? values[0] ?? null : null;
  }
  const size = values.length / count;
  const group = values.slice(index * size, (index + 1) * size);
  if (group.length === 0) return null;
  if (row.target === 'calorieKcal') {
    return group.find(value => value.unit === 'kcal') ?? group[group.length - 1];
  }
  return group[0];
}

/**
 * A row's chosen figure in this app's stored unit, or null when it cannot be
 * converted.
 *
 * **A figure with no printed unit is read in the nutrient's own unit**, which
 * is a reading of the convention rather than a guess: a panel that prints
 * "Protein 9" prints grams, and one that prints "Sodium 490" prints
 * milligrams, because those are the units the labelling rules require for
 * those nutrients and are exactly what `NUTRIENT_STORED_UNIT` records. Where
 * the packet does print a unit, the packet wins.
 */
function amountFor(row: LabelRow, value: LabelValue): number | null {
  const { amount, unit } = value;
  if (row.target === 'salt') {
    // The declared salt figure divided by the regulated factor is the sodium
    // in it, which is the same arithmetic `readOffNutrition` does on the same
    // constant — the packet's salt line and Open Food Facts' salt field are
    // the same declaration.
    return convertNutrientAmount(amount / SALT_TO_SODIUM, unit ?? 'g', 'sodiumMg');
  }
  return convertNutrientAmount(amount, unit ?? NUTRIENT_STORED_UNIT[row.target], row.target);
}

/**
 * The basis each column's heading states, in column order.
 *
 * **A heading row is taken only when it names exactly as many bases as there
 * are columns**, which is what makes the mapping positional rather than
 * guessed: "Typical values | per 100g | per serving" over two columns of
 * figures is two headings for two columns in the order they were printed. A
 * row naming three bases over two columns has been misread, and inventing an
 * alignment for it would put the wrong label on the right numbers, which is
 * worse than leaving the person's own choice standing.
 *
 * A single basis stated anywhere is the fallback and applies to the first
 * column alone. That is the US panel, whose "Amount per serving" sits on its
 * own line above a single column.
 */
function readColumnBases(texts: readonly string[], count: number): (FoodNutrition['basis'] | null)[] {
  const stated = texts.map(text => [...text.matchAll(BASIS_PHRASE)].map(m => basisOfPhrase(m[0])));
  const aligned = stated.find(found => found.length === count);
  if (aligned) return aligned;
  const single = stated.find(found => found.length === 1);
  const bases: (FoodNutrition['basis'] | null)[] = new Array(count).fill(null);
  if (single) bases[0] = single[0];
  return bases;
}

/**
 * The serving line's own words and the gram weight it stated, if any.
 *
 * The text is taken from the row as printed rather than from the normalized
 * copy, since it goes into `servingText` to be read back to a person and
 * "2 cookies (30g)" should not come back as "2 cookies 30g".
 */
function readServing(printed: string): { text: string | null; grams: number | null } {
  const stripped = printed.replace(/^.*?\b(serving|portion)\s*size\b\s*:?\s*/i, '').trim();
  const grams = PAREN_GRAMS.exec(printed);
  return {
    text: stripped || null,
    grams: grams ? Number(grams[1].replace(',', '.')) : null,
  };
}

/**
 * A photographed panel's recognized lines, read as a proposed panel, or null
 * when the photo does not hold one.
 *
 * Null for every kind of not-a-panel — too few rows read, no figure recovered —
 * because the caller's branch is the same in all of them: say the photo could
 * not be read and leave the form as the person left it. There is no second
 * opinion to fall back on, since nothing here reaches the network.
 */
export function readNutritionLabel(lines: readonly RecognizedLine[]): LabelReading | null {
  const printed = groupRecognizedRows(lines).map(row => row.map(f => f.text.trim()).join(' '));
  const normalized = printed.map(normalizeRow);

  const rows: LabelRow[] = [];
  for (const text of normalized) {
    const row = readRow(text);
    if (row) rows.push(row);
  }
  if (rows.length < MIN_LABEL_ROWS) return null;

  const count = countColumns(rows);
  const bases = readColumnBases(normalized, count);

  const columns: LabelColumn[] = [];
  for (let index = 0; index < count; index++) {
    const amounts: Partial<Record<NutrientKey, number>> = {};
    for (const row of rows) {
      const key = row.target === 'salt' ? 'sodiumMg' : row.target;
      // First reading wins. A panel prints each nutrient once, so a second row
      // claiming one is a misread of a line further down rather than a
      // correction of the line above it.
      if (amounts[key] !== undefined) continue;
      const value = valueForColumn(row, index, count);
      if (!value) continue;
      const amount = amountFor(row, value);
      if (amount !== null) amounts[key] = amount;
    }
    // A column past the first that came out empty means `countColumns` counted
    // a column that is not there — a stray figure on enough rows to carry the
    // vote. Dropping it is better than asking the person to choose between a
    // set of figures and nothing.
    if (index > 0 && Object.keys(amounts).length === 0) continue;
    columns.push({ basis: bases[index] ?? null, amounts });
  }
  if (columns.length === 0 || Object.keys(columns[0].amounts).length === 0) return null;

  const servingIndex = normalized.findIndex(text => SERVING_ROW.test(text));
  const serving = servingIndex === -1
    ? { text: null, grams: null }
    : readServing(printed[servingIndex]);

  return {
    servingText: serving.text,
    servingGrams: serving.grams !== null && serving.grams > 0 ? serving.grams : null,
    columns,
  };
}

/**
 * The bridge is `require`d at call site, never imported, for the reason
 * `receiptOcr.ts` sets out: this module is reachable from a sheet Jest
 * typechecks, and a module-scope import pulls `expo-modules-core` into Jest's
 * `node` environment, which throws on sight.
 *
 * Everything above this line is pure and tested; everything below is the thin
 * orchestration around a native call, which is not.
 */
function visionBridge(): typeof import('todo-vision-bridge') {
  return require('todo-vision-bridge');
}

/**
 * Reads the nutrition panel photographed at `uri`, or null when there is
 * nothing worth having.
 *
 * Nothing here is allowed to throw. The caller is a sheet the person is part
 * way through filling in by hand, and a failed photograph must cost them the
 * photograph rather than the form.
 */
export async function readLabelPhoto(uri: string): Promise<LabelReading | null> {
  try {
    return readNutritionLabel(await visionBridge().recognizeText(uri));
  } catch (error) {
    console.warn('[labelOcr] on-device read failed', error);
    return null;
  }
}
