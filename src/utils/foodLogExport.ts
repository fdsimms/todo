/**
 * The food log as a file somebody else can read.
 *
 * The same argument `moodExport.ts` and `medicationExport.ts` make: a food
 * diary is a record somebody may want to hand a dietitian or a doctor, or open
 * in a spreadsheet of their own, and a backup is the wrong shape for that (it
 * is JSON for `parseBackup`, and it is the whole database).
 *
 * The rules those two follow, and three of its own:
 *
 * - **Every entry is a row, oldest first, and nothing is derived.** No daily
 *   totals, no target, no "over by". A spreadsheet sums a column on its own,
 *   and a total row in the file would be one more figure for a reader to
 *   mistake for something the person recorded.
 * - **An unknown figure is an empty cell, never a 0.** `FoodNutrition.amounts`
 *   is partial by design, and absent means unknown. Written out as 0 it would
 *   sum into every column total the reader makes, quietly wrong, which is the
 *   exact failure that rule exists to prevent in the app itself.
 * - **Where the figures came from is a column, in words.** A label, a typed
 *   panel and a model's estimate are three different things to put in front of
 *   somebody (see `FoodNutrition.source`), and a file that dropped the
 *   distinction would render an estimate the way it renders a label.
 *
 * The ids that point at a recipe, a catalog row, a product or a planned meal are
 * not exported: they are base36 ids that mean nothing outside this database,
 * and the label column already says what was eaten.
 */

import { format } from 'date-fns/format';
import {
  MEAL_SLOT_LABELS, NUTRIENT_KEYS,
  type FoodLogEntry, type FoodNutritionSource,
} from '../types';
import { csvCell } from './moodExport';
import { NUTRIENT_LABEL } from './foodNutrition';

const SOURCE_LABEL: Record<FoodNutritionSource, string> = {
  fdc: 'FoodData Central',
  openFoodFacts: 'Open Food Facts',
  manual: 'Entered by hand',
  estimated: 'AI estimate',
};

/** "Calories (cal)", "Protein (g)": the unit lives in the header, so a cell is a bare number. */
const NUTRIENT_COLUMNS = NUTRIENT_KEYS.map(k => `${NUTRIENT_LABEL[k].label} (${NUTRIENT_LABEL[k].unit})`);

export const FOOD_LOG_EXPORT_COLUMNS: readonly string[] = [
  'Day', 'Eaten at', 'Meal', 'Food', 'Amount', 'Grams', 'Figures from',
  ...NUTRIENT_COLUMNS,
];

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * A figure as a spreadsheet should read it: rounded to one decimal place, with
 * no trailing ".0". The stored values are scaled helpings (a third of a 245 cal
 * serving), so they carry floating-point tails nobody typed.
 */
function numberCell(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(Math.round(value * 10) / 10);
}

/**
 * The whole export, as CSV text.
 *
 * Ordered by the real instant, with the logical day beside it. The two differ
 * for anybody whose day starts after midnight, which is why both are here: the
 * same pair, for the same reason, as the mood and medication exports.
 */
export function foodLogExportCsv(entries: readonly FoodLogEntry[]): string {
  const ordered = [...entries].sort((a, b) =>
    a.dayKey.localeCompare(b.dayKey) || a.atISO.localeCompare(b.atISO));
  const rows = ordered.map(e => csvRow([
    e.dayKey,
    e.atISO,
    e.slot ? MEAL_SLOT_LABELS[e.slot] : '',
    e.label,
    e.quantity,
    numberCell(e.grams),
    SOURCE_LABEL[e.nutrition.source] ?? '',
    ...NUTRIENT_KEYS.map(k => numberCell(e.nutrition.amounts[k])),
  ]));
  // A trailing newline: a spreadsheet importing a file without one is the usual
  // way a last row goes missing.
  return [csvRow(FOOD_LOG_EXPORT_COLUMNS), ...rows].join('\n') + '\n';
}

/** `food-log-2026-10-01.csv`: dated, so two exports never collide. */
export function foodLogExportFileName(exportedAt: Date): string {
  return `food-log-${format(exportedAt, 'yyyy-MM-dd')}.csv`;
}

/**
 * "84 entries across 21 days from Sep 1, 2026 to Sep 30, 2026": what is about
 * to be shared, said before the share sheet opens rather than after.
 *
 * Names the days as well as the entries, since a food log runs several rows a
 * day and the span on its own doesn't say how much of it was logged.
 */
export function foodLogExportSummary(entries: readonly FoodLogEntry[]): string {
  if (entries.length === 0) return 'Nothing logged in this range.';
  const days = [...new Set(entries.map(e => e.dayKey))].sort();
  const count = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
  const span = `${days.length} ${days.length === 1 ? 'day' : 'days'}`;
  const from = format(new Date(`${days[0]}T12:00:00`), 'MMM d, yyyy');
  if (days.length === 1) return `${count} from ${from}.`;
  const to = format(new Date(`${days[days.length - 1]}T12:00:00`), 'MMM d, yyyy');
  return `${count} across ${span} from ${from} to ${to}.`;
}
