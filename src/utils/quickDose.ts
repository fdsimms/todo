import { DOSE_UNITS, medicationKey, type MedicationDose } from './medicationLog';

/**
 * "took ibuprofen 400mg" typed into quick add: a dose to record, not a task.
 *
 * Past tense only. "Take ibuprofen" is something to do later, which is a task,
 * and the line between the two is exactly the tense. Quick add is where
 * everything gets typed, so the parse is strict about the rest too: the line
 * has to name a medication you have recorded before, or state an amount in a
 * dose unit. "Took the car in" names neither and stays a task; "took 2 tablets
 * of melatonin" states one and is recorded even the first time.
 *
 * The name is matched back to the spelling already in the log
 * (`medicationKey`, the same exact-but-case-blind match the log uses), so a
 * dose typed in lowercase joins the existing medication rather than starting
 * a second one beside it.
 */

const UNIT_WORDS: Record<string, string> = {
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  mcg: 'mcg', 'µg': 'mcg', ug: 'mcg', microgram: 'mcg', micrograms: 'mcg',
  g: 'g', gram: 'g', grams: 'g',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  tablet: 'tablet', tablets: 'tablet', tab: 'tablet', tabs: 'tablet', pill: 'tablet', pills: 'tablet',
  capsule: 'capsule', capsules: 'capsule', cap: 'capsule', caps: 'capsule',
  drop: 'drop', drops: 'drop',
  puff: 'puff', puffs: 'puff',
  spray: 'spray', sprays: 'spray',
  unit: 'unit', units: 'unit',
};

const AMOUNT_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|')})\\b`,
  'i',
);

const LEAD_RE = /^\s*took\s+/i;
const FILLER = new Set(['a', 'an', 'my', 'some', 'of', 'the']);

/** The dose a quick-add line records, or null when the line is a task. */
export function parseQuickDose(text: string, vocabulary: readonly string[]): MedicationDose | null {
  if (!LEAD_RE.test(text)) return null;
  let rest = text.replace(LEAD_RE, '');

  let amount: number | null = null;
  let unit: string | null = null;
  const match = rest.match(AMOUNT_RE);
  if (match) {
    amount = Number(match[1]);
    unit = UNIT_WORDS[match[2].toLowerCase()] ?? null;
    rest = `${rest.slice(0, match.index)} ${rest.slice((match.index ?? 0) + match[0].length)}`;
  }
  if (unit && !DOSE_UNITS.some(u => u.value === unit)) { amount = null; unit = null; }

  const words = rest
    .replace(/[.,!;:]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 0 && FILLER.has(words[0].toLowerCase())) words.shift();
  while (words.length > 0 && FILLER.has(words[words.length - 1].toLowerCase())) words.pop();
  const typed = words.join(' ').trim();
  if (!typed) return null;

  const known = vocabulary.find(v => medicationKey(v) === medicationKey(typed));
  if (!known && amount === null) return null;
  return { name: known ?? typed, amount, unit };
}
